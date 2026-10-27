import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
const availability=loadTs('lib/agenda-availability.ts');
const a={id:'one',doctorId:'d1',anesthetistId:'a1',hospitalId:'h1',date:'2026-09-11',time:'11:30',duration:60,procedure:'Cirurgia',status:'scheduled'};
const state=(override={})=>({settings:{workStart:'07:00',workEnd:'19:00'},
 professionals:[{id:'d1',agendaSettings:{workStart:'07:00',workEnd:'19:00'}},{id:'a1'}],
 appointments:[],scheduleBlocks:[],schedulingRules:[],...override});
test('manual overlap excludes adjacent boundaries but rejects all overlapping cases and anesthesia',()=>{
 const s=state({scheduleBlocks:[{id:'b',professionalId:'d1',date:'2026-09-11',start:'12:00',end:'14:00',reason:'Recesso'}]});
 for(const [time,duration] of [['12:10',60],['11:30',60],['13:30',60],['11:00',240]])
  assert.ok(availability.appointmentAvailabilityIssues(s,{...a,time,duration}).length>0,time);
 for(const [time,duration] of [['11:00',60],['14:00',60]])
  assert.equal(availability.appointmentAvailabilityIssues(s,{...a,time,duration}).length,0,time);
 s.scheduleBlocks=[{id:'a',professionalId:'a1',date:'2026-09-11',start:'12:00',end:'14:00',reason:'Indisponível'}];
 assert.ok(availability.appointmentAvailabilityIssues(s,a).length>0);
});
test('recurring weekly rule and monthly last occurrence are matched by local calendar date',()=>{
 const r={professionalId:'d1',severity:'block',weekday:5,occurrence:'2',blockAllDay:true};
 assert.equal(availability.ruleMatchesLocalDate(r,'2026-09-11'),true);
 assert.equal(availability.ruleMatchesLocalDate({...r,occurrence:'last'},'2026-09-11'),false);
 assert.equal(availability.ruleMatchesLocalDate({...r,occurrence:'last'},'2026-09-25'),true);
 assert.equal(availability.ruleMatchesLocalDate({...r,enabled:false},'2026-09-11'),false);
 assert.equal(availability.ruleMatchesLocalDate(r,'2026-09-12'),false);
 assert.equal(availability.ruleMatchesLocalDate(r,'2026-02-31'),false);
});
test('entire workday blocked by full-day rule or union of intervals',()=>{
 const s=state({schedulingRules:[{professionalId:'d1',severity:'block',weekday:5,blockAllDay:true,name:'Feriado'}]});
 assert.equal(availability.entirelyUnavailable(s,'d1','2026-09-11'),true);
 assert.equal(availability.entirelyUnavailable(s,'d1','2026-09-12'),false);
 s.schedulingRules=[];
 s.scheduleBlocks=[{professionalId:'d1',date:'2026-09-11',start:'07:00',end:'13:00'}, {professionalId:'d1',date:'2026-09-11',start:'12:30',end:'19:00'}];
 assert.equal(availability.entirelyUnavailable(s,'d1','2026-09-11'),true);
 s.scheduleBlocks[1].start='13:30';
 assert.equal(availability.entirelyUnavailable(s,'d1','2026-09-11'),false);
});
test('rule window and forbidden slots treat full duration, including partial crossings',()=>{
 const s=state({schedulingRules:[{professionalId:'d1',severity:'block',weekday:5,start:'09:00',end:'17:00',forbiddenTimes:'12:00',name:'Clínica'}]});
 for(const [time,duration] of [['08:30',60],['16:30',60],['11:30',60],['12:10',20]])
  assert.ok(availability.appointmentAvailabilityIssues(s,{...a,time,duration}).length,time);
 for(const [time,duration] of [['09:00',60],['12:30',60],['16:00',60]])
  assert.equal(availability.appointmentAvailabilityIssues(s,{...a,time,duration}).length,0,time);
});
test('isolated professional rules and scoped maximum/preferring time',()=>{
 const s=state({schedulingRules:[{professionalId:'other',severity:'block',blockAllDay:true}]});
 assert.equal(availability.appointmentAvailabilityIssues(s,a).length,0);
 s.schedulingRules=[{professionalId:'d1',severity:'block',hospitalId:'h2',preferredTimes:'09:00',maxPatients:1}];
 assert.equal(availability.appointmentAvailabilityIssues(s,a).length,0);
 s.schedulingRules[0].hospitalId='h1';
 assert.ok(availability.appointmentAvailabilityIssues(s,a).some(x=>x.includes('Horário não permitido')));
});
test('changing rules never cancels old appointments; reschedules and new bookings recheck',()=>{
 const s=state({appointments:[a],schedulingRules:[{professionalId:'d1',severity:'block',blockAllDay:true,weekday:5}]});
 assert.equal(availability.changedAppointmentIssues(state({appointments:[a]}),s).length,0);
 const moved=state({...s,appointments:[{...a,id:'one',time:'12:00'}]});
 assert.ok(availability.changedAppointmentIssues(state({appointments:[a]}),moved).length>0);
 assert.ok(availability.changedAppointmentIssues(state(),s).length>0);
});
test('HTTP pathways and database trigger enforce availability separately from client',()=>{
 const stateApi=readFileSync('app/api/state/route.ts','utf8'),
   workflow=readFileSync('app/api/workflow/route.ts','utf8'),
   sql=readFileSync('supabase/migrations/20261027150000_guard_agenda_appointment_availability.sql','utf8'),
   legacy=readFileSync('public/legacy-app.js','utf8');
 assert.match(stateApi,/changedAppointmentIssues\(/);
 assert.match(workflow,/body.decision==="accepted"[\s\S]*?changedAppointmentIssues\(/);
 assert.match(sql,/CREATE TRIGGER guard_agenda_appointment_availability\s+BEFORE INSERT OR UPDATE OF payload ON public.app_state/);
 assert.match(sql,/prior->>'date'/);
 assert.match(sql,/item->>'doctorId'/);
 assert.match(sql,/pg_advisory_xact_lock\(194701,1\)/);
 assert.match(sql,/beginning<block_end AND ending>block_start/);
 assert.match(sql,/r->>'blockAllDay'='true'/);
 assert.match(sql,/r->>'forbiddenTimes'/);
 assert.match(sql,/ERRCODE='P0001'/);
 assert.doesNotMatch(sql,/(delete from public\.appointments|update public\.invoices)/i);
 assert.match(legacy,/window.RNAvailability\.appointmentAvailabilityIssues\(state,updated\)/);
 assert.match(legacy,/window.RNAvailability\.availabilityIntervals\(state,owner.id,date,includeRules\)/);
});
