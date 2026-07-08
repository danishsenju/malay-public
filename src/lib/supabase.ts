import { createClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_ vars must be accessed as literal property names — Next.js only
// inlines them at build time when it can statically see the full identifier.
// process.env[dynamicKey] is NOT inlined and returns undefined in the browser.

/** Browser / server-component client (anon key, RLS-governed). */
export function getSupabase() {
  // Return type intentionally inferred from createClient(string, string) so the
  // hooks get SupabaseClient<any> and .rpc() accepts arbitrary param objects.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Server-only admin client (service role key — never expose to browser). */
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
