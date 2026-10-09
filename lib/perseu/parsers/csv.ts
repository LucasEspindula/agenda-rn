import {PERSEUS_LIMITS,PERSEUS_PARSER_VERSION,PerseusParseError,type PerseusParseResult} from '../contracts';
import {boundedCell,layoutFingerprint,structuralColumns} from '../normalize';

function decode(bytes:Uint8Array){
 const utf8=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
 if(!utf8.includes('\ufffd'))return {text:utf8.replace(/^\uFEFF/,''),encoding:'UTF-8'};
 return {text:new TextDecoder('windows-1252',{fatal:false}).decode(bytes).replace(/^\uFEFF/,''),encoding:'Windows-1252'};
}
function rowsOf(text:string,delimiter:string){
 const rows:string[][]=[];let row:string[]=[];let field='';let quoted=false;
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(quoted){if(char==='"'&&text[index+1]==='"'){field+='"';index++;}else if(char==='"')quoted=false;else field+=char;continue;}
  if(char==='"'){quoted=true;continue;}
  if(char===delimiter){row.push(field);field='';continue;}
  if(char==='\n'){row.push(field);rows.push(row);row=[];field='';continue;}
  if(char!=='\r')field+=char;
 }
 if(quoted)throw new PerseusParseError('CSV com aspas não finalizadas.');
 if(field.length||row.length){row.push(field);rows.push(row);}return rows;
}
function useful(row:string[]){return row.some(value=>value.trim()!=='');}
function delimiterFor(text:string){
 const candidates=[',',';','\t'];let best=',';let score=-1;
 for(const candidate of candidates){const rows=rowsOf(text,candidate).filter(useful).slice(0,12);if(!rows.length)continue;const counts=rows.map(row=>row.length);const frequency=counts.filter(count=>count===counts[0]).length;const next=frequency*100+counts[0];if(next>score){best=candidate;score=next;}}
 return best;
}
export function parseCsv(bytes:Uint8Array):PerseusParseResult{
 const decoded=decode(bytes),delimiter=delimiterFor(decoded.text),rows=rowsOf(decoded.text,delimiter).filter(useful);
 if(!rows.length)throw new PerseusParseError('CSV sem linhas utilizáveis.');
 const header=rows.shift()!;if(header.length>PERSEUS_LIMITS.maxColumns)throw new PerseusParseError('CSV excede o limite de colunas.');
 const columns=structuralColumns(header),items=[] as PerseusParseResult['items'];
 for(const [index,row] of rows.entries()){
  if(items.length>=PERSEUS_LIMITS.maxItems)throw new PerseusParseError('CSV excede o limite de linhas analisáveis.');
  const rawData:Record<string,unknown>={};for(let column=0;column<columns.length;column++)rawData[columns[column].original]=boundedCell(row[column]??'',PERSEUS_LIMITS.maxCellLength);
  items.push({sourceIndex:items.length,source:{row:index+2},rawData});
 }
 const sheets=[{name:'CSV',rowCount:items.length,columns}],layoutFingerprintValue=layoutFingerprint('CSV',sheets);
 return {format:'CSV',parserKey:'generic-csv',parserVersion:PERSEUS_PARSER_VERSION,layoutFingerprint:layoutFingerprintValue,structure:{rowCount:items.length,columnCount:columns.length,sheetCount:1,columns,sheets},items,warnings:[`Codificação detectada: ${decoded.encoding}.`,`Delimitador detectado: ${delimiter==='\t'?'TAB':delimiter}.`]};
}
