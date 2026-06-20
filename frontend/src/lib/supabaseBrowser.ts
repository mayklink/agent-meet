"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser-side Supabase client used for Google OAuth sign-in and reading the
// current session. It stores the session in cookies (via @supabase/ssr) so the
// Next.js API routes can read the signed-in user server-side.
let client: SupabaseClient | undefined;

export function getSupabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
