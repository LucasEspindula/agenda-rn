// Revisão por papel (11/11/2026): gerente, secretária e médico.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const policy=loadTs('lib/security/state.ts');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const principal=role=>({account:{role},agendaIds:['one']});
const appointment=(id,doctorId,patientId)=>({id,doctorId,patientId,date:'2026-09-14',time:'10:00',duration:60,status:'scheduled'});
const block={id:'b1',professionalId:'one',date:'2026-09-15',start:'08:00',end:'09:00',reason:'Congresso',hospitalId:null};
const rule={id:'r1',professionalId:'one',name:'Manhã',severity:'preference',enabled:true,blockAllDay:false};
function fixture(){return {schemaVersion:7,settings:{workStart:'07:00',workEnd:'19:00'},professionals:[{id:'one'},{id:'two'}],hospitals:[],
 patients:[{id:'p1',doctorId:'one'},{id:'p2',doctorId:'two'}],appointments:[appointment('a','one','p1'),appointment('b','two','p2')],cancelledAppointments:[],
 patientHistory:[],schedulingRules:[rule],scheduleBlocks:[block]}}
const visible=(s,p)=>structuredClone(policy.visibleState(s,p));

test('secretária: bloqueio novo, alterado ou regra alterada é recusado com 403 (antes sumia em silêncio)',()=>{
 for(const attack of [
  p=>p.scheduleBlocks.push({...block,id:'b2',date:'2026-09-16'}),
  p=>{p.scheduleBlocks[0].reason='Outro motivo'},
  p=>{p.schedulingRules[0].enabled=false},
  p=>p.schedulingRules.push({...rule,id:'r2'}),
 ]){
  const s=fixture(),p=visible(s,principal('secretary'));attack(p);
  assert.throws(()=>policy.mergeState(s,p,principal('secretary')),e=>e.status===403);
 }
});

test('secretária: salvar consulta com bloqueios e regras intactos continua funcionando',()=>{
 const s=fixture(),p=visible(s,principal('secretary'));
 // O navegador normaliza hospitalId/blockAllDay; a comparação usa a forma canônica.
 p.scheduleBlocks=p.scheduleBlocks.map(b=>({...b,hospitalId:null}));p.schedulingRules=p.schedulingRules.map(r=>({...r,blockAllDay:!!r.blockAllDay}));
 p.appointments[0].status='confirmed';
 const next=policy.mergeState(s,p,principal('secretary'));
 assert.equal(next.appointments.find(a=>a.id==='a').status,'confirmed');
 assert.deepEqual(next.scheduleBlocks,s.scheduleBlocks);
});

test('médico continua criando bloqueio na própria agenda e não na alheia',()=>{
 const s=fixture(),p=visible(s,principal('doctor'));
 p.scheduleBlocks.push({...block,id:'b3',date:'2026-09-17'});
 assert.equal(policy.mergeState(s,p,principal('doctor')).scheduleBlocks.length,2);
 const q=visible(s,principal('doctor'));q.scheduleBlocks.push({...block,id:'b4',professionalId:'two'});
 assert.throws(()=>policy.mergeState(s,q,principal('doctor')));
});

test('interface: só gerência e médico editam bloqueio; secretária vê sem salvar/excluir',()=>{
 const js=read('public/legacy-app.js'),html=read('app/dashboard/legacy-body.ts');
 assert.match(js,/function canEditBlocks\(\)\{const role=\(window\.AgendaAuth\|\|\{\}\)\.role;return role==="general_manager"\|\|role==="doctor"\}/);
 assert.match(js,/\$\("saveBlockBtn"\)\.classList\.toggle\("hidden",!editable\)/);
 assert.match(js,/if\(form\.dataset\.saving\|\|!canEditBlocks\(\)\)return;/);
 assert.match(js,/if\(id&&canEditBlocks\(\)&&await appConfirm\("Excluir bloqueio"/);
 assert.match(html,/<button id="saveBlockBtn" type="submit" class="primary-btn">Salvar bloqueio<\/button>/);
});

test('impressão da agenda usa a organização da sessão (quem tem duas organizações não recebe erro)',()=>{
 assert.match(read('app/api/reports/agenda/route.ts'),/loadAgendaWindow\(session\.account\.id, start, session\.organization\.id\)/);
});

test('PDF verificado da cirurgia fica sob org/<organização>/ no Storage',()=>{
 assert.match(read('app/api/documents/route.ts'),/const storedPath = `org\/\$\{session\.organization\.id\}\/\$\{surgery\.id\}\/\$\{randomUUID\(\)\}\.verified\.pdf`;/);
});

test('médico exclui o próprio bloqueio; bloqueio de outra agenda e o criado depois da leitura ficam',()=>{
 const s=fixture();s.scheduleBlocks.push({...block,id:'b9',professionalId:'two'});
 const p=visible(s,principal('doctor'));p.scheduleBlocks=p.scheduleBlocks.filter(b=>b.id!=='b1');
 const next=policy.mergeState(s,p,principal('doctor'));
 assert.equal(next.scheduleBlocks.map(b=>b.id).join(','),'b9');
});

test('secretária salva detalhes de atendimento sem anestesista ("" na tela, null no banco)',()=>{
 const s=fixture();s.appointments[0].anesthetistId=null;
 const p=visible(s,principal('secretary'));const a=p.appointments.find(x=>x.id==='a');a.anesthetistId='';a.procedureValue=1500;
 const next=policy.mergeState(s,p,principal('secretary'));
 assert.equal(next.appointments.find(x=>x.id==='a').procedureValue,1500);
 const q=visible(s,principal('secretary'));q.appointments.find(x=>x.id==='a').anesthetistId='two';
 assert.throws(()=>policy.mergeState(s,q,principal('secretary')),e=>e.status===403);
});

