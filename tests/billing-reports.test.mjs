import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {readFileSync} from 'node:fs';
const {buildReport,individualReceived}=loadTs('lib/billing-reports.ts');
const row=(id,doctor,entity,amount)=>({appointment_id:id,patient:'Paciente '+id,doctor_id:doctor,anesthetist_id:'',date:'2026-09-03',procedure:'Procedimento',insurance:'UNIMED',status_atendimento:'realized',forma_cobranca:'CONVENIO',record:{billing_entity_id:entity,payment_status:'PAGO',received_amount:9999},invoice:{id:'nf',invoice_number:'1058',paid_at:'2026-09-10',net_amount:13800},invoice_item:{received_amount:amount}});
const data={doctors:[{id:'d1',name:'Médico 1'},{id:'d2',name:'Médico 2'}],entities:[{id:'e1',name:'Empresa 1',tax_id:'123'},{id:'e2',name:'Empresa 2',tax_id:'456'}],rows:[row('a','d1','e1',1450),row('b','d2','e1',null),row('c','d2','e1',1280),row('d','d1','e2',1620)],links:[],invoices:[],items:[]};
const scope={kind:'doctor',doctor:'d1',entity:'',start:'2026-09-01',end:'2026-09-30'};
test('doctor report separates multiple historical receiving entities',()=>{const r=buildReport(data,scope);assert.equal(r.groups.length,2);assert.equal(r.summary.received,3070);assert.equal(r.summary.total,2)});
test('company report includes multiple doctors without doctor filter and counts each attendance once',()=>{const r=buildReport(data,{...scope,kind:'entity',entity:'e1',doctor:''});assert.equal(r.groups.length,2);assert.equal(r.summary.received,2730);assert.equal(r.summary.total,3);assert.equal(r.summary.unidentified,1)});
test('individual amount comes only from invoice item for insurance; NULL is never allocated',()=>{assert.equal(individualReceived(data.rows[0]),1450);assert.equal(individualReceived(data.rows[1]),null);assert.equal(buildReport(data,{...scope,kind:'entity',entity:'e1',doctor:''}).summary.received,2730);assert.equal(individualReceived({...data.rows[0],invoice:null,forma_cobranca:'PARTICULAR'}),9999)});
test('required report identity and interval are validated',()=>{for(const invalid of [{start:''},{end:''},{start:'2026-10-01'},{doctor:''},{kind:'entity',entity:''}])assert.throws(()=>buildReport(data,{...scope,...invalid}))});
test('realized production only; cancelled/scheduled do not enter reports',()=>{const r=buildReport({...data,rows:[...data.rows,{...data.rows[0],status_atendimento:'scheduled'},{...data.rows[0],date:'2026-08-01'}]},scope);assert.equal(r.summary.total,2)});
test('report generation uses the authenticated PDF route and preserves historical entity grouping',()=>{
 const source=readFileSync('app/api/reports/billing/route.ts','utf8');
 const report=buildReport(data,scope);
 assert.equal(report.groups.map(group=>group.id).join(','),'e1,e2');
 assert.match(source,/new PdfReport\(\)\.init\(\)/);
 assert.match(source,/report\.groups/);
 assert.match(source,/canOpenBilling|canOpenInvoices/);
 assert.match(source,/pdfResponse\(/);
 assert.doesNotMatch(source,/>Financeiro<|>Editar<|>Salvar</);
});

test("company report respects an explicitly selected doctor",()=>{const r=buildReport(data,{...scope,kind:"entity",entity:"e1"});assert.equal(r.summary.total,1);assert.equal(r.summary.received,1450)});

