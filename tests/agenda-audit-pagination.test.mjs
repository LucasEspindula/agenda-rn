import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const records=Array.from({length:35},(_,i)=>({id:'log-'+i,actor_name:'Roseni',actor_role:'secretary',action:'appointment_created',professional_id:i%2?'dr2':'dr1',appointment_id:'at-'+i,patient_id:'patient',created_at:new Date(Date.UTC(2026,9,28,12,0,0)-i*1000).toISOString(),metadata:{before:null,after:{procedure:'Consulta '+i}}}));
function setup(role='general_manager',agendaIds=['dr1'],leaky=false){
 const calls=[];
 const db={from(table){
  let items=table==='audit_logs'?records:[];
  const query={
   select(){return query},
   eq(field,value){calls.push(['eq',table,field,value]);return query},
   in(field,values){calls.push(['in',table,field,values]);if(!leaky)items=items.filter(row=>values.includes(row[field]));return query},
   lt(field,value){calls.push(['lt',field,value]);items=items.filter(row=>row[field]<value);return query},
   order(field,{ascending}){items.sort((a,b)=>ascending?String(a[field]).localeCompare(String(b[field])):String(b[field]).localeCompare(String(a[field])));return query},
   limit(n){calls.push(['limit',table,n]);return Promise.resolve({data:items.slice(0,n),error:null})}
  };return query;
 }};
 const {GET}=loadTs('app/api/workflow/logs/route.ts',{
  '@/app/authz':{getSession:async()=>({account:{role,id:1},organization:{id:'org-1'},agendaIds}),isManager:r=>r==='general_manager'},
  '@/lib/doctor-services':{canUseAgenda:()=>true},
  '@/lib/supabase-admin':{getSupabaseAdmin:()=>db,dbError:e=>{if(e)throw e}}
 });
 return {GET,calls};
}
test('logs da agenda são buscados sob demanda em páginas de 25',async()=>{
 const {GET,calls}=setup();
 const first=await(await GET(new Request('https://rn.test/api/workflow/logs'))).json();
 assert.equal(first.logs.length,25);
 assert.equal(first.next,records[24].created_at);
 assert.ok(calls.some(c=>c[0]==='limit'&&c[2]===26));
 const next=await(await GET(new Request('https://rn.test/api/workflow/logs?cursor='+encodeURIComponent(first.next)))).json();
 assert.equal(next.logs.length,10);
 assert.equal(next.next,null);
 assert.ok(next.logs.every(row=>!first.logs.some(firstRow=>firstRow.id===row.id)));
});
test('médicos são bloqueados e secretárias recebem apenas suas agendas mesmo com consulta defeituosa',async()=>{
 const doctor=setup('doctor');
 assert.equal((await doctor.GET(new Request('https://rn.test/api/workflow/logs'))).status,403);
 const secretary=setup('secretary',['dr1'],true);
 const result=await(await secretary.GET(new Request('https://rn.test/api/workflow/logs'))).json();
 assert.ok(result.logs.length>0);
 assert.ok(result.logs.every(row=>row.professionalId==='dr1'));
 const i=secretary.calls.findIndex(c=>c[0]==='in'&&c[1]==='audit_logs'),n=secretary.calls.findIndex(c=>c[0]==='limit');
 assert.ok(i>=0&&i<n);
});
test('agenda não transfere mais 500 logs no refresh e consulta histórico só ao abrir a seção',()=>{
 const api=readFileSync('app/api/workflow/route.ts','utf8'),ui=readFileSync('public/legacy-app.js','utf8');
 assert.doesNotMatch(api,/\.limit\(500\)/);
 assert.match(api,/audit: \[\]/);
 assert.match(ui,/if\(view==="audit"&&!agendaAuditLoaded\)void loadAgendaAudit\(\)/);
 assert.match(ui,/id="auditLoadMore"/);
 assert.match(ui,/workflowData=\{\.\.\.result,audit:workflowData\.audit\|\|\[\]\}/);
});
test('faturamento limita o lote inicial a 25 eventos com cursor incremental',()=>{
 const api=readFileSync('app/api/billing/logs/route.ts','utf8'),ui=readFileSync('app/billing/billing-logs.tsx','utf8');
 assert.match(api,/\.limit\(26\)/);
 assert.match(api,/logs\.slice\(0,25\)/);
 assert.match(api,/logs\.length>25\?logs\[24\]\.created_at:null/);
 assert.match(ui,/>Carregar mais<\/button>/);
});
