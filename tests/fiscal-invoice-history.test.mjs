import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';

const {historicalInvoice,compareInvoiceNumbersDesc}=loadTs('lib/fiscal-document.ts');
const {doctorInvoiceProcedure,doctorInvoiceStatusClass,visibleDoctorInvoices}=loadTs('app/billing/doctor-billing.tsx');
const {INVOICE_STATUSES}=loadTs('lib/billing-row.ts');
const {buildReport,companyCash}=loadTs('lib/billing-reports.ts');
const Report=loadTs('app/billing/billing-report.tsx').default;
const invoice=(id,invoice_number,status='ACTIVE',extra={})=>({id,invoice_number,status,voided_at:null,billing_entity_id:'e1',payer:'Pagador '+invoice_number,issue_date:'2026-10-01',paid_at:'2026-10-02',total_amount:100,net_amount:100,...extra});
const scope={kind:'invoices',doctor:'',entity:'',start:'',end:''};

test('historical invoice list excludes only voided entries and sorts natural numeric descending',()=>{
 const invoices=[invoice('103','103'),invoice('102','102','CANCELLED'),invoice('101','101','REPLACED'),invoice('100','100','ACTIVE',{voided_at:'2026-10-03'})];
 assert.deepEqual(invoices.filter(historicalInvoice).sort(compareInvoiceNumbersDesc).map(i=>i.invoice_number),['103','102','101']);
 assert.deepEqual(['9','100','20','101','099'].map((number,index)=>invoice(String(index),number)).sort(compareInvoiceNumbersDesc).map(i=>i.invoice_number),['101','100','099','20','9']);
 assert.equal(INVOICE_STATUSES.includes('Lançamento desfeito'),false);
});

test('invoice relation keeps fiscal history but excludes voided and valid cash excludes non-active documents',()=>{
 const active=invoice('105','105','ACTIVE',{net_amount:100});
 const cancelled=invoice('104','104','CANCELLED',{net_amount:200});
 const replaced=invoice('103','103','REPLACED',{net_amount:300});
 const voided=invoice('102','102','ACTIVE',{voided_at:'2026-10-05',net_amount:400});
 const data={doctors:[],entities:[{id:'e1',name:'Empresa',tax_id:'1'}],rows:[],links:[],items:[],invoices:[active,cancelled,replaced,voided],expenses:[]};
 const report=buildReport(data,scope);
 assert.deepEqual(report.invoices.map(i=>i.invoice_number),['105','104','103']);
 assert.deepEqual(buildReport(data,{...scope,status:'Cancelada'}).invoices.map(i=>i.invoice_number),['104']);
 assert.equal(companyCash(data,'e1','2026-10-01','2026-10-31').revenue,100);
});

test('invoice relation states remain explicit in the report and replacements resolve when available',()=>{
 const replaced=invoice('120','120','REPLACED',{replaced_by_invoice_id:'121',net_amount:300});
 const replacement=invoice('121','121','ACTIVE',{net_amount:100});
 const cancelled=invoice('119','119','CANCELLED',{net_amount:200});
 const data={doctors:[],entities:[{id:'e1',name:'Empresa',tax_id:'1'}],rows:[],links:[],items:[],invoices:[replaced,replacement,cancelled],expenses:[]};
 const html=renderToStaticMarkup(React.createElement(Report,{data,scope,onClose(){}}));
 assert.match(html,/Substituída por NF 121/);
 assert.match(html,/Cancelada/);
 assert.match(html,/Total líquido válido \(NFs ativas\): R\$ 100,00/);
});


test('doctor invoice relation uses the same historical list and numeric order',()=>{
 const invoices=[invoice('105','105'),invoice('104','104','CANCELLED'),invoice('103','103','REPLACED'),invoice('102','102','ACTIVE',{voided_at:'2026-10-05'})];
 const data={doctors:[],entities:[],rows:[],links:[],items:[],invoices,expenses:[],payers:[]};
 const filters={entity:'',insurance:'',status:'',start:'',end:'',doctor:''};
 assert.deepEqual(visibleDoctorInvoices(data,filters).map(i=>i.invoice_number),['105','104','103']);
 const natural=['9','100','20','101','099'].map((number,index)=>invoice(String(index),number));
 assert.deepEqual(visibleDoctorInvoices({...data,invoices:natural},filters).map(i=>i.invoice_number),['101','100','099','20','9']);
});


test('doctor invoice procedure stays specific only for a single non-shared projected attendance',()=>{
 const one=invoice('one','101','ACTIVE',{recipient_type:'PARTICULAR'});
 const convenio=invoice('convenio','102','ACTIVE',{recipient_type:'CONVENIO'});
 const convenioSingle=invoice('convenio-single','105','ACTIVE',{recipient_type:'CONVENIO'});
 const shared=invoice('shared','103','ACTIVE',{recipient_type:'CONVENIO',shared:true});
 const data={doctors:[],entities:[],links:[],invoices:[one,convenio,convenioSingle,shared],expenses:[],payers:[],rows:[
  {attendance_id:'a1',procedure:'Colonoscopia',record:{id:'r1'},invoice:one},
  {attendance_id:'a2',procedure:'Endoscopia',record:{id:'r2'},invoice:convenio},
  {attendance_id:'a3',procedure:'Consulta',record:{id:'r3'},invoice:convenio},
  {attendance_id:'a4',procedure:'Procedimento autorizado',record:{id:'r4'},invoice:shared},
  {attendance_id:'a5',procedure:'Ecocardiograma',record:{id:'r5'},invoice:convenioSingle},
 ],items:[
  {invoice_id:'one',billing_record_id:'r1'},
  {invoice_id:'convenio',billing_record_id:'r2'},
  {invoice_id:'convenio',billing_record_id:'r3'},
  {invoice_id:'shared',billing_record_id:'r4'},
  {invoice_id:'convenio-single',billing_record_id:'r5'},
 ]};
 assert.equal(doctorInvoiceProcedure(one,data),'Colonoscopia');
 assert.equal(doctorInvoiceProcedure(convenio,data),'Diversos');
 assert.equal(doctorInvoiceProcedure(convenioSingle,data),'Ecocardiograma');
 assert.equal(doctorInvoiceProcedure(shared,data),'Diversos');
 assert.equal(doctorInvoiceProcedure(invoice('empty','104'),{...data,items:[],rows:[]}),'—');
});

test('doctor invoice relationship presents procedure, restricted details and semantic status badges',()=>{
 const source=readFileSync('app/billing/doctor-billing.tsx','utf8');
 const css=readFileSync('app/billing/billing.css','utf8');
 assert.doesNotMatch(source,/<h1>Consulta financeira<\/h1>/);
 assert.doesNotMatch(source,/Somente leitura ·/);
 assert.match(source,/<th>Procedimento<\/th>/);
 assert.match(source,/i\.recipient_type==='CONVENIO'\?<button className="billing-icon-action"/);
 assert.match(source,/<th>Detalhes<\/th>/);
 assert.equal(doctorInvoiceStatusClass('Pago'),'doctor-invoice-status paid');
 assert.equal(doctorInvoiceStatusClass('Aguardando pagamento'),'doctor-invoice-status pending');
 assert.equal(doctorInvoiceStatusClass('Cancelada'),'doctor-invoice-status cancelled');
 assert.equal(doctorInvoiceStatusClass('Substituída'),'doctor-invoice-status replaced');
 assert.match(css,/\.doctor-invoice-status\.paid\{background:#e9f8f1;color:#237354\}/);
 assert.match(css,/\.doctor-invoice-status\.pending\{background:#fff3d9;color:#8c6210\}/);
});
