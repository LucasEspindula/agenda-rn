import {getSession} from '@/app/authz';
import {canManageInsurance} from '@/lib/insurance-control';
import {inspectPerseusDocument} from '@/lib/perseu/inspect';
import {PerseusParseError,type PerseusParseResult} from '@/lib/perseu/contracts';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {consumeLimit} from '@/lib/security/rate-limit';
import {HttpError,readJson,secureMutation} from '@/lib/security/http';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const BUCKET='insurance-documents';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Session=NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Document={id:string;storage_path:string;detected_format:string|null;upload_status:string;raw_metadata:Record<string,unknown>|null};

function manager(session:Awaited<ReturnType<typeof getSession>>):asserts session is Session{if(!session||!canManageInsurance(session.account.role))throw new HttpError(403,'Acesso restrito à Gerência.');}
function id(value:unknown){return typeof value==='string'&&uuid.test(value)}
function failure(error:unknown){return Response.json({error:error instanceof HttpError||error instanceof PerseusParseError?error.message:'Não foi possível analisar o documento.'},{status:error instanceof HttpError?error.status:500,headers:{'Cache-Control':'private, no-store'}})}
async function documentFor(documentId:string){const result=await getSupabaseAdmin().from('insurance_documents').select('id,storage_path,detected_format,upload_status,raw_metadata').eq('id',documentId).maybeSingle();if(result.error)throw result.error;return result.data as Document|null;}
function metadata(result:PerseusParseResult){return {parsed_at:new Date().toISOString(),parser_key:result.parserKey,parser_version:result.parserVersion,format:result.format,row_count:result.structure.rowCount,column_count:result.structure.columnCount,sheet_count:result.structure.sheetCount,layout_fingerprint:result.layoutFingerprint,warnings:result.warnings};}
function itemRows(documentId:string,result:PerseusParseResult){return result.items.map(item=>({document_id:documentId,source_index:item.sourceIndex,raw_data:item.rawData,normalized_data:{},match_status:'UNMATCHED'}));}

async function replaceItems(document:Document,result:PerseusParseResult,actorId:number){
 const db=getSupabaseAdmin(),previous=await db.from('insurance_document_items').select('*').eq('document_id',document.id).order('source_index',{ascending:true});if(previous.error)throw previous.error;
 const remove=await db.from('insurance_document_items').delete().eq('document_id',document.id);if(remove.error)throw remove.error;
 const insert=await db.from('insurance_document_items').insert(itemRows(document.id,result));
 if(insert.error){if(previous.data?.length)await db.from('insurance_document_items').insert(previous.data);throw insert.error;}
 const rawMetadata={...(document.raw_metadata||{}),perseus:metadata(result)};
 const update=await db.from('insurance_documents').update({perseus_status:'REVIEW_REQUIRED',parser_key:result.parserKey,parser_version:result.parserVersion,raw_metadata:rawMetadata,updated_at:new Date().toISOString(),updated_by:actorId}).eq('id',document.id).eq('upload_status','READY');
 if(update.error){await db.from('insurance_document_items').delete().eq('document_id',document.id);if(previous.data?.length)await db.from('insurance_document_items').insert(previous.data);throw update.error;}
}

async function fail(document:Document,actorId:number,message:string){
 const rawMetadata={...(document.raw_metadata||{}),perseus:{...((document.raw_metadata?.perseus as Record<string,unknown>|undefined)||{}),failed_at:new Date().toISOString(),error:message}};
 const result=await getSupabaseAdmin().from('insurance_documents').update({perseus_status:'FAILED',raw_metadata:rawMetadata,updated_at:new Date().toISOString(),updated_by:actorId}).eq('id',document.id).eq('upload_status','READY');if(result.error)throw result.error;
}

async function analyze(request:Request){
 const session=await getSession();manager(session);await consumeLimit('perseus-analyze',String(session.account.id),15,3600);
 const body=await readJson(request),documentId=body.id;if(!id(documentId))throw new HttpError(400,'Documento inválido.');
 const document=await documentFor(documentId);if(!document||document.upload_status!=='READY')throw new HttpError(409,'Somente documentos prontos podem ser analisados.');
 const download=await getSupabaseAdmin().storage.from(BUCKET).download(document.storage_path);if(download.error||!download.data)throw new HttpError(404,'Arquivo original não disponível.');
 try{
  const inspection=inspectPerseusDocument(document.detected_format,new Uint8Array(await download.data.arrayBuffer()));
  if(inspection.kind==='unsupported')return Response.json({ok:false,unsupported:true,message:inspection.message},{headers:{'Cache-Control':'private, no-store'}});
  await replaceItems(document,inspection.result,session.account.id);
  return Response.json({ok:true,summary:metadata(inspection.result)},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){if(error instanceof PerseusParseError){await fail(document,session.account.id,error.message);return Response.json({error:error.message},{status:422,headers:{'Cache-Control':'private, no-store'}});}throw error;}
}

export async function GET(request:Request){try{
 const session=await getSession();manager(session);const url=new URL(request.url),documentId=url.searchParams.get('id');if(typeof documentId!=='string'||!id(documentId))throw new HttpError(400,'Documento inválido.');
 const document=await documentFor(documentId);if(!document||document.upload_status!=='READY')throw new HttpError(404,'Documento não disponível.');
 const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||20)||20,1),20),items=await getSupabaseAdmin().from('insurance_document_items').select('source_index,raw_data').eq('document_id',document.id).order('source_index',{ascending:true}).limit(limit);if(items.error)throw items.error;
 const perseus=(document.raw_metadata?.perseus&&typeof document.raw_metadata.perseus==='object'?document.raw_metadata.perseus:{}) as Record<string,unknown>;
 return Response.json({summary:perseus,items:((items.data||[]) as {source_index:number;raw_data:Record<string,unknown>}[]).map(item=>({sourceIndex:item.source_index,rawData:item.raw_data}))},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return failure(error);}}
export const POST=secureMutation(async request=>{try{return await analyze(request)}catch(error){return failure(error)}});
