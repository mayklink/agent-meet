import { NextResponse } from "next/server";
import { internalError } from "@/lib/server/errors";
import { getUserFromCookies } from "@/lib/server/supabaseServer";
import { listUserRooms, MAX_CHANNELS_PER_USER } from "@/lib/server/store";

export const runtime = "nodejs";

// Chat history + channels for the signed-in user.
export async function GET() {
  try {
    const user = await getUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const rooms = await listUserRooms(user.id);
    const channels = rooms.filter((r) => r.is_channel);
    const history = rooms.filter((r) => !r.is_channel);

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      channels,
      history,
      max_channels: MAX_CHANNELS_PER_USER,
      channels_remaining: Math.max(0, MAX_CHANNELS_PER_USER - channels.length),
    });
  } catch (err) {
    return internalError(err);
  }
}
