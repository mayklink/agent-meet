import { describe, expect, it } from "vitest";
import { getHumanPendingStorageKey, parseHumanPendingMessage } from "@/lib/human-pending";

describe("human pending message storage", () => {
  it("scopes pending sends by both room and authenticated user", () => {
    const roomAUserA = getHumanPendingStorageKey("room/one", "user-a");
    expect(roomAUserA).not.toBe(getHumanPendingStorageKey("room/two", "user-a"));
    expect(roomAUserA).not.toBe(getHumanPendingStorageKey("room/one", "user-b"));
    expect(roomAUserA).toContain("room%2Fone");
  });

  it("preserves the exact content, id, and source for a safe retry", () => {
    expect(parseHumanPendingMessage(JSON.stringify({
      content: "olá, mundo",
      clientMessageId: "8fd7d5a4-18b5-4e35-b5f2-c6c201eac991",
      source: "voice",
    }))).toEqual({
      content: "olá, mundo",
      clientMessageId: "8fd7d5a4-18b5-4e35-b5f2-c6c201eac991",
      source: "voice",
    });
  });

  it.each([null, "not json", "{}", JSON.stringify({ content: "", clientMessageId: "id" })])(
    "rejects invalid pending data (%s)",
    (value) => {
      expect(parseHumanPendingMessage(value)).toBeNull();
    }
  );
});
