-- Verificação de isolamento entre duas organizações (2B-M1).
-- Rodar SEMPRE dentro de BEGIN ... ROLLBACK no banco (não grava nada):
--   begin; <migration 20261107120000 se ainda não aplicada>; <este arquivo>; rollback;
-- Cria a "Clínica Teste B" e tenta atravessar dados nos dois sentidos.
-- Cada linha de pg_temp.tenant_check deve terminar com ok=true.

create temp table tenant_check(step text, ok boolean, detail text) on commit drop;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end $$;

do $$
declare
 a_org uuid:=(select id from public.organizations where slug='rn-gestao');
 b_org uuid:='bbbbbbbb-0000-4000-8000-0000000000b1';
 a_mgr bigint:=(select u.id from public.users u join public.organization_memberships m on m.user_id=u.id and m.active where m.organization_id=a_org and u.role='general_manager' and u.active order by u.id limit 1);
 a_sec bigint:=(select u.id from public.users u join public.organization_memberships m on m.user_id=u.id and m.active where m.organization_id=a_org and u.role='secretary' and u.active order by u.id limit 1);
 a_doc text:=(select id from public.doctors where organization_id=a_org and specialty<>'Anestesiologia' and scheduling_enabled order by name limit 1);
 a_crm text; a_appt text; a_appt_version integer; a_appt_before text; a_patient text;
 b_mgr bigint; b_doc text; b_patient text:=gen_random_uuid()::text; b_appt text:=gen_random_uuid()::text;
 a_req text:=gen_random_uuid()::text; msg text; ctx jsonb; st jsonb; n integer;
 creds jsonb:=jsonb_build_object('hash','pbkdf2-sha256$600000$'||encode(decode(md5(random()::text)||md5(random()::text),'hex'),'base64'),'salt',encode(decode(md5(random()::text),'hex'),'base64'));
begin
 -- Médico de A com CRM conhecido, criado pela própria função de cadastro.
 a_crm:='CRM-ISOL-'||floor(random()*1e6)::text;
 perform public.save_doctor_directory(a_mgr,'doctor',jsonb_build_object('name','Dr. Isolamento A','specialty','Cardiologia','crm',a_crm));
 select id,row_version,public.agenda_appointment_json(x)::text,patient_id into a_appt,a_appt_version,a_appt_before,a_patient
  from public.appointments x where organization_id=a_org and archived_at is null order by date desc limit 1;

 -- Clínica B, com agenda e gerente próprios.
 insert into public.users(email,name,role,active) values('gerente.b@clinicab.test','Gerente B','general_manager',true) returning id into b_mgr;
 -- Desde a 2B-M2a toda organização pertence a uma conta (aqui, outra conta contratante).
 insert into public.accounts(id,name,owner_user_id) values('bbbbbbbb-0000-4000-8000-0000000000ac','Conta Teste B',b_mgr);
 insert into public.organizations(id,slug,name,kind,active,account_id) values(b_org,'clinica-teste-b','Clínica Teste B','CLINIC',true,'bbbbbbbb-0000-4000-8000-0000000000ac');
 insert into public.agenda_settings(organization_id) values(b_org);
 insert into public.organization_memberships(organization_id,user_id,role,active) values(b_org,b_mgr,'general_manager',true);
 insert into public.sessions(token_hash,user_id,expires_at) values('iso-a',a_mgr,now()+interval '10 minutes'),('iso-b',b_mgr,now()+interval '10 minutes');

 -- Sessão e organização do ator.
 ctx:=public.session_context('iso-a');
 insert into tenant_check values('sessão A continua válida com 2 organizações',(ctx->'organization'->>'id')::uuid=a_org,ctx->'organization'->>'slug');
 ctx:=public.session_context('iso-b');
 insert into tenant_check values('sessão B aponta para B',(ctx->'organization'->>'id')::uuid=b_org,ctx->'organization'->>'slug');
 insert into tenant_check values('sync B não vê auditoria de A',(public.agenda_sync_signal('iso-b')->>'workflowRevision') is null,public.agenda_sync_signal('iso-b')->>'workflowRevision');

 -- Leitura: B não enxerga nada de A.
 st:=public.load_agenda_window(b_mgr,null)->'state';
 insert into tenant_check values('B lê agenda vazia',jsonb_array_length(st->'appointments')=0 and jsonb_array_length(st->'patients')=0 and jsonb_array_length(st->'professionals')=0,
  format('appts=%s patients=%s profs=%s',jsonb_array_length(st->'appointments'),jsonb_array_length(st->'patients'),jsonb_array_length(st->'professionals')));
 st:=public.load_agenda_state(a_mgr)->'state';
 insert into tenant_check values('A continua lendo a própria agenda',jsonb_array_length(st->'appointments')>0,jsonb_array_length(st->'appointments')::text);

 -- Cadastro: CRM pode repetir entre clínicas; B não edita médico de A.
 b_doc:=public.save_doctor_directory(b_mgr,'doctor',jsonb_build_object('name','Dra. Clínica B','specialty','Cardiologia','crm',a_crm));
 insert into tenant_check values('B cadastra médico com mesmo CRM de A',(select organization_id from public.doctors where id=b_doc)=b_org,b_doc);
 msg:=pg_temp.fails(format('select public.save_doctor_directory(%s,%L,%L::jsonb)',b_mgr,'doctor',jsonb_build_object('id',a_doc,'name','Invasor','specialty','Cardiologia')));
 insert into tenant_check values('B não altera médico de A',msg is not null and (select name from public.doctors where id=a_doc)<>'Invasor',msg);
 msg:=pg_temp.fails(format('select public.save_doctor_directory(%s,%L,%L::jsonb)',b_mgr,'agenda',jsonb_build_object('id',a_doc,'workStart','07:00','workEnd','08:00')));
 insert into tenant_check values('B não altera agenda de médico de A',msg is not null,msg);

 -- Agenda: B grava o que é seu e não alcança registros de A.
 perform public.apply_agenda_changes(b_mgr,jsonb_build_array(
  jsonb_build_object('op','upsert_patient','id',b_patient,'expectedVersion',null,'data',jsonb_build_object('id',b_patient,'doctorId',b_doc,'name','Paciente B')),
  jsonb_build_object('op','upsert_appointment','id',b_appt,'expectedVersion',null,'cancelled',false,'data',jsonb_build_object('id',b_appt,'doctorId',b_doc,'patientId',b_patient,'date','2026-12-14','time','10:00','duration',30,'status','scheduled','procedure','Consulta B'))));
 insert into tenant_check values('B cria paciente e consulta na própria clínica',(select organization_id from public.appointments where id=b_appt)=b_org and (select organization_id from public.patients where id=b_patient)=b_org,b_appt);
 msg:=pg_temp.fails(format('select public.apply_agenda_changes(%s,%L::jsonb)',b_mgr,jsonb_build_array(jsonb_build_object('op','upsert_appointment','id',gen_random_uuid(),'expectedVersion',null,'cancelled',false,
  'data',jsonb_build_object('doctorId',b_doc,'patientId',a_patient,'date','2026-12-14','time','11:00','duration',30,'status','scheduled')))));
 insert into tenant_check values('B não agenda paciente de A',msg is not null,msg);
 msg:=pg_temp.fails(format('select public.apply_agenda_changes(%s,%L::jsonb)',b_mgr,jsonb_build_array(jsonb_build_object('op','upsert_appointment','id',a_appt,'expectedVersion',a_appt_version,'cancelled',false,
  'data',jsonb_build_object('id',a_appt,'doctorId',b_doc,'patientId',b_patient,'date','2026-12-15','time','10:00','duration',30,'status','confirmed','procedure','Invasão')))));
 insert into tenant_check values('B não altera consulta de A pelo id',msg is not null and (select public.agenda_appointment_json(x)::text from public.appointments x where id=a_appt)=a_appt_before,msg);
 msg:=pg_temp.fails(format('select public.apply_agenda_changes(%s,%L::jsonb)',b_mgr,jsonb_build_array(jsonb_build_object('op','archive_appointment','id',a_appt,'expectedVersion',a_appt_version))));
 insert into tenant_check values('B não arquiva consulta de A',msg is not null and (select archived_at from public.appointments where id=a_appt) is null,msg);
 st:=public.agenda_row_bases(b_mgr,now(),jsonb_build_array(jsonb_build_object('entity','appointments','id',a_appt)));
 insert into tenant_check values('B não vê versão/base de registro de A',(st->0->>'currentVersion') is null and (st->0->>'base') is null,st::text);

 -- Solicitações e auditoria.
 insert into public.agenda_requests(id,professional_id,appointment_id,action,requested_by,created_at) values(a_req,a_doc,a_appt,'update',a_mgr,now());
 insert into tenant_check values('solicitação de A recebe organização A',(select organization_id from public.agenda_requests where id=a_req)=a_org,'');
 msg:=pg_temp.fails(format('select public.apply_agenda_changes(%s,%L::jsonb,%L::jsonb,%L,%L)',b_mgr,'[]','[]',a_req,'accepted'));
 insert into tenant_check values('B não decide solicitação de A',msg is not null and (select status from public.agenda_requests where id=a_req)='pending',msg);
 perform set_config('rn.actor',b_mgr::text,true);
 msg:=pg_temp.fails(format('insert into public.audit_logs(id,actor_user_id,actor_name,actor_role,action,professional_id,description,created_at) values(%L,%s,%L,%L,%L,%L,%L,now())',gen_random_uuid(),b_mgr,'Gerente B','general_manager','x',a_doc,'teste'));
 perform set_config('rn.actor','',true);
 insert into tenant_check values('auditoria de B não referencia médico de A',msg is not null,msg);

 -- Acessos.
 msg:=pg_temp.fails(format('select public.save_user_access(%s,%L::jsonb,null)',b_mgr,jsonb_build_object('id',a_sec,'email','x@y.test','role','secretary')));
 insert into tenant_check values('B não altera conta de A',msg is not null,msg);
 msg:=pg_temp.fails(format('select public.deactivate_user_access(%s,%s)',b_mgr,a_sec));
 insert into tenant_check values('B não desativa conta de A',msg is not null and (select active from public.users where id=a_sec),msg);
 msg:=pg_temp.fails(format('select public.save_user_access(%s,%L::jsonb,%L::jsonb)',b_mgr,jsonb_build_object('email','sec.b1@clinicab.test','role','secretary','agendaIds',jsonb_build_array(a_doc)),creds));
 insert into tenant_check values('B não concede agenda de A',msg is not null,msg);
 perform public.save_user_access(b_mgr,jsonb_build_object('email','sec.b2@clinicab.test','name','Sec B','role','secretary','agendaIds',jsonb_build_array(b_doc)),creds);
 insert into public.sessions(token_hash,user_id,expires_at) select 'iso-bs',id,now()+interval '10 minutes' from public.users where email='sec.b2@clinicab.test';
 ctx:=public.session_context('iso-bs');
 insert into tenant_check values('secretária de B nasce em B só com agenda de B',(ctx->'organization'->>'id')::uuid=b_org and ctx->'agendaIds'=jsonb_build_array(b_doc),ctx::text);

 -- A segue operando normalmente com duas organizações.
 msg:=pg_temp.fails(format('select public.apply_agenda_changes(%s,%L::jsonb)',a_mgr,jsonb_build_array(jsonb_build_object('op','upsert_patient','id',gen_random_uuid(),'expectedVersion',null,
  'data',jsonb_build_object('doctorId',a_doc,'name','Paciente A novo'))))));
 insert into tenant_check values('A grava normalmente com 2 organizações',msg is null,msg);
 insert into tenant_check values('revisão de A intacta e separada de B',public.agenda_revision(a_mgr)<>public.agenda_revision(b_mgr),'');

 -- 2B-M2a: titular com duas organizações na mesma conta.
 declare a_new uuid; a_owner bigint:=(select owner_user_id from public.accounts a join public.organizations o on o.account_id=a.id where o.id=a_org); n_patient text:=gen_random_uuid()::text;
 begin
  msg:=pg_temp.fails(format('select public.create_account_organization(%s,%L,%L,%L)',b_mgr,a_org,'Invasora','CLINIC'));
  insert into tenant_check values('quem não é titular de A não cria organização na conta de A',msg is not null,msg);
  a_new:=public.create_account_organization(a_owner,a_org,'Filial Teste','CLINIC');
  insert into tenant_check values('titular cria segunda organização na própria conta',(select account_id from public.organizations where id=a_new)=(select account_id from public.organizations where id=a_org),a_new::text);
  msg:=pg_temp.fails(format('select public.load_agenda_state(%s)',a_owner));
  insert into tenant_check values('com duas organizações, chamada sem organização é recusada',msg like '%Selecione a organização%',msg);
  st:=public.load_agenda_state(a_owner,a_new)->'state';
  insert into tenant_check values('organização nova começa vazia',jsonb_array_length(st->'appointments')=0 and jsonb_array_length(st->'patients')=0,'');
  st:=public.load_agenda_state(a_owner,a_org)->'state';
  insert into tenant_check values('titular continua vendo A ao escolher A',jsonb_array_length(st->'appointments')>0,jsonb_array_length(st->'appointments')::text);
  msg:=pg_temp.fails(format('select public.load_agenda_state(%s,%L)',b_mgr,a_new));
  insert into tenant_check values('gerente de outra conta não abre a organização nova',msg is not null,msg);
  insert into public.sessions(token_hash,user_id,expires_at) values('iso-owner',a_owner,now()+interval '10 minutes');
  perform public.switch_session_organization('iso-owner',a_new);
  insert into tenant_check values('sessão do titular troca para a organização nova',(public.session_context('iso-owner')->'organization'->>'id')::uuid=a_new,'');
  msg:=pg_temp.fails(format('select public.switch_session_organization(%L,%L)','iso-owner',b_org));
  insert into tenant_check values('sessão não troca para organização sem vínculo',msg is not null,msg);
  msg:=pg_temp.fails(format('select public.apply_agenda_changes(%s,%L::jsonb,%L::jsonb,null,null,null,null,%L)',a_owner,jsonb_build_array(jsonb_build_object('op','upsert_patient','id',n_patient,'expectedVersion',null,
   'data',jsonb_build_object('doctorId',a_doc,'name','Paciente cruzado'))),'[]',a_new));
  insert into tenant_check values('na organização nova não se usa médico de A',msg is not null,msg);
 end;
end $$;

select step, ok, left(detail,140) detail from tenant_check;
