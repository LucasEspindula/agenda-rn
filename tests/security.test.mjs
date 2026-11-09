import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {readFileSync} from 'node:fs';
const policy=loadTs('lib/security/state.ts');
const http=loadTs('lib/security/http.ts');
const principal=role=>({account:{role},agendaIds:['one']});
const appointment=(id,doctorId,patientId)=>({id,doctorId,patientId,date:'2026-09-14',time:'10:00',duration:60,status:'scheduled'});
function fixture(){return {schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},professionals:[{id:'one'},{id:'two'}],hospitals:[],patients:[{id:'p1',doctorId:'one'},{id:'p2',doctorId:'two'}],appointments:[appointment('a','one','p1'),appointment('b','two','p2')],cancelledAppointments:[],patientHistory:[{id:'h1',patientId:'p1',text:'original'},{id:'h2',patientId:'p2',text:'private'}],schedulingRules:[],scheduleBlocks:[]};}
const visible=(s,p=principal('secretary'))=>structuredClone(policy.visibleState(s,p));
test('other agenda records and histories do not enter response',()=>{const s=policy.visibleState(fixture(),principal('secretary'));assert.deepEqual(s.appointments.map(x=>x.id),['a']);assert.deepEqual(s.patients.map(x=>x.id),['p1']);assert.deepEqual(s.patientHistory.map(x=>x.id),['h1'])});
test('unknown state fields are not spread into non-manager response',()=>{const s=fixture();s.privateSecret='secret';assert.equal(policy.visibleState(s,principal('doctor')).privateSecret,undefined)});
test('forging ownership of existing appointment is rejected',()=>{const s=fixture(),p=visible(s);p.appointments.push({...s.appointments[1],doctorId:'one'});assert.throws(()=>policy.mergeState(s,p,principal('secretary')))});
test('forging ownership of archived appointment is rejected',()=>{const s=fixture();s.cancelledAppointments.push(s.appointments.pop());const p=visible(s);p.appointments.push({...s.cancelledAppointments[0],doctorId:'one'});assert.throws(()=>policy.mergeState(s,p,principal('secretary')))});
test('forging patient ownership or unknown patient relationship is rejected',()=>{for(const attack of [p=>p.patients.push({id:'p2',doctorId:'one'}),p=>p.appointments[0].patientId='p2']){const s=fixture(),p=visible(s);attack(p);assert.throws(()=>policy.mergeState(s,p,principal('secretary')))}});
test('history from unauthorized patient cannot be appended',()=>{const s=fixture(),p=visible(s);p.patientHistory.push({id:'evil',patientId:'p2',text:'fake'});assert.throws(()=>policy.mergeState(s,p,principal('secretary')))});
test('secretary cannot replace history or global settings',()=>{const s=fixture(),p=visible(s);p.patientHistory[0].text='forged';p.settings.workStart='08:00';const next=policy.mergeState(s,p,principal('secretary'));assert.equal(next.patientHistory[0].text,'original');assert.equal(next.settings.workStart,'07:00');assert.equal(next.patientHistory.length,2)});
test('authorized status change preserves all other agendas',()=>{const s=fixture(),p=visible(s);p.appointments[0].status='confirmed';const n=policy.mergeState(s,p,principal('secretary'));assert.equal(n.appointments.find(x=>x.id==='a').status,'confirmed');assert.deepEqual(n.appointments.find(x=>x.id==='b'),s.appointments[1])});
test('doctor cannot mutate appointments through state API',()=>{const s=fixture(),p=visible(s,principal('doctor'));p.appointments[0].status='realized';assert.deepEqual(policy.mergeState(s,p,principal('doctor')).appointments,s.appointments)});
test('non-manager cannot initialize empty database',()=>assert.throws(()=>policy.mergeState(null,fixture(),principal('secretary'))));
test('unknown roles fail closed',()=>assert.throws(()=>policy.mergeState(fixture(),fixture(),principal('forged'))));
test('duplicate IDs, HTML IDs, invalid duration and injected privileges rejected',()=>{for(const mutate of [s=>s.patients[0].id='\"><img src=x onerror=alert(1)>',s=>s.patients.push(s.patients[0]),s=>s.appointments[0].duration=-1,s=>s.is_admin=true,s=>s.patients[0].isAdmin=true]){const s=fixture();mutate(s);assert.throws(()=>policy.validateState(s))}});
test('prototype keys rejected at nested level',()=>{const s=fixture();s.patients[0]=JSON.parse('{"id":"p1","__proto__":{"polluted":true}}');assert.throws(()=>policy.validateState(s));assert.equal({}.polluted,undefined)});
test('mutation requires explicit same origin, rejects sibling/null/missing origins',async()=>{const handler=http.secureMutation(async()=>Response.json({ok:true}));for(const origin of [undefined,'null','https://evil.example','https://sub.example.com']){const r=await handler(new Request('https://example.com/api/state',{method:'PUT',headers:origin?{origin}:{}}));assert.equal(r.status,403)}assert.equal((await handler(new Request('https://example.com/api/state',{method:'PUT',headers:{origin:'https://example.com'}}))).status,200)});
test('body cap works without Content-Length and errors never leak internal messages',async()=>{const req=new Request('https://example.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:'x'.repeat(100)})});await assert.rejects(()=>http.readJson(req,30));const response=await http.secureMutation(async()=>{throw Error('database secret')})(new Request('https://example.com',{method:'POST',headers:{origin:'https://example.com'}}));assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/secret/)});
test('invalid JSON shapes and non-JSON Content-Type are rejected',async()=>{for(const body of ['null','[]','"str"','{bad'])await assert.rejects(()=>http.readJson(new Request('https://example.com',{method:'POST',headers:{'content-type':'application/json'},body})));await assert.rejects(()=>http.readJson(new Request('https://example.com',{method:'POST',body:'{}'})))});
test('new PBKDF2 hashes and legacy hashes verify without locking out valid accounts',async()=>{const p=loadTs('app/passwords.ts');const fresh=await p.hashPassword('a valid passphrase');assert.match(fresh.hash,/^pbkdf2-sha256\$600000\$/);assert.equal(await p.verifyPassword('a valid passphrase',fresh.hash,fresh.salt),true);assert.equal(await p.verifyPassword('wrong',fresh.hash,fresh.salt),false);const old=await p.hashPassword('legacy password',undefined,100000);assert.equal(await p.verifyPassword('legacy password',old.hash.split('$')[2],old.salt),true);assert.equal(await p.verifyPassword('x','pbkdf2-sha256$999999999$foo',old.salt),false)});
test('clinical data has no persistent browser write path and IDs are HTML escaped',()=>{const s=readFileSync('public/legacy-app.js','utf8');assert.doesNotMatch(s,/localStorage\.setItem|sessionStorage\.setItem/);assert.doesNotMatch(s,/data-[\w-]+="\$\{\w+\.id\}"/);assert.match(s,/data-detail="\$\{esc\(p.id\)\}"/)});
test('login has no automatic privileged account creation',()=>{const s=readFileSync('app/api/auth/login/route.ts','utf8');assert.doesNotMatch(s,/INITIAL_MANAGER|Create initial manager/)});

test('distributed limiter fails closed on database errors and returns 429 on exhaustion',async()=>{
 for(const [data,error,status] of [[false,null,429],[null,{message:'private database failure'},503]]){
  const api=loadTs('lib/security/rate-limit.ts',{'@/lib/supabase-admin':{getSupabaseAdmin:()=>({rpc:async()=>({data,error})})}});
  const original=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='synthetic-test-key';
  try{await assert.rejects(()=>api.consumeLimit('test','user',10,60),e=>e.status===status);}finally{if(original===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=original;}
 }
});
test('workflow cannot disclose an original appointment by forging its proposed owner',async()=>{
 const s=fixture(),p={...s.appointments[1],doctorId:'one',patientId:'p1'};
 const writes=[];const q={select(){return this},eq(){return this},maybeSingle:async()=>({data:{payload:s},error:null}),insert(x){writes.push(x);return this}};
 const api=loadTs('app/api/workflow/route.ts',{'@/app/authz':{getSession:async()=>({...principal('doctor'),account:{role:'doctor',id:1,name:'Test'}}),isManager:r=>r==='general_manager'},'@/lib/supabase-admin':{getSupabaseAdmin:()=>({from:()=>q}),dbError(){}},'@/lib/security/rate-limit':{consumeLimit:async()=>{}}});
 const r=await api.POST(new Request('https://example.com/api/workflow',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({action:'update',appointmentId:'b',appointment:p})}));
 assert.equal(r.status,403);assert.equal(writes.length,0);
});
test('unknown login cannot recreate privileged bootstrap account',async()=>{
 const writes=[];const q={select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null}),insert(x){writes.push(x);return this}};
 const api=loadTs('app/api/auth/login/route.ts',{'next/headers':{cookies:async()=>({set(){throw Error('must not set cookie')}})},'@/app/authz':{SESSION_COOKIE:'agenda_rn_session'},'@/app/passwords':{hashPassword:async()=>({})},'@/lib/supabase-admin':{getSupabaseAdmin:()=>({from:()=>q}),dbError(){}},'@/lib/security/rate-limit':{consumeLimit:async()=>{}}});
 const r=await api.POST(new Request('https://example.com/api/auth/login',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({email:'lucasespindula42@gmail.com',password:'not a bootstrap password',is_admin:true})}));
 assert.equal(r.status,401);assert.equal(writes.length,0);
});
test('secretary can add a free-text hospital but never rename or drop existing ones',()=>{const s=fixture();s.hospitals=[{id:'h1',name:'HMV'}];const p=visible(s);p.hospitals.push({id:'h2',name:'  HMD ',abbreviation:'X'});p.hospitals[0].name='Renamed';p.appointments[0].hospitalId='h2';const n=policy.mergeState(s,p,principal('secretary'));assert.deepEqual(JSON.parse(JSON.stringify(n.hospitals)),[{id:'h1',name:'HMV'},{id:'h2',name:'HMD'}]);const q=visible(s);q.hospitals=[];assert.deepEqual(JSON.parse(JSON.stringify(policy.mergeState(s,q,principal('secretary')).hospitals)),[{id:'h1',name:'HMV'}]);const blank=visible(s);blank.hospitals.push({id:'h3',name:'  '});assert.throws(()=>policy.mergeState(s,blank,principal('secretary')),/Hospital inválido/)});
