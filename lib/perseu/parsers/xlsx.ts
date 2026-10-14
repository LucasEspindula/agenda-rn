import * as XLSX from 'xlsx';
import {PERSEUS_LIMITS,PERSEUS_PARSER_VERSION,PerseusParseError,type PerseusParseResult,type PerseusSheet} from '../contracts';
import {boundedCell,layoutFingerprint} from '../normalize';
import {detectTabularStructures,type StructuralMatrixRow} from '../structure/detect';

function physicalRows(sheet:XLSX.WorkSheet):StructuralMatrixRow[]{
 const ref=sheet['!ref'];if(!ref)return [];
 const range=XLSX.utils.decode_range(ref),width=range.e.c-range.s.c+1,height=range.e.r-range.s.r+1;
 if(width>PERSEUS_LIMITS.maxColumns)throw new PerseusParseError('Planilha excede o limite de colunas.');
 if(height>PERSEUS_LIMITS.maxRows)throw new PerseusParseError('Planilha excede o limite de linhas analisáveis.');
 const rows:StructuralMatrixRow[]=[];
 for(let row=range.s.r;row<=range.e.r;row++){
  const cells:unknown[]=[];
  for(let column=range.s.c;column<=range.e.c;column++)cells.push(boundedCell(sheet[XLSX.utils.encode_cell({r:row,c:column})]?.v??null,PERSEUS_LIMITS.maxCellLength));
  rows.push({row:row+1,cells});
 }
 return rows;
}
export function parseXlsx(bytes:Uint8Array):PerseusParseResult{
 const workbook=XLSX.read(Buffer.from(bytes),{type:'buffer',cellFormula:false,cellDates:false,raw:true});
 const names=workbook.SheetNames.slice(0,PERSEUS_LIMITS.maxSheets);if(!names.length)throw new PerseusParseError('Planilha sem abas utilizáveis.');
 const items:PerseusParseResult['items']=[],sheets:PerseusSheet[]=[];const warnings:string[]=[];
 if(workbook.SheetNames.length>names.length)warnings.push('Foram consideradas apenas as primeiras abas dentro do limite de segurança.');
 for(const name of names){
  const tables=detectTabularStructures(physicalRows(workbook.Sheets[name]),{sheet:name},`xlsx-${name.replace(/[^a-z0-9]+/gi,'_').toLowerCase()||'sheet'}`);
  for(const detected of tables)for(const record of detected.records){
   if(items.length>=PERSEUS_LIMITS.maxItems)throw new PerseusParseError('Planilha excede o limite de linhas analisáveis.');
   items.push({sourceIndex:items.length,source:{sheet:name,row:record.row,tableId:detected.table.tableId,region:detected.table.region},rawData:record.rawData});
  }
  const columns=tables[0]?.table.columns.map(column=>{const {position:_position,...rest}=column;return rest;})||[];
  sheets.push({name,rowCount:tables.reduce((count,item)=>count+item.records.length,0),columns,tables:tables.map(item=>item.table)});
  if(!tables.length)warnings.push(`Aba ${name} sem estrutura tabular identificável.`);
  warnings.push(...tables.flatMap(item=>item.table.warnings.map(warning=>`Aba ${name}: ${warning}`)));
 }
 const tables=sheets.flatMap(sheet=>sheet.tables||[]);
 if(!sheets.length)throw new PerseusParseError('Planilha sem abas utilizáveis.');
 return {format:'XLSX',parserKey:'adaptive-xlsx',parserVersion:PERSEUS_PARSER_VERSION,layoutFingerprint:layoutFingerprint('XLSX',sheets,tables),structure:{rowCount:items.length,columnCount:Math.max(0,...tables.map(table=>table.columns.length)),sheetCount:sheets.length,sheets,tables,fingerprintVersion:2},items,warnings};
}
