import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20261103151428_agenda_normalized_a1.sql',import.meta.url),'utf8');
const ORG='00000000-0000-4000-8000-000000000001';
const SURGEON='d1000000-0000-4000-8000-000000000001',CLINIC='d2000000-0000-4000-8000-000000000002',ANEST='d3000000-0000-4000-8000-000000000003';
const P1='a1000000-0000-4000-8000-000000000001',P2='a2000000-0000-4000-8000-000000000002';
const AP1='b1000000-0000-4000-8000-000000000001',AP2='b2000000-0000-4000-8000-000000000002';
const uuid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

const legacy={schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},professionals:[],
 hospitals:[{id:'h-legacy',name:'Hospital Central',abbreviation:'HC'}],
 patients:[{id:P1,doctorId:SURGEON,name:'Paciente Teste',cpf:'52998224725',insurance:'Unimed',cardNumber:'1',created_by:1},
  {id:P2,doctorId:CLINIC,name:'Paciente Clínica',insurance:'',created_by:1}],
 appointments:[{id:AP1,doctorId:SURGEON,anesthetistId:ANEST,patientId:P1,hospitalId:'h-legacy',date:'2026-12-07',time:'09:00',duration:60,status:'scheduled',careType:'outpatient',procedure:'Consulta',insurance:'Unimed',forma_cobranca:'CONVENIO',payment:150,invoiceNumber:'NF1',rescheduleHistory:[{fromDate:'2026-12-01',fromTime:'08:00',toDate:'2026-12-07',toTime:'09:00',reason:'Paciente pediu',proposedBy:'Ana',createdAt:'2026-11-01T10:00:00.000Z'}]}],
 cancelledAppointments:[{id:AP2,doctorId:CLINIC,patientId:P2,date:'2026-12-08',time:'10:00',duration:30,status:'scheduled',cancelledAt:'2026-11-02T10:00:00.000Z',cancelReason:'Desistiu'}],
 patientHistory:[{id:'hist-1',patientId:P1,appointmentId:AP1,type:'Agendamento criado',text:'x',at:'2026-11-01T09:00:00.000Z'},{id:'hist-2',patientId:P1,appointmentId:null,type:'Paciente cadastrado',text:'Cadastro criado.',at:'2026-11-01T08:00:00.000Z'}],
 scheduleBlocks:[{id:'blk-1',professionalId:SURGEON,hospitalId:null,date:'2026-12-09',start:'08:00',end:'12:00',reason:'Congresso'}],
 schedulingRules:[{id:'rule-1',professionalId:SURGEON,hospitalId:null,name:'Sextas',severity:'block',weekday:'5',occurrence:'',start:'',end:'',maxPatients:null,procedureContains:'',preferredTimes:'',forbiddenTimes:'',blockAllDay:true,enabled:true}]};

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.organizations(id uuid primary key,slug text not null,active boolean not null default true);
  insert into public.organizations values ('${ORG}','rn-gestao',true);
  create table public.users(id bigint primary key,role text not null,active boolean not null default true,name text);
  create table public.organization_memberships(user_id bigint,organization_id uuid,role text,active boolean default true);
  insert into public.users values (1,'general_manager',true,'Gerente'),(2,'secretary',true,'Secretária'),(3,'doctor',true,'Médico');
  insert into public.organization_memberships select id,'${ORG}',role,true from public.users;
  create table public.doctors(id text primary key,organization_id uuid not null default '${ORG}',name text,crm text,specialty text,category text,active boolean default true,
   details jsonb,scheduling_enabled boolean default true,billing_enabled boolean default true,invoice_enabled boolean default true,updated_at timestamptz default now(),updated_by bigint);
  insert into public.doctors(id,name,specialty) values ('${SURGEON}','Dr. Cirurgião','Ortopedia'),('${CLINIC}','Dra. Clínica','Clínica médica'),('${ANEST}','Dr. Anestesista','Anestesiologia');
  create table public.doctor_agendas(doctor_id text primary key,active boolean,settings jsonb,updated_at timestamptz default now(),updated_by bigint);
  insert into public.doctor_agendas(doctor_id,active,settings) select id,true,'{"workStart":"07:00","workEnd":"19:00"}' from public.doctors;
  create table public.attendances(id text primary key,appointment_id text,origin text,patient_id text,doctor_id text,date date,procedure text,insurance text,billing_method text,status text,organization_id uuid);
  create table public.invoices(id uuid primary key,status text,voided_at timestamptz,invoice_number text,organization_id uuid);
  create table public.billing_records(id uuid primary key,attendance_id text,appointment_id text);
  create table public.invoice_billing_records(billing_record_id uuid,invoice_id uuid,is_active boolean);
  create table public.billing_entities(id uuid,name text,organization_id uuid);
  create table public.billing_doctor_entities(id uuid,doctor_id text,organization_id uuid);
  create table public.company_associates(id uuid,name text);
  create table public.agenda_requests(id text primary key,status text,decided_by bigint,decision_note text,decided_at timestamptz);
  insert into public.agenda_requests values ('req-1','pending',null,null,null),('req-2','accepted',1,null,now());
  create table public.audit_logs(id text,actor_user_id bigint,actor_name text,actor_role text,action text,professional_id text,appointment_id text,patient_id text,description text,metadata jsonb,created_at timestamptz);
  create table public.notifications(id text,user_id bigint,type text,request_id text,message text,created_at timestamptz);
  create table public.directory_audit(actor_id bigint,kind text,record_id text,before_data jsonb,after_data jsonb);
  create table public.app_state(id integer primary key,organization_id uuid,payload jsonb not null,version bigint default 1,updated_at timestamptz default now());
  insert into public.app_state(id,organization_id,payload) values (1,'${ORG}',$json$${JSON.stringify(legacy)}$json$);
  create function public.is_anesthesiologist(t text) returns boolean language sql immutable as $$ select lower(trim(coalesce(t,'')))='anestesiologia' $$;
  create function public.valid_medical_specialty(t text) returns boolean language sql immutable as $$ select true $$;
  create function public.rn_finance_single_organization_id() returns uuid language sql stable as $$ select id from public.organizations $$;
  create function public.commit_agenda_change(p_expected timestamptz,p_payload jsonb,p_revision timestamptz,p_audit jsonb,p_request_id text default null,
   p_decision text default null,p_actor bigint default null,p_note text default null,p_notification jsonb default null) returns boolean language plpgsql as $$ begin return true; end; $$;
  create function public.require_rn_agenda_actor_organization(p_actor bigint) returns uuid language plpgsql stable as $$ begin return null; end; $$;
  create function public.financial_operation(p_actor bigint,p_kind text,p_id text) returns void language plpgsql as $$
   begin perform set_config('rn.actor',p_actor::text,true); end; $$;
 `);
 await db.exec(migration);
 return db;
}
const apply=(db,actor,ops)=>db.query('select public.apply_agenda_changes($1,$2::jsonb) as r',[actor,JSON.stringify(ops)]).then(r=>r.rows[0].r);
const load=db=>db.query('select public.load_agenda_state(1) as s').then(r=>r.rows[0].s);
const version=(db,table,id)=>db.query(`select row_version from public.${table} where id=$1`,[id]).then(r=>r.rows[0]?.row_version);
const patient=(id,extra={})=>({id,doctorId:SURGEON,name:'Novo Paciente',cpf:'',phone:'',email:'',insurance:'',cardNumber:'',...extra});
const appointment=(id,extra={})=>({id,doctorId:SURGEON,anesthetistId:null,patientId:P1,hospitalId:'',date:'2026-12-10',time:'10:00',duration:30,status:'scheduled',procedure:'Consulta',...extra});
async function rejects(promise,pattern){await assert.rejects(promise,error=>pattern.test(`${error.code||''} ${error.message}`))}

test('migrates the legacy test document into normalized tables and freezes app_state',async()=>{
 const db=await fixture();
 try{
  const counts=(await db.query(`select (select count(*) from public.patients)::int p,(select count(*) from public.appointments)::int a,(select count(*) from public.appointments where cancelled_at is not null)::int c,
   (select count(*) from public.patient_history_events)::int h,(select count(*) from public.schedule_blocks)::int b,(select count(*) from public.scheduling_rules)::int r,
   (select count(*) from public.hospitals)::int hs,(select count(*) from public.appointment_reschedules)::int rs`)).rows[0];
  assert.deepEqual(counts,{p:2,a:2,c:1,h:2,b:1,r:1,hs:1,rs:1});
  const state=(await load(db)).state;
  assert.equal(state.schemaVersion,7);
  assert.deepEqual(state.appointments.map(a=>a.id),[AP1]);
  assert.deepEqual(state.cancelledAppointments.map(a=>[a.id,a.cancelReason]),[[AP2,'Desistiu']]);
  assert.equal(state.appointments[0].payment,undefined,'legacy finance fields are discarded');
  assert.equal(state.appointments[0].invoiceNumber,undefined);
  assert.equal(state.appointments[0].rescheduleHistory[0].reason,'Paciente pediu');
  assert.deepEqual(state.professionals.map(p=>p.name).sort(),['Dr. Anestesista','Dr. Cirurgião','Dra. Clínica']);
  assert.equal(state.schedulingRules[0].weekday,'5');
  assert.equal((await db.query("select status,decision_note from public.agenda_requests where id='req-1'")).rows[0].decision_note,'migração A1');
  await rejects(db.query("update public.app_state set version=version+1"),/Agenda migrada/);
  await rejects(db.query("select public.commit_agenda_change(now(),'{}',now(),'[]',null,null,1,null,null)"),/Agenda migrada/);
  const triggers=(await db.query("select tgname from pg_trigger where tgrelid='public.app_state'::regclass and not tgisinternal")).rows.map(r=>r.tgname);
  assert.deepEqual(triggers,['app_state_frozen']);
 }finally{await db.close()}
});

test('per-record versions: stale expected version is a conflict, other records are independent',async()=>{
 const db=await fixture();
 try{
  const before=(await load(db)).revision;
  assert.equal(await version(db,'appointments',AP1),1);
  const first=await apply(db,2,[{op:'upsert_appointment',id:AP1,expectedVersion:1,data:appointment(AP1,{date:'2026-12-07',time:'09:00',anesthetistId:ANEST,status:'confirmed'})}]);
  assert.equal(first.ok,true);
  assert.ok(Date.parse(first.revision)>Date.parse(before));
  assert.equal(await version(db,'appointments',AP1),2);
  await rejects(apply(db,2,[{op:'upsert_appointment',id:AP1,expectedVersion:1,data:appointment(AP1,{date:'2026-12-07',time:'09:00',anesthetistId:ANEST})}]),/Conflito de edição/);
  // Outro registro com versão correta não é afetado pela edição concorrente.
  assert.equal((await apply(db,2,[{op:'upsert_patient',id:P2,expectedVersion:1,data:{...patient(P2),doctorId:CLINIC,name:'Paciente Clínica',phone:'9999'}}])).ok,true);
  const bases=(await db.query('select public.agenda_row_bases(1,$1,$2::jsonb) as b',[before,JSON.stringify([{entity:'appointments',id:AP1}])])).rows[0].b;
  assert.deepEqual([bases[0].baseVersion,bases[0].currentVersion,bases[0].base.status],[1,2,'scheduled']);
  assert.equal((await load(db)).state.appointments[0].status,'confirmed');
 }finally{await db.close()}
});

test('CPF is unique per doctor unless newborn; newborn requires a guardian',async()=>{
 const db=await fixture();
 try{
  await rejects(apply(db,2,[{op:'upsert_patient',id:uuid(1),data:patient(uuid(1),{cpf:'52998224725'})}]),/23505|duplicate|patients_owner_cpf_key/);
  assert.equal((await apply(db,2,[{op:'upsert_patient',id:uuid(2),data:patient(uuid(2),{doctorId:CLINIC,cpf:'52998224725'})}])).ok,true,'same person with another doctor is a separate record');
  assert.equal((await apply(db,2,[{op:'upsert_patient',id:uuid(3),data:patient(uuid(3),{cpf:'52998224725',newborn:true,guardianName:'Mãe'})}])).ok,true);
  await rejects(apply(db,2,[{op:'upsert_patient',id:uuid(4),data:patient(uuid(4),{newborn:true,guardianName:' '})}]),/23514|check/);
  const rn=(await load(db)).state.patients.find(p=>p.id===uuid(3));
  assert.deepEqual([rn.newborn,rn.guardianName],[true,'Mãe']);
  await rejects(apply(db,2,[{op:'upsert_patient',id:'not-a-uuid',data:patient('not-a-uuid')}]),/Identificador inválido/);
 }finally{await db.close()}
});

test('patient owner is permanent once there are appointments and must match the appointment doctor',async()=>{
 const db=await fixture();
 try{
  await rejects(apply(db,2,[{op:'upsert_patient',id:P1,expectedVersion:1,data:{...patient(P1),doctorId:CLINIC,name:'Paciente Teste',cpf:'52998224725'}}]),/médico responsável não pode ser alterado/);
  await apply(db,2,[{op:'upsert_patient',id:uuid(5),data:patient(uuid(5))}]);
  assert.equal((await apply(db,2,[{op:'upsert_patient',id:uuid(5),expectedVersion:1,data:patient(uuid(5),{doctorId:CLINIC})}])).ok,true,'wrong-doctor registration can be fixed while empty');
  await rejects(apply(db,2,[{op:'upsert_appointment',id:uuid(6),data:appointment(uuid(6),{patientId:P2})}]),/pertence a outro médico/);
 }finally{await db.close()}
});

test('soft delete only: direct deletes are blocked, history is immutable, archive is explicit',async()=>{
 const db=await fixture();
 try{
  await rejects(db.query(`delete from public.patients where id='${P1}'`),/Exclusão direta bloqueada/);
  await rejects(db.query(`delete from public.appointments where id='${AP1}'`),/Exclusão direta bloqueada/);
  await rejects(db.query("update public.patient_history_events set text='x2' where id='hist-1'"),/imutável/);
  await rejects(db.query("delete from public.patient_history_events where id='hist-1'"),/Exclusão direta bloqueada/);
  await apply(db,1,[{op:'archive_patient',id:P2,expectedVersion:1}]);
  const state=(await load(db)).state;
  assert.equal(state.patients.some(p=>p.id===P2),false);
  assert.equal((await db.query(`select archived_by from public.patients where id='${P2}'`)).rows[0].archived_by,1);
  await apply(db,1,[{op:'delete_block',id:'blk-1',expectedVersion:1}]);
  assert.equal((await load(db)).state.scheduleBlocks.length,0);
  const deleted=(await db.query("select data from public.agenda_row_versions where entity='scheduleBlocks' and row_id='blk-1' order by row_version desc limit 1")).rows[0];
  assert.equal(deleted.data,null);
 }finally{await db.close()}
});

test('availability is enforced per row: blocks, full-day rules, forbidden times and daily limits',async()=>{
 const db=await fixture();
 try{
  await rejects(apply(db,2,[{op:'upsert_appointment',id:uuid(10),data:appointment(uuid(10),{date:'2026-12-09',time:'11:30'})}]),/bloqueio do profissional/);
  await rejects(apply(db,2,[{op:'upsert_appointment',id:uuid(11),data:appointment(uuid(11),{date:'2026-12-11'})}]),/dia totalmente bloqueado/);
  await apply(db,1,[{op:'upsert_rule',id:uuid(12),data:{id:uuid(12),professionalId:SURGEON,name:'Almoço',severity:'block',weekday:'',occurrence:'',start:'',end:'',maxPatients:1,procedureContains:'',preferredTimes:'',forbiddenTimes:'12:00, 13:00',blockAllDay:false,enabled:true}}]);
  await rejects(apply(db,2,[{op:'upsert_appointment',id:uuid(13),data:appointment(uuid(13),{date:'2026-12-14',time:'12:00'})}]),/horário proibido/);
  assert.equal((await apply(db,2,[{op:'upsert_appointment',id:uuid(14),data:appointment(uuid(14),{date:'2026-12-14',time:'08:00'})}])).ok,true);
  await rejects(apply(db,2,[{op:'upsert_appointment',id:uuid(15),data:appointment(uuid(15),{date:'2026-12-14',time:'15:00'})}]),/limite diário/);
  await rejects(apply(db,1,[{op:'upsert_rule',id:uuid(16),data:{id:uuid(16),professionalId:SURGEON,forbiddenTimes:'25:00'}}]),/Horário inválido/);
  // Cancelar não depende de disponibilidade.
  assert.equal((await apply(db,2,[{op:'upsert_appointment',id:uuid(14),expectedVersion:1,cancelled:true,data:appointment(uuid(14),{date:'2026-12-14',time:'08:00',cancelReason:'Desmarcou'})}])).ok,true);
 }finally{await db.close()}
});

test('issued invoice blocks cancellation; realized appointments reach attendances',async()=>{
 const db=await fixture();
 try{
  await apply(db,1,[{op:'upsert_appointment',id:AP1,expectedVersion:1,data:appointment(AP1,{date:'2026-12-07',time:'09:00',anesthetistId:ANEST,status:'realized',insurance:'Unimed',forma_cobranca:'CONVENIO'})}]);
  const attendance=(await db.query(`select doctor_id,status,billing_method,organization_id from public.attendances where appointment_id='${AP1}'`)).rows[0];
  assert.deepEqual(attendance,{doctor_id:SURGEON,status:'realized',billing_method:'CONVENIO',organization_id:ORG});
  await db.exec(`insert into public.invoices values ('${uuid(20)}','ACTIVE',null,'NF-1','${ORG}');
   insert into public.billing_records values ('${uuid(21)}','${AP1}','${AP1}');
   insert into public.invoice_billing_records values ('${uuid(21)}','${uuid(20)}',true);`);
  await rejects(apply(db,1,[{op:'upsert_appointment',id:AP1,expectedVersion:2,cancelled:true,data:appointment(AP1,{date:'2026-12-07',time:'09:00',anesthetistId:ANEST,status:'realized',cancelReason:'x'})}]),/Nota Fiscal emitida/);
  await rejects(apply(db,1,[{op:'archive_appointment',id:AP1,expectedVersion:2}]),/Nota Fiscal emitida/);
 }finally{await db.close()}
});

test('billing is switched off server-side and agenda tables are service-role only',async()=>{
 const db=await fixture();
 try{
  await rejects(db.query("select public.preview_billing_month(1,null,'2026-11')"),/Faturamento em reconstrução/);
  await rejects(db.query("select public.save_manual_attendance(1,'{}')"),/Faturamento em reconstrução/);
  await rejects(db.query("select public.finish_private_payment(1,null,'{}')"),/Faturamento em reconstrução/);
  assert.equal((await db.query('select public.authorized_financial_attachment_actor(1,null,null) as ok')).rows[0].ok,false);
  for(const table of ['patients','appointments','hospitals','schedule_blocks','scheduling_rules','patient_history_events','agenda_settings','agenda_row_versions']){
   const privileges=(await db.query(`select has_table_privilege('anon','public.${table}','select') a,has_table_privilege('authenticated','public.${table}','select') b,has_table_privilege('service_role','public.${table}','select') s`)).rows[0];
   assert.deepEqual(privileges,{a:false,b:false,s:true},table);
  }
  assert.equal((await db.query("select has_function_privilege('anon','public.apply_agenda_changes(bigint,jsonb,jsonb,text,text,text,jsonb)','execute') x")).rows[0].x,false);
  await rejects(db.query('select public.load_agenda_state(999)'),/Acesso à organização negado/);
 }finally{await db.close()}
});

test('workflow decision, audit and notification are written in the same transaction',async()=>{
 const db=await fixture();
 try{
  await db.exec("insert into public.agenda_requests values ('req-3','pending',null,null,null)");
  const result=(await db.query(`select public.apply_agenda_changes(1,$1::jsonb,$2::jsonb,'req-3','accepted','ok',$3::jsonb) as r`,[
   JSON.stringify([{op:'upsert_appointment',id:uuid(30),data:appointment(uuid(30))}]),
   JSON.stringify([{id:'audit-1',actor_user_id:1,action:'request_accepted'}]),
   JSON.stringify({id:'n-1',user_id:3,type:'request_accepted',message:'ok'})])).rows[0].r;
  assert.equal(result.ok,true);
  assert.equal((await db.query("select status from public.agenda_requests where id='req-3'")).rows[0].status,'accepted');
  assert.equal((await db.query("select count(*)::int n from public.audit_logs")).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from public.notifications where request_id='req-3'")).rows[0].n,1);
  const again=(await db.query(`select public.apply_agenda_changes(1,'[]','[]','req-3','denied',null,null) as r`)).rows[0].r;
  assert.deepEqual(again,{ok:false,conflict:'request'});
 }finally{await db.close()}
});
