import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './load-ts.mjs';
import {readFileSync} from 'node:fs';


const context={rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:'general_manager',name:'Roseni'}]};
const inserted=(id,record_type,after_data)=>({id,record_type,record_id:record_type+'-'+id,action:'INSERT',before_data:null,after_data,differences:Object.entries(after_data).map(([field,after])=>({field,before:null,after}))});
async function render(changes,relatedLogs=[]){
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 let index=0;
 const logs=[{id:'one',kind:'record',actor_id:1,actor_name:'Roseni',created_at:'2026-10-28T12:53:00Z',changes},...relatedLogs];
 const Component=loadTs('app/billing/billing-logs.tsx',{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?logs:initial,()=>{}]}}).default;
 return renderToStaticMarkup(React.createElement(Component,{data:context}));
}
test('solicitação de NF mostra resumo de uma operação e preserva os dados da auditoria',async()=>{
 const html=await render([
  inserted(1,'attendances',{date:'2026-10-27',patient_name:'Lucas Espindula',procedure:'Consulta',billing_method:'PARTICULAR'}),
  inserted(2,'billing_records',{payment_status:'PAGO',received_amount:1500,billing_method:'PARTICULAR',paid_at:'2026-10-27',no_invoice:false,payment_composition_verified:true}),
  inserted(3,'invoice_requests',{status:'PENDING',patient_name_snapshot:'Lucas Espindula',doctor_name_snapshot:'Dr. Heitor',procedure_snapshot:'Consulta',attendance_date_snapshot:'2026-10-27',received_amount_snapshot:1500,paid_at_snapshot:'2026-10-27',taker_name:'Lucas Espindula',taker_tax_id:'00000000000'}),
  inserted(4,'payment_parts',{method:'PIX',amount:500}),
  inserted(5,'payment_parts',{method:'CASH',amount:1000})
 ]);
 assert.match(html,/Solicitação de NF/);
 assert.match(html,/class="billing-log-summary"/);
 assert.match(html,/Atendimento<\/strong>.*27\/10\/2026.*Consulta/);
 assert.match(html,/Pagamento<\/strong>.*1\.500,00.*Particular.*pago em 27\/10\/2026/);
 assert.match(html,/Composição<\/strong>.*PIX.*500,00.*Dinheiro.*1\.000,00/);
 const visible=html.split('<details class="billing-log-details">')[0];
 assert.doesNotMatch(visible,/No invoice|Payment composition verified|CPF\/CNPJ do tomador|Atendimento: Lucas Espindula/);
 assert.match(html,/<summary>Ver auditoria completa<\/summary>/);
 assert.match(html,/Dispensa de emissão de NF/);
 assert.match(html,/Composição do pagamento conferida/);
 assert.match(html,/CPF\/CNPJ do tomador/);
 assert.match(html,/Responsável:.*Roseni/);
});
test('comprovante tem apenas arquivo e formato no resumo, com detalhes expansíveis',async()=>{
 const html=await render([inserted(1,'financial_attachments',{status:'READY',original_filename:'comprovante.pdf',file_size:162816,mime_type:'application/pdf',document_type:'PAYMENT_PROOF',is_current:true})]);
 assert.match(html,/Comprovante de pagamento anexado/);
 const visible=html.split('<details class="billing-log-details">')[0];
 assert.match(visible,/Arquivo<\/strong>.*comprovante\.pdf/);
 assert.match(visible,/Formato<\/strong>.*PDF · 159 KB/);
 assert.doesNotMatch(visible,/Comprovante operacional|Status: Comprovante disponível/);
 assert.match(html,/Comprovante operacional/);
 assert.match(html,/<summary>Ver auditoria completa<\/summary>/);
});
test('eventos não fiscais continuam com histórico detalhado imediatamente visível',async()=>{
 const html=await render([inserted(1,'billing_records',{notes:'Observação registrada'})]);
 assert.doesNotMatch(html,/billing-log-summary|Ver auditoria completa/);
 assert.match(html,/Observação: Observação registrada/);
 assert.match(html,/Adicionou/);
});

test('comprovante vinculado aparece no cartão SOLICITAÇÃO, com autoria própria preservada',async()=>{
 const request=[inserted(1,'invoice_requests',{status:'PENDING',billing_record_id:'record-1',patient_name_snapshot:'Paciente'})];
 const proof={id:'proof',kind:'payment_proof',actor_id:2,actor_name:'Secretária Ana',created_at:'2026-10-28T13:00:00Z',changes:[inserted(2,'financial_attachments',{status:'READY',billing_record_id:'record-1',original_filename:'recibo.pdf',file_size:2048,mime_type:'application/pdf'})]};
 const html=await render(request,[proof]);
 assert.equal((html.match(/class="billing-log-event workflow-card"/g)||[]).length,1);
 assert.match(html,/SOLICITAÇÃO/);
 assert.doesNotMatch(html,/>COMPROVANTE</);
 assert.match(html,/recibo\.pdf/);
 assert.match(html,/Secretária Ana/);
 assert.match(html,/billing-log-linked-proof/);
 assert.match(html,/Ver auditoria completa/);
});
test('comprovante independente continua com seu próprio evento',async()=>{
 const request=[inserted(1,'invoice_requests',{status:'PENDING',billing_record_id:'record-1'})];
 const proof={id:'proof',kind:'payment_proof',actor_id:2,actor_name:'Secretária Ana',created_at:'2026-10-28T13:00:00Z',changes:[inserted(2,'financial_attachments',{status:'READY',billing_record_id:'another-record',original_filename:'outro.pdf'})]};
 const html=await render(request,[proof]);
 assert.equal((html.match(/class="billing-log-event workflow-card"/g)||[]).length,2);
 assert.match(html,/>COMPROVANTE</);
});
test('eventos financeiros extensos exibem resumo deduplicado sem objetos ou códigos internos',async()=>{
 const html=await render([inserted(1,'invoices',{status:'ACTIVE',invoice_number:'123',billing_entity_id:'entity-id',total_amount:1500,net_amount:1450,patient_id:'patient-id',notes:'NF de consulta',settings:{internal:'object'},origin:'AGENDA'})]);
 const compact=html.split('<details class="billing-log-details">')[0];
 assert.match(compact,/billing-log-summary/);
 assert.match(compact,/Número da NF/);
 assert.doesNotMatch(compact,/\[object Object\]|Dados atualizados|settings|entity-id|patient-id|AGENDA/);
 assert.match(html,/<summary>Ver auditoria completa<\/summary>/);
});

test('cartões compactos de faturamento mantêm colunas, espaçamento e fonte discreta',()=>{
 const css=readFileSync('app/billing/billing.css','utf8');
 assert.match(css,/\.billing-log-event \.billing-log-summary-row\s*\{\s*display:grid;\s*grid-template-columns:minmax\(115px,148px\) minmax\(0,1fr\);/);
 assert.match(css,/\.billing-log-event \.billing-log-summary-row>strong\s*\{[^}]*font-size:11\.5px;/s);
 assert.match(css,/\.billing-log-event \.billing-log-summary-row>span,[\s\S]*?font-size:12px;/);
 assert.match(css,/\.billing-log-event \.billing-log-details>summary\s*\{[^}]*font-size:11px;/s);
 assert.match(css,/@media\(max-width:560px\)\s*\{\s*\.billing-log-event \.billing-log-summary-row/);
});
