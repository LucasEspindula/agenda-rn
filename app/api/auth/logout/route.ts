import { secureMutation } from "@/lib/security/http";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/app/authz";
import { hashToken } from "@/app/passwords";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

async function logout(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) { const result = await getSupabaseAdmin().from("sessions").delete().eq("token_hash", await hashToken(token)); dbError(result.error, "Delete session"); }
  cookieStore.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return new Response(null, { status: 204, headers: { "Clear-Site-Data": '"cache", "storage"' } });
}


export const POST = secureMutation(logout);
