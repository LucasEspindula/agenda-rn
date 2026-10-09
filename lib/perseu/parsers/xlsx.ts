import * as XLSX from 'xlsx';
import {PERSEUS_LIMITS,PERSEUS_PARSER_VERSION,PerseusParseError,type PerseusParseResult,type PerseusSheet} from '../contracts';
import {boundedCell,layoutFingerprint,structuralColumns} from '../normalize';

function usable(row:unknown[]){return row.some(value=>value!==null&&value!==undefined&&String(value).trim()!=='');}
export function parseXlsx(bytes:Uint8Array):PerseusParseResult{
 const workbook=XLSX.read(Buffer.from(bytes),{type:'buffer',cellFormula:false,cellDates:false,raw:true});
 const names=workbook.SheetNames.slice(0,PERSEUS_LIMITS.maxSheets);if(!names.length)throw new PerseusParseError('Planilha sem abas utilizáveis.');
 const items:PerseusParseResult['items']=[],sheets:PerseusSheet[]=[];const warnings:string[]=[];
 if(workbook.SheetNames.length>names.length)warnings.push('Foram consideradas apenas as primeiras abas dentro do limite de segurança.');
 for(const name of names){
  const rows=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name],{header:1,raw:true,defval:null,blankrows:false});
  const headerIndex=rows.findIndex(usable);if(headerIndex<0){warnings.push(`Aba ${name} sem linhas utilizáveis.`);continue;}
  const header=rows[headerIndex];if(header.length>PERSEUS_LIMITS.maxColumns)throw new PerseusParseError('Planilha excede o limite de colunas.');
  const columns=structuralColumns(header),before=items.length;
  for(let index=headerIndex+1;index<rows.length;index++){
   const row=rows[index];if(!usable(row))continue;if(items.length>=PERSEUS_LIMITS.maxItems)throw new PerseusParseError('Planilha excede o limite de linhas analisáveis.');
   const rawData:Record<string,unknown>={};for(let column=0;column<columns.length;column++)rawData[columns[column].original]=boundedCell(row[column],PERSEUS_LIMITS.maxCellLength);
   items.push({sourceIndex:items.length,source:{sheet:name,row:index+1},rawData});
  }
  sheets.push({name,rowCount:items.length-before,columns});
 }
 if(!sheets.length)throw new PerseusParseError('Planilha sem dados estruturados.');
 const columnCount=Math.max(...sheets.map(sheet=>sheet.columns.length));
 return {format:'XLSX',parserKey:'generic-xlsx',parserVersion:PERSEUS_PARSER_VERSION,layoutFingerprint:layoutFingerprint('XLSX',sheets),structure:{rowCount:items.length,columnCount,sheetCount:sheets.length,sheets},items,warnings};
}
