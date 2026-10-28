import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const sql=readFileSync(new URL('../supabase/migrations/20261028123000_agenda_update_before_insert_trigger.sql',import.meta.url),'utf8');
const availability=loadTs('lib/agenda-availability.ts');
const doctorId='doctor';
const ap={id:'historical',doctorId,date:'2026-11-03',time:'08:00',duration:60,status:'scheduled',procedure:'Consulta',hospitalId:'hospital'};

test('agenda commit updates the existing singleton before attempting initial INSERT',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.commit_agenda_change\(/i);
 assert.match(sql,/update public\.app_state\s+set payload=p_payload, updated_at=p_revision\s+where id=1;\s+if not found then\s+insert into public\.app_state\(id,payload,updated_at\)/i);
 const routine=sql.slice(sql.indexOf('if p_payload is not null then'),sql.indexOf('insert into public.audit_logs'));
 assert.doesNotMatch(routine,/on conflict\s*\(/i);
 assert.match(sql,/if current_revision is distinct from p_expected then return false;/i);
 assert.match(sql,/perform pg_advisory_xact_lock\(194701,1\)/i);
});

test('historical appointment inside a later block does not block a new free day',()=>{
 const block={id:'block',professionalId:doctorId,date:'2026-11-03',start:'08:00',end:'09:00',reason:'Bloqueio preexistente'};
 const before={settings:{workStart:'07:00',workEnd:'19:00'},professionals:[{id:doctorId}],scheduleBlocks:[block],appointments:[ap]};
 const valid={...ap,id:'new-valid',date:'2026-10-30',time:'08:00'};
 const after={...before,appointments:[ap,valid]};
 assert.equal(availability.changedAppointmentIssues(before,after).length,0);
});

test('new or rescheduled appointments still cannot enter a blocked slot',()=>{
 const block={id:'block',professionalId:doctorId,date:'2026-11-03',start:'08:00',end:'09:00',reason:'Bloqueio'};
 const before={settings:{workStart:'07:00',workEnd:'19:00'},professionals:[{id:doctorId}],scheduleBlocks:[block],appointments:[{...ap,date:'2026-11-02'}]};
 const moved={...ap,date:'2026-11-03'};
 const after={...before,appointments:[moved]};
 assert.ok(availability.changedAppointmentIssues(before,after).some(issue=>issue.appointmentId==='historical'));
 const created={...ap,id:'new',date:'2026-11-03'};
 assert.ok(availability.changedAppointmentIssues(before,{...before,appointments:[...before.appointments,created]}).length>0);
});
