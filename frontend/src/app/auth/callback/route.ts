import { NextRequest, NextResponse } from "next/server";
import { createRouteClient } from "@/lib/server/supabaseServer";

export const runtime = "nodejs";

// OAuth redirect target. Supabase sends the user here with a `code` after they
// approve Google sign-in; we exchange it for a session cookie, then bounce them
// back to wherever they started (?next=).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/me";

  const response = NextResponse.redirect(`${origin}${next}`);

  if (code) {
    const supabase = createRouteClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error.message)}`);
    }
  }

  return response;
}
