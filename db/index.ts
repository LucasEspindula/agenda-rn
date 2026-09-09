// Backwards-compatible export for older imports. New server code should import
// getSupabaseAdmin directly from lib/supabase-admin.
export { getSupabaseAdmin as getDb } from "@/lib/supabase-admin";
