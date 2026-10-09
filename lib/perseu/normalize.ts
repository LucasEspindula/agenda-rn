import {createHash} from 'node:crypto';
import {PerseusParseError} from './contracts';
import type {PerseusColumn,PerseusFormat,PerseusSheet} from './contracts';

export function normalizeStructuralKey(value:unknown){
 return String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/_+/g,'_');
}

export function structuralColumns(headers:unknown[]):PerseusColumn[]{
 const seen=new Map<string,number>();
 return headers.map((header,index)=>{
  const original=String(header??'').trim()||`Coluna ${index+1}`;
  const base=normalizeStructuralKey(original)||`coluna_${index+1}`;
  const count=(seen.get(base)||0)+1;seen.set(base,count);
  return {original,key:count===1?original:`${original} [${count}]`,normalized:count===1?base:`${base}_${count}`};
 });
}

export function duplicateHeaderWarning(columns:PerseusColumn[]){
 const duplicates=columns.filter(column=>column.key!==column.original).map(column=>column.original);
 return duplicates.length?`Cabeçalhos duplicados preservados com chaves distintas: ${[...new Set(duplicates)].join(', ')}.`:null;
}

export function layoutFingerprint(format:PerseusFormat,sheets:PerseusSheet[]){
 const layout={format,sheets:sheets.map(sheet=>({name:sheet.name,columns:sheet.columns.map(column=>column.normalized),columnCount:sheet.columns.length}))};
 return createHash('sha256').update(JSON.stringify(layout)).digest('hex');
}

export function boundedCell(value:unknown,maximum:number){
 if(value===null||value===undefined)return null;
 const text=typeof value==='string'?value:String(value);
 if(text.length>maximum)throw new PerseusParseError('O arquivo excede o limite de tamanho de célula.');
 return value;
}
