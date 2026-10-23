import {PERSEUS_LIMITS,PERSEUS_PARSER_VERSION,PerseusParseError,type PerseusParseResult,type PerseusSheet} from '../contracts';
import {boundedCell,layoutFingerprint} from '../normalize';
import {detectTabularStructures,type StructuralMatrixRow} from '../structure/detect';

type CsvRow={row:number;cells:string[]};
function decode(bytes:Uint8Array){
 const utf8=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
 if(!utf8.includes('\ufffd'))return {text:utf8.replace(/^\uFEFF/,''),encoding:'UTF-8'};
 return {text:new TextDecoder('windows-1252',{fatal:false}).decode(bytes).replace(/^\uFEFF/,''),encoding:'Windows-1252'};
}
function rowsOf(text:string,delimiter:string){
 const rows:CsvRow[]=[];let row:string[]=[];let field='';let quoted=false;let physicalRow=1;let rowStart=1;
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(quoted){if(char==='"'&&text[index+1]==='"'){field+='"';index++;}else if(char==='"')quoted=false;else{field+=char;if(char==='\n')physicalRow++;}continue;}
  if(char==='"'){quoted=true;continue;}
  if(char===delimiter){row.push(field);field='';continue;}
  if(char==='\n'){row.push(field);rows.push({row:rowStart,cells:row});row=[];field='';physicalRow++;rowStart=physicalRow;continue;}
  if(char!=='\r')field+=char;
 }
 if(quoted)throw new PerseusParseError('CSV com aspas não finalizadas.');
 if(field.length||row.length){row.push(field);rows.push({row:rowStart,cells:row});}
 return rows;
}
function useful(row:CsvRow){return row.cells.some(value=>value.trim()!=='');}
function delimiterFor(text:string){
 const candidates=[',',';','\t'];let best=',';let score=-1;
 for(const candidate of candidates){const rows=rowsOf(text,candidate).filter(useful).slice(0,80);if(!rows.length)continue;const counts=rows.map(row=>row.cells.length),multi=counts.filter(count=>count>1);const mostCommon=multi.length?Math.max(...multi.map(count=>multi.filter(other=>other===count).length)):0;const next=multi.length*1000+mostCommon*100+Math.max(...counts);if(next>score){best=candidate;score=next;}}
 return best;
}
export function parseCsv(bytes:Uint8Array):PerseusParseResult{
 const decoded=decode(bytes),delimiter=delimiterFor(decoded.text),csvRows=rowsOf(decoded.text,delimiter);
 if(!csvRows.some(useful))throw new PerseusParseError('CSV sem linhas utilizáveis.');
 if(csvRows.length>PERSEUS_LIMITS.maxRows)throw new PerseusParseError('CSV excede o limite de linhas analisáveis.');
 // Headers and footers need some headroom, but do not scan thousands more
 // populated lines than can ever be persisted as document items.
 if(csvRows.filter(useful).length>PERSEUS_LIMITS.maxItems+PERSEUS_LIMITS.maxColumns)
  throw new PerseusParseError('CSV excede o limite de linhas analisáveis.');
 const maxColumns=Math.max(...csvRows.map(row=>row.cells.length));if(maxColumns>PERSEUS_LIMITS.maxColumns)throw new PerseusParseError('CSV excede o limite de colunas.');
 for(const row of csvRows)for(const cell of row.cells)boundedCell(cell,PERSEUS_LIMITS.maxCellLength);
 const tables=detectTabularStructures(csvRows as StructuralMatrixRow[],{},'csv');
 const items:PerseusParseResult['items']=[];const warnings=[`Codificação detectada: ${decoded.encoding}.`,`Delimitador detectado: ${delimiter==='\t'?'TAB':delimiter}.`];
 for(const detected of tables)for(const record of detected.records){
  if(items.length>=PERSEUS_LIMITS.maxItems)throw new PerseusParseError('CSV excede o limite de linhas analisáveis.');
  items.push({sourceIndex:items.length,source:{row:record.row,tableId:detected.table.tableId,region:detected.table.region},rawData:record.rawData});
 }
 if(!tables.length)warnings.push('Nenhuma estrutura tabular pôde ser determinada com segurança; não foram criados registros.');
 const columns=tables[0]?.table.columns.map(column=>{const {position:_position,...rest}=column;return rest;})||[];
 const sheet:PerseusSheet={name:'CSV',rowCount:items.length,columns,tables:tables.map(item=>item.table)};
 return {format:'CSV',parserKey:'adaptive-csv',parserVersion:PERSEUS_PARSER_VERSION,layoutFingerprint:layoutFingerprint('CSV',[sheet],sheet.tables),structure:{rowCount:items.length,columnCount:Math.max(0,...tables.map(item=>item.table.columns.length)),sheetCount:1,columns,sheets:[sheet],tables:sheet.tables,fingerprintVersion:2},items,warnings:[...warnings,...tables.flatMap(item=>item.table.warnings)]};
}
