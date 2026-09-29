import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
const {isInsurancePending}=loadTs('lib/billing-row.ts');
const {filterPendingRows,groupPendingRows,pendingSummary,pendingAge,pendingAction}=loadTs('lib/insurance-pending.ts');
const base={attendance_id:'a',patient:'João Teste',procedure:'Avaliação',date:'2026-06-01',doctor_id:'d',anesthetist_id:'an',insurance:'CABERGS',forma_cobranca:'CONVENIO',status_atendimento:'realized',billing_entity_id:'e',record:null,invoice:null};
const invoice={id:'nf',status:'ACTIVE',paid_at:null};
const record={settlement_mode:'INVOICE',payment_status:'PAGO',paid_at:'2026-09-29',received_amount:100};
test('queue resolves only active paid NF or complete paid direct settlement',()=>{
 assert.equal(isInsurancePending(base),true);
 for(const row of [{...base,status_atendimento:'scheduled'},{...base,status_atendimento:'cancelled'},{...base,forma_cobranca:'PARTICULAR'}])assert.equal(isInsurancePending(row),false);
 assert.equal(isInsurancePending({...base,record}),true,'invoice-managed stale PAGO is not a resolution');
 assert.equal(isInsurancePending({...base,invoice}),true);
 assert.equal(isInsurancePending({...base,invoice:{...invoice,paid_at:'2026-09-29'}}),false);
 const direct={...record,settlement_mode:'DIRECT'};
 assert.equal(isInsurancePending({...base,record:direct}),false);
 for(const patch of [{paid_at:null},{received_amount:null},{payment_status:'PENDENTE'}])assert.equal(isInsurancePending({...base,record:{...direct,...patch}}),true);
 assert.equal(isInsurancePending({...base,record:{...direct,received_amount:0}}),false,'zero is valid, not missing');
});
test('cancel, undo and replacement restore queue unless operational replacement paid',()=>{
 for(const history of [{...invoice,status:'CANCELLED'},{...invoice,status:'REPLACED'},{...invoice,voided_at:'2026-09-29'}])assert.equal(isInsurancePending({...base,record,invoice:{...history,paid_at:'2026-09-29'}}),true);
 assert.equal(isInsurancePending({...base,record,invoice:{...invoice,id:'replacement',paid_at:null}}),true);
 assert.equal(isInsurancePending({...base,record,invoice:{...invoice,id:'replacement',paid_at:'2026-09-29'}}),false);
});
const data={rows:[base,{...base,attendance_id:'b',patient:'Maria',procedure:'Cirurgia',date:'2026-07-30',billing_entity_id:'f',insurance:'UNIMED'},{...base,attendance_id:'c',date:'2026-09-20',insurance:' cabergs '},{...base,attendance_id:'paid',invoice:{...invoice,paid_at:'2026-09-29'}}],entities:[{id:'e',name:'Empresa E'},{id:'f',name:'Empresa F'},{id:'empty',name:'Sem fila'}],doctors:[{id:'d',invoice_enabled:true}],links:[]};
const all={entity:'',doctor:'',insurance:'',start:'',end:''};
test('filters intersect, search accents ignored, generic status cannot hide pending; global source unchanged',()=>{
 const filters=[{entity:'f'},{insurance:'unimed'},{doctor:'an',search:'cirurgia'},{search:'joao',start:'2026-06-01',end:'2026-06-01'},{search:'AVALIACAO',start:'2026-09-01'}];
 for(const filter of filters)assert.equal(filterPendingRows(data,{...all,...filter}).length,1);
 assert.equal(filterPendingRows(data,{...all,entity:'empty'}).length,0);
 assert.equal(filterPendingRows(data,{...all,status:'Pago'}).length,3);
 assert.equal(data.rows.filter(isInsurancePending).length,3);
 assert.equal(filterPendingRows(data,all).map(r=>r.attendance_id).join(','),'a,b,c');
});
test('company then normalized payer, oldest first, no empty groups',()=>{
 const groups=groupPendingRows(data,filterPendingRows(data,all),'2026-09-29');
 assert.equal(groups.map(g=>g.id).join(','),'e,f');assert.equal(groups[0].payers.length,1);
 assert.equal(groups[0].payers[0].name,'CABERGS');assert.equal(groups[0].payers[0].rows.map(r=>r.attendance_id).join(','),'a,c');
 assert.equal(groupPendingRows(data,filterPendingRows(data,{...all,entity:'f'}))[0].id,'f');
});
test('aging boundaries and cards use calendar days and filtered rows',()=>{
 const today='2026-09-29';const rows=[0,30,31,60,61,90,91].map((days,i)=>({...base,attendance_id:String(i),date:new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10)}));
 const result=pendingSummary(rows,today);assert.equal(result.total,7);assert.equal(result.oldest,91);assert.equal(result.over60,3);assert.equal(result.companies,1);assert.equal(result.buckets.join(','),'2,2,2,1');
 assert.equal(pendingAge('2026-09-28',today),1);assert.equal(pendingAge('2026-09-30',today),0);assert.equal(pendingSummary([],today).oldest,0);
});
test('three contextual actions honor active document and direct-payment helper',()=>{
 assert.equal(pendingAction(base,data).kind,'create');
 assert.equal(pendingAction({...base,invoice},data).kind,'invoice');
 assert.equal(pendingAction({...base,record:{settlement_mode:'DIRECT'}},data).kind,'payment');
 assert.equal(pendingAction({...base,invoice:{...invoice,status:'CANCELLED'}},data).kind,'create');
 assert.equal(pendingAction(base,{...data,doctors:[{id:'d',invoice_enabled:false}]}).kind,'payment');
});
