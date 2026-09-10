import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const source=readFileSync(new URL('../app/api/state/route.ts',import.meta.url),'utf8');
function fixture({role='general_manager',stale=false,authenticated=true}={}){
 const writes=[],audit=[];
 const row={updated_at:'2026-09-10T10:00:00.000Z',payload:{appointments:[{id:'a',doctorId:'one',status:'scheduled'},{id:'b',doctorId:'two',status:'scheduled'}],patients:[],cancelledAppointments:[]}};
 const db={from(table){let operation='read',payload;const filters=[];const chain={
  select(){return chain},eq(key,value){filters.push([key,value]);return chain},
  update(value){operation='update';payload=value;return chain},
  insert(value){if(table==='audit_logs'){audit.push(...value);return Promise.resolve({error:null})}operation='insert';payload=value;return chain},
  async maybeSingle(){if(operation==='read')return {data:structuredClone(row),error:null};writes.push({payload,filters});return {data:stale?null:{id:1},error:null}}
 };return chain}};
 const exports={};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Response,Request,crypto:webcrypto,require(name){
  if(name.includes('authz'))return {getSession:async()=>authenticated?{account:{id:1,name:'Manager',role},agendaIds:['one']}:null,isManager:r=>r==='general_manager'};
  return {getSupabaseAdmin:()=>db,dbError:error=>{if(error)throw error}};
 }});
 return {api:exports,row,writes,audit};
}
const request=(state,revision)=>new Request('http://localhost/api/state',{method:'PUT',headers:{'content-type':'application/json','if-match':revision},body:JSON.stringify(state)});
test('rejects unauthenticated writes',async()=>{const f=fixture({authenticated:false});assert.equal((await f.api.PUT(request({},'old'))).status,403);assert.equal(f.writes.length,0)});
test('rejects a stale client without writing data or history',async()=>{const f=fixture();assert.equal((await f.api.PUT(request(f.row.payload,'old'))).status,409);assert.equal(f.writes.length,0);assert.equal(f.audit.length,0)});
test('rejects a concurrent write detected by the database compare-and-set',async()=>{const f=fixture({stale:true});assert.equal((await f.api.PUT(request(f.row.payload,f.row.updated_at))).status,409);assert.ok(f.writes[0].filters.some(([key,value])=>key==='updated_at'&&value===f.row.updated_at));assert.equal(f.audit.length,0)});
test('saves a status change with one audit entry and a new revision',async()=>{const f=fixture();const next=structuredClone(f.row.payload);next.appointments[0].status='confirmed';const response=await f.api.PUT(request(next,f.row.updated_at));assert.equal(response.status,200);assert.ok((await response.json()).revision);assert.equal(f.audit.length,1);assert.equal(f.audit[0].appointment_id,'a')});
test('a no-op save does not create appointment history',async()=>{const f=fixture();assert.equal((await f.api.PUT(request(f.row.payload,f.row.updated_at))).status,200);assert.equal(f.audit.length,0)});
test('accepts equivalent PostgreSQL and ISO timestamp formats',async()=>{const f=fixture();assert.equal((await f.api.PUT(request(f.row.payload,'2026-09-10T10:00:00+00:00'))).status,200)});
test('live snapshot source filters appointments for a secretary',async()=>{const f=fixture({role:'secretary'});const snapshot=await(await f.api.GET()).json();assert.deepEqual(snapshot.state.appointments.map(a=>a.id),['a']);assert.equal(snapshot.revision,f.row.updated_at)});
