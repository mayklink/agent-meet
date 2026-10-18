import { describe, expect, it } from "vitest";
import {
  collectFinalSpeechResults,
  getSpeechErrorStatus,
  getSpeechStatusMessage,
} from "@/lib/speech";

function result(transcript: string, isFinal: boolean) {
  return Object.assign([{ transcript }], { isFinal });
}

describe("speech transcription helpers", () => {
  it("keeps identical utterances from different result indexes", () => {
    const seen = new Set<string>();
    const results = [result("olá mundo", true), result("olá mundo", true)];

    expect(collectFinalSpeechResults("run-1", results, seen)).toEqual([
      "olá mundo",
      "olá mundo",
    ]);
  });

  it("ignores interim results and deduplicates repeated events by run and index", () => {
    const seen = new Set<string>();
    const results = [result("frase final", true), result("frase provisória", false)];

    expect(collectFinalSpeechResults("run-1", results, seen)).toEqual(["frase final"]);
    expect(collectFinalSpeechResults("run-1", results, seen)).toEqual([]);
  });

  it("accepts the same result index in a later recognition run", () => {
    const seen = new Set<string>();
    const results = [result("repetir frase", true)];

    expect(collectFinalSpeechResults("run-1", results, seen)).toEqual(["repetir frase"]);
    expect(collectFinalSpeechResults("run-2", results, seen)).toEqual(["repetir frase"]);
  });

  it.each([
    ["not-allowed", "permission-denied"],
    ["service-not-allowed", "permission-denied"],
    ["no-speech", "no-speech"],
    ["network", "network"],
    ["audio-capture", "error"],
  ] as const)("maps %s into a visible state", (error, status) => {
    expect(getSpeechErrorStatus(error)).toBe(status);
    expect(getSpeechStatusMessage(status)).not.toBe("");
  });
});
