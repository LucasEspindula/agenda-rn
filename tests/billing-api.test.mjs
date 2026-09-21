import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const patient={id:'p',name:'Paciente',insurance:'UNIMED'};
const invoice={id:'nf',invoice_number:'1058',payer:'UNIMED',issue_date:'2026-09-03',paid_at:'2026-09-17',net_amount:13800,total_amount:15000};
const tables={app_state:{payload:{patients:[patient],appointments:[{id:'a',patientId:'p',doctorId:'d',status:'realized',forma_cobranca:'CONVENIO'}]}},billing_entities:[{id:'e'}],billing_doctor_entities:[{doctor_id:'d',billing_entity_id:'e'}],billing_records:[{id:'b',attendance_id:'a',appointment_id:'a',billing_entity_id:'e',billing_method:'CONVENIO',received_amount:null}],invoices:[invoice],invoice_billing_records:[{invoice_id:'nf',billing_record_id:'b',received_amount:1450}],doctors:[{id:'d'}],attendances:[{id:'a',appointment_id:'a',doctor_id:'d',patient_id:'p',status:'realized',billing_method:'CONVENIO',insurance:'UNIMED',date:'2026-09-03',procedure:'Joelho',origin:'AGENDA'}],company_expenses:[],company_associates:[],users:[]};
function api(role){return loadTs('app/api/billing/route.ts',{'@/app/authz':{getSession:async()=>({account:{id:1,role},agendaIds:['d']})},'@/lib/supabase-admin':{getSupabaseAdmin:()=>({from:table=>{const q={select(){return q},eq(){return q},order(){return q},range(){return q},maybeSingle(){return Promise.resolve({data:tables[table]})},then(fn){return Promise.resolve({data:tables[table]}).then(fn)}};return q}})}})}
test('authorized appointment finance projects item value without copying into record or leaking NF totals',async()=>{
 const response=await api('secretary').GET(new Request('https://example.test/api/billing?appointment_id=a'));
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.rows[0].invoice_item.received_amount,1450);assert.equal(data.rows[0].record.received_amount,null);assert.equal(data.rows[0].invoice.invoice_number,'1058');assert.equal(data.rows[0].invoice.paid_at,'2026-09-17');assert.equal(data.rows[0].invoice.net_amount,null);assert.equal(data.items.length,0);
});
test('secretary cannot enumerate financial records; doctor cannot read administrative billing',async()=>{
 assert.equal((await api('secretary').GET(new Request('https://example.test/api/billing'))).status,403);
 assert.equal((await api('doctor').GET(new Request('https://example.test/api/billing?appointment_id=a'))).status,403);
});
