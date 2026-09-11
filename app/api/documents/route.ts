import { createHash, randomUUID } from 'node:crypto';
import { getSession } from '@/app/authz';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { compressPdf } from '@/lib/compress-pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;
const BUCKET = 'surgery-documents';
const MAX_SIZE = 20 * 1024 * 1024;
type Surgery = { id: string; patientId?: string; doctorId?: string; anesthetistId?: string; date?: string; procedure?: string };
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
function permitted(session: Session, a: Surgery) {
 return session.account.role === 'general_manager' || [a.doctorId,a.anesthetistId].some(id => !!id && session.agendaIds.includes(id));
}
async function context() {
 const session = await getSession();
 if (!session) throw new Error('unauthorized');
 const db = getSupabaseAdmin();
 const { data, error } = await db.from('app_state').select('payload').eq('id',1).maybeSingle();
 if (error || !data) throw new Error('state');
 const surgeries: Surgery[] = [...(data.payload.appointments || []), ...(data.payload.cancelledAppointments || [])];
 return { session, db, surgeries };
}
function failure(error: unknown) {
 const unauthorized = error instanceof Error && error.message === 'unauthorized';
 return Response.json({ error: unauthorized ? 'Entre na sua conta.' : 'Não foi possível acessar os documentos. Tente novamente.' }, { status: unauthorized ? 401 : 500 });
}
function sameOrigin(request: Request) {
 const origin = request.headers.get('origin');
 return !origin || origin === new URL(request.url).origin;
}
export async function GET(request: Request) {
 try {
  const { session, db, surgeries } = await context();
  const url = new URL(request.url), id = url.searchParams.get('id');
  if (id) {
   const { data: doc, error } = await db.from('surgery_documents').select('*').eq('id',id).eq('status','ready').maybeSingle();
   if (error) throw error;
   const surgery = doc && surgeries.find(a => a.id === doc.appointment_id);
   if (!surgery || !permitted(session,surgery)) return Response.json({ error:'Documento não disponível.' },{ status:404 });
   const { data, error: signedError } = await db.storage.from(BUCKET).createSignedUrl(doc.object_path,60,url.searchParams.has('download') ? { download:doc.name } : undefined);
   if (signedError) throw signedError;
   return new Response(null,{ status:302,headers:{ Location:data.signedUrl,'Cache-Control':'no-store','Referrer-Policy':'no-referrer' } });
  }
  const appointmentId = url.searchParams.get('appointmentId'), patientId = url.searchParams.get('patientId');
  if (!appointmentId && !patientId) return Response.json({ error:'Selecione uma cirurgia.' },{ status:400 });
  const allowed = surgeries.filter(a => permitted(session,a) && (appointmentId ? a.id === appointmentId : a.patientId === patientId));
  if (appointmentId && !allowed.length) return Response.json({ error:'Agenda sem permissão.' },{ status:403 });
  if (!allowed.length) return Response.json({ documents:[] });
  const { data, error } = await db.from('surgery_documents').select('id,appointment_id,name,category,size,created_at').in('appointment_id',allowed.map(a=>a.id)).eq('status','ready').order('created_at',{ascending:false});
  if (error) throw error;
  return Response.json({ documents:(data || []).map((d: { appointment_id:string }) => ({ ...d, surgery:allowed.find(a=>a.id===d.appointment_id) })) },{ headers:{'Cache-Control':'no-store'} });
 } catch(error) { return failure(error); }
}
export async function POST(request: Request) {
 if (!sameOrigin(request)) return Response.json({error:'Origem inválida.'},{status:403});
 try {
  const { session, db, surgeries } = await context();
  const body = await request.json();
  const surgery = surgeries.find(a => a.id === body.appointmentId);
  if (!surgery || !permitted(session,surgery)) return Response.json({error:'Agenda sem permissão.'},{status:403});
  if (typeof body.name !== 'string' || !body.name.toLowerCase().endsWith('.pdf') || !Number.isInteger(body.size) || body.size <= 0 || body.size > MAX_SIZE || !['guide','report','summary','other'].includes(body.category)) return Response.json({error:'Selecione um PDF de até 20 MB e uma categoria.'},{status:400});
  const id = randomUUID(), path = `${surgery.id}/${id}.pdf`, name = body.name.replace(/[\x00-\x1f/\\]/g,'_').slice(0,200);
  const { error } = await db.from('surgery_documents').insert({id,appointment_id:surgery.id,patient_id:surgery.patientId||null,object_path:path,name,category:body.category,size:body.size,uploaded_by:session.account.id});
  if (error) throw error;
  const { data, error: signError } = await db.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false});
  if (signError) { await db.from('surgery_documents').delete().eq('id',id); throw signError; }
  return Response.json({id,url:data.signedUrl},{headers:{'Cache-Control':'no-store'}});
 } catch(error) { return failure(error); }
}
export async function PATCH(request: Request) {
 if (!sameOrigin(request)) return Response.json({error:'Origem inválida.'},{status:403});
 try {
  const { session, db, surgeries } = await context();
  const { id } = await request.json();
  const { data: doc, error } = await db.from('surgery_documents').select('*').eq('id',id).maybeSingle();
  if (error) throw error;
  const surgery = doc && surgeries.find(a=>a.id===doc.appointment_id);
  if (!surgery || !permitted(session,surgery) || Number(doc.uploaded_by)!==session.account.id) return Response.json({error:'Envio não disponível.'},{status:403});
  if (doc.status==='ready') return Response.json({ok:true});
  const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(doc.object_path);
  if (downloadError || !file) return Response.json({error:'O envio não terminou. Tente novamente.'},{status:409});
  const valid = file.size === Number(doc.size) && file.size <= MAX_SIZE && (await file.slice(0,5).text()) === '%PDF-';
  if (!valid) {
   await db.storage.from(BUCKET).remove([doc.object_path]);
   await db.from('surgery_documents').delete().eq('id',id).eq('status','pending');
   return Response.json({error:'Arquivo inválido. Envie um PDF original de até 20 MB.'},{status:400});
  }
  const original = Buffer.from(await file.arrayBuffer());
  const hash = createHash('sha256').update(original).digest('hex');
  const compressed = await compressPdf(original);
  let storedPath=doc.object_path;
  if(compressed.bytes.length<original.length){
   storedPath=doc.object_path+'.compact.pdf';
   const {error: uploadError}=await db.storage.from(BUCKET).upload(storedPath,compressed.bytes,{contentType:'application/pdf',upsert:true});
   if(uploadError) throw uploadError;
  }
  const { error: updateError } = await db.from('surgery_documents').update({status:'ready',sha256:hash,size:compressed.bytes.length,object_path:storedPath}).eq('id',id).eq('status','pending');
  if (updateError?.code==='23505') {
   await db.storage.from(BUCKET).remove([...new Set([doc.object_path,storedPath])]);await db.from('surgery_documents').delete().eq('id',id).eq('status','pending');
   return Response.json({error:'Este PDF já está vinculado a esta cirurgia.'},{status:409});
  }
  if (updateError) throw updateError;
  if(storedPath!==doc.object_path) await db.storage.from(BUCKET).remove([doc.object_path]);
  return Response.json({ok:true,originalSize:original.length,size:compressed.bytes.length,compression:compressed.reason});
 } catch(error) { return failure(error); }
}

export async function DELETE(request: Request) {
 if(!sameOrigin(request)) return Response.json({error:'Origem inválida.'},{status:403});
 try {
  const {session,db,surgeries}=await context();
  const {id,confirmed}=await request.json();
  if(confirmed!==true) return Response.json({error:'Confirme a exclusão do PDF.'},{status:400});
  const {data:doc,error}=await db.from('surgery_documents').select('*').eq('id',id).maybeSingle();
  if(error) throw error;
  const surgery=doc && surgeries.find(a=>a.id===doc.appointment_id);
  if(!surgery||!permitted(session,surgery)) return Response.json({error:'Documento não disponível.'},{status:404});
  const originalPath=doc.object_path.replace(/\.compact\.pdf$/,'');
  const {error:removeError}=await db.storage.from(BUCKET).remove([originalPath,originalPath+'.compact.pdf']);
  if(removeError) throw removeError;
  const {error:deleteError}=await db.from('surgery_documents').delete().eq('id',id);
  if(deleteError) throw deleteError;
  return Response.json({ok:true});
 }catch(error){return failure(error)}
}
