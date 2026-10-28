import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const read=path=>readFileSync(path,'utf8');
const {formatPatientAddress}=loadTs('lib/patient-address.ts');
const {patientRecipient}=loadTs('components/confirm-fiscal-payment.tsx');

test('endereço legado é preservado e os novos campos compõem o endereço fiscal',()=>{
 assert.equal(formatPatientAddress({address:'  Rua antiga, 44  '}),'Rua antiga, 44');
 const patient={id:'p1',name:'Maria',cpf:'12345678901',address:'Rua A',
  addressNumber:'123',addressComplement:'Sala 2',addressNeighborhood:'Centro',
  addressCity:'Porto Alegre',addressState:'rs',addressZip:'90000-000'};
 assert.equal(formatPatientAddress(patient),'Rua A, nº 123, Sala 2 · Centro · Porto Alegre/RS · CEP 90000-000');
 assert.equal(patientRecipient(patient).taker_address,formatPatientAddress(patient));
 assert.equal(patientRecipient({id:'p2',name:'Sem rua',addressCity:'Porto Alegre'}).taker_address,'');
});

test('cadastro de paciente tem endereço opcional e mantém edição de informações',()=>{
 const form=read('app/dashboard/legacy-body.ts');
 const agenda=read('public/legacy-app.js');
 for(const field of ['patientAddress','patientZip','patientNumber','patientComplement',
  'patientNeighborhood','patientCity','patientState']){
  assert.match(form,new RegExp('id="'+field+'"'));
  assert.match(agenda,new RegExp('\\$\\("'+field+'"\\)'));
 }
 assert.match(form,/id="patientDoctor" required/);
 assert.match(form,/id="detailAddress"/);
 assert.match(agenda,/patientFullAddress\(p\)/);
 assert.doesNotMatch(form,/id="patientAddress"[^>]*required/);
});

test('solicitação fiscal exige endereço; S\/N continua sem esta exigência',()=>{
 const confirmation=read('components/confirm-fiscal-payment.tsx');
 const editor=read('components/invoice-request-editor.tsx');
 const api=read('app/api/billing/route.ts');
 assert.match(confirmation,/!noInvoice&&!value\.taker_address\.trim\(\)/);
 assert.match(confirmation,/Endereço completo do tomador/);
 assert.match(confirmation,/<input required maxLength=\{1000\}/);
 assert.match(editor,/!form\.taker_address\.trim\(\)/);
 assert.match(api,/!fiscal\.no_invoice/);
 assert.match(api,/kind==='edit_invoice_request'/);
 assert.match(api,/Informe o endereço completo do tomador/);
});

test('a lista de NF abre o cadastro do paciente, sem expor endereço aos médicos',()=>{
 const list=read('app/billing/invoice-requests.tsx');
 const data=read('lib/billing-data.ts');
 const state=read('lib/security/state.ts');
 assert.match(list,/onClick=\{\(\)=>setSelectedPatient\(r\)\}/);
 assert.match(list,/Informações de /);
 assert.match(list,/Endereço cadastrado/);
 assert.match(data,/address:formatPatientAddress\(p\)/);
 for(const field of ['address','addressZip','addressNumber','addressComplement',
  'addressNeighborhood','addressCity','addressState'])assert.match(state,new RegExp('\\x27'+field+'\\x27'));
 assert.match(state,/delete clinical\[field\]/);
});
