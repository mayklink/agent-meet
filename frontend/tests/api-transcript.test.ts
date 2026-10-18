import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranscript } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function message(messageId: number) {
  return {
    message_id: messageId,
    agent_id: "ag_test",
    agent_name: "Agent",
    content: `message ${messageId}`,
    timestamp: "2026-10-17T00:00:00.000Z",
    read_by: [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getTranscript", () => {
  it("loads every page for a transcript larger than 1000 messages", async () => {
    const pages = new Map([
      [0, { messages: Array.from({ length: 500 }, (_, index) => message(index + 1)), agents: [{ agent_id: "ag_test", agent_name: "Agent", status: "active" }], offset: 0, has_more: true }],
      [500, { messages: Array.from({ length: 500 }, (_, index) => message(index + 501)), agents: [], offset: 500, has_more: true }],
      [1000, { messages: [message(1001)], agents: [], offset: 1000, has_more: false }],
    ]);
    const offsets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://agentmeet.test");
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      return jsonResponse(pages.get(offset));
    }));

    const transcript = await getTranscript("room-code");

    expect(offsets).toEqual([0, 500, 1000]);
    expect(transcript.messages).toHaveLength(1001);
    expect(transcript.messages[0].message_id).toBe(1);
    expect(transcript.messages.at(-1)?.message_id).toBe(1001);
    expect(transcript.agents).toHaveLength(1);
  });

  it("fails rather than returning a silently truncated result when a later page errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://agentmeet.test");
      if (url.searchParams.get("offset") === "0") {
        return jsonResponse({ messages: Array.from({ length: 500 }, (_, index) => message(index + 1)), agents: [], offset: 0, has_more: true });
      }
      return jsonResponse({ error: "service unavailable" }, 503);
    }));

    await expect(getTranscript("room-code")).rejects.toThrow("API error 503");
  });

  it("fails on an empty page that claims more history so pagination cannot loop forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://agentmeet.test");
      const offset = Number(url.searchParams.get("offset"));
      return jsonResponse({
        messages: offset === 0 ? [message(1)] : [],
        agents: [],
        offset,
        has_more: true,
      });
    }));

    await expect(getTranscript("room-code")).rejects.toThrow("empty page");
  });
});
