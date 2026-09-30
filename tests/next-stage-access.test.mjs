import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {readFileSync} from 'node:fs';
const {doctorHome,canOpenBilling,canUseAgenda}=loadTs('lib/doctor-services.ts');
const {doctorBillingProjection}=loadTs('lib/billing-projection.ts');
const {individualReceived,companyCash,buildReport}=loadTs('lib/billing-reports.ts');
const {visibleState,withoutLegacyFinance}=loadTs('lib/security/state.ts');
const services=(s,b,i)=>({scheduling_enabled:s,billing_enabled:b,invoice_enabled:i});
const principal=(flags,id='d1')=>({account:{id:3,role:'doctor',doctorId:id},agendaIds:['d1','d2'],services:flags});
for(const [name,flags,home,agenda,billing] of [
 ['complete',services(true,true,true),'/dashboard',true,false],
 ['agenda only',services(true,false,false),'/dashboard',true,false],
 ['direct finance',services(false,true,false),'/billing',false,true],
 ['invoice only',services(false,false,true),'/billing?view=invoices',false,true],
 ['no service',services(false,false,false),'/no-services',false,false],
])test('doctor services and navigation: '+name,()=>{const p=principal(flags);assert.equal(doctorHome(p),home);assert.equal(canUseAgenda(p),agenda);assert.equal(canOpenBilling(p),billing)});
const invoice={id:'nf',billing_entity_id:'e',invoice_number:'123',issue_date:'2026-09-01',paid_at:'2026-09-15',payer:'UNIMED',net_amount:13800,total_amount:15000,notes:'Confidential administration'};
const row=(id,doctor,amount)=>({attendance_id:id,appointment_id:null,origin:'FATURAMENTO_MANUAL',doctor_id:doctor,patient_id:'p'+id,patient:'Paciente '+id,date:'2026-09-01',procedure:'Joelho',insurance:'UNIMED',forma_cobranca:'CONVENIO',status_atendimento:'realized',record:{id:'b'+id,attendance_id:id,billing_entity_id:'e',billing_method:'CONVENIO',settlement_mode:'INVOICE',payment_status:'PAGO',received_amount:null,paid_at:null},invoice,invoice_item:{received_amount:amount}});
const data={rows:[row('1','d1',1450),row('2','d2',1280)],doctors:[{id:'d1',name:'Um'},{id:'d2',name:'Dois'}],entities:[{id:'e',name:'Empresa'}],links:[],payers:['UNIMED'],invoices:[invoice],items:[{invoice_id:'nf',billing_record_id:'b1',received_amount:1450},{invoice_id:'nf',billing_record_id:'b2',received_amount:1280}],expenses:[{billing_entity_id:'e',amount:300,status:'PAGO',paid_at:'2026-09-10'}],associates:[{name:'Private'}],users:[],patients:[]};
test('shared NF projection removes other doctors, patients, totals and administrative data',()=>{
 const result=doctorBillingProjection(data,principal(services(false,true,true)));
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].doctor_id,'d1');assert.equal(result.items.length,1);
 assert.equal(result.invoices[0].total_amount,null);assert.equal(result.invoices[0].net_amount,null);assert.equal(result.rows[0].invoice.net_amount,null);assert.equal(result.invoices[0].notes,null);
 assert.equal(result.expenses.length,0);assert.equal(result.associates.length,0);assert.equal(result.read_only,true);
 assert.ok(!JSON.stringify(result).includes('Paciente 2'));
});
test('NF exclusively owned by doctor can expose its totals',()=>{const result=doctorBillingProjection({...data,rows:[data.rows[0]],items:[data.items[0]]},principal(services(false,false,true)));assert.equal(result.invoices[0].net_amount,13800)});
test('invoice-only projection excludes unlinked occurrences',()=>{const result=doctorBillingProjection({...data,rows:[...data.rows,{...row('3','d1',null),invoice:null}]},principal(services(false,false,true)));assert.equal(result.rows.length,1)});
function route(path,p){return loadTs(path,{'@/app/authz':{getSession:async()=>p},'@/lib/billing-data':{loadBillingData:async()=>({data:structuredClone(data),state:{}})}})}
test('doctor billing API ignores forged doctor_id and forbids mutations',async()=>{
 const api=route('app/api/billing/route.ts',principal(services(false,true,true)));
 const response=await api.GET(new Request('https://example.test/api/billing?doctor_id=d2'));
 assert.equal(response.status,200);assert.equal((await response.json()).rows[0].doctor_id,'d1');
 const post=await api.POST(new Request('https://example.test/api/billing',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({kind:'invoice',data:{}})}));assert.equal(post.status,403);
});
test('doctor with agenda cannot enumerate administrative billing API',async()=>{assert.equal((await route('app/api/billing/route.ts',principal(services(true,true,true))).GET(new Request('https://example.test/api/billing'))).status,403)});
test('patient financial projection returns only own doctor and explicit financial fields',async()=>{
 const api=route('app/api/patient-finance/route.ts',principal(services(true,true,true)));
 const own=await (await api.GET(new Request('https://example.test/api/patient-finance?patient_id=p1'))).json();assert.equal(own.rows[0].received_amount,1450);assert.equal(own.rows[0].paid_at,'2026-09-15');assert.equal(own.rows[0].invoice_number,'123');assert.equal(own.rows[0].net_amount,undefined);assert.equal(own.rows[0].record,undefined);
 const other=await (await api.GET(new Request('https://example.test/api/patient-finance?patient_id=p2'))).json();assert.equal(other.rows.length,0);
 assert.equal((await route('app/api/patient-finance/route.ts',principal(services(true,false,false))).GET(new Request('https://example.test/api/patient-finance?patient_id=p1'))).status,403);
});
test('logs API denies doctors and secretaries before any database read',async()=>{for(const role of ['doctor','secretary']){const api=loadTs('app/api/billing/logs/route.ts',{'@/app/authz':{getSession:async()=>({account:{id:2,role}})},'@/lib/supabase-admin':{getSupabaseAdmin:()=>{throw new Error('Must not read')}}});assert.equal((await api.GET(new Request('https://example.test/api/billing/logs'))).status,403)}});
test('manual unpaid insurance participates in pending report',()=>{const r={...row('m','d1',null),invoice:null,record:{...data.rows[0].record,payment_status:'PENDENTE'}};const report=buildReport({...data,rows:[r]},{kind:'pending',start:'2026-09-01',end:'2026-09-30',doctor:'',entity:''});assert.equal(report.rows.length,1);assert.equal(report.summary.pending,1)});
test('company cash counts direct receipts and each invoice once, never invoice items',()=>{
 const direct={...row('3','d1',null),invoice:null,record:{...data.rows[0].record,settlement_mode:'DIRECT',received_amount:1450,paid_at:'2026-09-20'}};
 const result=companyCash({...data,rows:[...data.rows,direct],invoices:[invoice,invoice]},'e','2026-09-01','2026-09-30');
 assert.equal(result.revenue,15250);assert.equal(result.paidExpenses,300);assert.equal(result.result,14950);assert.equal(result.invoiceCount,1);
 assert.equal(individualReceived(direct),1450);assert.equal(individualReceived(data.rows[0]),1450);assert.equal(individualReceived({...data.rows[0],invoice_item:{received_amount:null}}),null);
});
test('print presentation repeats headers and excludes operational shell',()=>{const css=readFileSync('app/billing/billing.css','utf8');assert.match(css,/table-header-group/);assert.match(css,/break-inside:\s*avoid/);assert.match(css,/billing-report-document/);const source=readFileSync('app/billing/billing-client.tsx','utf8');assert.ok(!source.includes('window.print('));});
test('legacy agenda and workflow snapshots are not an alternative financial read for doctors',()=>{
 const source={appointments:[{id:'a',doctorId:'d2',payment:9000,invoiceNumber:'PRIVATE'}],patients:[{id:'p',doctorId:'d2'}],patientHistory:[{id:'h',patientId:'p',appointmentId:'a',type:'Financeiro alterado',text:'Valor: 9000'}]};
 const view=visibleState(source,principal(services(true,true,true)));
 assert.equal(view.appointments[0].payment,undefined);assert.equal(view.appointments[0].invoiceNumber,undefined);assert.equal(view.patientHistory.length,0);assert.equal(source.appointments[0].payment,9000);
 assert.equal(withoutLegacyFinance({previous_payload:source.appointments[0]}).previous_payload.payment,undefined);
});

test('cancelled/replaced shared invoice historical membership preserves doctor privacy and item values',()=>{
 const {invoiceRows,matchesInvoice}=loadTs('lib/billing-row.ts');
 for(const status of ['CANCELLED','REPLACED']){
  const historical={...invoice,status};
  const history={...data,invoices:[historical],rows:data.rows.map(r=>({...r,invoice:null,invoice_item:null})),items:data.items.map(i=>({...i,is_active:false}))};
  assert.equal(invoiceRows(historical,history).length,2);
  assert.equal(matchesInvoice(historical,history,{doctor:'d1',entity:'',start:'',end:''}),true);
  const own=doctorBillingProjection(history,principal(services(false,false,true)),true);
  assert.equal(own.rows.length,1);assert.equal(own.invoices.length,1);assert.equal(own.items.length,1);assert.equal(own.invoices[0].net_amount,null);
  assert.deepEqual(Array.from(invoiceRows(historical,own),x=>x.amount),[1450]);
  assert.ok(!JSON.stringify(own).includes('Paciente 2'));
 }
});
