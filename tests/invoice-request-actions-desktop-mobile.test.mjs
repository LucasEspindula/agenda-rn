import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const read=path=>readFileSync(path,'utf8');
const {canStartInvoiceRequest,availableInvoiceRequestRows}=loadTs('lib/invoice-request-actions.ts');
const rec=(changes={})=>({id:'r1',attendance_id:'a1',billing_entity_id:'e1',
 billing_method:'PARTICULAR',settlement_mode:'DIRECT',payment_status:'PAGO',
 received_amount:120,paid_at:'2026-10-21',no_invoice:false,invoice_number:null,...changes});
const row=(changes={})=>({attendance_id:'a1',appointment_id:'a1',patient_id:'p1',patient:'Paciente Teste',
 status_atendimento:'realized',date:'2026-10-21',procedure:'Consulta',
 record:rec(),invoice:null,...changes});
const data=(changes={})=>({rows:[row()],items:[],requests:[],invoices:[],...changes});

test('paid particular attendance without NF/request is eligible; no writes on picker open',()=>{
 const d=data();
 assert.equal(canStartInvoiceRequest(d.rows[0],d),true);
 assert.equal(availableInvoiceRequestRows(d).length,1);
 assert.equal(availableInvoiceRequestRows(d)[0].record.id,'r1');
});
test('pending or issued request prevents duplicate shortcut, cancelled requests permit historical reconsideration',()=>{
 for(const status of ['PENDING','ISSUED']){
  const d=data({requests:[{billing_record_id:'r1',attendance_id:'a1',status}]});
  assert.equal(canStartInvoiceRequest(d.rows[0],d),false);
 }
 const d=data({requests:[{billing_record_id:'r1',attendance_id:'a1',status:'CANCELLED'}]});
 assert.equal(canStartInvoiceRequest(d.rows[0],d),true);
});
test('rejects cancelled attendance, insurance, unpaid, no NF preference and existing invoice linkage',()=>{
 const cases=[
  {status_atendimento:'cancelled'},
  {record:rec({billing_method:'CONVENIO'})},
  {record:rec({settlement_mode:'INVOICE'})},
  {record:rec({payment_status:'PENDENTE'})},
  {record:rec({paid_at:null})},
  {record:rec({billing_entity_id:null})},
  {record:rec({received_amount:null})},
  {record:rec({no_invoice:true})},
  {record:rec({invoice_number:'12'})},
  {invoice:{id:'nf1'}},
  {patient_id:null}
 ];
 for(const change of cases){const d=data({rows:[row(change)]});
  assert.equal(canStartInvoiceRequest(d.rows[0],d),false,JSON.stringify(change));}
 const d=data({items:[{billing_record_id:'r1',invoice_id:'nf-history',is_active:false}]});
 assert.equal(canStartInvoiceRequest(d.rows[0],d),false);
});
test('one selection per billing record and user context survives the picker',()=>{
 const d=data({rows:[
  row({attendance_id:'a1',date:'2026-10-21'}),
  row({attendance_id:'a1',date:'2026-10-21'}),
  row({attendance_id:'a2',date:'2026-10-22',patient:'Segundo',record:rec({id:'r2',attendance_id:'a2'})})
 ]});
 assert.deepEqual(availableInvoiceRequestRows(d).map(r=>r.attendance_id),['a2','a1']);
});
test('remove only redundant Pago em in NF request table and preserve financial dates in other screens',()=>{
 const requests=read('app/billing/invoice-requests.tsx');
 const confirmation=read('components/confirm-fiscal-payment.tsx');
 const types=read('lib/billing-types.ts');
 assert.doesNotMatch(requests,/Pago em|<th>Pagamento<\/th>|paid_at_snapshot/);
 assert.match(requests,/<th>Valor<\/th><th>Situação<\/th>/);
 assert.match(confirmation,/Data do pagamento/);
 assert.match(types,/paid_at_snapshot:string/);
});
test('mobile + and desktop CTA share existing record editing and fiscal request submission',()=>{
 const ui=read('app/billing/billing-client.tsx');
 const css=read('app/billing/billing.css');
 assert.match(ui,/const invoiceRequestCandidates = availableInvoiceRequestRows\(data\)/);
 assert.match(ui,/tab === "invoices" && invoiceRequestCandidates.length > 0/);
 assert.match(ui,/className="billing-invoice-request-desktop no-print"/);
 assert.match(ui,/onClick=\{\(\) => setInvoiceRequestStep\("picker"\)\}/);
 assert.match(ui,/className="billing-mobile-fab billing-invoice-request-fab"/);
 assert.match(ui,/onClick=\{\(\) => setInvoiceRequestStep\("menu"\)\}/);
 assert.match(ui,/onClick=\{\(\) => setInvoiceRequestStep\("picker"\)\}><FilePlus2/);
 assert.match(ui,/function chooseInvoiceRequest\(row: BillingRow\) \{[\s\S]*?setInvoiceRequestStep\(null\);[\s\S]*?editRecord\(row\);/);
 assert.match(ui,/!!draft\.id && r\.record\?\.id === draft\.id/);
 assert.match(ui,/onClick=\{\(\) => chooseInvoiceRequest\(row\)\}/);
 assert.match(ui,/fiscal = await confirmFiscalPayment\(/);
 assert.match(ui,/initialParts: currentRow\?\.record\?\.payment_status === "PAGO" \? parts : undefined/);
 assert.match(ui,/kind: editing/);
 assert.match(confirmationForExistingPayment(),/context.initialParts\?\.map/);
 assert.match(css,/\.rn-hub \.billing-invoice-request-desktop\{[\s\S]*?justify-content:flex-end/);
 assert.match(css,/@media screen and \(max-width:900px\)\{\s*\.rn-hub \.billing-invoice-request-desktop\{display:none!important\}/);
 assert.match(css,/\.rn-hub \.billing-invoice-request-fab\{display:none!important\}/);
 assert.match(css,/billing-mobile-actions-dialog/);
});
function confirmationForExistingPayment(){return read('components/confirm-fiscal-payment.tsx');}
test('NF creation stays on pre-existing billing endpoints and RPC idempotence remains',()=>{
 const api=read('app/api/billing/route.ts');
 const sql=read('supabase/migrations/20261019235000_cash_paid_nonrealized_and_invoice_request_idempotence.sql');
 assert.match(api,/\['entity','link','record'/);
 assert.match(sql,/r\.status='PENDING' and r\.billing_entity_id=b\.billing_entity_id/);
 const ui=read('app/billing/billing-client.tsx');
 assert.doesNotMatch(ui,/kind:\s*["']new_invoice_request["']/);
 assert.match(ui,/no_invoice:!!\(fiscal\?\.no_invoice\|\|draft\.no_invoice\)/);
});

test('solicitações de NF mostram quem solicitou e data/hora a partir do registro original',async()=>{
 const React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {default:InvoiceRequests}=loadTs('app/billing/invoice-requests.tsx',{
  '@/components/mobile-row-actions':{__esModule:true,default:({children})=>React.createElement('div',{},children)}
 });
 const request={id:'request-1',status:'PENDING',billing_record_id:'finance-1',created_by:7,created_at:'2026-10-28T12:53:00Z',
  patient_name_snapshot:'Paciente Teste',taker_kind:'PATIENT',taker_tax_id:'12345678901',doctor_name_snapshot:'Dra. Ana',
  procedure_snapshot:'Consulta',attendance_date_snapshot:'2026-10-27',entity_name_snapshot:'Empresa A',received_amount_snapshot:150};
 const props={data:{rows:[],requests:[request],users:[{id:7,name:'Roseni Nunes'}]},onIssue:()=>{},onReview:()=>{},onEdit:()=>{}};
 const html=renderToStaticMarkup(React.createElement(InvoiceRequests,props));
 assert.match(html,/<th>Solicitado por<\/th><th>Solicitado em<\/th>/);
 assert.match(html,/data-mobile-label="Solicitado por">Roseni Nunes<\/td>/);
 assert.match(html,/data-mobile-label="Solicitado em"[^>]*><time[^>]*>28\/10\/2026 \d{2}:\d{2}<\/time>/);
 assert.match(html,/class="billing-table billing-mobile-card-table billing-invoice-requests-table"/);
 assert.doesNotMatch(html,/Usuário #7|Solicitado por.*undefined/);
 const unknown=renderToStaticMarkup(React.createElement(InvoiceRequests,{...props,data:{...props.data,users:[]}}));
 assert.match(unknown,/data-mobile-label="Solicitado por">Não identificado<\/td>/);
 const css=read('app/billing/billing.css');
 assert.match(css,/\.billing-invoice-requests-table \.billing-requested-at\{white-space:nowrap/);
});
