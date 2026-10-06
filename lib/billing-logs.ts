type Snapshot=Record<string,unknown>;
export type LogChange={id:number;record_type:string;record_id:string;action:string;before_data:Snapshot|null;after_data:Snapshot|null};
export type FinancialLog={id:string;actor_id?:number;actor_name:string;actor_email:string;kind:string;created_at:string;changes:LogChange[]};
const ignoredFields=new Set(['id','created_by','created_at','updated_by','updated_at','_labels']);
export function isTechnicalIdentifier(value:unknown){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
export function collapseChanges(changes:LogChange[]){
 const result=new Map<string,LogChange>();
 for(const change of [...changes].sort((a,b)=>a.id-b.id)){const key=change.record_type+':'+change.record_id,old=result.get(key);result.set(key,old?{...old,after_data:change.after_data,action:old.before_data===null?'INSERT':change.after_data===null?'DELETE':'UPDATE'}:{...change});}
 return [...result.values()].map(c=>({...c,differences:[...new Set([...Object.keys(c.before_data||{}),...Object.keys(c.after_data||{})])].filter(k=>!ignoredFields.has(k)&&JSON.stringify(c.before_data?.[k]??null)!==JSON.stringify(c.after_data?.[k]??null)).map(field=>({field,before:c.before_data?.[field]??null,after:c.after_data?.[field]??null}))})).filter(c=>c.differences.length>0);
}

export type PresentedLogDifference={field:string;before:unknown|null;after:unknown|null};
function hasLogValue(value:unknown){if(value==null)return false;if(typeof value==="string")return value.trim()!=="";if(Array.isArray(value))return value.length>0;return true}
export function presentLogDifferences(differences:{field:string;before:unknown;after:unknown}[]):PresentedLogDifference[]{return differences.flatMap(d=>{const before=hasLogValue(d.before)?d.before:null,after=hasLogValue(d.after)?d.after:null;return before===null&&after===null?[]:[{field:d.field,before,after}]})}
