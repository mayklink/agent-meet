"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectFinalSpeechResults,
  getSpeechErrorStatus,
  type SpeechResultListLike,
  type SpeechStatus,
} from "@/lib/speech";

interface SpeechRecognitionEventLike {
  readonly results: SpeechResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

interface ActiveRun {
  id: string;
  recognition: SpeechRecognitionLike;
  seen: Set<string>;
  active: boolean;
  gotFinal: boolean;
  failure: SpeechStatus | null;
}

interface UseSpeechOptions {
  roomCode: string;
  enabled: boolean;
  onFinalText: (text: string) => void;
}

export function useSpeech({ roomCode, enabled, onFinalText }: UseSpeechOptions) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [preview, setPreview] = useState("");
  const [supported, setSupported] = useState(true);
  const callbackRef = useRef(onFinalText);
  const runRef = useRef<ActiveRun | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    callbackRef.current = onFinalText;
  }, [onFinalText]);

  const abort = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.active = false;
    runRef.current = null;
    try {
      run.recognition.abort();
    } catch {
      // The recognition service may already have ended.
    }
    setPreview("");
    setStatus("idle");
  }, []);

  const start = useCallback(() => {
    if (!enabled || runRef.current) return;
    if (typeof window === "undefined") return;
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      setStatus("unsupported");
      return;
    }

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      setStatus("error");
      return;
    }

    const run: ActiveRun = {
      id: `${roomCode}:${++sequenceRef.current}`,
      recognition,
      seen: new Set(),
      active: true,
      gotFinal: false,
      failure: null,
    };
    runRef.current = run;
    setStatus("requesting");
    setPreview("");

    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      if (runRef.current === run && run.active) setStatus("listening");
    };
    recognition.onresult = (event) => {
      if (runRef.current !== run || !run.active) return;
      const results = event.results;
      const finals = collectFinalSpeechResults(run.id, results, run.seen);
      for (const finalText of finals) {
        run.gotFinal = true;
        callbackRef.current(finalText);
      }

      const interim: string[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result && !result.isFinal) {
          const text = result[0]?.transcript.trim();
          if (text) interim.push(text);
        }
      }
      setPreview(interim.join(" "));
    };
    recognition.onerror = (event) => {
      if (runRef.current !== run || !run.active) return;
      run.failure = getSpeechErrorStatus(event.error);
      run.active = false;
      setPreview("");
      setStatus(run.failure);
    };
    recognition.onend = () => {
      if (runRef.current !== run) return;
      runRef.current = null;
      setPreview("");
      if (run.active) {
        setStatus(run.gotFinal ? "final" : "idle");
      } else if (!run.failure) {
        setStatus("idle");
      }
    };

    try {
      recognition.start();
    } catch {
      run.active = false;
      runRef.current = null;
      setStatus("error");
    }
  }, [enabled, roomCode]);

  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run || !run.active) return;
    setStatus("stopping");
    try {
      run.recognition.stop();
    } catch {
      run.active = false;
      runRef.current = null;
      setStatus(run.gotFinal ? "final" : "error");
    }
  }, []);

  useEffect(() => {
    if (!enabled) abort();
    return () => abort();
  }, [abort, enabled, roomCode]);

  const capturing = runRef.current !== null;
  return { status, preview, supported, capturing, start, stop, abort };
}
