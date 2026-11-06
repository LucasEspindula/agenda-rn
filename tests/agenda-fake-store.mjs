// Banco em memória com a mesma semântica das RPCs da A1 (load_agenda_state,
// agenda_revision, agenda_row_bases, apply_agenda_changes). O SQL real é
// coberto por agenda-normalized-db.test.mjs.
const entities=['hospitals','patients','appointments','scheduleBlocks','schedulingRules'];
const legacyFinance=['payment','invoiceNumber','received_amount','paid_at','payment_status','total_amount','net_amount'];
const upsert={upsert_hospital:'hospitals',upsert_patient:'patients',upsert_appointment:'appointments',upsert_block:'scheduleBlocks',upsert_rule:'schedulingRules'};
const remove={archive_hospital:'hospitals',archive_patient:'patients',archive_appointment:'appointments',delete_block:'scheduleBlocks',delete_rule:'schedulingRules'};

export function fakeAgenda(initial,{start='2026-11-03T12:00:00.000Z'}={}){
 let revision=Date.parse(start);
 const rows=Object.fromEntries(entities.map(e=>[e,new Map()]));
 const versions=[],calls=[],audit=[],notifications=[];
 let history=structuredClone(initial.patientHistory||[]),settings=structuredClone(initial.settings||{workStart:'07:00',workEnd:'19:00'});
 const clean=(data,cancelled)=>{const copy=structuredClone(data);for(const key of legacyFinance)delete copy[key];if(!cancelled){delete copy.cancelledAt;delete copy.cancelReason}return copy};
 const record=(entity,id)=>{const row=rows[entity].get(id);versions.push({entity,id,version:row?row.version:(versions.filter(v=>v.entity===entity&&v.id===id).at(-1)?.version||0)+1,revision,data:row?{...structuredClone(row.data),_cancelled:row.cancelled}:null})};
 const put=(entity,id,data,cancelled=false)=>{const previous=rows[entity].get(id);rows[entity].set(id,{data:clean(data,cancelled),cancelled,version:(previous?.version||0)+1})};
 for(const entity of entities){
  const list=entity==='appointments'?[...(initial.appointments||[]).map(row=>[row,false]),...(initial.cancelledAppointments||[]).map(row=>[row,true])]:(initial[entity]||[]).map(row=>[row,false]);
  for(const [row,cancelled] of list){put(entity,row.id,row,cancelled);record(entity,row.id)}
 }
 const list=(entity,filter=()=>true)=>[...rows[entity].values()].filter(filter).map(row=>structuredClone(row.data));
 const state=()=>({schemaVersion:7,settings:structuredClone(settings),professionals:structuredClone(initial.professionals||[]),hospitals:list('hospitals'),patients:list('patients'),
  appointments:list('appointments',r=>!r.cancelled),cancelledAppointments:list('appointments',r=>r.cancelled),patientHistory:structuredClone(history),
  schedulingRules:list('schedulingRules'),scheduleBlocks:list('scheduleBlocks')});
 const iso=()=>new Date(revision).toISOString();
 const conflict=message=>({data:null,error:{code:'P0001',message:'Conflito de edição: '+message}});
 function apply(ops,p){
  const snapshot={rows:Object.fromEntries(entities.map(e=>[e,new Map([...rows[e]].map(([k,v])=>[k,structuredClone(v)]))])),history:structuredClone(history),settings:structuredClone(settings),versions:versions.length,revision};
  const rollback=()=>{for(const e of entities)rows[e]=snapshot.rows[e];history=snapshot.history;settings=snapshot.settings;versions.length=snapshot.versions;revision=snapshot.revision};
  revision=Math.max(Date.now(),revision+1);const touched=new Set();
  for(const op of ops){
   const id=op.data?.id??op.id;
   if(upsert[op.op]){
    const entity=upsert[op.op],current=rows[entity].get(id);
    if(op.expectedVersion==null?current:current?.version!==op.expectedVersion){rollback();return conflict(entity)}
    put(entity,id,op.data,!!op.cancelled);touched.add(entity+'|'+id);
   }else if(remove[op.op]){
    const entity=remove[op.op],current=rows[entity].get(id);
    if(!current||current.version!==op.expectedVersion){rollback();return conflict(entity)}
    rows[entity].delete(id);touched.add(entity+'|'+id);
   }else if(op.op==='append_history'){if(!history.some(h=>h.id===id))history.push(structuredClone(op.data))}
   else if(op.op==='save_settings')settings={...op.data};
   else throw new Error('unknown op '+op.op);
  }
  for(const key of touched){const [entity,id]=key.split('|');record(entity,id)}
  audit.push(...(p.p_audit||[]));if(p.p_notification)notifications.push(p.p_notification);
  return {data:{ok:true,revision:iso()},error:null};
 }
 const db={
  async rpc(name,p){
   calls.push({name,p:structuredClone(p)});
   if(name==='load_agenda_state')return {data:{state:state(),revision:iso()},error:null};
   // Mesma regra de public.load_agenda_window: consultas e histórico a partir de p_since.
   if(name==='load_agenda_window'){const full=state(),since=p.p_since;if(!since)return {data:{state:full,revision:iso()},error:null};const ids=new Set([...full.appointments,...full.cancelledAppointments].filter(a=>a.date>=since).map(a=>a.id));return {data:{state:{...full,appointments:full.appointments.filter(a=>a.date>=since),cancelledAppointments:full.cancelledAppointments.filter(a=>a.date>=since),patientHistory:(full.patientHistory||[]).filter(h=>String(h.at)>=since||ids.has(h.appointmentId))},revision:iso()},error:null}}
   if(name==='agenda_revision')return {data:iso(),error:null};
   if(name==='agenda_row_bases'){const at=Date.parse(p.p_revision);return {data:p.p_keys.map(({entity,id})=>{const base=versions.filter(v=>v.entity===entity&&v.id===id&&v.revision<=at).at(-1);return {entity,id,currentVersion:rows[entity].get(id)?.version??null,baseVersion:base?.version??null,base:base?.data??null}}),error:null}}
   if(name==='apply_agenda_changes')return apply(p.p_ops,p);
   throw new Error('unexpected rpc '+name);
  },
  from(table){throw new Error('unexpected table '+table)}
 };
 return {db,calls,audit,notifications,state,revision:iso,applies:()=>calls.filter(c=>c.name==='apply_agenda_changes')};
}
