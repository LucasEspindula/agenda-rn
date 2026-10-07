import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('page descriptions are scoped, left-aligned and preserve actions',()=>{
 const pending=read('app/billing/insurance-pending.tsx');
 assert.match(pending,/<header className="pending-page-heading page-description"><p>Atendimentos realizados que ainda aguardam resolução financeira pelo convênio\.<\/p><\/header>/);
 assert.doesNotMatch(pending,/<header className="pending-page-heading">\s*<h1>Pendências de Convênio<\/h1>/);

 const doctors=read('app/doctors/doctor-directory.tsx');
 assert.match(doctors,/tab==='doctors'\?<p>Dados profissionais, serviços, agenda e acesso em um único cadastro\.<\/p>/);
 assert.doesNotMatch(doctors,/tab==='doctors'\?'Médicos':'Agenda'/);

 const billing=read('app/billing/billing-client.tsx');
 assert.match(billing,/adminView==='entities'.*?page-description">Cadastre e gerencie as entidades recebedoras utilizadas no faturamento\..*?<button className="billing-primary"/s);
 assert.match(billing,/adminView==='links'.*?page-description">Defina quais empresas cada médico pode utilizar como entidade recebedora\..*?billing-link-doctors/s);
 assert.doesNotMatch(billing,/adminView==='entities'.*?<h2>Empresas \/ entidades recebedoras<\/h2>/s);
 assert.doesNotMatch(billing,/adminView==='links'.*?<h2>Vínculos com médicos<\/h2>/s);

 const finance=read('app/billing/company-finance.tsx');
 assert.match(finance,/<section><p className="page-description billing-page-description">Controle das despesas das empresas e seus pagamentos\.<\/p><div className="billing-filter-bar">/);
});

test('shared description styles align content at the container start',()=>{
 const billingCss=read('app/billing/billing.css');
 const legacyCss=read('public/legacy.css');
 const pendingCss=read('app/billing/insurance-pending.css');
 assert.match(billingCss,/\.page-description\{max-width:720px;margin:0;.*?text-align:left/s);
 assert.match(legacyCss,/\.page-description\{max-width:720px;margin:0;.*?text-align:left/s);
 assert.match(pendingCss,/\.pending-page-heading\.page-description\{max-width:720px;margin:0 0 18px;text-align:left\}/);
 assert.match(billingCss,/\.billing-section-head\.page-description-head\{display:flex;align-items:center;justify-content:space-between/);
 assert.match(legacyCss,/\.section-head\.page-description-head\{display:flex;align-items:center;justify-content:space-between/);
 assert.doesNotMatch(billingCss,/grid-template-columns:minmax\(0,1fr\) minmax\(0,720px\) minmax\(0,1fr\)/);
 assert.doesNotMatch(legacyCss,/grid-template-columns:minmax\(0,1fr\) minmax\(0,720px\) minmax\(0,1fr\)/);
});

test('legacy pages keep one hospital description and preserve the rules heading',()=>{
 const body=read('app/dashboard/legacy-body.ts');
 const legacy=read('public/legacy-app.js');
 assert.match(body,/section-head page-description-head"><p class="page-description">Cadastro, convênio e histórico dos pacientes\.<\/p><button id="newPatientBtn"/);
 assert.match(body,/hospital-panel"><div class="section-head page-description-head"><p class="page-description">Cadastro compartilhado entre as agendas\.<\/p><button id="newHospitalBtn"/);
 assert.match(legacy,/requestsView.*?page-description">Sugestões enviadas pelos médicos para sua aprovação\..*?requestStatusFilter/s);
 assert.match(legacy,/auditView.*?page-description">Histórico de alterações nas agendas autorizadas\..*?refreshAudit/s);
 assert.doesNotMatch(legacy,/AgendaAdminSection==="hospitals"\?\[/);
 assert.match(legacy,/if\(view==="settings"&&window\.AgendaAdminSection!=="hospitals"\)/);
 assert.match(legacy,/AgendaAdminSection==="rules"\?\["Regras e bloqueios","Disponibilidade da agenda selecionada\."/);
});

test('billing logs retain the description without a redundant visual title',()=>{
 const logs=read('app/billing/billing-logs.tsx');
 assert.match(logs,/<section className="billing-logs"><p className="page-description">Histórico imutável\. Cada evento reúne as alterações da mesma operação\.<\/p>/);
 assert.doesNotMatch(logs,/<section className="billing-logs"><h2>Logs Faturamento<\/h2>/);
});
