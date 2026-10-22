import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {readFileSync} from 'node:fs';

const {visibleState,mergeState,canReadAppointment,validateState}=loadTs('lib/security/state.ts');
const services=loadTs('lib/doctor-services.ts');
const apiSource=readFileSync('app/api/billing/route.ts','utf8');
const authz=readFileSync('app/authz.ts','utf8');
const fixture=()=>({
 schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},
 professionals:[{id:'surgeon'},{id:'ana'},{id:'foreign'}],hospitals:[],
 patients:[{id:'p1',doctorId:'surgeon',name:'Paciente compartilhado',cpf:'52998224725',address:'Rua reservada'},
           {id:'p2',doctorId:'foreign',name:'Paciente alheio',cpf:'52998224725'}],
 appointments:[{id:'a1',doctorId:'surgeon',anesthetistId:'ana',patientId:'p1',date:'2026-10-22',time:'09:00',duration:60,status:'scheduled'},
               {id:'a2',doctorId:'foreign',patientId:'p2',date:'2026-10-22',time:'10:00',duration:60,status:'scheduled'}],
 cancelledAppointments:[],patientHistory:[],schedulingRules:[],scheduleBlocks:[]
});
const principal=(role,agendaIds,doctorId)=>({account:{role,doctorId},agendaIds});

test('Gerente geral: visibilidade ampla e permissão para atualizar status',()=>{
 const s=fixture(),m=principal('general_manager',[]);
 assert.equal(visibleState(s,m).appointments.length,2);
 const payload=structuredClone(s);payload.appointments[0].status='confirmed';
 const next=mergeState(s,payload,m);
 assert.equal(next.appointments[0].status,'confirmed');
});
test('Secretaria: vê agendamento da sua agenda e não pode alterar agendamento de terceiro',()=>{
 const s=fixture(),p=principal('secretary',['surgeon']),snapshot=visibleState(s,p);
 assert.deepEqual(snapshot.appointments.map(x=>x.id),['a1']);
 const changed=structuredClone(snapshot);changed.appointments.push(s.appointments[1]);
 assert.throws(()=>mergeState(s,changed,p),/agenda|permissão/i);
});
test('Faturamento: acesso financeiro administrativo somente com perfil de gerência',()=>{
 assert.match(apiSource,/session.account.role==='secretary'&&!appointmentId&&!summary/);
 assert.match(apiSource,/session.account.role==='doctor'/);
 assert.match(apiSource,/kind==='edit_invoice_request'/);
 assert.match(authz,/type Role = "general_manager" \| "secretary" \| "doctor"/);
});
test('Médico: pode consultar agenda atribuída, mas não editar diretamente agendamentos',()=>{
 const s=fixture(),p=principal('doctor',['surgeon'],'surgeon');
 const copy=visibleState(s,p);
 assert.deepEqual(copy.appointments.map(x=>x.id),['a1']);
 copy.appointments[0].status='realized';
 assert.equal(mergeState(s,copy,p).appointments[0].status,'scheduled');
});
test('Anestesista: vê o paciente do procedimento compartilhado, sem CPF/endereço',()=>{
 const s=fixture(),p=principal('doctor',['ana'],'ana');
 assert.equal(canReadAppointment(p,s.appointments[0]),true);
 const projected=visibleState(s,p);
 assert.deepEqual(projected.appointments.map(x=>x.id),['a1']);
 assert.deepEqual(projected.patients.map(x=>x.id),['p1']);
 assert.equal(projected.patients[0].cpf,undefined);
 assert.equal(projected.patients[0].address,undefined);
 assert.equal(projected.patients.find(x=>x.id==='p2'),undefined);
});
test('Secretaria de anestesia: lê paciente vinculado sem poder sobrescrever cadastro do cirurgião',()=>{
 const s=fixture(),p=principal('secretary',['ana']);
 const visible=visibleState(s,p);
 assert.deepEqual(visible.patients.map(x=>x.id),['p1']);
 const edited=structuredClone(visible);
 edited.patients[0].name='Alteração não autorizada';
 assert.throws(()=>mergeState(s,edited,p),/outra agenda|permissão/i);
});
test('Médico sem Agendamento habilitado não acessa a Agenda; somente perfis habilitados',()=>{
 const p={account:{role:'doctor',doctorId:'ana'},agendaIds:['ana'],services:{scheduling_enabled:false,billing_enabled:true,invoice_enabled:false}};
 assert.equal(services.canUseAgenda(p),false);
 const p2={...p,services:{...p.services,scheduling_enabled:true}};
 assert.equal(services.canUseAgenda(p2),true);
});
test('Estado inválido com IDs duplicados e vínculos não autorizados é rejeitado',()=>{
 const s=fixture();s.appointments.push({...s.appointments[0]});
 assert.throws(()=>validateState(s));
});
