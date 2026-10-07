import {getSession} from '@/app/authz';
import {loadBillingData} from '@/lib/billing-data';
import {doctorCanReadFinancialAttachment} from '@/lib/billing-projection';
import type {FinancialAttachment} from '@/lib/billing-types';
import {invoiceRows} from '@/lib/billing-row';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {consumeLimit} from '@/lib/security/rate-limit';
import {HttpError,readJson,secureMutation} from '@/lib/security/http';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const BUCKET='financial-documents',MAX_SIZE=10*1024*1024;
const MIME=new Set(['application/pdf','image/jpeg','image/png']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Session=NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Attachment={id:string;invoice_id:string|null;billing_record_id:string|null;storage_path:string;created_by:number;status:FinancialAttachment['status'];is_current:boolean;deactivated_at:string|null};
function validId(value:unknown){return typeof value==='string'&&uuid.test(value);}
function cleanName(value:unknown){
 if(typeof value!=='string'||value!==value.trim()||!value||value.length>200||/[\\/\x00-\x1f]/.test(value))throw new HttpError(400,'Nome do comprovante inválido.');
 return value;
}
function expectedMime(name:string){const ext=name.split('.').pop()?.toLowerCase();return ext==='pdf'?'application/pdf':ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='png'?'image/png':null;}
function bytesMatch(bytes:Uint8Array,mime:string){
 if(mime==='application/pdf')return String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
 if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
}
async function permitted(session:Session,invoiceId:string|null,recordId:string|null){
 if(session.account.role==='general_manager')return true;
 if(session.account.role!=='secretary')return false;
 const {data}=await loadBillingData();
 // Keep this in lockstep with authorized_financial_attachment_actor(): the doctor
 // is stored on attendance and the optional anesthetist comes from app_state.
 if(recordId){const row=data.rows.find(r=>r.record?.id===recordId);return !!row&&[row.doctor_id,row.anesthetist_id].some(id=>session.agendaIds.includes(id));}
 const invoice=data.invoices.find(i=>i.id===invoiceId);if(!invoice)return false;
 const rows=invoiceRows(invoice,data).map(({row})=>row);
 return rows.length>0&&rows.every(row=>[row.doctor_id,row.anesthetist_id].some(id=>session.agendaIds.includes(id)));
}
async function canReadFinancialAttachment(session:Session,attachment:Attachment){
 if(session.account.role==='general_manager')return true;
 if(session.account.role==='secretary')return permitted(session,attachment.invoice_id,attachment.billing_record_id);
 if(session.account.role!=='doctor')return false;
 const {data}=await loadBillingData();
 return doctorCanReadFinancialAttachment(data,session,attachment);
}
async function attachmentFor(id:string){
 const {data,error}=await getSupabaseAdmin().from('financial_attachments').select('*').eq('id',id).maybeSingle();
 if(error)throw error;
 return data as Attachment|null;
}
async function rejectPending(session:Session,attachment:Attachment){
 if(attachment.status!=='PENDING'||attachment.created_by!==session.account.id||!(await permitted(session,attachment.invoice_id,attachment.billing_record_id)))throw new HttpError(403,'Envio não disponível.');
 const db=getSupabaseAdmin();
 // Storage removal is deliberately best effort: metadata still becomes REJECTED when
 // the object was never uploaded or the upload URL expired.
 await db.storage.from(BUCKET).remove([attachment.storage_path]);
 const {error}=await db.rpc('reject_financial_attachment',{p_actor:session.account.id,p_id:attachment.id});
 if(error)throw new HttpError(error.code==='P0001'?409:503,error.message||'Não foi possível cancelar o envio.');
}
async function cleanOldPending(session:Session){
 const db=getSupabaseAdmin(),cutoff=new Date(Date.now()-60*60*1000).toISOString();
 const {data,error}=await db.from('financial_attachments').select('id,invoice_id,billing_record_id,storage_path,created_by,status').eq('created_by',session.account.id).eq('status','PENDING').lt('created_at',cutoff);
 if(error)return;
 for(const row of data||[]){try{await rejectPending(session,row as Attachment);}catch{/* Keep rows whose authorization changed for audit. */}}
}
function failure(error:unknown){
 if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status});
 return Response.json({error:'Não foi possível acessar o comprovante.'},{status:500});
}
export async function GET(request:Request){
 try{
  const session=await getSession(),id=new URL(request.url).searchParams.get('id');
  if(!session)throw new HttpError(403,'Acesso negado.');
  if(!id||!validId(id))throw new HttpError(400,'Comprovante inválido.');
  const attachment=await attachmentFor(id);
  const doctorRead=session.account.role==='doctor';
  if(!attachment||attachment.status!=='READY'||(doctorRead&&(!attachment.is_current||!!attachment.deactivated_at))||!(await canReadFinancialAttachment(session,attachment)))throw new HttpError(404,'Comprovante não disponível.');
  const {data,error}=await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(attachment.storage_path,60);
  if(error||!data)throw error||new Error('signed-url');
  return new Response(null,{status:302,headers:{Location:data.signedUrl,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 }catch(error){return failure(error);}
}
async function begin(request:Request){
 const session=await getSession();if(!session||session.account.role==='doctor')throw new HttpError(403,'Acesso negado.');
 await consumeLimit('payment-proof-upload',String(session.account.id),30,3600);
 await cleanOldPending(session);
 const body=await readJson(request),invoiceId=body.invoiceId??null,recordId=body.billingRecordId??null;
 if((invoiceId===null)===(recordId===null)||!(!invoiceId||validId(invoiceId))||!(!recordId||validId(recordId)))throw new HttpError(400,'Selecione um pagamento válido.');
 const name=cleanName(body.name),mime=body.mimeType,size=body.size;
 if(typeof mime!=='string'||!MIME.has(mime)||expectedMime(name)!==mime||!Number.isInteger(size)||size<=0||size>MAX_SIZE)throw new HttpError(400,'Envie PDF, JPG ou PNG de até 10 MB.');
 const replacesId=body.replacesId??null;if(replacesId!==null&&!validId(replacesId))throw new HttpError(400,'Comprovante a substituir inválido.');
 if(!(await permitted(session,invoiceId,recordId)))throw new HttpError(403,'Sem permissão para este pagamento.');
 const db=getSupabaseAdmin(),{data,error}=await db.rpc('begin_financial_attachment',{p_actor:session.account.id,p_invoice:invoiceId,p_record:recordId,p_filename:name,p_mime:mime,p_size:size,p_replaces:replacesId});
 if(error)throw new HttpError(error.code==='P0001'?409:400,error.message||'Não foi possível preparar o envio.');
 const row=Array.isArray(data)?data[0]:data;if(!row?.id||!row.storage_path)throw new Error('attachment');
 const signed=await db.storage.from(BUCKET).createSignedUploadUrl(row.storage_path,{upsert:false});
 if(signed.error||!signed.data){await db.rpc('reject_financial_attachment',{p_actor:session.account.id,p_id:row.id});throw new HttpError(503,'Não foi possível preparar o envio.');}
 return Response.json({id:row.id,url:signed.data.signedUrl},{headers:{'Cache-Control':'private, no-store'}});
}
async function complete(request:Request){
 const session=await getSession();if(!session||session.account.role==='doctor')throw new HttpError(403,'Acesso negado.');
 await consumeLimit('payment-proof-finalize',String(session.account.id),40,3600);
 const {id}=await readJson(request);if(!validId(id))throw new HttpError(400,'Comprovante inválido.');
 const attachment=await attachmentFor(id);
 if(!attachment||attachment.created_by!==session.account.id||attachment.status!=='PENDING'||!(await permitted(session,attachment.invoice_id,attachment.billing_record_id)))throw new HttpError(403,'Envio não disponível.');
 const db=getSupabaseAdmin(),download=await db.storage.from(BUCKET).download(attachment.storage_path);
 if(download.error||!download.data)throw new HttpError(409,'O envio não terminou. Tente novamente.');
 const file=download.data,bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
 const meta=await db.from('financial_attachments').select('mime_type,file_size').eq('id',id).maybeSingle();
 if(meta.error||!meta.data)throw new HttpError(404,'Comprovante não disponível.');
 if(file.size!==Number(meta.data.file_size)||file.size>MAX_SIZE||file.type!==meta.data.mime_type||!bytesMatch(bytes,meta.data.mime_type)){
  await db.storage.from(BUCKET).remove([attachment.storage_path]);await db.rpc('reject_financial_attachment',{p_actor:session.account.id,p_id:id});
  throw new HttpError(400,'Arquivo inválido. Envie PDF, JPG ou PNG original de até 10 MB.');
 }
 const {error}=await db.rpc('complete_financial_attachment',{p_actor:session.account.id,p_id:id});
 if(error)throw new HttpError(error.code==='P0001'?409:503,error.message||'Não foi possível concluir o envio.');
 return Response.json({ok:true});
}
export const POST=secureMutation(begin);
export const PATCH=secureMutation(complete);
export const DELETE=secureMutation(async request=>{
 const session=await getSession();if(!session||session.account.role==='doctor')throw new HttpError(403,'Acesso negado.');
 const id=new URL(request.url).searchParams.get('id');if(!id||!validId(id))throw new HttpError(400,'Comprovante inválido.');
 const attachment=await attachmentFor(id);if(!attachment)throw new HttpError(404,'Comprovante não disponível.');
 await rejectPending(session,attachment);
 return Response.json({ok:true});
});
