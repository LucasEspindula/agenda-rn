import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {canManageInsurance} from '@/lib/insurance-control';
import {HttpError} from '@/lib/security/http';

export const dynamic='force-dynamic';
type Row={id:string;original_filename:string;detected_format:string|null;upload_status:string;perseus_status:string;created_at:string;created_by:number;raw_metadata:Record<string,unknown>|null;movement:unknown};
type User={id:number;name:string|null;email:string|null};

export async function GET(){
 try{
  const session=await getSession();
  if(!session||!canManageInsurance(session.account.role))throw new HttpError(403,'Acesso restrito à Gerência.');
  const db=getSupabaseAdmin(),result=await db.from('insurance_documents').select('id,original_filename,detected_format,upload_status,perseus_status,created_at,created_by,raw_metadata,movement:insurance_movements!inner(payer,competence,kind,external_reference,billing_entity:billing_entities(name,trade_name))').order('created_at',{ascending:false});
  if(result.error)throw result.error;
  const rows=(result.data||[]) as Row[],userIds=[...new Set(rows.map(document=>document.created_by))],users=userIds.length?await db.from('users').select('id,name,email').in('id',userIds):{data:[],error:null};
  if(users.error)throw users.error;
  const names=new Map(((users.data||[]) as User[]).map(user=>[user.id,user.name||user.email||'Não informado']));
  return Response.json({documents:rows.map(document=>{const perseus=document.raw_metadata?.perseus&&typeof document.raw_metadata.perseus==='object'?document.raw_metadata.perseus:null;return {id:document.id,originalFilename:document.original_filename,detectedFormat:document.detected_format,uploadStatus:document.upload_status,perseusStatus:document.perseus_status,createdAt:document.created_at,movement:document.movement,importer:names.get(document.created_by)||'Não informado',rejectionReason:typeof document.raw_metadata?.rejection_reason==='string'?document.raw_metadata.rejection_reason:null,analysis:perseus};})},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){const message=error instanceof HttpError?error.message:'Não foi possível carregar os documentos.';return Response.json({error:message},{status:error instanceof HttpError?error.status:500})}
}

