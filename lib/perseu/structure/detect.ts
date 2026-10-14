import {PERSEUS_LIMITS,type PerseusDetectionEvidence,type PerseusRegion,type PerseusTable,type PerseusTableColumn} from '../contracts';
import {boundedCell,duplicateHeaderWarning,structuralColumns} from '../normalize';

export type StructuralMatrixRow={row:number;cells:unknown[]};
export type StructuralSource={sheet?:string};
type Span={start:number;end:number;values:unknown[]};
type Candidate={header:StructuralMatrixRow;span:Span;records:StructuralMatrixRow[];recordSpans:Span[];score:number;evidence:PerseusDetectionEvidence;warnings:string[]};
export type DetectedTable={table:PerseusTable;records:{row:number;rawData:Record<string,unknown>}[]};

const text=(value:unknown)=>String(value??'').trim();
const nonEmpty=(value:unknown)=>text(value)!=='';
const numeric=(value:unknown)=>typeof value==='number'||(/^[-+]?\d+(?:[.,]\d+)?$/).test(text(value));
const summary=(span:Span)=>/^(total|subtotal|total geral|grand total|rodape|observa[cç][aã]o)/i.test(text(span.values.find(nonEmpty)));
const headerLike=(span:Span)=>{const values=span.values.filter(nonEmpty);return values.length>0&&values.every(value=>!numeric(value));};
const auxiliary=(span:Span)=>/[:]|^(relat[oó]rio|emitido|compet[eê]ncia|data(?:\s|$))/i.test(text(span.values.find(nonEmpty)));

function spans(cells:unknown[]):Span[]{
 const result:Span[]=[];let start=-1;
 for(let index=0;index<=cells.length;index++){
  if(index<cells.length&&nonEmpty(cells[index])){if(start<0)start=index;continue;}
  if(start>=0){result.push({start,end:index-1,values:cells.slice(start,index)});start=-1;}
 }
 return result;
}
function compatible(left:Span,right:Span){
 const overlap=Math.max(0,Math.min(left.end,right.end)-Math.max(left.start,right.start)+1);
 const width=Math.max(left.end-left.start+1,right.end-right.start+1);
 return overlap>0&&right.end<=left.end&&overlap/width>.5;
}
function headerScore(span:Span){
 const values=span.values.filter(nonEmpty),words=values.filter(value=>!numeric(value)).length;
 return values.length*4+words*3+(new Set(values.map(text)).size===values.length?2:0);
}
function candidate(rows:StructuralMatrixRow[],index:number,span:Span):Candidate|null{
 const records:StructuralMatrixRow[]=[];const recordSpans:Span[]=[];let blankGap=0;
 for(let next=index+1;next<rows.length;next++){
  const nextSpans=spans(rows[next].cells);
  if(!nextSpans.length){if(!records.length||++blankGap>1)break;continue;}
  const hadGap=blankGap>0;
  blankGap=0;
  const match=nextSpans.find(value=>compatible(span,value));
  if(!match){if(records.length)break;continue;}
  if(summary(match)||(hadGap&&headerLike(match)))break;
  records.push(rows[next]);recordSpans.push(match);
  if(records.length>=PERSEUS_LIMITS.maxItems)break;
 }
 if(!records.length)return null;
 // A one-column document can be a legitimate table (for example, Nome/Ana).
 // Only discard the common title/date pair when it has an explicit auxiliary signal.
 if(records.length===1&&span.values.filter(nonEmpty).length===1&&headerLike(span)&&headerLike(recordSpans[0])&&(auxiliary(span)||auxiliary(recordSpans[0])))return null;
 const regular=recordSpans.filter(value=>compatible(span,value)).length/recordSpans.length;
 const columnCount=span.values.filter(nonEmpty).length;
 const score=headerScore(span)+records.length*5+Math.round(regular*8);
 const classification:PerseusDetectionEvidence['classification']=records.length>=2&&regular===1?'clear':records.length===1?'probable':'ambiguous';
 const signals=[`${columnCount} coluna${columnCount===1?'':'s'} no cabeçalho`,`${records.length} registro${records.length===1?'':'s'} contíguo${records.length===1?'':'s'}`,regular===1?'campos regulares':'campos parcialmente regulares'];
 const warnings=classification==='clear'?[]:['Estrutura exige revisão por ter poucos registros ou campos irregulares.'];
 return {header:rows[index],span,records,recordSpans,score,evidence:{classification,signals},warnings};
}
function overlaps(candidate:Candidate,selected:Candidate){
 const rowOverlap=candidate.header.row<=selected.records.at(-1)!.row&&selected.header.row<=candidate.records.at(-1)!.row;
 const columnOverlap=Math.max(candidate.span.start,selected.span.start)<=Math.min(candidate.span.end,selected.span.end);
 return rowOverlap&&columnOverlap;
}

export function detectTabularStructures(rows:StructuralMatrixRow[],source:StructuralSource,tablePrefix:string):DetectedTable[]{
 const candidates:Candidate[]=[];
 for(let index=0;index<rows.length;index++)for(const span of spans(rows[index].cells)){const next=candidate(rows,index,span);if(next)candidates.push(next);}
 const selected:Candidate[]=[],hasClear=candidates.some(item=>item.evidence.classification==='clear');
 for(const next of [...candidates].sort((a,b)=>b.score-a.score||a.header.row-b.header.row||a.span.start-b.span.start)){
  if(hasClear&&next.evidence.classification!=='clear'&&next.span.values.filter(nonEmpty).length===1)continue;
  if(!selected.some(current=>overlaps(next,current)))selected.push(next);
 }
 const ordered=selected.sort((a,b)=>a.header.row-b.header.row||a.span.start-b.span.start);
 return ordered.map((entry,index)=>{
  const tableId=`${tablePrefix}-table-${index+1}`;
  const baseColumns=structuralColumns(entry.span.values);
  const columns:PerseusTableColumn[]=baseColumns.map((column,columnIndex)=>({...column,position:entry.span.start+columnIndex+1}));
  const duplicate=duplicateHeaderWarning(baseColumns);if(duplicate)entry.warnings.push(duplicate);
  const rowEnd=entry.records.at(-1)!.row;
  const region:PerseusRegion={rowStart:entry.header.row,rowEnd,columnStart:entry.span.start+1,columnEnd:entry.span.end+1};
  const table:PerseusTable={tableId,source,region,headerLocation:{row:entry.header.row,column:entry.span.start+1},columns,recordCount:entry.records.length,detectionEvidence:entry.evidence,warnings:entry.warnings};
  const records=entry.records.map((record,recordIndex)=>{
   const sourceSpan=entry.recordSpans[recordIndex];const rawData:Record<string,unknown>={};
   for(let column=0;column<columns.length;column++)rawData[columns[column].key]=boundedCell(record.cells[entry.span.start+column]??'',PERSEUS_LIMITS.maxCellLength);
   if(sourceSpan.start!==entry.span.start)table.warnings.push('Alguns registros possuem deslocamento horizontal e exigem revisão.');
   return {row:record.row,rawData};
  });
  table.warnings=[...new Set(table.warnings)];
  return {table,records};
 });
}
