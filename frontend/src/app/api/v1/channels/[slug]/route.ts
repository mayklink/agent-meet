import { NextResponse } from "next/server";
import { internalError } from "@/lib/server/errors";
import { getUserFromCookies } from "@/lib/server/supabaseServer";
import { deleteChannel } from "@/lib/server/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

// Delete a channel the signed-in user owns (also removes its messages/agents).
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const user = await getUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const { slug } = await params;
    const ok = await deleteChannel(user.id, slug);
    if (!ok) {
      return NextResponse.json(
        { error: "not_found", message: "No channel with this link that you own" },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return internalError(err);
  }
}
