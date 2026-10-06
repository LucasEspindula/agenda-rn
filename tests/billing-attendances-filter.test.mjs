import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
const {attendanceInsuranceOptions,sanitizeAttendanceFilters,matchesRow,matchesInvoice}=loadTs('lib/billing-row.ts');
const {buildReport}=loadTs('lib/billing-reports.ts');
const base={attendance_id:'a',appointment_id:'a',patient_id:'p',origin:'AGENDA',date:'2026-10-01',time:'08:00',doctor_id:'d',anesthetist_id:'',procedure:'Consulta',status_atendimento:'realized',billing_entity_id:'e',legacy_payment:null,legacy_invoice:null,created_at:'',created_by:null,updated_at:'',updated_by:null,invoice:null,invoice_item:null};
const row=values=>({...base,...values});
const filters=values=>({entity:'',doctor:'',insurance:'',patient:'',status:'',start:'',end:'',...values});
test('attendance insurance options are normalized and exclude patients plus private-only insurance values',()=>{
 const rows=[row({patient:'Lucas Espindula',insurance:' IPE ',forma_cobranca:'CONVENIO',record:null}),row({patient:'Maria',insurance:'ipe',forma_cobranca:'CONVENIO',record:null}),row({patient:'Paciente Particular',insurance:'UNIMED',forma_cobranca:'PARTICULAR',record:null})];
 assert.deepEqual(attendanceInsuranceOptions(rows),['IPE']);
 assert.ok(!attendanceInsuranceOptions(rows).includes('Lucas Espindula'));
});
test('Particular is billing method based, accepts partial accent-insensitive patient search and excludes the patient insurance',()=>{
 const privateRow=row({patient:'Lúcas Espindula',insurance:'UNIMED',forma_cobranca:'PARTICULAR',record:null});
 const insuranceRow=row({patient:'Maria',insurance:'UNIMED',forma_cobranca:'CONVENIO',record:null});
 assert.equal(matchesRow(privateRow,filters({insurance:'PARTICULAR',patient:'lucas'})),true);
 assert.equal(matchesRow(privateRow,filters({insurance:'UNIMED'})),false);
 assert.equal(matchesRow(insuranceRow,filters({insurance:'UNIMED'})),true);
 assert.equal(matchesRow(insuranceRow,filters({insurance:'PARTICULAR'})),false);
});
test('filtered reports preserve the particular patient filter while invoice payer matching remains independent',()=>{
 const privateRow=row({patient:'Lucas Espindula',insurance:'UNIMED',forma_cobranca:'PARTICULAR',record:{billing_entity_id:'e',billing_method:'PARTICULAR',payment_status:'PAGO',received_amount:100,settlement_mode:'DIRECT',paid_at:'2026-10-01',id:'r',attendance_id:'a',appointment_id:'a',invoice_number:null,notes:null,created_at:'',created_by:null,updated_at:'',updated_by:null}});
 const other=row({attendance_id:'b',appointment_id:'b',patient:'Outro paciente',insurance:'UNIMED',forma_cobranca:'PARTICULAR',record:{...privateRow.record,id:'r2',attendance_id:'b',appointment_id:'b'}});
 const data={rows:[privateRow,other],invoices:[],items:[],doctors:[{id:'d',name:'Dra. Ana'}],entities:[{id:'e',name:'Empresa',tax_id:'',person_type:'PJ',trade_name:'',active:true}],links:[],payers:[]};
 assert.equal(buildReport(data,{kind:'filtered',doctor:'',entity:'',start:'',end:'',insurance:'PARTICULAR',patient:'lucas'}).summary.total,1);
 assert.equal(matchesInvoice({id:'nf',billing_entity_id:'e',payer:'UNIMED',issue_date:'2026-10-01',paid_at:null,total_amount:null,net_amount:null,invoice_number:'1',notes:null,created_at:'',created_by:null,updated_at:'',updated_by:null},data,filters({insurance:'UNIMED'})),true);
});
test('attendance context sanitizes an invoice payer and only retains particular patient text for Particular',()=>{
 const rows=[row({insurance:'CESA',forma_cobranca:'CONVENIO',record:null})];
 assert.deepEqual(sanitizeAttendanceFilters(rows,'Lucas Espindula','Lucas'),{insurance:'',patient:''});
 assert.deepEqual(sanitizeAttendanceFilters(rows,'cEsa','Lucas'),{insurance:'CESA',patient:''});
 assert.deepEqual(sanitizeAttendanceFilters(rows,'PARTICULAR','Lucas'),{insurance:'PARTICULAR',patient:'Lucas'});
});
test('attendance patient field is stable, disabled outside Particular and CSS stays scoped',()=>{
 const client=readFileSync('app/billing/billing-client.tsx','utf8'),css=readFileSync('app/billing/billing.css','utf8');
 assert.match(client,/<label className="billing-filter-patient">Paciente<input type="search" disabled=\{insurance!=='PARTICULAR'\}/);
 assert.match(client,/placeholder=\{insurance==='PARTICULAR'\?'Buscar por nome':'Selecione Particular para filtrar'\}/);
 assert.match(client,/className="billing-table billing-attendance-table"/);
 assert.match(css,/\.billing-panel>\.billing-attendance-table\{min-width:1120px/);
 assert.match(css,/\.billing-attendance-table td\{max-width:260px/);
 assert.doesNotMatch(css,/\.billing-panel>\.billing-table\{min-width:1120px/);
 assert.doesNotMatch(css,/\.billing-table td\{max-width:260px/);
 assert.match(css,/\.billing-filter-patient input:disabled\{background:/);
});

test('billing logs keep the workflow-card composition instead of timeline card styles',()=>{
 const logs=readFileSync('app/billing/billing-logs.tsx','utf8'),css=readFileSync('app/billing/billing.css','utf8');
 for(const name of ['workflow-card','workflow-heading','workflow-status','workflow-changes','workflow-change','workflow-log-context','workflow-log-authorship'])assert.match(logs,new RegExp(name));
 assert.match(css,/Billing logs mirror the Agenda workflow-card tokens/);
 assert.match(css,/\.billing-log-event \.workflow-status\{display:inline-block;[^}]*padding:3px 7px;[^}]*font-size:9px/);
});
