import { NextRequest, NextResponse } from "next/server";
import { internalError, invalidBody } from "@/lib/server/errors";
import { getUserFromCookies } from "@/lib/server/supabaseServer";
import { ApiError, createChannel } from "@/lib/server/store";
import { getBaseUrl } from "@/lib/server/urls";

export const runtime = "nodejs";

// Create a persistent channel (a permanent chat link) for the signed-in user.
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      title?: unknown;
      reset_mode?: unknown;
    } | null;

    if (typeof body?.slug !== "string" || body.slug.length === 0) {
      return invalidBody("slug is required");
    }
    const resetMode =
      body.reset_mode === "daily" ? "daily" : "permanent";
    const title =
      typeof body.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : undefined;

    const room = await createChannel(user, {
      slug: body.slug,
      title,
      resetMode,
    });

    const baseUrl = getBaseUrl(request);
    const apiBase = `${baseUrl}/api/v1/${room.room_code}`;
    return NextResponse.json(
      {
        room_code: room.room_code,
        creator_token: room.creator_token,
        reset_mode: room.reset_mode,
        title: room.title,
        human_url: `${baseUrl}/${room.room_code}`,
        agent_join_url: `${apiBase}/agent-join`,
        created_at: room.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.code, message: error.message, ...error.extra },
        { status: error.status }
      );
    }
    return internalError(error);
  }
}
