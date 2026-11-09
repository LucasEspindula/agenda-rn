import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

// A1: faturamento desligado até a reconstrução — menus ocultos e servidor recusa.
const session=(role,scheduling=false,billing=false,invoice=false)=>({account:{role,doctorId:role==='doctor'?'d1':null},services:{scheduling_enabled:scheduling,billing_enabled:billing,invoice_enabled:invoice}});

test('billing menus are hidden for every profile while paused',()=>{
 const {moduleLinks}=loadTs('lib/navigation.ts');
 assert.deepEqual(Array.from(moduleLinks(session('general_manager')),l=>l.href),['/dashboard?agenda=1']);
 assert.deepEqual(Array.from(moduleLinks(session('doctor',true,true,true)),l=>l.href),['/dashboard?agenda=1']);
 const {doctorHome,canOpenBilling,canOpenInvoices}=loadTs('lib/doctor-services.ts');
 assert.equal(doctorHome(session('doctor',false,true,true)),'/no-services');
 assert.equal(canOpenBilling(session('general_manager')),false);
 assert.equal(canOpenInvoices(session('general_manager')),false);
});

test('server refuses billing routes and pages with a clear message',async()=>{
 const {proxy}=loadTs('proxy.ts');
 for(const path of ['/api/billing','/api/billing/closing','/api/reports/billing','/api/financial-attachments','/api/patient-finance']){
  const response=proxy({nextUrl:new URL('https://rn.example'+path),headers:new Headers()});
  assert.equal(response.status,503,path);
  assert.deepEqual(await response.json(),{error:'Faturamento em reconstrução.'});
 }
 const page=proxy({nextUrl:new URL('https://rn.example/billing/glosas'),headers:new Headers()});
 assert.equal(page.status,503);
 assert.match(await page.text(),/Faturamento em reconstrução/);
 const {isBillingPath}=loadTs('lib/billing-paused.ts');
 for(const path of ['/api/state','/api/reports/agenda','/dashboard','/api/documents','/billingx'])assert.equal(isBillingPath(path),false,path);
});

test('database billing RPCs coupled to the old agenda document are stubbed in the A1 migration',()=>{
 const sql=readFileSync('supabase/migrations/20261103151428_agenda_normalized_a1.sql','utf8');
 for(const fn of ['attribute_financial_attendance','finish_private_payment','preview_billing_month','save_billing_fiscal_core','save_billing_legacy_single_charge','save_manual_attendance','save_professional_charge','save_professional_charge_core','update_pending_invoice_request'])
  assert.match(sql,new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[^;]*?perform public\\.billing_paused\\(\\)`),fn);
});

test('agenda keeps saving appointments while billing is paused (finance block is skipped)',()=>{
 const js=readFileSync('public/legacy-app.js','utf8'),host=readFileSync('app/dashboard/legacy-app.tsx','utf8');
 assert.match(host,/AgendaBillingPaused = BILLING_PAUSED/);
 assert.match(js,/async function loadNativeFinance\(id,draft=null\)\{\s*if\(window\.AgendaBillingPaused\)\{nativeFinance=null;/);
 assert.match(js,/function validateNativeFinance\(\)\{\s*if\(window\.AgendaBillingPaused\|\|/);
 assert.match(js,/async function saveNativeFinance\(id,onProgress=\(\)=>\{\}\)\{\s*if\(window\.AgendaBillingPaused\|\|/);
});

test('patient form has a single required doctor select and an aligned RN checkbox',()=>{
 const body=readFileSync('app/dashboard/legacy-body.ts','utf8'),js=readFileSync('public/legacy-app.js','utf8'),css=readFileSync('public/legacy.css','utf8');
 // O legacy-app.js insere o seletor de médico antes do nome; o markup não pode repetir o id.
 assert.equal((body.match(/id="patientDoctor"/g)||[]).length+(js.match(/<select id="patientDoctor"/g)||[]).length,1);
 assert.match(body,/id="patientNewborn" type="checkbox"/);
 assert.match(css,/\.check-row\{display:flex;/);
});
