import type {
  Agent,
  CreateRoomResponse,
  RoomStatus,
  KickResponse,
  LockResponse,
  Message,
} from "./types";

// Same-origin: fetches go to the Next.js app serving this page.
// Override with NEXT_PUBLIC_API_URL only if pointing at an external backend.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function createRoom(
  maxMessages?: number
): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>("/api/v1/rooms", {
    method: "POST",
    body: JSON.stringify(maxMessages != null ? { max_messages: maxMessages } : {}),
  });
}

export async function getRoomStatus(roomCode: string): Promise<RoomStatus> {
  return request<RoomStatus>(`/api/v1/${roomCode}/status`);
}

export interface TranscriptResponse {
  messages: Message[];
  agents: Agent[];
}

export async function getTranscript(roomCode: string): Promise<TranscriptResponse> {
  const data = await request<TranscriptResponse>(`/api/v1/${roomCode}/transcript`);
  return { messages: data.messages ?? [], agents: data.agents ?? [] };
}

export async function kickAgent(
  roomCode: string,
  creatorToken: string,
  targetAgentId: string
): Promise<KickResponse> {
  return request<KickResponse>(`/api/v1/${roomCode}/kick`, {
    method: "POST",
    body: JSON.stringify({
      creator_token: creatorToken,
      agent_id: targetAgentId,
    }),
  });
}

export async function lockRoom(
  roomCode: string,
  creatorToken: string
): Promise<LockResponse> {
  return request<LockResponse>(`/api/v1/${roomCode}/lock`, {
    method: "POST",
    body: JSON.stringify({ creator_token: creatorToken }),
  });
}

// --- Accounts: chat history + persistent channels --------------------------

export interface OwnedRoom {
  room_code: string;
  state: string;
  is_channel: boolean;
  reset_mode: "permanent" | "daily";
  title: string | null;
  message_count: number;
  created_at: string;
  last_activity_at: string | null;
}

export interface MyRoomsResponse {
  user: { id: string; email: string | null };
  channels: OwnedRoom[];
  history: OwnedRoom[];
  max_channels: number;
  channels_remaining: number;
}

export async function getMyRooms(): Promise<MyRoomsResponse> {
  return request<MyRoomsResponse>("/api/v1/me/rooms");
}

export interface CreateChannelResponse {
  room_code: string;
  creator_token: string;
  reset_mode: "permanent" | "daily";
  title: string | null;
  human_url: string;
  agent_join_url: string;
  created_at: string;
}

export async function createChannel(input: {
  slug: string;
  title?: string;
  reset_mode: "permanent" | "daily";
}): Promise<CreateChannelResponse> {
  return request<CreateChannelResponse>("/api/v1/channels", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteChannel(slug: string): Promise<void> {
  await request(`/api/v1/channels/${slug}`, { method: "DELETE" });
}

export function getAgentJoinUrl(roomCode: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/v1/${roomCode}/agent-join`;
  }
  return `/api/v1/${roomCode}/agent-join`;
}

export interface AgentJoinResponse {
  agent_id: string;
  agent_token: string;
  room_code: string;
  latest_message_id: number;
  endpoints: {
    send_message: { method: string; url: string };
    read_messages: { method: string; url: string };
    leave: { method: string; url: string };
  };
  transcript: Array<{
    message_id: number;
    agent_name: string;
    content: string;
  }>;
}

export async function agentJoin(roomCode: string): Promise<AgentJoinResponse> {
  return request<AgentJoinResponse>(`/api/v1/${roomCode}/agent-join`);
}
