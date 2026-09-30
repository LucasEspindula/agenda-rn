type Snapshot=Record<string,unknown>;
export type LogChange={id:number;record_type:string;record_id:string;action:string;before_data:Snapshot|null;after_data:Snapshot|null};
export type FinancialLog={id:string;actor_id?:number;actor_name:string;actor_email:string;kind:string;created_at:string;changes:LogChange[]};
export function collapseChanges(changes:LogChange[]){
 const result=new Map<string,LogChange>();
 for(const change of [...changes].sort((a,b)=>a.id-b.id)){const key=change.record_type+':'+change.record_id,old=result.get(key);result.set(key,old?{...old,after_data:change.after_data,action:old.before_data===null?'INSERT':change.after_data===null?'DELETE':'UPDATE'}:{...change});}
 return [...result.values()].map(c=>({...c,differences:[...new Set([...Object.keys(c.before_data||{}),...Object.keys(c.after_data||{})])].filter(k=>!['id','created_by','created_at','updated_by','updated_at','_labels'].includes(k)&&JSON.stringify(c.before_data?.[k]??null)!==JSON.stringify(c.after_data?.[k]??null)).map(field=>({field,before:c.before_data?.[field]??null,after:c.after_data?.[field]??null}))})).filter(c=>c.differences.length>0);
}

