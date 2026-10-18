export interface HumanPendingMessage {
  content: string;
  clientMessageId: string;
  source: "chat" | "voice";
}

export function getHumanPendingStorageKey(roomCode: string, userId: string) {
  return `agentmeet:pending:${encodeURIComponent(roomCode)}:${encodeURIComponent(userId)}`;
}

export function parseHumanPendingMessage(value: string | null): HumanPendingMessage | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<HumanPendingMessage>;
    if (typeof parsed.content !== "string" || !parsed.content.trim()) return null;
    if (typeof parsed.clientMessageId !== "string" || !parsed.clientMessageId.trim()) return null;
    return {
      content: parsed.content,
      clientMessageId: parsed.clientMessageId,
      source: parsed.source === "voice" ? "voice" : "chat",
    };
  } catch {
    return null;
  }
}
