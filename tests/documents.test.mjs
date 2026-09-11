import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
const source=readFileSync(new URL('../app/api/documents/route.ts',import.meta.url),'utf8');
function fixture(session){
 const rows=[{id:'a',doctorId:'d1',patientId:'p'},{id:'b',doctorId:'d2',patientId:'p'}];let allowed;
 const db={from(table){const q={select(){return q},eq(){return q},in(k,ids){allowed=ids;return q},order:async()=>({data:[{id:'doc',appointment_id:allowed[0]}]}),maybeSingle:async()=>({data:table==='app_state'?{payload:{appointments:rows}}:null})};return q}};
 const exports={};const context={exports,Response,Request,URL,Buffer,require:name=>name==='node:crypto'?crypto:name.includes('authz')?{getSession:async()=>session}:{getSupabaseAdmin:()=>db}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {api:exports,ids:()=>allowed};
}
test('documents require a valid session',async()=>{const {api}=fixture(null);assert.equal((await api.GET(new Request('https://example.com/api/documents?appointmentId=a'))).status,401)});
test('patient documents include only surgeries in authorized agendas',async()=>{const f=fixture({account:{id:1,role:'secretary'},agendaIds:['d1']});const r=await f.api.GET(new Request('https://example.com/api/documents?patientId=p'));assert.equal(r.status,200);assert.deepEqual(Array.from(f.ids()),['a']);assert.equal((await r.json()).documents[0].surgery.id,'a')});
test('another surgery cannot be listed or receive uploads',async()=>{const {api}=fixture({account:{id:1,role:'doctor'},agendaIds:['d1']});assert.equal((await api.GET(new Request('https://example.com/api/documents?appointmentId=b'))).status,403);assert.equal((await api.POST(new Request('https://example.com/api/documents',{method:'POST',body:JSON.stringify({appointmentId:'b'})}))).status,403)});
test('invalid extensions and oversized uploads are rejected before storage',async()=>{const {api}=fixture({account:{id:1,role:'general_manager'},agendaIds:[]});for(const [name,size] of [['test.exe',10],['test.pdf',20971521]]){assert.equal((await api.POST(new Request('https://example.com/api/documents',{method:'POST',body:JSON.stringify({appointmentId:'a',name,size,category:'guide'})}))).status,400)}});
test('cross-origin writes are rejected',async()=>{const {api}=fixture(null);assert.equal((await api.POST(new Request('https://example.com/api/documents',{method:'POST',headers:{origin:'https://other.example'}}))).status,403)});
