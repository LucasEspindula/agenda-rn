import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
const {isInsurancePending,rowEntityId,companyLabel,matchesRow,expensePayer}=loadTs('lib/billing-row.ts');
const {buildReport}=loadTs('lib/billing-reports.ts');
const {canOpenInvoices,canOpenBilling,doctorHome}=loadTs('lib/doctor-services.ts');
const {MEDICAL_SPECIALTIES,canonicalSpecialty,isAnesthesiologist}=loadTs('lib/medical-specialties.ts');
const row={attendance_id:'a',origin:'AGENDA',status_atendimento:'realized',forma_cobranca:'CONVENIO',insurance:'IPE',date:'2026-01-10',doctor_id:'d1',patient:'Maria',record:null,invoice:null};
const data={rows:[row],doctors:[{id:'d1',name:'Médico'}],entities:[{id:'e',name:'Razão social',trade_name:'Fantasia'}],links:[{id:'l',doctor_id:'d1',billing_entity_id:'e',active:true}],invoices:[],items:[],payers:['IPE']};
for(const [name,value,expected] of [
 ['realized without record',row,true],['without entity',row,true],['paid NF',{...row,invoice:{paid_at:'2026-09-01'}},false],['unpaid NF',{...row,invoice:{paid_at:null}},true],['direct paid',{...row,record:{payment_status:'PAGO',settlement_mode:'DIRECT'}},false],['private insured',{...row,forma_cobranca:'PARTICULAR'},false],['not realized',{...row,status_atendimento:'scheduled'},false],['explicit method missing',{...row,forma_cobranca:null},false]
])test('canonical insurance pending: '+name,()=>assert.equal(isInsurancePending(value),expected));
test('company is historical, has trade name and never guesses current doctor link',()=>{assert.equal(rowEntityId(row),'');assert.equal(companyLabel(data,rowEntityId(row)),'—');assert.equal(rowEntityId({...row,billing_entity_id:'e'}),'e');assert.equal(rowEntityId({...row,billing_entity_id:'old',record:{billing_entity_id:'e'}}),'e');assert.equal(companyLabel(data,'e'),'Fantasia');assert.equal(companyLabel({...data,entities:[{id:'e',name:'Razão social'}]},'e'),'Razão social')});
test('filtered report requires no entity/doctor/period and shares current UI filters',()=>{const scope={kind:'filtered',entity:'',doctor:'',start:'',end:'',insurance:'IPE'};const report=buildReport(data,scope);assert.deepEqual(Array.from(report.rows),data.rows.filter(r=>matchesRow(r,scope)));assert.equal(report.rows.length,1)});
test('pending report and operational helper agree without company and with doctor selected',()=>{const scope={kind:'pending',entity:'',doctor:'d1',start:'',end:''};assert.equal(buildReport(data,scope).rows.length,1);assert.equal(buildReport({...data,rows:[{...row,invoice:{paid_at:'2026-09-01'}}]},scope).rows.length,0)});
test('specialty canonical list rejects free text and drives anesthesia independently of category',()=>{assert.ok(MEDICAL_SPECIALTIES.includes('Anestesiologia'));assert.equal(canonicalSpecialty('ssss'),undefined);assert.equal(canonicalSpecialty(' anestesiologia '),'Anestesiologia');assert.equal(isAnesthesiologist({specialty:' Anestesiologia ',category:'doctor'}),true);assert.equal(isAnesthesiologist({specialty:'Psiquiatria',category:'anesthetist'}),false)});
test('historical expense payer resolves exact inactive link or legacy name',()=>{assert.equal(expensePayer({...data,links:[{...data.links[0],active:false}]},{paid_by_doctor_entity_link_id:'l'}),'Médico');assert.equal(expensePayer({...data,associates:[{id:'old',name:'Histórico'}]},{paid_by_associate_id:'old'}),'Histórico')});
for(const billing of [true,false])test('Agenda + NF explicit readonly authorization, billing='+billing,async()=>{
 const session={account:{id:3,role:'doctor',doctorId:'d1'},agendaIds:['d1'],services:{scheduling_enabled:true,billing_enabled:billing,invoice_enabled:true}};
 assert.equal(doctorHome(session),'/dashboard');assert.equal(canOpenBilling(session),false);assert.equal(canOpenInvoices(session),true);
 const invoice={id:'nf',billing_entity_id:'e',invoice_number:'1058',net_amount:9000,total_amount:10000};
 const rows=[{...row,record:{id:'b1',billing_entity_id:'e'},invoice},{...row,attendance_id:'b',patient:'Outro médico',doctor_id:'d2',record:{id:'b2'},invoice},{...row,attendance_id:'unlinked'}];
 const api=loadTs('app/api/billing/route.ts',{'@/app/authz':{getSession:async()=>session},'@/lib/billing-data':{loadBillingData:async()=>({data:{...data,rows,invoices:[invoice],items:[{invoice_id:'nf',billing_record_id:'b1'},{invoice_id:'nf',billing_record_id:'b2'}]},state:{}})},'@/lib/supabase-admin':{getSupabaseAdmin:()=>{throw new Error('unexpected write')}}});
 assert.equal((await api.GET(new Request('https://example.test/api/billing?doctor_id=d2'))).status,403);
 const response=await api.GET(new Request('https://example.test/api/billing?view=invoices&doctor_id=d2'));assert.equal(response.status,200);const result=await response.json();assert.equal(result.rows.length,1);assert.equal(result.rows[0].doctor_id,'d1');assert.equal(result.invoices[0].net_amount,null);assert.equal(result.invoices[0].total_amount,null);assert.equal(result.expenses.length,0);
 session.services.invoice_enabled=false;assert.equal((await api.GET(new Request('https://example.test/api/billing?view=invoices'))).status,403);
});
test('documentary preview, accessible compact actions and no associates operational tab',()=>{
 const client=readFileSync('app/billing/billing-client.tsx','utf8');assert.match(client,/aria-label="Abrir financeiro"/);assert.match(client,/aria-label="Editar atendimento"/);assert.match(client,/billing-filter-action/);assert.match(client,/Imprimir atendimentos filtrados/);assert.ok(!client.includes("['associates','Associados']"));assert.ok(!client.includes('window.print('));
 const css=readFileSync('app/billing/billing.css','utf8');assert.match(css,/minmax\(0,1fr\) 52px/);assert.match(css,/table-header-group/);assert.match(css,/break-inside:avoid/);
});
