import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const {historicalInvoice,compareInvoiceNumbersDesc}=loadTs('lib/fiscal-document.ts');
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
