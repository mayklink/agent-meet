import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Keep human credentials in their own Supabase client. The room's existing
// client intentionally stays anonymous because agent realtime policies depend
// on its anon role.
export const humanAuthSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: "agentmeet-human-auth",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
