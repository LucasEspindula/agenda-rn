import {PGlite} from '@electric-sql/pglite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync('supabase/migrations/20261027190000_atomic_agenda_suggestions.sql','utf8');
const route=readFileSync('app/api/workflow/route.ts','utf8');
const legacy=readFileSync('public/legacy-app.js','utf8');

test('doctor suggestion is atomic, idempotent and repairs the confirmed orphan notification',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`
   CREATE ROLE service_role;
   CREATE TABLE public.users(id bigint PRIMARY KEY);
   INSERT INTO public.users(id) VALUES(7);
   CREATE TABLE public.agenda_requests(
     id text PRIMARY KEY,professional_id text NOT NULL,appointment_id text,action text NOT NULL,
     proposed_payload jsonb,previous_payload jsonb,status text NOT NULL DEFAULT 'pending',
     requested_by bigint NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE public.notifications(
     id text PRIMARY KEY,user_id bigint NOT NULL REFERENCES public.users(id),type text NOT NULL,
     request_id text REFERENCES public.agenda_requests(id),message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE public.audit_logs(
     id text PRIMARY KEY,actor_user_id bigint REFERENCES public.users(id),actor_name text NOT NULL,
     actor_role text NOT NULL,action text NOT NULL,professional_id text,appointment_id text,
     patient_id text,description text NOT NULL,metadata jsonb,created_at timestamptz NOT NULL DEFAULT now()
   );
 `);
 const now='2026-10-27T17:07:00Z';
 await db.query(`INSERT INTO public.agenda_requests(id,professional_id,appointment_id,action,requested_by,created_at)
                 VALUES('orphan','d1','a0','update',7,$1)`,[now]);
 await db.exec(migration);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.notifications WHERE request_id='orphan' AND type='request_sent'")).rows[0].n,1);

 const make=(id,appointmentId)=>({
   request:{id,professional_id:'d1',appointment_id:appointmentId,action:'update',proposed_payload:{id:appointmentId},previous_payload:null,requested_by:7,created_at:now},
   notification:{id:'note-'+id,user_id:7,type:'request_sent',request_id:id,created_at:now},
   audit:{id:'audit-'+id,actor_user_id:7,actor_name:'Médico',actor_role:'doctor',action:'request_created',professional_id:'d1',appointment_id:appointmentId,description:'Sugestão de teste',metadata:{requestId:id,requestAction:'update'},created_at:now}
 });
 const rpc='SELECT public.submit_agenda_suggestion($1,$2,$3) AS id';
 const first=make('request1','a1');
 assert.equal((await db.query(rpc,[first.request,first.notification,first.audit])).rows[0].id,'request1');
 const duplicate=make('request2','a1');
 assert.equal((await db.query(rpc,[duplicate.request,duplicate.notification,duplicate.audit])).rows[0].id,'request1');
 for(const table of ['agenda_requests','notifications','audit_logs']){
   const {rows}=await db.query(`SELECT count(*)::int AS n FROM public.${table}`);
   assert.equal(rows[0].n,table==='agenda_requests'?2:table==='notifications'?2:1,table);
 }

 // Simulate notification PK conflict: the parent request and audit must roll back.
 await db.exec("INSERT INTO public.notifications(id,user_id,type,message) VALUES('note-request3',7,'request_sent','existing')");
 const invalid=make('request3','a3');
 await assert.rejects(()=>db.query(rpc,[invalid.request,invalid.notification,invalid.audit]),/duplicate key|unique constraint/);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.agenda_requests WHERE id='request3'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.audit_logs WHERE id='audit-request3'")).rows[0].n,0);

 const inconsistent=make('request4','a4');
 inconsistent.notification.request_id='some-other-request';
 await assert.rejects(()=>db.query(rpc,[inconsistent.request,inconsistent.notification,inconsistent.audit]),/Solicitação de agenda inválida/);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.agenda_requests WHERE id='request4'")).rows[0].n,0);
});

test('the doctor API uses the atomic RPC and the block form prevents duplicates',()=>{
 assert.match(route,/db\.rpc\("submit_agenda_suggestion"/);
 assert.doesNotMatch(route,/Promise\.all\(\[\s*db\.from\("agenda_requests"\)\.insert/);
 assert.match(legacy,/state\.scheduleBlocks\.some\(b=>b\.id!==item\.id/);
 assert.match(legacy,/if\(form\.dataset\.saving\)return/);
});
