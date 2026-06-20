import { getAdmin } from "./db";
import {
  generateAgentId,
  generateAgentToken,
  generateCreatorToken,
  generateRoomCode,
} from "./ids";
import type { AgentRow, AgentSummary, MessageRow, RoomRow } from "./types";

const MAX_ACTIVE_AGENTS = 20;

const ROOM_COLS =
  "room_code, creator_token, state, max_messages, message_count, lock_reason, locked_at, first_message_at, last_activity_at, created_at, owner_user_id, owner_email, is_channel, no_auto_lock, reset_mode, title, current_day" as const;

const AGENT_COLS =
  "agent_id, agent_token, room_code, agent_name, status, created_at, activated_at, left_at" as const;

const MESSAGE_COLS =
  "room_seq, agent_id, agent_name, content, created_at, read_by, day_key" as const;

// Channels (persistent links) are capped per signed-in user.
export const MAX_CHANNELS_PER_USER = 3;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function db() {
  return getAdmin();
}

function toMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    message_id: (row.message_id ?? row.room_seq) as number,
    agent_id: row.agent_id as string,
    agent_name: row.agent_name as string,
    content: row.content as string,
    timestamp: (row.timestamp ?? row.created_at) as string,
    read_by: (row.read_by ?? []) as string[],
    day_key: (row.day_key ?? null) as string | null,
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export interface RoomOwner {
  id: string;
  email: string | null;
}

export async function createRoom(
  maxMessages = 500,
  owner?: RoomOwner | null
): Promise<RoomRow> {
  const roomCode = generateRoomCode();
  const creatorToken = generateCreatorToken();
  const { data, error } = await db()
    .from("rooms")
    .insert({
      room_code: roomCode,
      creator_token: creatorToken,
      max_messages: maxMessages,
      owner_user_id: owner?.id ?? null,
      owner_email: owner?.email ?? null,
    })
    .select(ROOM_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as RoomRow;
}

// --- Channels: persistent, user-owned chat links ---------------------------

export async function countUserChannels(userId: string): Promise<number> {
  const { count, error } = await db()
    .from("rooms")
    .select("*", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .eq("is_channel", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createChannel(
  owner: RoomOwner,
  opts: { slug: string; title?: string; resetMode?: "permanent" | "daily" }
): Promise<RoomRow> {
  const slug = opts.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new ApiError(
      422,
      "invalid_slug",
      "Link must be 3-40 chars: lowercase letters, numbers, and dashes only"
    );
  }

  const count = await countUserChannels(owner.id);
  if (count >= MAX_CHANNELS_PER_USER) {
    throw new ApiError(
      403,
      "channel_limit_reached",
      `Each user can keep up to ${MAX_CHANNELS_PER_USER} permanent links`,
      { max_channels: MAX_CHANNELS_PER_USER }
    );
  }

  const existing = await getRoom(slug);
  if (existing) {
    throw new ApiError(409, "slug_taken", "That link is already in use");
  }

  const creatorToken = generateCreatorToken();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db()
    .from("rooms")
    .insert({
      room_code: slug,
      creator_token: creatorToken,
      max_messages: 10000,
      owner_user_id: owner.id,
      owner_email: owner.email,
      is_channel: true,
      no_auto_lock: true,
      reset_mode: opts.resetMode ?? "permanent",
      title: opts.title?.slice(0, 120) ?? null,
      current_day: today,
    })
    .select(ROOM_COLS)
    .single();
  if (error) {
    // Unique violation race on the slug.
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "slug_taken", "That link is already in use");
    }
    throw new Error(error.message);
  }
  return data as unknown as RoomRow;
}

export interface OwnedRoomSummary {
  room_code: string;
  state: string;
  is_channel: boolean;
  reset_mode: "permanent" | "daily";
  title: string | null;
  message_count: number;
  created_at: string;
  last_activity_at: string | null;
}

export async function listUserRooms(userId: string): Promise<OwnedRoomSummary[]> {
  const { data, error } = await db()
    .from("rooms")
    .select(
      "room_code, state, is_channel, reset_mode, title, message_count, created_at, last_activity_at"
    )
    .eq("owner_user_id", userId)
    .order("is_channel", { ascending: false })
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OwnedRoomSummary[];
}

export async function deleteChannel(
  userId: string,
  slug: string
): Promise<boolean> {
  const room = await getRoom(slug);
  if (!room || !room.is_channel || room.owner_user_id !== userId) return false;

  // Remove dependent rows first (messages + agents reference room_code).
  await db().from("messages").delete().eq("room_code", slug);
  await db().from("agents").delete().eq("room_code", slug);
  const { error } = await db().from("rooms").delete().eq("room_code", slug);
  if (error) throw new Error(error.message);
  return true;
}

export async function getRoom(roomCode: string): Promise<RoomRow | null> {
  const { data, error } = await db()
    .from("rooms")
    .select(ROOM_COLS)
    .eq("room_code", roomCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as RoomRow) ?? null;
}

export async function registerAgent(roomCode: string): Promise<AgentRow> {
  const agentId = generateAgentId();
  const agentToken = generateAgentToken();
  const { data, error } = await db()
    .from("agents")
    .insert({
      agent_id: agentId,
      agent_token: agentToken,
      room_code: roomCode,
      status: "pending",
    })
    .select(AGENT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as AgentRow;
}

export async function getAgentByToken(
  roomCode: string,
  agentToken: string
): Promise<AgentRow | null> {
  const { data, error } = await db()
    .from("agents")
    .select(AGENT_COLS)
    .eq("room_code", roomCode)
    .eq("agent_token", agentToken)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as AgentRow) ?? null;
}

export async function countActiveAgents(roomCode: string): Promise<number> {
  const { count, error } = await db()
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("room_code", roomCode)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getRoomStatus(roomCode: string) {
  const room = await getRoom(roomCode);
  if (!room) return null;

  const [{ count: active, error: e1 }, { count: pending, error: e2 }] =
    await Promise.all([
      db()
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("room_code", roomCode)
        .eq("status", "active"),
      db()
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("room_code", roomCode)
        .eq("status", "pending"),
    ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);

  return {
    room_code: room.room_code,
    state: room.state,
    agents: { active: active ?? 0, pending: pending ?? 0 },
    message_count: room.message_count,
    max_messages: room.max_messages,
    created_at: room.created_at,
    first_message_at: room.first_message_at ?? undefined,
    locked_at: room.locked_at ?? undefined,
    lock_reason: room.lock_reason ?? undefined,
    is_channel: room.is_channel,
    reset_mode: room.reset_mode,
    title: room.title ?? undefined,
  };
}

export async function getRecentMessages(
  roomCode: string,
  limit?: number
): Promise<MessageRow[]> {
  if (limit === 0) return [];

  if (limit != null) {
    const { data, error } = await db()
      .from("messages")
      .select(MESSAGE_COLS)
      .eq("room_code", roomCode)
      .order("room_seq", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).reverse().map(toMessageRow);
  }

  const { data, error } = await db()
    .from("messages")
    .select(MESSAGE_COLS)
    .eq("room_code", roomCode)
    .order("room_seq");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMessageRow);
}

export async function getUnreadMessages(
  roomCode: string,
  agentId: string
): Promise<MessageRow[]> {
  const { data, error } = await db()
    .from("messages")
    .select(MESSAGE_COLS)
    .eq("room_code", roomCode)
    .neq("agent_id", agentId)
    .not("read_by", "cs", `{${agentId}}`)
    .order("room_seq");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMessageRow);
}

export async function markMessagesRead(
  roomCode: string,
  agentId: string,
  messageIds: number[]
): Promise<MessageRow[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await db().rpc("mark_messages_read", {
    p_room_code: roomCode,
    p_agent_id: agentId,
    p_message_ids: messageIds,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toMessageRow);
}

export async function sendMessage(
  roomCode: string,
  agentToken: string,
  agentName: string,
  content: string
) {
  const room = await getRoom(roomCode);
  if (!room) {
    throw new ApiError(404, "room_not_found", "No room with this code exists");
  }
  if (room.state === "locked") {
    throw new ApiError(
      423,
      "room_locked",
      "This room is locked and read-only. No new messages or agents allowed."
    );
  }

  const agent = await getAgentByToken(roomCode, agentToken);
  if (!agent) {
    throw new ApiError(401, "unauthorized", "Invalid agent token");
  }
  if (agent.status === "left" || agent.status === "kicked") {
    throw new ApiError(
      403,
      "agent_inactive",
      "Agent has been kicked or has left the room"
    );
  }

  if (agent.status === "pending") {
    const { data: activatedId, error } = await db().rpc("activate_agent", {
      p_agent_id: agent.agent_id,
      p_agent_name: agentName,
      p_room_code: roomCode,
      p_max_active: MAX_ACTIVE_AGENTS,
    });
    if (error) throw new Error(error.message);
    if (!activatedId) {
      throw new ApiError(
        409,
        "room_full",
        "Room has reached the maximum of 20 active agents",
        { max_agents: MAX_ACTIVE_AGENTS }
      );
    }
  } else if (agent.agent_name !== agentName) {
    const { error } = await db()
      .from("agents")
      .update({ agent_name: agentName })
      .eq("agent_id", agent.agent_id);
    if (error) throw new Error(error.message);
  }

  const { data: result, error } = await db().rpc("send_message", {
    p_room_code: roomCode,
    p_agent_id: agent.agent_id,
    p_agent_name: agentName,
    p_content: content,
  });
  if (error) throw new Error(error.message);

  const row = result as {
    message_id: number;
    timestamp: string;
    room_message_count: number;
    max_messages: number;
  };

  // Channels never auto-lock — they are meant to stay on forever.
  if (!room.no_auto_lock && row.room_message_count >= row.max_messages) {
    await lockRoom(roomCode, "max_messages_reached");
  }

  return {
    message_id: row.message_id,
    timestamp: row.timestamp,
    room_message_count: row.room_message_count,
    max_messages: row.max_messages,
  };
}

export async function leaveRoom(
  roomCode: string,
  agentToken: string
): Promise<boolean> {
  const agent = await getAgentByToken(roomCode, agentToken);
  if (!agent) return false;

  const { error } = await db()
    .from("agents")
    .update({ status: "left", left_at: new Date().toISOString() })
    .eq("agent_id", agent.agent_id);
  if (error) throw new Error(error.message);
  return true;
}

export async function validateCreatorToken(
  roomCode: string,
  creatorToken: string
): Promise<boolean> {
  const { data, error } = await db()
    .from("rooms")
    .select("creator_token")
    .eq("room_code", roomCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.creator_token === creatorToken;
}

export async function getAgentById(
  agentId: string
): Promise<AgentRow | null> {
  const { data, error } = await db()
    .from("agents")
    .select(AGENT_COLS)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as AgentRow) ?? null;
}

export async function kickAgent(
  roomCode: string,
  targetAgentId: string
): Promise<AgentRow | null> {
  const agent = await getAgentById(targetAgentId);
  if (
    !agent ||
    agent.room_code !== roomCode ||
    !["active", "pending"].includes(agent.status)
  ) {
    return null;
  }

  const { error } = await db()
    .from("agents")
    .update({ status: "kicked", left_at: new Date().toISOString() })
    .eq("agent_id", targetAgentId);
  if (error) throw new Error(error.message);
  return agent;
}

export async function lockRoom(roomCode: string, reason: string) {
  const { data, error } = await db()
    .from("rooms")
    .update({
      state: "locked",
      lock_reason: reason,
      locked_at: new Date().toISOString(),
    })
    .eq("room_code", roomCode)
    .select(ROOM_COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as RoomRow) ?? null;
}

export async function getAgentsInRoom(
  roomCode: string
): Promise<AgentSummary[]> {
  const { data, error } = await db()
    .from("agents")
    .select("agent_id, agent_name, status, created_at, activated_at")
    .eq("room_code", roomCode)
    .neq("status", "pending")
    .order("activated_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    agent_id: row.agent_id as string,
    agent_name: (row.agent_name ?? "") as string,
    status: row.status as AgentSummary["status"],
    created_at: row.created_at as string | undefined,
    activated_at: row.activated_at as string | null | undefined,
  }));
}

export async function getPaginatedMessages(
  roomCode: string,
  limit: number,
  offset: number
) {
  const { count, error: countErr } = await db()
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("room_code", roomCode);
  if (countErr) throw new Error(countErr.message);

  const totalMessages = count ?? 0;

  const { data, error } = await db()
    .from("messages")
    .select(MESSAGE_COLS)
    .eq("room_code", roomCode)
    .order("room_seq")
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  return {
    messages: (data ?? []).map(toMessageRow),
    total_messages: totalMessages,
    limit,
    offset,
    has_more: offset + limit < totalMessages,
  };
}
