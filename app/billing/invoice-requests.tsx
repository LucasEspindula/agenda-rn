'use client';
import type {BillingData,InvoiceRequest,BillingRow} from '@/lib/billing-types';
import {formatBRL} from '@/lib/money';
import {formatDateBR} from '@/lib/date-format';
import {formatCPF} from '@/lib/cpf';
const date=formatDateBR;
export default function InvoiceRequests({data,onIssue,onReview}:{data:BillingData;onIssue:(r:InvoiceRequest)=>void;onReview:(r:BillingRow)=>void}){
 const requests=(data.requests||[]).filter(r=>r.status==='PENDING');
 const legacy=data.rows.filter(r=>r.record?.billing_method==='PARTICULAR'&&r.record.payment_status==='PAGO'&&!r.invoice&&!data.requests?.some(q=>q.billing_record_id===r.record?.id&&q.status!=='CANCELLED'));
 return <><div className="billing-panel"><table className="billing-table"><thead><tr><th>Paciente / Tomador</th><th>CPF</th><th>Médico</th><th>Atendimento</th><th>Empresa emissora</th><th>Valor</th><th>Pagamento</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{requests.map(r=><tr key={r.id}><td>{r.patient_name_snapshot}{r.taker_kind==='OTHER'&&<small className="billing-origin">Tomador: {r.taker_name}</small>}</td><td>{formatCPF(r.taker_tax_id)}</td><td>{r.doctor_name_snapshot}</td><td>{r.procedure_snapshot}<small className="billing-origin">{date(r.attendance_date_snapshot)}</small></td><td>{r.entity_name_snapshot}</td><td>{formatBRL(r.received_amount_snapshot)}</td><td>Pago em {date(r.paid_at_snapshot)}</td><td>Pendente de emissão</td><td><button className="billing-primary" onClick={()=>onIssue(r)}>Registrar NF</button></td></tr>)}</tbody></table>{!requests.length&&<p className="billing-empty">Nenhuma solicitação aguardando emissão.</p>}</div>
 {!!legacy.length&&<details className="billing-legacy-review"><summary>Registros anteriores para revisão ({legacy.length})</summary><p>Dados históricos preservados. Registros com número de NF legado precisam de conferência documental; nenhuma nota foi criada automaticamente.</p>{legacy.map(r=><p key={r.attendance_id}>{r.patient} · {formatBRL(r.record?.received_amount)} · {r.record?.invoice_number?'NF legada '+r.record.invoice_number:'Sem solicitação fiscal confirmada'} {!r.record?.invoice_number&&<button className="billing-secondary" onClick={()=>onReview(r)}>Confirmar dados fiscais</button>}</p>)}</details>}
 </>;
}
