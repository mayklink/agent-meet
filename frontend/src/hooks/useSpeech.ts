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
  failure: SpeechStatus | null;
}

interface UseSpeechOptions {
  roomCode: string;
  enabled: boolean;
  onFinalText: (text: string) => void;
}

const SILENCE_DELAY_MS = 1200;
const RESTART_DELAY_MS = 200;

export function useSpeech({ roomCode, enabled, onFinalText }: UseSpeechOptions) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [preview, setPreview] = useState("");
  const [supported, setSupported] = useState(true);
  const [handsfree, setHandsfree] = useState(false);
  const callbackRef = useRef(onFinalText);
  const enabledRef = useRef(enabled);
  const handsfreeRef = useRef(false);
  const pausedRef = useRef(false);
  const runRef = useRef<ActiveRun | null>(null);
  const sequenceRef = useRef(0);
  const finalTextRef = useRef<string[]>([]);
  const silenceTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const scheduleSilenceRef = useRef<() => void>(() => undefined);
  const startRecognitionRef = useRef<() => void>(() => undefined);

  callbackRef.current = onFinalText;
  enabledRef.current = enabled;

  const clearTimer = (timer: { current: number | null }) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const stopCurrentRun = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.active = false;
    runRef.current = null;
    try {
      run.recognition.abort();
    } catch {
      // The browser recognition service may already have ended.
    }
  }, []);

  const mute = useCallback(() => {
    handsfreeRef.current = false;
    pausedRef.current = false;
    setHandsfree(false);
    clearTimer(silenceTimerRef);
    clearTimer(restartTimerRef);
    finalTextRef.current = [];
    setPreview("");
    stopCurrentRun();
    setStatus("muted");
  }, [stopCurrentRun]);

  const abort = useCallback(() => {
    handsfreeRef.current = false;
    pausedRef.current = false;
    setHandsfree(false);
    clearTimer(silenceTimerRef);
    clearTimer(restartTimerRef);
    finalTextRef.current = [];
    setPreview("");
    stopCurrentRun();
    setStatus("idle");
  }, [stopCurrentRun]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimer(silenceTimerRef);
    clearTimer(restartTimerRef);
    setPreview("");
    stopCurrentRun();
    setStatus("paused");
  }, [stopCurrentRun]);

  const flushFinals = useCallback(() => {
    if (!handsfreeRef.current || !enabledRef.current || pausedRef.current) return;
    const content = finalTextRef.current.join(" ").trim();
    finalTextRef.current = [];
    if (!content) return;

    pausedRef.current = true;
    clearTimer(restartTimerRef);
    setPreview("");
    stopCurrentRun();
    setStatus("sending");
    callbackRef.current(content);
  }, [stopCurrentRun]);

  scheduleSilenceRef.current = () => {
    clearTimer(silenceTimerRef);
    silenceTimerRef.current = window.setTimeout(flushFinals, SILENCE_DELAY_MS);
  };

  const startRecognition = useCallback(() => {
    if (!enabledRef.current || !handsfreeRef.current || pausedRef.current || runRef.current) return;
    if (typeof window === "undefined") return;

    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      handsfreeRef.current = false;
      setHandsfree(false);
      setSupported(false);
      setStatus("unsupported");
      return;
    }

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      handsfreeRef.current = false;
      setHandsfree(false);
      setStatus("error");
      return;
    }

    const run: ActiveRun = {
      id: `${roomCode}:${++sequenceRef.current}`,
      recognition,
      seen: new Set(),
      active: true,
      failure: null,
    };
    runRef.current = run;
    setStatus("requesting");

    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      if (runRef.current === run && run.active) setStatus("listening");
    };
    recognition.onresult = (event) => {
      if (runRef.current !== run || !run.active) return;
      const finals = collectFinalSpeechResults(run.id, event.results, run.seen);
      if (finals.length) finalTextRef.current.push(...finals);

      const interim: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result && !result.isFinal) {
          const text = result[0]?.transcript.trim();
          if (text) interim.push(text);
        }
      }
      setPreview(interim.join(" "));

      // Partials move the silence boundary, but only deduplicated finals are
      // ever buffered for persistence or sending.
      if (finalTextRef.current.length) scheduleSilenceRef.current();
    };
    recognition.onerror = (event) => {
      if (runRef.current !== run || !run.active) return;
      run.failure = getSpeechErrorStatus(event.error);
      setPreview("");
      setStatus(run.failure);
      if (run.failure !== "no-speech") {
        handsfreeRef.current = false;
        pausedRef.current = false;
        setHandsfree(false);
        clearTimer(silenceTimerRef);
        finalTextRef.current = [];
      }
    };
    recognition.onend = () => {
      if (runRef.current !== run) return;
      runRef.current = null;
      setPreview("");
      if (run.failure && run.failure !== "no-speech") {
        setStatus(run.failure);
        return;
      }
      if (handsfreeRef.current && enabledRef.current && !pausedRef.current) {
        clearTimer(restartTimerRef);
        restartTimerRef.current = window.setTimeout(() => startRecognitionRef.current(), RESTART_DELAY_MS);
      } else if (!pausedRef.current) {
        setStatus("muted");
      }
    };

    try {
      recognition.start();
    } catch {
      run.active = false;
      runRef.current = null;
      handsfreeRef.current = false;
      setHandsfree(false);
      setStatus("error");
    }
  }, [roomCode]);

  startRecognitionRef.current = startRecognition;

  const start = useCallback(() => {
    if (!enabledRef.current || handsfreeRef.current) return;
    handsfreeRef.current = true;
    pausedRef.current = false;
    finalTextRef.current = [];
    setHandsfree(true);
    setPreview("");
    startRecognitionRef.current();
  }, []);

  const resume = useCallback(() => {
    if (!enabledRef.current || !handsfreeRef.current) return;
    pausedRef.current = false;
    startRecognitionRef.current();
    if (finalTextRef.current.length) scheduleSilenceRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) abort();
    return () => {
      clearTimer(silenceTimerRef);
      clearTimer(restartTimerRef);
      stopCurrentRun();
    };
  }, [abort, enabled, roomCode, stopCurrentRun]);

  const capturing = runRef.current !== null;
  return { status, preview, supported, handsfree, capturing, start, mute, pause, resume, abort };
}
