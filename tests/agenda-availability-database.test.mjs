import {PGlite} from '@electric-sql/pglite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync('supabase/migrations/20261027131422_guard_agenda_appointment_availability.sql','utf8');
const original={professionals:[{id:'d1',agendaSettings:{workStart:'07:00',workEnd:'19:00'}},{id:'a1'}],
 settings:{workStart:'07:00',workEnd:'19:00'},schedulingRules:[],scheduleBlocks:[],
 appointments:[{id:'existing',doctorId:'d1',anesthetistId:'a1',hospitalId:'h1',date:'2026-09-11',time:'12:00',duration:60,procedure:'Atendimento',status:'scheduled'}]};
const booking=(id,time='11:30',extra={})=>({id,doctorId:'d1',anesthetistId:null,hospitalId:'h1',date:'2026-09-11',time,duration:60,procedure:'Atendimento',status:'scheduled',...extra});
const manual={id:'manual',professionalId:'d1',date:'2026-09-11',start:'12:00',end:'14:00',reason:'Bloqueio'};
const rule={id:'rule',professionalId:'d1',weekday:5,enabled:true,severity:'block',blockAllDay:true,name:'Recesso'};
const query='UPDATE public.app_state SET payload=$1 WHERE id=1';
test('live PostgreSQL trigger syntax and full transactional blocked availability behavior in isolated PGlite',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('create table public.app_state(id integer primary key,payload jsonb not null);');
 await db.exec(migration);
 await db.query('INSERT INTO public.app_state(id,payload) VALUES (1,$1)',[original]);
 async function check(next,blocked){
  await db.exec('BEGIN');
  try {
   if(blocked)await assert.rejects(()=>db.query(query,[next]),/Horário indisponível/);
   else await db.query(query,[next]);
  }finally{await db.exec('ROLLBACK')}
  const current=(await db.query('SELECT payload FROM public.app_state WHERE id=1')).rows[0].payload;
  assert.deepEqual(current,original,'no writes may persist');
 }
 await check({...original,scheduleBlocks:[manual],appointments:[...original.appointments,booking('new')]},true);
 for(const time of ['11:00','14:00'])
  await check({...original,scheduleBlocks:[manual],appointments:[...original.appointments,booking('allowed-'+time,time)]},false);
 await check({...original,scheduleBlocks:[{...manual,professionalId:'a1'}],appointments:[...original.appointments,booking('anesthesia','11:30',{anesthetistId:'a1'})]},true);
 await check({...original,schedulingRules:[rule],appointments:[...original.appointments,booking('blocked-day','09:00')]},true);
 await check({...original,schedulingRules:[rule],appointments:[{...original.appointments[0],status:'realized'}]},false);
 await check({...original,schedulingRules:[{...rule,professionalId:'another'}],appointments:[...original.appointments,booking('other','09:00')]},false);
 await check({...original,schedulingRules:[{...rule,blockAllDay:false,start:'09:00',end:'17:00',forbiddenTimes:'12:00'}],appointments:[...original.appointments,booking('cross-window','08:30')]},true);
 await check({...original,schedulingRules:[{...rule,blockAllDay:false,start:'07:00',end:'19:00',forbiddenTimes:'12:00'}],appointments:[...original.appointments,booking('cross-forbidden','11:30')]},true);
 await check({...original,schedulingRules:[{...rule,blockAllDay:false,start:'07:00',end:'19:00',forbiddenTimes:'12:00'}],appointments:[...original.appointments,booking('adjacent','14:00')]},false);
});
