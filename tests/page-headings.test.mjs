import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('page descriptions replace only the scoped redundant headings',()=>{
 const pending=read('app/billing/insurance-pending.tsx');
 assert.match(pending,/<header className="pending-page-heading page-description"><p>Atendimentos realizados que ainda aguardam resolução financeira pelo convênio\.<\/p><\/header>/);
 assert.doesNotMatch(pending,/<header className="pending-page-heading">\s*<h1>Pendências de Convênio<\/h1>/);

 const doctors=read('app/doctors/doctor-directory.tsx');
 assert.match(doctors,/tab==='doctors'\?<p>Dados profissionais, serviços, agenda e acesso em um único cadastro\.<\/p>/);
 assert.doesNotMatch(doctors,/tab==='doctors'\?'Médicos':'Agenda'/);

 const billing=read('app/billing/billing-client.tsx');
 assert.match(billing,/adminView==='entities'.*?page-description">Cadastre e gerencie as entidades recebedoras utilizadas no faturamento\./s);
 assert.match(billing,/adminView==='links'.*?page-description">Defina quais empresas cada médico pode utilizar como entidade recebedora\./s);
 assert.doesNotMatch(billing,/adminView==='entities'.*?<h2>Empresas \/ entidades recebedoras<\/h2>/s);
 assert.doesNotMatch(billing,/adminView==='links'.*?<h2>Vínculos com médicos<\/h2>/s);

 const finance=read('app/billing/company-finance.tsx');
 assert.match(finance,/<section><p className="page-description billing-page-description">Controle das despesas das empresas e seus pagamentos\.<\/p><div className="billing-filter-bar">/);
});

test('legacy pages keep one centered description and no duplicate visible heading',()=>{
 const body=read('app/dashboard/legacy-body.ts'),legacy=read('public/legacy-app.js');
 assert.match(body,/section-head page-description-head"><p class="page-description">Cadastro, convênio e histórico dos pacientes\.<\/p><button id="newPatientBtn"/);
 assert.doesNotMatch(body,/<h2>Pacientes<\/h2><p>Cadastro, convênio e histórico de atendimentos\.<\/p>/);
 assert.match(body,/hospital-panel"><div class="section-head page-description-head"><p class="page-description">Cadastro compartilhado entre as agendas\.<\/p><button id="newHospitalBtn"/);
 assert.doesNotMatch(body,/hospital-panel"><div class="section-head"><div><h2>Hospitais<\/h2>/);
 assert.match(legacy,/requestsView.*?page-description">Sugestões enviadas pelos médicos para sua aprovação\./s);
 assert.match(legacy,/auditView.*?page-description">Histórico de alterações nas agendas autorizadas\./s);
 assert.doesNotMatch(legacy,/requestsView.*?<h2>Solicitações de agenda<\/h2>/s);
 assert.doesNotMatch(legacy,/auditView.*?<h2>Logs Agendamento<\/h2>/s);
 assert.match(legacy,/AgendaAdminSection==="hospitals"\?\["","Cadastro compartilhado entre as agendas\."\]/);
});

test('billing logs use the shared centered description without a visible title',()=>{
 const logs=read('app/billing/billing-logs.tsx');
 assert.match(logs,/<section className="billing-logs"><p className="page-description">Histórico imutável\. Cada evento reúne as alterações da mesma operação\.<\/p>/);
 assert.doesNotMatch(logs,/<section className="billing-logs"><h2>Logs Faturamento<\/h2>/);
 const billingCss=read('app/billing/billing.css'),legacyCss=read('public/legacy.css');
 assert.match(billingCss,/\.page-description\{max-width:720px.*?text-align:center/s);
 assert.match(billingCss,/\.billing-section-head\.page-description-head/);
 assert.match(legacyCss,/\.section-head\.page-description-head/);
});
