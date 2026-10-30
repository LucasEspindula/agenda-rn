import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {financialActorOrganizationId} from '@/lib/financial-organization';
import {collapseChanges,type FinancialLog} from '@/lib/billing-logs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const s=await getSession();if(!s||s.account.role!=='general_manager')return Response.json({error:'Acesso restrito à gerência.'},{status:403});
 const organizationId=await financialActorOrganizationId(s.account.id);
 if(!organizationId)return Response.json({error:'Acesso à organização negado.'},{status:403});
 const p=new URL(request.url).searchParams;const start=p.get('start'),end=p.get('end'),cursor=p.get('cursor');
 if([start,end].some(v=>v&&!/^\d{4}-\d{2}-\d{2}$/.test(v))||cursor&&Number.isNaN(Date.parse(cursor)))return Response.json({error:'Período inválido.'},{status:400});
 let q=getSupabaseAdmin().from('financial_logs').select('*,changes:financial_log_changes!financial_log_changes_log_id_fkey(*)').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(26);
 if(start)q=q.gte('created_at',start+'T00:00:00-03:00');if(end)q=q.lte('created_at',end+'T23:59:59.999-03:00');if(cursor)q=q.lt('created_at',cursor);
 if(p.get('user'))q=q.eq('actor_id',p.get('user'));if(p.get('kind'))q=q.eq('kind',p.get('kind'));
 const r=await q;if(r.error)return Response.json({error:'Não foi possível carregar os logs.'},{status:503});
 const logs=(r.data||[]) as FinancialLog[];return Response.json({logs:logs.slice(0,25).map(l=>({...l,changes:collapseChanges(l.changes)})),next:logs.length>25?logs[24].created_at:null},{headers:{'Cache-Control':'private, no-store'}});
}
