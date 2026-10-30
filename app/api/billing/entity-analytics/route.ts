import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {financialActorOrganizationId} from '@/lib/financial-organization';

export const dynamic='force-dynamic';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const noCache={'Cache-Control':'private, no-store'} as const;

type ReceiptRow={payment_year:number;payment_month:number;source:string;
 amount:number|string;operations:number|string};

export async function GET(request:Request){
 const session=await getSession();
 if(!session||session.account.role!=='general_manager')
  return Response.json({error:'Acesso restrito à Gerência Geral.'},{status:403,headers:noCache});
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)return Response.json({error:'Acesso à organização negado.'},{status:403,headers:noCache});
 const entityId=new URL(request.url).searchParams.get('entity')||'';
 if(!uuid.test(entityId))
  return Response.json({error:'Entidade recebedora inválida.'},{status:400,headers:noCache});
 const db=getSupabaseAdmin();
 const {data:entity,error:entityError}=await db.from('billing_entities')
  .select('id,name,trade_name,person_type,tax_id')
  .eq('id',entityId).eq('organization_id',organizationId).maybeSingle();
 if(entityError)return Response.json({error:'Não foi possível consultar a entidade.'},{status:503,headers:noCache});
 if(!entity)return Response.json({error:'Entidade não encontrada.'},{status:404,headers:noCache});

 const {data,error}=await db.rpc('billing_entity_receipts_analytics',{p_entity:entityId});
 if(error)return Response.json({error:'Não foi possível obter os indicadores financeiros.'},
  {status:503,headers:noCache});

 const buckets=(data||[] as ReceiptRow[]).map((r:ReceiptRow)=>({
  year:Number(r.payment_year),month:Number(r.payment_month),
  source:r.source,amount:Number(r.amount),operations:Number(r.operations)
 })).filter((r:{year:number;month:number;source:string;amount:number;operations:number})=>
  Number.isSafeInteger(r.year)&&r.year>=1900&&r.year<=2200&&
  Number.isInteger(r.month)&&r.month>=1&&r.month<=12&&
  typeof r.source==='string'&&Number.isFinite(r.amount)&&r.amount>=0&&
  Number.isFinite(r.operations)&&r.operations>=0);
 return Response.json({entity,buckets},{headers:noCache});
}
