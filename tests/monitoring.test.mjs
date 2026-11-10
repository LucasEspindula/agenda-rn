import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';

// Monitoramento: base do assistente que corrige sozinho, diagnostica e só então chama um dev.
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').split('\r\n').join('\n');
const lgpd=read('supabase/migrations/20261110180000_lgpd_operations.sql');
const monitorSql=read('supabase/migrations/20261112120000_monitoring.sql');
const scrub=loadTs('lib/monitor/scrub.ts');
const playbook=loadTs('lib/monitor/playbook.ts');
const checks=loadTs('lib/monitor/checks.ts');
const same=(a,b,m)=>assert.deepStrictEqual(JSON.parse(JSON.stringify(a)),b,m);

async function database(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
  create table public.organizations(id uuid primary key); create table public.users(id bigint primary key);
  create table public.sessions(id bigserial primary key,expires_at timestamptz); create table public.auth_tokens(id bigserial primary key,expires_at timestamptz);
  create table public.security_rate_limits(key text primary key,hits int,expires_at timestamptz);`);
 await db.exec(lgpd.slice(lgpd.indexOf('create table if not exists public.security_events'),lgpd.indexOf('-- 2.')));
 await db.exec(monitorSql);
 return db;
}
const rec=(db,fp,sev='error',extra='null,null,1')=>db.query(`select public.record_monitor_incident('${fp}','production','server','${sev}','Falha X',null,'/api/x',null,${extra}) v`).then(r=>r.rows[0].v);

test('incidents group by fingerprint, escalate severity and throttle alerts',async()=>{
 const db=await database();
 try{
  const a=await rec(db,'server:abc12345');
  assert.equal(a.alert,true,'first error alerts');assert.equal(a.new,true);
  const b=await rec(db,'server:abc12345');
  assert.equal(b.occurrences,2);assert.equal(b.alert,false,'same error inside 6 h does not alert again');
  const c=await rec(db,'server:abc12345','critical');
  assert.equal(c.severity,'critical');assert.equal(c.alert,true,'getting worse alerts right away');
  assert.equal((await rec(db,'server:abc12345','error')).alert,false,'a milder repeat keeps critical and stays quiet');
  const info=await rec(db,'check:x:info','info');
  assert.equal(info.alert,false,'info never alerts');
  assert.equal((await db.query(`select count(*)::int n from public.monitor_incidents`)).rows[0].n,2,'one open incident per fingerprint');
 }finally{await db.close()}
});

test('transient failures only alert when they insist; quiet ones resolve by themselves',async()=>{
 const db=await database();
 try{
  for(let i=1;i<=4;i++)assert.equal((await rec(db,'server:net12345','warning',"'db-network','transient',5")).alert,false,`occurrence ${i}`);
  assert.equal((await rec(db,'server:net12345','warning',"'db-network','transient',5")).alert,true,'5th occurrence alerts');
  await db.exec(`update public.monitor_incidents set last_seen=now()-interval '2 hours'`);
  const resolved=(await db.query(`select public.resolve_quiet_incidents('production') v`)).rows[0].v;
  same(resolved,[{title:'Falha X',severity:'warning'}],'reports the alerted one as resolved');
  assert.equal((await rec(db,'server:net12345','warning',"'db-network','transient',5")).new,true,'a new episode opens a new incident');
 }finally{await db.close()}
});

test('checks that stop reporting are resolved; maintenance cleans up and leaves a heartbeat',async()=>{
 const db=await database();
 try{
  await db.query(`select public.record_monitor_incident('check:database:down','production','check','critical','Banco fora',null,null,null)`);
  await db.query(`select public.record_monitor_incident('check:email:not-configured','production','check','info','Sem e-mail',null,null,null)`);
  const resolved=(await db.query(`select public.resolve_monitor_checks('production',array['check:email:not-configured']) v`)).rows[0].v;
  same(resolved,[{title:'Banco fora',severity:'critical'}]);
  assert.equal((await db.query(`select count(*)::int n from public.monitor_incidents where resolved_at is null`)).rows[0].n,1,'still-active check stays open');
  await db.exec(`insert into public.monitor_incidents(fingerprint,source,severity,title,last_seen) values ('server:old00000','server','error','velho',now()-interval '8 days');
   insert into public.monitor_incidents(fingerprint,source,severity,title,resolved_at) values ('server:gone0000','server','error','antigo',now()-interval '91 days');
   insert into public.sessions(expires_at) values (now()-interval '2 days');`);
  const out=(await db.query('select public.run_maintenance() v')).rows[0].v;
  assert.equal(out.sessions,1);assert.equal(out.incidentsResolved,1);assert.equal(out.incidentsDeleted,1);
  const beat=(await db.query(`select ok,details from public.monitor_heartbeats where name='maintenance'`)).rows[0];
  assert.equal(beat.ok,true);assert.equal(beat.details.sessions,1);
  assert.equal((await db.query(`select has_function_privilege('anon','public.record_monitor_incident(text,text,text,text,text,text,text,uuid,text,text,integer)','execute') v`)).rows[0].v,false);
  assert.equal((await db.query(`select has_table_privilege('authenticated','public.monitor_incidents','select') v`)).rows[0].v,false);
 }finally{await db.close()}
});

test('scrub removes personal data and tokens; routes and messages group without ids',async()=>{
 const s=scrub.scrub('Falha para joao.silva@clinica.com.br CPF 123.456.789-09 tel (48) 99999-1234 id 3f2a9c1e-1111-4222-8333-444455556666 token eyJhbGciOiJIUzI1NiJ9.abc');
 for(const leaked of ['joao','123.456','99999','3f2a9c1e','eyJhbGci'])assert.ok(!s.includes(leaked),leaked);
 assert.match(s,/\[email\].*\[cpf\].*\[número\].*\[id\].*\[token\]/);
 assert.equal(scrub.normalizeRoute('/api/patients/123/export?x=1'),'/api/patients/:id/export');
 assert.equal(scrub.groupingText('Timeout after 3000ms'),scrub.groupingText('Timeout after 5000ms'));
 assert.match(await scrub.fingerprint('a','b'),/^[0-9a-f]{24}$/);
 assert.equal(scrub.scrubStack('Error: x\n    at fn (/var/task/.next/server/app/api/x/route.js:10:5)'),'at fn (app/api/x/route.js:10:5)');
});

test('playbook explains known errors and marks what heals by itself',()=>{
 assert.equal(playbook.findPlaybook('ChunkLoadError: Loading chunk 42 failed').auto,'reload');
 assert.equal(playbook.findPlaybook('TypeError: fetch failed').auto,'transient');
 assert.equal(playbook.findPlaybook('Error: Supabase server configuration is incomplete').auto,'config');
 assert.equal(playbook.findPlaybook('Envio de e-mail ainda não configurado.').id,'email-config');
 assert.equal(playbook.findPlaybook('TypeError: cannot read properties of undefined'),null,'unknown errors go to a dev');
 for(const p of playbook.PLAYBOOKS){assert.ok(p.diagnosis&&p.action,p.id)}
});

test('check rules: database retries once, maintenance overdue, brute force, e-mail and alert channels',()=>{
 same(checks.evaluateDatabase({ok:true,ms:80}),[]);
 same(checks.evaluateDatabase({ok:false,ms:0},{ok:true,ms:90}),[],'a single blip is not an incident');
 assert.equal(checks.evaluateDatabase({ok:false,ms:0},{ok:false,ms:0})[0].severity,'critical');
 assert.equal(checks.evaluateDatabase({ok:true,ms:3000})[0].key,'slow');
 const now=new Date('2026-11-12T12:00:00Z');
 assert.equal(checks.evaluateMaintenance(new Date('2026-11-12T06:00:00Z'),99,now),'ok');
 assert.equal(checks.evaluateMaintenance(new Date('2026-11-11T06:00:00Z'),0,now),'overdue');
 assert.equal(checks.evaluateMaintenance(null,0,now),'ok','fresh install without backlog');
 assert.equal(checks.evaluateMaintenance(null,3,now),'overdue');
 same(checks.evaluateLoginFailures(10),[]);
 assert.equal(checks.evaluateLoginFailures(40)[0].severity,'warning');assert.equal(checks.evaluateLoginFailures(150)[0].severity,'error');
 assert.equal(checks.evaluateEmail('production',false,true)[0].severity,'warning');
 assert.equal(checks.evaluateEmail('production',false,false)[0].severity,'info');
 same(checks.evaluateEmail('preview',false,true),[]);
 assert.equal(checks.evaluateAlertChannels('production',false,false)[0].severity,'info');
});

test('runner repairs what it can, verifies, and only reports what is left',async()=>{
 const reported=[],alerts=[],rpcs=[];
 const db={rpc:async(fn,args)=>{rpcs.push([fn,args]);return {data:[],error:null}}};
 const prev=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';
 try{
  const runner=loadTs('lib/monitor/runner.ts',{'@/lib/supabase-admin':{getSupabaseAdmin:()=>db},
   './report':{environment:()=>'production',reportIncident:async i=>{reported.push(i);return null}},
   './alert':{sendAlert:async a=>{alerts.push(a);return []}}});
  let fixed=false;
  const summary=await runner.runMonitor([
   {id:'maintenance',label:'Manutenção',run:async()=>fixed?[]:[{key:'overdue',severity:'warning',title:'Manutenção atrasada',repair:async()=>{fixed=true;return 'manutenção executada'}}]},
   {id:'database',label:'Banco',run:async()=>[{key:'down',severity:'critical',title:'Banco fora'}]},
   {id:'broken',label:'Quebrada',run:async()=>{throw new Error('boom')}},
  ]);
  assert.equal(summary.ok,false,'critical left → not ok (GitHub job fails)');
  same(summary.repaired.map(r=>r.check),['maintenance']);
  assert.ok(alerts.some(a=>a.resolved&&/Corrigido automaticamente/.test(a.note)),'tells that it healed by itself');
  same(summary.findings.map(f=>f.check),['database','broken']);
  assert.equal(summary.counts.critical,1);assert.equal(summary.counts.warning,1);
  assert.ok(reported.some(r=>r.key==='check:database:down'));
  assert.ok(!reported.some(r=>r.key==='check:maintenance:overdue'),'repaired problem is not left open');
  const resolveCall=rpcs.find(([fn])=>fn==='resolve_monitor_checks');
  same(resolveCall[1].p_active,['check:database:down','check:broken:failed']);
  assert.ok(rpcs.some(([fn])=>fn==='resolve_quiet_incidents'));
  assert.ok(rpcs.some(([fn,a])=>fn==='touch_monitor_heartbeat'&&a.p_name==='monitor'&&a.p_ok===false));
 }finally{if(prev===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prev}
});

test('reportIncident attaches the diagnosis, alerts only in production and never throws',async()=>{
 const alerts=[];let calls=[];
 const make=(env,result)=>{process.env.VERCEL_ENV=env;return loadTs('lib/monitor/report.ts',{
  '@/lib/supabase-admin':{getSupabaseAdmin:()=>({rpc:async(fn,args)=>{calls.push(args);return result}})},
  './alert':{sendAlert:async a=>{alerts.push(a);return []}}})};
 const prev=process.env.VERCEL_ENV;
 try{
  let r=make('production',{data:{alert:true,severity:'warning',occurrences:5},error:null});
  await r.reportError(new Error('Supabase server configuration is incomplete'),{source:'server',route:'/api/state',method:'PUT'});
  assert.equal(calls[0].p_playbook,'supabase-config');assert.equal(calls[0].p_route,'PUT /api/state');
  assert.match(alerts[0].action,/SUPABASE_SECRET_KEY/);
  await r.reportError(new Error('fetch failed'),{source:'server',route:'/api/x',method:'GET'});
  assert.equal(calls[1].p_severity,'warning','transient errors are downgraded');assert.equal(calls[1].p_min_occurrences,5);
  r=make('preview',{data:{alert:true},error:null});alerts.length=0;
  await r.reportIncident({source:'server',severity:'critical',title:'x'});
  assert.equal(alerts.length,0,'previews never alert');
  r=make('production',{data:null,error:{message:'db off'}});
  assert.equal(await r.reportIncident({source:'server',severity:'error',title:'x'}),null,'a broken monitor does not break the request');
 }finally{if(prev===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prev}
});

test('secureMutation reports unexpected failures and 5xx, never validation errors',async()=>{
 const seen=[];
 const http=loadTs('lib/security/http.ts',{'@/lib/monitor/report':{reportError:async(e,c)=>{seen.push([e.message,c])}}});
 process.env.APP_ORIGIN='https://app.test';
 try{
  const req=()=>new Request('https://app.test/api/x/77',{method:'POST',headers:{origin:'https://app.test'}});
  assert.equal((await http.secureMutation(async()=>{throw new Error('boom')})(req())).status,500);
  assert.equal((await http.secureMutation(async()=>{throw new http.HttpError(409,'conflito')})(req())).status,409);
  assert.equal((await http.secureMutation(async()=>{throw new http.HttpError(503,'fora')})(req())).status,503);
  same(seen.map(([m,c])=>[m,c.severity,c.route,c.method]),[['boom','error','/api/x/77','POST'],['fora','warning','/api/x/77','POST']]);
 }finally{delete process.env.APP_ORIGIN}
});

test('browser errors: reported by logged-in users with a limit; stale bundles reload once',()=>{
 const client=read('components/client-monitor.tsx'),route=read('app/api/monitor/client-error/route.ts'),layout=read('app/layout.tsx');
 assert.match(layout,/<ClientMonitor \/>/);
 assert.match(client,/if \(sent >= 5 \|\| seen\.has\(key\)\) return;/);
 assert.match(client,/new URL\(event\.filename, location\.href\)\.origin !== location\.origin/,'extension and third-party errors are ignored');
 assert.match(client,/Date\.now\(\) - last > 60_000[\s\S]*location\.reload\(\)/,'reload at most once a minute');
 assert.match(route,/if \(!session\) return new Response\(null, \{ status: 204 \}\)/);
 assert.match(route,/consumeLimit\("client-error", String\(session\.account\.id\), 30, 3600\)/);
 assert.match(route,/readJson\(request, 8 \* 1024\)/);
 assert.match(route,/export const POST = secureMutation/);
 assert.match(read('instrumentation.ts'),/export const onRequestError/);
});

test('scheduled check: every 15 min, no permissions, secret never printed, fails on critical',()=>{
 const wf=read('.github/workflows/monitor.yml');
 assert.match(wf,/cron: "\*\/15 \* \* \* \*"/);
 assert.match(wf,/permissions: \{\}/);
 assert.match(wf,/CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
 assert.doesNotMatch(wf,/echo[^\n]*\$CRON_SECRET/);
 assert.match(wf,/jq -c '\{ok, counts, repaired: \(\.repaired\|length\), resolved\}'/,'only counts reach the public log');
 assert.match(wf,/if \[ "\$code" != "200" \]; then[^\n]*exit 1; fi/);
 const route=read('app/api/cron/monitor/route.ts');
 assert.match(route,/cronAuthError\(request\)/);assert.match(route,/status: summary\.ok \? 200 : 503/);
});
