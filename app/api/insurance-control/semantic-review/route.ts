import { getSession } from "@/app/authz";
import { canManageInsurance, normalizeInsurancePayer } from "@/lib/insurance-control";
import { consumeLimit } from "@/lib/security/rate-limit";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { SEMANTIC_FIELDS } from "@/lib/perseu/semantic/contracts";
import { normalizeAmount, normalizeDate, normalizeIdentifier, normalizeSemanticText } from "@/lib/perseu/semantic/normalize";

export const dynamic = "force-dynamic";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value:unknown,max=200)=>typeof value==='string'&&value.trim().length<=max?value.trim():'';
function manager(session:Awaited<ReturnType<typeof getSession>>){if(!session||!canManageInsurance(session.account.role))throw new HttpError(403,'Acesso restrito à Gerência.');return session}
function fail(error:unknown){return Response.json({error:error instanceof HttpError?error.message:'Não foi possível registrar a revisão.'},{status:error instanceof HttpError?error.status:500,headers:{'Cache-Control':'private, no-store'}})}

export const POST=secureMutation(async request=>{
 try{
  const session=manager(await getSession()); await consumeLimit('perseus-semantic-review',String(session.account.id),60,3600);
  const body=await readJson(request),documentId=text(body.documentId,40),tableId=text(body.tableId),sourceKey=text(body.sourceKey),field=body.semanticField===null?null:text(body.semanticField),expected=text(body.expectedUpdatedAt,80);
  if(!uuid.test(documentId)||!tableId||!sourceKey||!expected||field!==null&&!SEMANTIC_FIELDS.includes(field as typeof SEMANTIC_FIELDS[number]))throw new HttpError(400,'Revisão semântica inválida.');
  const db=getSupabaseAdmin(),doc=await db.from('insurance_documents').select('id,updated_at,movement:insurance_movements!inner(billing_entity_id,payer,kind)').eq('id',documentId).maybeSingle();
  if(doc.error)throw doc.error;if(!doc.data)throw new HttpError(404,'Documento não encontrado.');
  const semantic=((await db.from('insurance_document_items').select('source_metadata,raw_data').eq('document_id',documentId).eq('source_metadata->>table_id',tableId).limit(1)).data||[])[0] as {source_metadata?:Record<string,unknown>;raw_data?:Record<string,unknown>}|undefined;
  if(!semantic?.raw_data?.[sourceKey]&&!(sourceKey in (semantic?.raw_data||{})))throw new HttpError(400,'Coluna não pertence ao documento.');
  const movement=doc.data.movement as unknown as {billing_entity_id:string;payer:string;kind:string};
  const meta=(await db.from('insurance_documents').select('raw_metadata').eq('id',documentId).single()).data?.raw_metadata as Record<string,unknown>|null;
  const perseus=(meta?.perseus||{}) as Record<string,unknown>,semanticMeta=(perseus.semantic||{}) as {tables?:{tableId:string;columns?:{sourceKey:string;sourceColumn:string}[]}[]};
  const table=semanticMeta.tables?.find(item=>item.tableId===tableId),column=table?.columns?.find(item=>item.sourceKey===sourceKey);
  const signature=(table?.columns||[]).map(item=>item.sourceKey).sort().join('|');
  const context={billing_entity_id:movement.billing_entity_id,payer_normalized:normalizeInsurancePayer(movement.payer),movement_kind:movement.kind,layout_fingerprint:String(perseus.layout_fingerprint||''),table_signature:signature,column_normalized:sourceKey};
  const result=await db.rpc('apply_perseus_semantic_review',{p_document_id:documentId,p_table_id:tableId,p_source_key:sourceKey,p_semantic_field:field,p_learn:body.learn===true,p_context:context,p_expected_updated_at:expected,p_updated_by:session.account.id});
  if(result.error)throw result.error;
  return Response.json({ok:true,result:result.data},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return fail(error)}
});

export const PATCH=secureMutation(async request=>{
 try{
  const session=manager(await getSession());await consumeLimit('perseus-semantic-value',String(session.account.id),120,3600);
  const body=await readJson(request),documentId=text(body.documentId,40),itemId=text(body.itemId,40),field=text(body.semanticField),expected=text(body.expectedUpdatedAt,80);
  if(!uuid.test(documentId)||!uuid.test(itemId)||!expected||!SEMANTIC_FIELDS.includes(field as typeof SEMANTIC_FIELDS[number]))throw new HttpError(400,'Correção semântica inválida.');
  const normalized=field==='service_date'?normalizeDate(body.value).value:field.startsWith('amount_')?normalizeAmount(body.value).value:['guide_number','beneficiary_number','procedure_code','gloss_code'].includes(field)?normalizeIdentifier(body.value):normalizeSemanticText(body.value);
  if(!normalized)throw new HttpError(400,'Informe um valor válido para a correção.');
  const result=await getSupabaseAdmin().rpc('apply_perseus_semantic_value_correction',{p_document_id:documentId,p_item_id:itemId,p_semantic_field:field,p_normalized_value:normalized,p_expected_updated_at:expected,p_updated_by:session.account.id});
  if(result.error)throw result.error;return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return fail(error)}
});

export async function GET(request:Request){
 try{manager(await getSession());const id=new URL(request.url).searchParams.get('id')||'';if(!uuid.test(id))throw new HttpError(400,'Documento inválido.');const db=getSupabaseAdmin();const [reviews,rules]=await Promise.all([db.from('perseus_semantic_reviews').select('id,table_id,source_key,semantic_field,state,applied_item_count,created_at').eq('document_id',id).neq('state','SUPERSEDED'),db.from('perseus_semantic_rules').select('id,column_normalized,semantic_field,state,version,created_at').eq('state','ACTIVE').limit(100)]);if(reviews.error)throw reviews.error;if(rules.error)throw rules.error;return Response.json({reviews:reviews.data||[],rules:rules.data||[]},{headers:{'Cache-Control':'private, no-store'}})}catch(error){return fail(error)}
}
