import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {readFileSync} from 'node:fs';
const {moduleLinks}=loadTs('lib/navigation.ts');
const session=(role,scheduling=false,billing=false,invoice=false)=>({account:{role,doctorId:role==='doctor'?'d1':null},services:{scheduling_enabled:scheduling,billing_enabled:billing,invoice_enabled:invoice}});
for(const [name,s,expected] of [
 ['manager',session('general_manager'),['/dashboard?agenda=1','/billing','/doctors']],
 ['secretary',session('secretary'),['/dashboard?agenda=1']],
 ['doctor agenda',session('doctor',true),['/dashboard?agenda=1']],
 ['doctor agenda and finance',session('doctor',true,true),['/dashboard?agenda=1']],
 ['doctor agenda and NF',session('doctor',true,false,true),['/dashboard?agenda=1','/billing?view=invoices']],
 ['doctor all services',session('doctor',true,true,true),['/dashboard?agenda=1','/billing?view=invoices']],
 ['doctor finance',session('doctor',false,true),['/billing']],
 ['doctor NF',session('doctor',false,false,true),['/billing?view=invoices']],
 ['doctor no services',session('doctor'),[]],
 ['doctor no identity',{...session('doctor',true,true,true),account:{role:'doctor',doctorId:null}},[]]
])test('global navigation respects permissions: '+name,()=>assert.deepEqual(Array.from(moduleLinks(s),l=>l.href),expected));
test('manager global navigation calls the master-data module Cadastros',()=>{const link=moduleLinks(session('general_manager')).find(link=>link.href==='/doctors');assert.equal(link?.label,'Cadastros')});

test('central doctors API and settings deny non-managers without database access',async()=>{
 for(const role of ['doctor','secretary']){
  const s=session(role,true,true,true);
  const api=loadTs('app/api/doctors/route.ts',{'@/app/authz':{getSession:async()=>s},'@/lib/supabase-admin':{getSupabaseAdmin:()=>{throw new Error('forbidden query')}}});
  assert.equal((await api.GET()).status,403);
  const page=loadTs('app/settings/page.tsx',{'@/app/authz':{getSession:async()=>s},'next/navigation':{redirect:url=>{throw new Error('redirect:'+url)}},'@/components/site-header':()=>null,'@/app/dashboard/legacy-app':{LegacyApp:()=>null}});
  await assert.rejects(()=>page.default(),/redirect:\/dashboard/);
 }
});
test('operational areas survive while redundant medical forms and monthly report disappear',()=>{
 const js=readFileSync('public/legacy-app.js','utf8'),body=readFileSync('app/dashboard/legacy-body.ts','utf8');
 for(const view of ['agenda','patients','requests','audit','cancelled','notifications'])assert.ok((body+js).includes('data-view="'+view+'"'),view);
 for(const id of ['newBlockBtn','newRuleBtn','notificationBell','newPatientBtn'])assert.ok(body.includes('id="'+id+'"'),id);
 assert.doesNotMatch(js+body,/agendaReportBtn|generateMonthlyReport|professionalForm|professionalModal|Agenda RN/);
 assert.doesNotMatch(readFileSync('app/billing/billing-client.tsx','utf8'),/DoctorDirectory/);
});


test('Cadastros keeps only Médicos and Hospitais and redirects the former companies URL',async()=>{
 const source=readFileSync('app/doctors/page.tsx','utf8');
 assert.match(source,/aria-label="Cadastros"/);
 assert.match(source,/\[\['doctors','Médicos'\],\['hospitals','Hospitais'\]\]/);
 assert.doesNotMatch(source,/BillingClient/);
 const page=loadTs('app/doctors/page.tsx',{'@/app/authz':{getSession:async()=>({account:{role:'general_manager'}})},'next/navigation':{redirect:url=>{throw Error('redirect:'+url)}},'@/components/site-header':()=>null,'@/components/billing-icons':{NavIcon:()=>null},'./doctor-directory':()=>null,'./agenda-settings':()=>null,'@/app/dashboard/legacy-app':{LegacyApp:()=>null}});
 await assert.rejects(()=>page.default({searchParams:Promise.resolve({view:'companies'})}),/redirect:\/billing\?view=entities/);
});
