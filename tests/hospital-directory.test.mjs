import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const {duplicateHospital,hospitalIsInUse,withHospitals}=loadTs('lib/hospital-directory.ts');

const hospitals=[{id:'h1',name:'Hospital São José'},{id:'h2',name:'Mirar'}];
const state={hospitals,appointments:[],cancelledAppointments:[],schedulingRules:[],patients:[{id:'p1'}]};

test('hospital directory preserves complete app_state while changing hospitals',()=>{
 const next=withHospitals(state,[...hospitals,{id:'h3',name:'Novo'}]);
 assert.deepEqual(next.hospitals.map(hospital=>hospital.id),['h1','h2','h3']);
 assert.deepEqual(next.patients,[{id:'p1'}]);
 assert.equal(duplicateHospital(hospitals,'hospital sao jose'),true);
 assert.equal(duplicateHospital(hospitals,'HOSPITAL SÃO JOSÉ','h1'),false);
 assert.equal(duplicateHospital(hospitals,'Mirar','h1'),true);
});

test('hospital removal is blocked for every legacy usage source',()=>{
 for(const key of ['appointments','cancelledAppointments','schedulingRules']){
  const candidate={...state,[key]:[{hospitalId:'h1'}]};
  assert.equal(hospitalIsInUse(candidate,'h1'),true,key);
 }
 assert.equal(hospitalIsInUse(state,'h1'),false);
});

test('native HospitalDirectory uses state snapshots and optimistic concurrency',()=>{
 const source=readFileSync('app/doctors/hospital-directory.tsx','utf8');
 assert.match(source,/fetch\('\/api\/state',\{cache:'no-store'\}\)/);
 assert.match(source,/'If-Match':revision\|\|'new'/);
 assert.match(source,/withHospitals\(state,hospitals\)/);
 assert.match(source,/crypto\.randomUUID\(\)/);
 assert.match(source,/if\(response\.status===409\)await load\(\)/);
 assert.match(source,/Hospital já cadastrado\./);
 assert.match(source,/Hospital em uso\. Este hospital está vinculado a agendamentos ou regras e não pode ser removido\./);
 assert.doesNotMatch(source,/LegacyApp/);
});

test('Cadastros renders native hospitals while agenda rules keep LegacyApp',()=>{
 const source=readFileSync('app/doctors/page.tsx','utf8');
 assert.match(source,/import HospitalDirectory from '.\/hospital-directory'/);
 assert.match(source,/const legacy=view==='agenda'&&!!doctor_id/);
 assert.match(source,/view==='hospitals'\?<HospitalDirectory\/>/);
 assert.match(source,/view==='agenda'&&doctor_id\?<><AgendaSettings[^]*?<LegacyApp initialView="settings" adminSection="rules"/);
 assert.doesNotMatch(source,/view==='hospitals'\?<LegacyApp/);
});


test('hospital deletion keeps the compact table icon and uses a textual danger action in the modal',()=>{
 const source=readFileSync('app/doctors/hospital-directory.tsx','utf8');
 assert.match(source,/className="billing-icon-action billing-delete"[^>]*title="Remover hospital"/);
 assert.match(source,/<button className="billing-danger" disabled=\{busy\} onClick=\{\(\)=>void remove\(\)\}\>\{busy\?'Removendo…':'Remover'\}<\/button>/);
 assert.doesNotMatch(source,/<button className="billing-delete" disabled=\{busy\} onClick=\{\(\)=>void remove\(\)\}/);
});


test('hospital abbreviations are normalized while preserving legacy fallbacks',()=>{
 const {automaticHospitalAbbreviation,hospitalAbbreviation,normalizeHospitalAbbreviation}=loadTs('lib/hospital-directory.ts');
 assert.equal(normalizeHospitalAbbreviation('Mirar'),'MIRAR');
 assert.equal(normalizeHospitalAbbreviation('hmv'),'HMV');
 assert.equal(normalizeHospitalAbbreviation('Mãe Deus'),'MÃE DEUS');
 assert.equal(hospitalAbbreviation({id:'h1',name:'Hospital Moinhos de Vento',abbreviation:'Moinhos'}),'MOINHOS');
 assert.equal(hospitalAbbreviation({id:'h2',name:'Hospital Moinhos de Vento'}),'HMV');
 assert.equal(hospitalAbbreviation({id:'h3',name:'Hospital Blanc'}),'BLANC');
 assert.equal(automaticHospitalAbbreviation('Mirar Hospital de olhos'),'MHO');
});

test('native hospital UI orders abbreviations first and persists normalized values',()=>{
 const source=readFileSync('app/doctors/hospital-directory.tsx','utf8');
 assert.match(source,/className="billing-table billing-admin-table doctor-table hospital-table"/);
 assert.match(source,/<th>Abreviação<\/th><th>Hospital<\/th><th>Ações<\/th>/);
 assert.doesNotMatch(source,/<th>Hospital<\/th><th>Abreviação<\/th>/);
 assert.doesNotMatch(source,/Disponibilidade|Todas as agendas/);
 assert.match(source,/const name=draftName\.trim\(\),abbreviation=normalizeHospitalAbbreviation\(draftAbbreviation\);/);
 assert.match(source,/setDraftAbbreviation\(normalizeHospitalAbbreviation\(event\.target\.value\)\)/);
 assert.match(source,/hospitalAbbreviation\(hospital\)/);
});

test('Agenda uppercases saved hospital abbreviations in cards, workflow and snapshots',()=>{
 const source=readFileSync('public/legacy-app.js','utf8');
 assert.match(source,/if\(abbreviation\)return abbreviation\.toLocaleUpperCase\("pt-BR"\);/);
 assert.match(source,/hospitalAcronym\(h\|\|"Hospital"\)/);
 assert.match(source,/place=hospitalAcronym\(h\)/);
 assert.match(source,/h\?\.name\?hospitalAcronym\(h\)/);
});

test('hospital sticky action column is scoped to the directory table',()=>{
 const styles=readFileSync('app/billing/billing.css','utf8');
 assert.match(styles,/\.hospital-table th:last-child,\.hospital-table td:last-child\{position:sticky;right:0/);
 assert.match(styles,/\.hospital-table th:last-child\{z-index:4;background:#f8fafc\}/);
 assert.match(styles,/\.hospital-table tbody tr:hover>td:last-child\{background:#f5fbfb\}/);
 assert.doesNotMatch(styles,/\.billing-table th:last-child,\.billing-table td:last-child\{position:sticky/);
});

test('state validation accepts bounded abbreviation fields without changing hospital IDs',()=>{
 const source=readFileSync('lib/security/state.ts','utf8');
 assert.match(source,/'abbreviation'/);
 assert.match(source,/key==='hospitals'&&row\.abbreviation!=null&&String\(row\.abbreviation\)\.length>16/);
});
