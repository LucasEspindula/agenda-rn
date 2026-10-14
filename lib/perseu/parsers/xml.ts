import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {PERSEUS_LIMITS,PERSEUS_PARSER_VERSION,PerseusParseError,type PerseusParseResult,type PerseusSheet,type PerseusTable} from '../contracts';
import {boundedCell,duplicateHeaderWarning,layoutFingerprint,structuralColumns} from '../normalize';

type Candidate={path:string;records:Record<string,unknown>[];depth:number;fields:string[];score:number};
function leaves(value:unknown,path:string,out:Record<string,unknown>,depth=0):void{
 if(depth>PERSEUS_LIMITS.maxXmlDepth)throw new PerseusParseError('XML excede o limite de profundidade.');
 if(value===null||typeof value!=='object'){out[path||'valor']=boundedCell(value,PERSEUS_LIMITS.maxCellLength);return;}
 if(Array.isArray(value)){value.forEach((entry,index)=>leaves(entry,`${path}[${index}]`,out,depth+1));return;}
 for(const [key,entry] of Object.entries(value as Record<string,unknown>))leaves(entry,path?`${path}.${key}`:key,out,depth+1);
}
function candidateFields(records:Record<string,unknown>[]){
 return records.map(record=>{const fields:Record<string,unknown>={};leaves(record,'',fields);return Object.keys(fields);});
}
function collect(value:unknown,path:string,depth:number,candidates:Candidate[],counter:{value:number}):void{
 counter.value++;if(counter.value>PERSEUS_LIMITS.maxXmlNodes)throw new PerseusParseError('XML excede o limite de nós.');
 if(depth>PERSEUS_LIMITS.maxXmlDepth)throw new PerseusParseError('XML excede o limite de profundidade.');
 if(Array.isArray(value)){
  if(value.length&&value.every(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry))){
   const records=value as Record<string,unknown>[],sets=candidateFields(records),fields=[...new Set(sets.flat())],homogeneity=sets.reduce((sum,set)=>sum+(set.length?set.filter(field=>fields.includes(field)).length/set.length:0),0)/sets.length;
   candidates.push({path,records,depth,fields,score:Math.round(homogeneity*100)+Math.min(records.length,50)*4-depth});
  }
  value.forEach((entry,index)=>collect(entry,`${path}[${index}]`,depth+1,candidates,counter));return;
 }
 if(value&&typeof value==='object')for(const [key,entry] of Object.entries(value as Record<string,unknown>))collect(entry,path?`${path}.${key}`:key,depth+1,candidates,counter);
}
function nested(path:string,parent:string){return path.startsWith(parent+'.')||path.startsWith(parent+'[');}
export function parseXml(bytes:Uint8Array):PerseusParseResult{
 const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes).replace(/^\uFEFF/,'');
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new PerseusParseError('XML com DTD ou entidade externa não é aceito.');
 if(XMLValidator.validate(text)!==true)throw new PerseusParseError('XML malformado.');
 let parsed:unknown;try{parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:false,trimValues:false}).parse(text);}catch{throw new PerseusParseError('XML malformado.');}
 const candidates:Candidate[]=[];collect(parsed,'',0,candidates,{value:0});
 const selected:Candidate[]=[];
 for(const candidate of [...candidates].sort((left,right)=>right.score-left.score||left.path.localeCompare(right.path)))if(!selected.some(current=>nested(candidate.path,current.path)||nested(current.path,candidate.path)))selected.push(candidate);
 const items:PerseusParseResult['items']=[],tables:PerseusTable[]=[];const warnings:string[]=[];
 for(const [index,candidate] of selected.sort((left,right)=>left.path.localeCompare(right.path)).entries()){
  if(candidate.records.length>PERSEUS_LIMITS.maxItems-items.length)throw new PerseusParseError('XML excede o limite de registros analisáveis.');
  if(candidate.fields.length>PERSEUS_LIMITS.maxColumns)throw new PerseusParseError('XML excede o limite de colunas.');
  const columns=structuralColumns(candidate.fields).map((column,position)=>({...column,position:position+1}));
  const duplicate=duplicateHeaderWarning(columns),tableId=`xml-table-${index+1}`;
  const table:PerseusTable={tableId,source:{path:candidate.path},region:{path:candidate.path},headerLocation:{path:candidate.path},columns,recordCount:candidate.records.length,detectionEvidence:{classification:candidate.records.length>1?'clear':'probable',signals:[`${candidate.records.length} elemento${candidate.records.length===1?'':'s'} homogêneo${candidate.records.length===1?'':'s'}`,`${columns.length} campo${columns.length===1?'':'s'} estrutural${columns.length===1?'':'is'}`]},warnings:duplicate?[duplicate]:[]};
  tables.push(table);
  candidate.records.forEach((record,recordIndex)=>{const rawData:Record<string,unknown>={};leaves(record,'',rawData);items.push({sourceIndex:items.length,source:{path:`${candidate.path}[${recordIndex}]`,tableId,region:table.region},rawData});});
 }
 if(!tables.length)warnings.push('Nenhuma coleção repetitiva pôde ser determinada com segurança; não foram criados registros.');
 const columns=tables[0]?.columns.map(column=>{const {position:_position,...rest}=column;return rest;})||[],sheet:PerseusSheet={name:'XML',rowCount:items.length,columns,tables};
 return {format:'XML',parserKey:'adaptive-xml',parserVersion:PERSEUS_PARSER_VERSION,layoutFingerprint:layoutFingerprint('XML',[sheet],tables),structure:{rowCount:items.length,columnCount:Math.max(0,...tables.map(table=>table.columns.length)),sheetCount:1,columns,sheets:[sheet],tables,fingerprintVersion:2},items,warnings:[...warnings,...tables.flatMap(table=>table.warnings)]};
}
