"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { humanAuthSupabase } from "@/lib/supabase";
import { useSpeech } from "@/hooks/useSpeech";
import { getSpeechStatusMessage } from "@/lib/speech";
import { getHumanAuthTransition } from "@/lib/human-auth-state";
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
  onInviteDetected?: () => void;
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

export function HumanChat({ roomCode, creatorToken, isLocked, onClose, onInviteDetected }: HumanChatProps) {
  const [authLoading, setAuthLoading] = useState(true);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [checkedRoomCode, setCheckedRoomCode] = useState<string | null>(null);
  const [sessionRefresh, setSessionRefresh] = useState(0);
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
  const [pendingStorageWarning, setPendingStorageWarning] = useState(false);
  const [pendingStorageOwner, setPendingStorageOwner] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const previousUserId = useRef<string | null>(null);
  const inviteRoom = useRef(roomCode);
  const authIdentityRef = useRef<{ userId: string | null; accessToken: string | null }>({ userId: null, accessToken: null });
  const authEventVersionRef = useRef(0);
  const sessionRequestVersionRef = useRef(0);
  const sessionRef = useRef<HumanSession | null>(null);
  const sessionRoomRef = useRef<string | null>(null);
  const pendingRef = useRef<HumanPendingMessage | null>(null);
  const busyRef = useRef(false);
  const joinBusyRef = useRef(false);
  const speechControlsRef = useRef<{ pause: () => void; resume: () => void }>({ pause: () => undefined, resume: () => undefined });
  const sendVoiceRef = useRef<(content: string) => void>(() => undefined);

  const updateSession = useCallback((nextSession: HumanSession | null) => {
    sessionRef.current = nextSession;
    sessionRoomRef.current = nextSession ? roomCode : null;
    setSession(nextSession);
  }, [roomCode]);

  const pendingStorageKey = userId
    ? getHumanPendingStorageKey(roomCode, userId)
    : null;
  const pendingStorageReady = pendingStorageKey !== null && pendingStorageOwner === pendingStorageKey;
  const currentPending = pendingStorageReady ? pending : null;
  const roomSession = sessionRoomRef.current === roomCode ? session : null;

  const speech = useSpeech({
    roomCode,
    enabled: Boolean(accessToken && roomSession && !isLocked),
    onFinalText: (content) => sendVoiceRef.current(content),
  });
  const abortSpeech = speech.abort;
  speechControlsRef.current = { pause: speech.pause, resume: speech.resume };

  useEffect(() => {
    if (inviteRoom.current !== roomCode) {
      inviteRoom.current = roomCode;
      setInvitationToken("");
    }
    const readInvitationFragment = () => {
      const inviteMatch = window.location.hash.match(/^#human_invite=([0-9a-f]{64})$/);
      if (!inviteMatch) return;
      setInvitationToken(inviteMatch[1]);
      onInviteDetected?.();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    };
    readInvitationFragment();
    window.addEventListener("hashchange", readInvitationFragment);
    return () => window.removeEventListener("hashchange", readInvitationFragment);
  }, [onInviteDetected, roomCode]);

  useEffect(() => {
    if (!pendingStorageKey) {
      return;
    }
    setPendingStorageWarning(false);
    setPendingStorageOwner(null);
    try {
      const restored = parseHumanPendingMessage(sessionStorage.getItem(pendingStorageKey));
      pendingRef.current = restored;
      setPending(restored);
    } catch {
      pendingRef.current = null;
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
    const previousId = previousUserId.current;
    previousUserId.current = userId;
    setDraft("");
    setDisplayName("");
    if (previousId && previousId !== userId) {
      // The room/user-scoped storage loader owns the new identity's retry.
      // Clearing here races that loader on direct account switches (A -> B)
      // and can delete B's unconfirmed message. Signing out still clears the
      // in-memory copy; the old account's storage remains scoped to that user.
      if (!userId) {
        pendingRef.current = null;
        setPending(null);
      }
    }
    // A fragment invitation must survive the expected anonymous-to-signed-in
    // transition. Clear it only when an already authenticated account changes.
    if (previousId && previousId !== userId) setInvitationToken("");
    setInviteToken(null);
    setInviteExpiresAt(null);
  }, [userId]);

  useEffect(() => {
    let active = true;
    const initialEventVersion = authEventVersionRef.current;
    void humanAuthSupabase.auth.getSession()
      .then(({ data }) => {
        if (!active || authEventVersionRef.current !== initialEventVersion) return;
        const nextAccessToken = data.session?.access_token ?? null;
        const nextUserId = data.session?.user.id ?? null;
        authIdentityRef.current = { accessToken: nextAccessToken, userId: nextUserId };
        setAccessToken(nextAccessToken);
        setUserId(nextUserId);
        setMembershipLoading(Boolean(nextAccessToken));
        setAuthLoading(false);
      })
      .catch(() => {
        if (!active || authEventVersionRef.current !== initialEventVersion) return;
        authIdentityRef.current = { accessToken: null, userId: null };
        setAccessToken(null);
        setUserId(null);
        setMembershipLoading(false);
        setAuthLoading(false);
        setError("Não foi possível recuperar sua sessão. Entre novamente para continuar.");
      });

    const { data } = humanAuthSupabase.auth.onAuthStateChange((event, authSession) => {
      authEventVersionRef.current += 1;
      const previousUserId = authIdentityRef.current.userId;
      const nextAccessToken = authSession?.access_token ?? null;
      const nextUserId = authSession?.user.id ?? null;
      const transition = getHumanAuthTransition(event, previousUserId, nextUserId);
      authIdentityRef.current = { accessToken: nextAccessToken, userId: nextUserId };
      setAccessToken(nextAccessToken);
      setUserId(nextUserId);
      setAuthLoading(false);
      if (transition === "signed-out" || transition === "identity-changed") {
        sessionRequestVersionRef.current += 1;
        abortSpeech();
        updateSession(null);
        setParticipants([]);
        setMembershipLoading(Boolean(nextAccessToken));
      } else if (transition === "refresh") {
        if (joinBusyRef.current) return;
        sessionRequestVersionRef.current += 1;
        setMembershipLoading(!sessionRef.current || sessionRoomRef.current !== roomCode);
        setSessionRefresh((current) => current + 1);
      }
    });

    const refreshOnFocus = () => {
      const identity = authIdentityRef.current;
      if (!identity.accessToken || !identity.userId || joinBusyRef.current) return;
      sessionRequestVersionRef.current += 1;
      setMembershipLoading(!sessionRef.current);
      setSessionRefresh((current) => current + 1);
    };
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      active = false;
      sessionRequestVersionRef.current += 1;
      window.removeEventListener("focus", refreshOnFocus);
      data.subscription.unsubscribe();
    };
  }, [abortSpeech, roomCode, updateSession]);

  useEffect(() => {
    if (!accessToken || !userId) {
      updateSession(null);
      setParticipants([]);
      setCheckedRoomCode(null);
      setMembershipLoading(false);
      return;
    }
    if (joinBusyRef.current) return;
    let active = true;
    const requestVersion = ++sessionRequestVersionRef.current;
    setCheckedRoomCode(roomCode);
    if (!sessionRef.current || sessionRoomRef.current !== roomCode) setMembershipLoading(true);
    setError(null);
    void getHumanSession(roomCode, accessToken)
      .then((result) => {
        if (active && requestVersion === sessionRequestVersionRef.current) {
          updateSession(result);
          setDisplayName(result.display_name);
        }
      })
      .catch((cause: unknown) => {
        if (active && requestVersion === sessionRequestVersionRef.current) {
          if (isHumanSessionDenied(cause)) abortSpeech();
          if (!sessionRef.current || sessionRoomRef.current !== roomCode || isHumanSessionDenied(cause) || (cause instanceof HumanApiError && cause.code === "session_not_found")) {
            updateSession(null);
          }
          if (!(cause instanceof HumanApiError && cause.code === "session_not_found")) {
            setError(errorText(cause, "Não foi possível verificar sua participação nesta sala."));
          }
        }
      })
      .finally(() => {
        if (active && requestVersion === sessionRequestVersionRef.current) setMembershipLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roomCode, accessToken, userId, sessionRefresh, abortSpeech, updateSession]);

  useEffect(() => {
    if (!accessToken || !roomSession) return;
    let active = true;
    const refreshPresence = async () => {
      try {
        const result = await getHumanPresence(roomCode, accessToken);
        if (active) setParticipants(result.participants ?? []);
      } catch (cause: unknown) {
        if (!active) return;
        if (isHumanSessionDenied(cause)) {
          abortSpeech();
          updateSession(null);
          setParticipants([]);
          setError("Sua sessão da sala expirou. Entre novamente para continuar.");
          return;
        }
        // A transient presence read failure does not revoke a valid session.
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
        updateSession(null);
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
  }, [accessToken, roomCode, roomSession, abortSpeech, updateSession]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await humanAuthSupabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      setPassword("");
    } catch (cause) {
      setError(errorText(cause, "Não foi possível entrar. Confira seu e-mail e senha."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    const requestVersion = ++sessionRequestVersionRef.current;
    joinBusyRef.current = true;
    busyRef.current = true;
    setMembershipLoading(true);
    setBusy(true);
    setError(null);
    try {
      const result = await joinHumanSession(
        roomCode,
        accessToken,
        displayName.trim(),
        creatorToken || invitationToken.trim() || undefined
      );
      if (requestVersion === sessionRequestVersionRef.current) {
        updateSession(result);
        setDisplayName(result.display_name);
        setInvitationToken("");
      }
    } catch (cause) {
      if (requestVersion === sessionRequestVersionRef.current) {
        setError(errorText(cause, "Não foi possível entrar nesta sala. Verifique o convite e tente novamente."));
      }
    } finally {
      busyRef.current = false;
      joinBusyRef.current = false;
      if (requestVersion === sessionRequestVersionRef.current) setMembershipLoading(false);
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

  async function dispatchHumanMessage(message: HumanPendingMessage, clearManualDraft: boolean) {
    if (!accessToken || !sessionRef.current || isLocked || busyRef.current || !pendingStorageReady || !pendingStorageKey) return false;
    if (!message.content.trim()) return false;

    if (message.source === "chat") speechControlsRef.current.pause();
    busyRef.current = true;
    pendingRef.current = message;
    setPending(message);
    setPendingStorageOwner(pendingStorageKey);
    try {
      // Persist the id and exact body before the request can become uncertain.
      sessionStorage.setItem(pendingStorageKey, JSON.stringify(message));
      setPendingStorageWarning(false);
    } catch {
      setPendingStorageWarning(true);
    }
    setBusy(true);
    setError(null);
    const sendingUserId = userId;
    try {
      await sendHumanMessage(roomCode, accessToken, message.content, message.clientMessageId, message.source);
      if (authIdentityRef.current.userId !== sendingUserId || pendingRef.current?.clientMessageId !== message.clientMessageId) return false;
      pendingRef.current = null;
      setPending(null);
      try {
        sessionStorage.removeItem(pendingStorageKey);
      } catch {
        setPendingStorageWarning(true);
      }
      if (clearManualDraft && message.source === "chat") setDraft("");
      speechControlsRef.current.resume();
      return true;
    } catch (cause) {
      // Keep the same payload and UUID for an explicit, idempotent retry.
      if (authIdentityRef.current.userId === sendingUserId && pendingRef.current?.clientMessageId === message.clientMessageId) {
        setError(errorText(cause, "A mensagem pode não ter sido confirmada. Tente novamente."));
        if (isHumanSessionDenied(cause)) {
          abortSpeech();
          updateSession(null);
          setParticipants([]);
        }
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const message = currentPending ?? {
      content: draft.trim(),
      clientMessageId: crypto.randomUUID(),
      source: "chat" as const,
    };
    await dispatchHumanMessage(message, true);
  }

  sendVoiceRef.current = (content) => {
    if (!content.trim() || busyRef.current || pendingRef.current) return;
    void dispatchHumanMessage({ content: content.trim(), clientMessageId: crypto.randomUUID(), source: "voice" }, false);
  };

  async function handleLeave() {
    if (!accessToken) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const [leaveResult, signOutResult] = await Promise.allSettled([
      roomSession ? leaveHumanSession(roomCode, accessToken) : Promise.resolve(),
        humanAuthSupabase.auth.signOut(),
      ]);
      if (signOutResult.status === "rejected") throw signOutResult.reason;
      if (signOutResult.value.error) throw signOutResult.value.error;
      updateSession(null);
      setParticipants([]);
      setDraft("");
      if (leaveResult.status === "rejected") {
        setError("Sua conta foi desconectada, mas a saída da sala não foi confirmada pelo servidor.");
      }
    } catch (cause) {
      setError(errorText(cause, "Não foi possível sair da sala."));
    } finally {
      busyRef.current = false;
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
  const microphoneLabel = speech.handsfree
    ? "Mutar microfone"
    : speech.status === "muted" ? "Desmutar microfone" : "Ativar microfone";

  return (
    <section aria-label="Chat de participantes" style={frameStyle}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--room-border)", flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Chat humano</h2>
          <p style={{ margin: "3px 0 0", color: "var(--room-text-muted)", fontSize: 12 }}>Mensagens compartilhadas com a sala</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {roomSession && <span style={{ color: "var(--room-text-muted)", fontSize: 11 }}>{roomSession.display_name}</span>}
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
      ) : !roomSession && (membershipLoading || checkedRoomCode !== roomCode) ? (
        <p role="status" style={{ padding: 16, color: "var(--room-text-secondary)", fontSize: 13 }}>Verificando sua participação na sala…</p>
      ) : !roomSession ? (
        <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
          <p style={{ margin: "0 0 2px", color: "var(--room-text-secondary)", fontSize: 13 }}>Escolha seu nome e informe o convite para participar.</p>
          <label style={labelStyle}>Nome para exibição
            <input autoComplete="nickname" required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} style={controlStyle} />
          </label>
          {!creatorToken && <label style={labelStyle}>Token de convite
            <input autoComplete="off" type="password" value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} style={controlStyle} aria-describedby="human-invite-help" />
            <span id="human-invite-help" style={{ color: "var(--room-text-muted)", fontSize: 11 }}>Cole o convite humano compartilhado para esta sala.</span>
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
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 6 }}>
              <textarea id="human-message" name="message" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={Boolean(currentPending) || busy || isLocked || !pendingStorageReady} maxLength={4000} rows={3} style={{ ...controlStyle, flex: 1, minWidth: 0, resize: "vertical", fontFamily: "inherit" }} placeholder={isLocked ? "A sala foi encerrada" : "Escreva sua mensagem…"} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={speech.handsfree ? speech.mute : speech.start}
                  disabled={isLocked || !pendingStorageReady || (!speech.handsfree && (busy || Boolean(currentPending)))}
                  aria-pressed={speech.handsfree}
                  aria-label={microphoneLabel}
                  title={microphoneLabel}
                  style={{ ...quietButtonStyle, width: 44, height: 44, minWidth: 44, padding: 0, display: "grid", placeItems: "center", background: speech.handsfree ? "rgba(60, 179, 113, .16)" : "transparent", borderColor: speech.handsfree ? "var(--room-green)" : "var(--room-border)", color: speech.handsfree ? "var(--room-green)" : "var(--room-text-secondary)" }}
                >
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
                    {!speech.handsfree && <path d="m4 4 16 16" />}
                  </svg>
                </button>
                <button type="submit" disabled={busy || isLocked || !pendingStorageReady || (!currentPending && !draft.trim())} style={{ ...primaryButtonStyle, minWidth: 72, paddingInline: 10 }}>
                  {currentPending ? (busy ? "Enviando…" : "Tentar novamente") : busy ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </div>
            <p role="status" aria-live="polite" style={{ margin: "7px 0 0", color: speech.status === "permission-denied" || speech.status === "error" || speech.status === "network" || speech.status === "no-speech" ? "#ffb4ab" : "var(--room-text-secondary)", fontSize: 11 }}>
              {busy ? "Enviando" : currentPending && speech.handsfree ? "Envio pendente · microfone pausado" : speech.handsfree ? "Ouvindo" : "Microfone mutado"}
              {speech.status !== "idle" && speech.status !== "listening" ? ` · ${getSpeechStatusMessage(speech.status)}` : ""}
            </p>
            {speech.preview && <p aria-live="polite" style={{ margin: "6px 0 0", color: "var(--room-text-muted)", fontSize: 11 }}><span>Prévia, ainda não enviada: </span>{speech.preview}</p>}
            <p style={{ margin: "5px 0 0", color: "var(--room-text-muted)", fontSize: 10 }}>O áudio não será salvo. O navegador pode enviar a fala a um serviço externo de reconhecimento.</p>
            {currentPending && <p role="status" style={{ margin: "7px 0 0", color: "var(--room-text-muted)", fontSize: 11, overflowWrap: "anywhere" }}>A mensagem “{currentPending.content}” não teve confirmação. A nova tentativa usa o mesmo identificador.</p>}
            <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 7 }}>
              <button type="button" onClick={() => void handleLeave()} disabled={busy} style={quietButtonStyle}>{busy ? "Aguarde…" : "Sair"}</button>
            </div>
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
