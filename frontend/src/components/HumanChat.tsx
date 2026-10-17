"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { humanAuthSupabase } from "@/lib/supabase";
import { useSpeech } from "@/hooks/useSpeech";
import { getSpeechStatusMessage } from "@/lib/speech";
import { getHumanPendingStorageKey, parseHumanPendingMessage, type HumanPendingMessage } from "@/lib/human-pending";
import {
  getHumanSession,
  getHumanPresence,
  heartbeatHumanPresence,
  joinHumanSession,
  leaveHumanSession,
  sendHumanMessage,
  createHumanInvite,
  HumanApiError,
  type HumanPresenceParticipant,
  type HumanSession,
} from "@/lib/human-api";

interface HumanChatProps {
  roomCode: string;
  creatorToken?: string | null;
  isLocked: boolean;
  onClose?: () => void;
}

const controlStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "10px 12px",
  color: "var(--room-text)",
  background: "var(--room-bg)",
  border: "1px solid var(--room-border)",
  borderRadius: 8,
  fontSize: 14,
};

export function HumanChat({ roomCode, creatorToken, isLocked, onClose }: HumanChatProps) {
  const [authLoading, setAuthLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [invitationToken, setInvitationToken] = useState("");
  const [session, setSession] = useState<HumanSession | null>(null);
  const [participants, setParticipants] = useState<HumanPresenceParticipant[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<HumanPendingMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<"chat" | "voice">("chat");
  const [pendingStorageWarning, setPendingStorageWarning] = useState(false);
  const [pendingStorageOwner, setPendingStorageOwner] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const previousUserId = useRef<string | null>(null);

  const pendingStorageKey = userId
    ? getHumanPendingStorageKey(roomCode, userId)
    : null;
  const pendingStorageReady = pendingStorageKey !== null && pendingStorageOwner === pendingStorageKey;
  const currentPending = pendingStorageReady ? pending : null;

  const appendVoiceText = (text: string) => {
    setDraft((current) => current.trim() ? `${current.trimEnd()} ${text}` : text);
    setDraftSource("voice");
  };
  const { abort: abortSpeech, ...speech } = useSpeech({
    roomCode,
    enabled: Boolean(accessToken && session && !isLocked && !currentPending && !busy),
    onFinalText: appendVoiceText,
  });

  useEffect(() => {
    if (!pendingStorageKey) {
      return;
    }
    setPendingStorageWarning(false);
    setPendingStorageOwner(null);
    try {
      setPending(parseHumanPendingMessage(sessionStorage.getItem(pendingStorageKey)));
    } catch {
      setPending(null);
    }
    setPendingStorageOwner(pendingStorageKey);
  }, [pendingStorageKey]);

  useEffect(() => {
    if (!pendingStorageKey || pendingStorageOwner !== pendingStorageKey) return;
    try {
      if (pending) sessionStorage.setItem(pendingStorageKey, JSON.stringify(pending));
      else sessionStorage.removeItem(pendingStorageKey);
    } catch {
      setPendingStorageWarning(Boolean(pending));
      return;
    }
    setPendingStorageWarning(false);
  }, [pending, pendingStorageKey, pendingStorageOwner]);

  useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    setDraft("");
    setDraftSource("chat");
    setDisplayName("");
    setInvitationToken("");
    setInviteToken(null);
    setInviteExpiresAt(null);
  }, [userId]);

  useEffect(() => {
    let active = true;
    void humanAuthSupabase.auth.getSession()
      .then(({ data }) => {
        if (active) {
          setAccessToken(data.session?.access_token ?? null);
          setUserId(data.session?.user.id ?? null);
          setAuthLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setAccessToken(null);
          setUserId(null);
          setAuthLoading(false);
          setError("Não foi possível recuperar sua sessão. Entre novamente para continuar.");
        }
      });

    const { data } = humanAuthSupabase.auth.onAuthStateChange((event, authSession) => {
      setAccessToken(authSession?.access_token ?? null);
      setUserId(authSession?.user.id ?? null);
      setAuthLoading(false);
      if (!authSession || event === "SIGNED_IN") {
        abortSpeech();
        setSession(null);
        setParticipants([]);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [abortSpeech]);

  useEffect(() => {
    if (!accessToken) {
      setSession(null);
      setParticipants([]);
      return;
    }
    let active = true;
    setError(null);
    void getHumanSession(roomCode, accessToken)
      .then((result) => {
        if (active) {
          setSession(result);
          setDisplayName(result.display_name);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          if (isHumanSessionDenied(cause)) abortSpeech();
          setSession(null);
          if (cause instanceof HumanApiError && cause.status === 403) {
            setError("Sua sessão não está mais autorizada nesta sala. Entre novamente com um convite válido.");
          }
        }
      });
    return () => {
      active = false;
    };
  }, [roomCode, accessToken, abortSpeech]);

  useEffect(() => {
    if (!accessToken || !session) return;
    let active = true;
    const refreshPresence = async () => {
      try {
        const result = await getHumanPresence(roomCode, accessToken);
        if (active) setParticipants(result.participants ?? []);
      } catch (cause: unknown) {
        if (!active) return;
        if (isHumanSessionDenied(cause)) {
          abortSpeech();
          setSession(null);
          setParticipants([]);
          setError("Sua sessão da sala expirou. Entre novamente para continuar.");
          return;
        }
        setError("Não foi possível atualizar a presença dos participantes.");
      }
    };
    const heartbeat = async () => {
      try {
        await heartbeatHumanPresence(roomCode, accessToken);
        await refreshPresence();
      } catch (cause: unknown) {
        if (!active) return;
        if (isHumanSessionDenied(cause)) {
          abortSpeech();
          setSession(null);
          setParticipants([]);
          setError("Sua sessão da sala expirou. Entre novamente para continuar.");
          return;
        }
        setError("Não foi possível atualizar sua presença na sala.");
      }
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [accessToken, roomCode, session, abortSpeech]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await humanAuthSupabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      setPassword("");
    } catch (cause) {
      setError(errorText(cause, "Não foi possível entrar. Confira seu e-mail e senha."));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await joinHumanSession(
        roomCode,
        accessToken,
        displayName.trim(),
        creatorToken || invitationToken.trim() || undefined
      );
      setSession(result);
      setDisplayName(result.display_name);
      setInvitationToken("");
    } catch (cause) {
      setError(errorText(cause, "Não foi possível entrar nesta sala. Verifique o convite e tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateInvite() {
    if (!accessToken || !creatorToken || isLocked || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setInviteCopied(false);
    setInviteToken(null);
    setInviteExpiresAt(null);
    try {
      const result = await createHumanInvite(roomCode, accessToken, creatorToken);
      setInviteToken(result.invite_token);
      setInviteExpiresAt(result.expires_at);
    } catch (cause) {
      setInviteError(errorText(cause, "Não foi possível gerar um convite para participantes humanos."));
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleCopyInvite() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteToken);
      setInviteCopied(true);
    } catch {
      setInviteError("Não foi possível copiar. Selecione e copie o convite exibido.");
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !session || isLocked || busy || !pendingStorageReady) return;
    // Invalidate recognition callbacks synchronously before freezing the draft
    // into a retryable request. Late browser events cannot change this payload.
    abortSpeech();
    const message = currentPending ?? {
      content: draft.trim(),
      clientMessageId: crypto.randomUUID(),
      source: draftSource,
    };
    if (!message.content) return;

    setPending(message);
    setPendingStorageOwner(pendingStorageKey);
    setBusy(true);
    setError(null);
    try {
      await sendHumanMessage(roomCode, accessToken, message.content, message.clientMessageId, message.source);
      setDraft("");
      setDraftSource("chat");
      setPending(null);
    } catch (cause) {
      // Retain the original id and body. Retrying after an uncertain network
      // result is safe because the API deduplicates client_message_id.
      setError(errorText(cause, "A mensagem pode não ter sido confirmada. Tente novamente."));
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const [leaveResult, signOutResult] = await Promise.allSettled([
        session ? leaveHumanSession(roomCode, accessToken) : Promise.resolve(),
        humanAuthSupabase.auth.signOut(),
      ]);
      if (signOutResult.status === "rejected") throw signOutResult.reason;
      if (signOutResult.value.error) throw signOutResult.value.error;
      setSession(null);
      setParticipants([]);
      setDraft("");
      setDraftSource("chat");
      if (leaveResult.status === "rejected") {
        setError("Sua conta foi desconectada, mas a saída da sala não foi confirmada pelo servidor.");
      }
    } catch (cause) {
      setError(errorText(cause, "Não foi possível sair da sala."));
    } finally {
      setBusy(false);
    }
  }

  const frameStyle = {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    minHeight: 0,
    color: "var(--room-text)",
    background: "var(--room-surface)",
  };

  return (
    <section aria-label="Chat de participantes" style={frameStyle}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--room-border)", flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Chat humano</h2>
          <p style={{ margin: "3px 0 0", color: "var(--room-text-muted)", fontSize: 12 }}>Mensagens compartilhadas com a sala</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {session && <span style={{ color: "var(--room-text-muted)", fontSize: 11 }}>{session.display_name}</span>}
          {onClose && <button type="button" onClick={onClose} aria-label="Fechar chat" style={iconButtonStyle}>×</button>}
        </div>
      </header>

      {error && <div role="alert" style={{ margin: "10px 12px 0", color: "#ffb4ab", background: "rgba(179,38,30,.14)", borderRadius: 7, padding: "8px 10px", fontSize: 12 }}>{error}</div>}

      {accessToken && creatorToken && (
        <aside aria-label="Convite para participantes humanos" style={{ margin: "10px 12px 0", padding: 10, borderRadius: 8, background: "var(--room-bg)", border: "1px solid var(--room-border)" }}>
          <strong style={{ display: "block", fontSize: 12 }}>Convite humano</strong>
          <p style={{ margin: "5px 0 8px", color: "var(--room-text-secondary)", fontSize: 11, lineHeight: 1.4 }}>Permite apenas participar desta sala; não concede controle de criador. Cada convite expira em 24 horas e gerar outro invalida o anterior.</p>
          <button type="button" onClick={() => void handleCreateInvite()} disabled={inviteBusy || isLocked} style={quietButtonStyle}>
            {inviteBusy ? "Gerando convite…" : "Gerar convite humano"}
          </button>
          {inviteToken && <div style={{ marginTop: 8 }}>
            <label htmlFor="human-generated-invite" style={labelStyle}>Convite para compartilhar</label>
            <input id="human-generated-invite" readOnly value={inviteToken} onFocus={(event) => event.currentTarget.select()} style={{ ...controlStyle, marginTop: 5, fontFamily: "var(--font-mono, monospace)", fontSize: 11 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 6 }}>
              <span style={{ color: "var(--room-text-muted)", fontSize: 10 }}>Expira: {formatExpiry(inviteExpiresAt)}</span>
              <button type="button" onClick={() => void handleCopyInvite()} style={quietButtonStyle}>{inviteCopied ? "Copiado" : "Copiar"}</button>
            </div>
          </div>}
          {inviteError && <p role="alert" style={{ margin: "7px 0 0", color: "#ffb4ab", fontSize: 11 }}>{inviteError}</p>}
        </aside>
      )}

      {authLoading ? (
        <p role="status" style={{ padding: 16, color: "var(--room-text-secondary)", fontSize: 13 }}>Verificando acesso…</p>
      ) : !accessToken ? (
        <form onSubmit={handleSignIn} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
          <p style={{ margin: "0 0 2px", color: "var(--room-text-secondary)", fontSize: 13 }}>Entre com sua conta para participar da conversa.</p>
          <label style={labelStyle}>E-mail
            <input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} style={controlStyle} />
          </label>
          <label style={labelStyle}>Senha
            <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} style={controlStyle} />
          </label>
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      ) : !session ? (
        <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
          <p style={{ margin: "0 0 2px", color: "var(--room-text-secondary)", fontSize: 13 }}>Escolha como seu nome aparecerá na sala.</p>
          <label style={labelStyle}>Nome para exibição
            <input autoComplete="nickname" required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} style={controlStyle} />
          </label>
          {!creatorToken && <label style={labelStyle}>Token de convite
            <input autoComplete="off" type="password" value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} style={controlStyle} aria-describedby="human-invite-help" />
            <span id="human-invite-help" style={{ color: "var(--room-text-muted)", fontSize: 11 }}>Use o token compartilhado pelo criador da sala.</span>
          </label>}
          <button type="submit" disabled={busy || !displayName.trim() || isLocked} style={primaryButtonStyle}>{isLocked ? "Sala encerrada" : busy ? "Entrando…" : "Participar"}</button>
          <button type="button" onClick={() => void handleLeave()} disabled={busy} style={quietButtonStyle}>{busy ? "Aguarde…" : "Sair da conta"}</button>
        </form>
      ) : (
        <>
          <div aria-live="polite" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600 }}>Participantes humanos</h3>
            {participants.length === 0 ? (
              <p style={{ color: "var(--room-text-muted)", fontSize: 12 }}>Nenhum participante listado.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {participants.map((participant) => <li key={participant.participant_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span aria-label={participant.online ? "online" : "offline"} style={{ width: 8, height: 8, borderRadius: "50%", background: participant.online ? "var(--room-green)" : "var(--room-text-muted)" }} />
                  {participant.display_name}
                </li>)}
              </ul>
            )}
          </div>
          <form onSubmit={handleSend} style={{ padding: 12, borderTop: "1px solid var(--room-border)", flexShrink: 0 }}>
            <label htmlFor="human-message" style={labelStyle}>Sua mensagem</label>
            <textarea id="human-message" value={currentPending?.content ?? draft} onChange={(event) => { setDraft(event.target.value); if (draftSource !== "voice") setDraftSource("chat"); }} disabled={Boolean(currentPending) || busy || isLocked || !pendingStorageReady} maxLength={4000} rows={3} style={{ ...controlStyle, resize: "vertical", marginTop: 6, fontFamily: "inherit" }} placeholder={isLocked ? "A sala foi encerrada" : "Escreva ou dite uma mensagem…"} />
            {speech.preview && <p aria-live="polite" style={{ margin: "7px 0 0", color: "var(--room-text-secondary)", fontSize: 12 }}><span style={{ color: "var(--room-text-muted)" }}>Prévia: </span>{speech.preview}</p>}
            {speech.status !== "idle" && <p role="status" aria-live="polite" style={{ margin: "7px 0 0", color: speech.status === "permission-denied" || speech.status === "error" || speech.status === "network" || speech.status === "no-speech" ? "#ffb4ab" : "var(--room-text-secondary)", fontSize: 11 }}>{getSpeechStatusMessage(speech.status)}</p>}
            <p style={{ margin: "7px 0 0", color: "var(--room-text-muted)", fontSize: 10 }}>O áudio não será salvo. O navegador pode enviar a fala a um serviço externo de reconhecimento.</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => void handleLeave()} disabled={busy} style={quietButtonStyle}>{busy ? "Aguarde…" : "Sair"}</button>
              <button type="button" onClick={speech.capturing ? speech.stop : speech.start} disabled={Boolean(currentPending) || busy || isLocked || speech.status === "stopping"} aria-label={speech.capturing ? "Parar transcrição" : "Iniciar transcrição de voz"} style={quietButtonStyle}>
                {speech.capturing ? (speech.status === "stopping" ? "Finalizando…" : "Parar voz") : "Falar"}
              </button>
              <button type="submit" disabled={busy || isLocked || !pendingStorageReady || speech.capturing || !(currentPending?.content ?? draft).trim()} style={primaryButtonStyle}>
                {currentPending ? (busy ? "Enviando…" : "Tentar novamente") : busy ? "Enviando…" : "Enviar"}
              </button>
            </div>
            {currentPending && <p role="status" style={{ margin: "7px 0 0", color: "var(--room-text-muted)", fontSize: 11 }}>A mensagem permanece salva para nova tentativa com o mesmo identificador.</p>}
            {pendingStorageWarning && <p role="alert" style={{ margin: "7px 0 0", color: "#ffb4ab", fontSize: 11 }}>O navegador não conseguiu guardar a nova tentativa. Mantenha este painel aberto até a confirmação.</p>}
          </form>
        </>
      )}
    </section>
  );
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isHumanSessionDenied(error: unknown): error is HumanApiError {
  return error instanceof HumanApiError && (error.status === 401 || error.status === 403);
}

function formatExpiry(value: string | null) {
  if (!value) return "em 24 horas";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "em 24 horas" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, color: "var(--room-text-secondary)", fontSize: 12, fontWeight: 500 };
const primaryButtonStyle = { border: 0, borderRadius: 7, padding: "9px 13px", background: "var(--room-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const quietButtonStyle = { border: "1px solid var(--room-border)", borderRadius: 7, padding: "8px 12px", background: "transparent", color: "var(--room-text-secondary)", fontSize: 12, cursor: "pointer" };
const iconButtonStyle = { border: 0, borderRadius: 20, width: 28, height: 28, background: "transparent", color: "var(--room-text-secondary)", fontSize: 22, lineHeight: 1, cursor: "pointer" };
