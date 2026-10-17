export interface HumanSession {
  participant_id: string;
  display_name: string;
  status: string;
  expires_at: string;
}

export interface HumanSendResponse {
  message_id: string | number;
  timestamp: string;
  room_message_count: number;
  max_messages: number;
}

async function request<T>(
  roomCode: string,
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `/api/human/rooms/${encodeURIComponent(roomCode)}/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    let message = `Não foi possível concluir a solicitação (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the status-based message if the response has no JSON body.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getHumanSession(roomCode: string, accessToken: string) {
  return request<HumanSession>(roomCode, accessToken, "session");
}

export function joinHumanSession(
  roomCode: string,
  accessToken: string,
  displayName: string,
  creatorToken?: string
) {
  return request<HumanSession>(roomCode, accessToken, "session", {
    method: "POST",
    body: JSON.stringify({
      display_name: displayName,
      ...(creatorToken ? { creator_token: creatorToken } : {}),
    }),
  });
}

export function leaveHumanSession(roomCode: string, accessToken: string) {
  return request<void>(roomCode, accessToken, "session", { method: "DELETE" });
}

export function sendHumanMessage(
  roomCode: string,
  accessToken: string,
  content: string,
  clientMessageId: string,
  source: "chat" | "voice" = "chat"
) {
  return request<HumanSendResponse>(roomCode, accessToken, "messages", {
    method: "POST",
    body: JSON.stringify({ content, client_message_id: clientMessageId, source }),
  });
}

export interface HumanPresenceParticipant {
  participant_id: string;
  display_name: string;
  online: boolean;
}

export function getHumanPresence(roomCode: string, accessToken: string) {
  return request<{ participants: HumanPresenceParticipant[] }>(roomCode, accessToken, "presence");
}

export function heartbeatHumanPresence(roomCode: string, accessToken: string) {
  return request<void>(roomCode, accessToken, "presence", {
    method: "POST",
    body: JSON.stringify({}),
  });
}
