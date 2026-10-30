import 'server-only';
import {getSupabaseAdmin} from '@/lib/supabase-admin';

// Organization is server-derived; never accept tenant IDs from request payloads.
// The database helper deliberately fails closed when a second organization exists.
export async function financialActorOrganizationId(actorId:number):Promise<string|null>{
 const {data,error}=await getSupabaseAdmin().rpc('require_rn_agenda_actor_organization',{p_actor:actorId});
 if(error||typeof data!=='string'||!data)return null;
 return data;
}
