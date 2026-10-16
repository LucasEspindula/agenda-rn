import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const number = (value:string|undefined,fallback:number) => {
  const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?Math.floor(parsed):fallback;
};
export const PERSEUS_CHAT_DAILY_TOKEN_LIMIT=()=>number(process.env.PERSEUS_CHAT_DAILY_TOKEN_LIMIT,100_000);
export const PERSEUS_CHAT_CONVERSATION_CALL_LIMIT=()=>number(process.env.PERSEUS_CHAT_CONVERSATION_CALL_LIMIT,80);

export async function assertPerseusChatBudget(actorId:number,conversationId:string){
  const db=getSupabaseAdmin(),day=new Date();day.setUTCHours(0,0,0,0);
  const [daily,conversation]=await Promise.all([
    db.from("perseus_usage_events").select("input_tokens,output_tokens").eq("actor_id",actorId).gte("created_at",day.toISOString()).limit(5_000),
    db.from("perseus_usage_events").select("id").eq("conversation_id",conversationId).limit(PERSEUS_CHAT_CONVERSATION_CALL_LIMIT()+1),
  ]);
  if(daily.error||conversation.error)throw new Error("Não foi possível validar o orçamento conversacional.");
  const consumed=(daily.data||[]).reduce((total:number,row:{input_tokens?:number;output_tokens?:number})=>total+(row.input_tokens||0)+(row.output_tokens||0),0);
  if(consumed>=PERSEUS_CHAT_DAILY_TOKEN_LIMIT())throw new Error("O limite diário da inteligência conversacional foi atingido.");
  if((conversation.data||[]).length>=PERSEUS_CHAT_CONVERSATION_CALL_LIMIT())throw new Error("Esta conversa atingiu o limite seguro de chamadas. Inicie uma nova conversa.");
}
