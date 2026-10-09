import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {PERSEUS_LIMITS,PERSEUS_PARSER_VERSION,PerseusParseError,type PerseusParseResult,type PerseusSheet} from '../contracts';
import {boundedCell,layoutFingerprint,normalizeStructuralKey,structuralColumns} from '../normalize';

type Candidate={path:string;records:unknown[];depth:number};
function leaves(value:unknown,path:string,out:Record<string,unknown>,depth=0):void{
 if(depth>PERSEUS_LIMITS.maxXmlDepth)throw new PerseusParseError('XML excede o limite de profundidade.');
 if(value===null||typeof value!=='object'){out[path||'valor']=boundedCell(value,PERSEUS_LIMITS.maxCellLength);return;}
 if(Array.isArray(value)){value.forEach((entry,index)=>leaves(entry,`${path}[${index}]`,out,depth+1));return;}
 for(const [key,entry] of Object.entries(value as Record<string,unknown>))leaves(entry,path?`${path}.${key}`:key,out,depth+1);
}
function collect(value:unknown,path:string,depth:number,candidates:Candidate[],counter:{value:number}):void{
 counter.value++;if(counter.value>PERSEUS_LIMITS.maxXmlNodes)throw new PerseusParseError('XML excede o limite de nós.');
 if(depth>PERSEUS_LIMITS.maxXmlDepth)throw new PerseusParseError('XML excede o limite de profundidade.');
 if(Array.isArray(value)){if(value.length&&value.every(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)))candidates.push({path,records:value,depth});value.forEach((entry,index)=>collect(entry,`${path}[${index}]`,depth+1,candidates,counter));return;}
 if(value&&typeof value==='object')for(const [key,entry] of Object.entries(value as Record<string,unknown>))collect(entry,path?`${path}.${key}`:key,depth+1,candidates,counter);
}
export function parseXml(bytes:Uint8Array):PerseusParseResult{
 const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes).replace(/^\uFEFF/,'');
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new PerseusParseError('XML com DTD ou entidade externa não é aceito.');
 if(XMLValidator.validate(text)!==true)throw new PerseusParseError('XML malformado.');
 let parsed:unknown;try{parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:false,trimValues:false}).parse(text);}catch{throw new PerseusParseError('XML malformado.');}
 const candidates:Candidate[]=[];collect(parsed,'',0,candidates,{value:0});
 const candidate=candidates.sort((left,right)=>right.records.length-left.records.length||left.depth-right.depth)[0];
 if(!candidate)throw new PerseusParseError('XML sem lista repetitiva de registros.');
 if(candidate.records.length>PERSEUS_LIMITS.maxItems)throw new PerseusParseError('XML excede o limite de registros analisáveis.');
 const rows=candidate.records.map((record,index)=>{const rawData:Record<string,unknown>={};leaves(record,'',rawData);return {sourceIndex:index,source:{path:`${candidate.path}[${index}]`},rawData};});
 const headerNames=[...new Set(rows.flatMap(row=>Object.keys(row.rawData)))];if(headerNames.length>PERSEUS_LIMITS.maxColumns)throw new PerseusParseError('XML excede o limite de colunas.');
 const columns=structuralColumns(headerNames),sheet:PerseusSheet={name:normalizeStructuralKey(candidate.path)||'XML',rowCount:rows.length,columns};
 return {format:'XML',parserKey:'generic-xml',parserVersion:PERSEUS_PARSER_VERSION,layoutFingerprint:layoutFingerprint('XML',[sheet]),structure:{rowCount:rows.length,columnCount:columns.length,sheetCount:1,columns,sheets:[sheet]},items:rows,warnings:[]};
}
