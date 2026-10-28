import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../public/legacy-app.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('legacy-app.js',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='saveNativeFinance');
assert.ok(fn,'saveNativeFinance must exist');

function fixture({withProof=false}={}){
 const calls=[],progress=[],refreshed=[],proofFile=withProof?{name:'recibo.pdf'}:null;
 const finance={
  id:'appointment',
  row:{attendance_id:'attendance',patient_id:'patient',patient:'Paciente',record:{id:'record',billing_entity_id:'entity',billing_method:'PARTICULAR',payment_status:'PENDENTE',received_amount:null,paid_at:null,no_invoice:false}},
  data:{requests:[]},
  draft:{billing_entity_id:'entity',received_amount:'R$ 1.500,00',payment_status:'PAGO',paid_at:'2026-10-27',no_invoice:false},
  proofFile,proofTargetId:null,proofReplacesId:null
 };
 const context={
  window:{
   AgendaAuth:{role:'secretary'},
   RNMoney:{parseBRL:()=>1500},
   RNFinance:{
    directPayment:()=>true,
    confirmFiscalPayment:async()=>({no_invoice:false,payment_parts:[]}),
    notifyFinancialChange:()=>calls.push('notify'),
    uploadPaymentProof:async()=>calls.push('upload')
   }
  },
  nativeFinance:finance,
  captureNativeFinance:()=>{},
  validateNativeFinance:()=>{},
  nativeMethod:()=> 'PARTICULAR',
  patient:()=>({id:'patient',name:'Paciente'}),
  financialRefreshAt:Date.now(),
  refreshFinancialAlerts:async()=>refreshed.push('summary'),
  paintNativeFinance:()=>calls.push('paint'),
  fetch:async(url)=>{
   calls.push(url);
   if(url==='/api/billing')return {ok:true,json:async()=>({id:'record'})};
   throw new Error('Unexpected blocking fetch: '+url);
  }
 };
 vm.createContext(context);
 vm.runInContext(fn.getText(ast),context);
 return {save:(id,callback)=>context.saveNativeFinance(id,callback),context,finance,calls,progress,refreshed};
}

test('invoice request finishes after the billing response without waiting for agenda reload',async()=>{
 const f=fixture();
 const result=await f.save('appointment',step=>f.progress.push(step));
 assert.equal(result.paymentSaved,true);
 assert.equal(result.stateRefreshed,false);
 assert.equal(result.invoiceRequested,true);
 assert.deepEqual(f.calls,['/api/billing','notify']);
 assert.deepEqual(f.progress,['Salvando financeiro…']);
 assert.equal(f.refreshed.length,1);
});

test('selected PDF is still fully uploaded before the form confirms success',async()=>{
 const f=fixture({withProof:true});
 let resolveUpload;let finished=false;
 f.context.window.RNFinance.uploadPaymentProof=()=>new Promise(resolve=>{resolveUpload=resolve;f.calls.push('upload')});
 const pending=f.save('appointment',step=>f.progress.push(step)).then(value=>{finished=true;return value});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,false);
 assert.deepEqual(f.progress,['Salvando financeiro…','Enviando comprovante…']);
 assert.equal(f.finance.proofFile?.name,'recibo.pdf');
 resolveUpload();
 const result=await pending;
 assert.equal(result.paymentSaved,true);
 assert.equal(f.finance.proofFile,null);
 assert.ok(f.calls.includes('upload'));
});

test('failed PDF upload retains retry target and does not report false success',async()=>{
 const f=fixture({withProof:true});
 f.context.window.RNFinance.uploadPaymentProof=async()=>{throw Error('upload failed')};
 await assert.rejects(f.save('appointment',()=>{}),/comprovante não foi enviado/);
 assert.equal(f.finance.proofTargetId,'record');
 assert.equal(f.finance.proofFile?.name,'recibo.pdf');
});

test('appointment modal schedules background refresh after the finance commit',()=>{
 assert.match(source,/if\(financeResult\?\.paymentSaved&&!financeResult\.stateRefreshed\)/);
 assert.match(source,/if\(financeResult\?\.paymentSaved\)void checkAgendaRevision\(\)/);
});
