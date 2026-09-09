import { createClient } from "@supabase/supabase-js";

// Schema types are generated after deployment; keep this server-only client untyped
// so migrations and runtime code can be shipped atomically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): any {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is incomplete");
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

export function dbError(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message || "Supabase error"}`);
}
