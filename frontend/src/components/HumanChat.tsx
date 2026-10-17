"use client";

import { useEffect, useState, type FormEvent } from "react";
import { humanAuthSupabase } from "@/lib/supabase";
import {
  getHumanSession,
  getHumanPresence,
  heartbeatHumanPresence,
  joinHumanSession,
  leaveHumanSession,
  sendHumanMessage,
  type HumanPresenceParticipant,
  type HumanSession,
} from "@/lib/human-api";

interface HumanChatProps {
  roomCode: string;
  creatorToken?: string | null;
  isLocked: boolean;
  onClose?: () => void;
}

interface PendingMessage {
  content: string;
  clientMessageId: string;
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [invitationToken, setInvitationToken] = useState("");
  const [session, setSession] = useState<HumanSession | null>(null);
  const [participants, setParticipants] = useState<HumanPresenceParticipant[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void humanAuthSupabase.auth.getSession().then(({ data }) => {
      if (active) {
        setAccessToken(data.session?.access_token ?? null);
        setAuthLoading(false);
      }
    });

    const { data } = humanAuthSupabase.auth.onAuthStateChange((_event, authSession) => {
      setAccessToken(authSession?.access_token ?? null);
      setAuthLoading(false);
      if (!authSession) {
        setSession(null);
        setParticipants([]);
        setPending(null);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

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
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, [roomCode, accessToken]);

  useEffect(() => {
    if (!accessToken || !session) return;
    let active = true;
    const refreshPresence = async () => {
      try {
        const result = await getHumanPresence(roomCode, accessToken);
        if (active) setParticipants(result.participants ?? []);
      } catch {
        if (active) setError("Não foi possível atualizar a presença dos participantes.");
      }
    };
    const heartbeat = async () => {
      try {
        await heartbeatHumanPresence(roomCode, accessToken);
        await refreshPresence();
      } catch {
        if (active) setError("Não foi possível atualizar sua presença na sala.");
      }
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [accessToken, roomCode, session]);

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

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !session || isLocked || busy) return;
    const message = pending ?? {
      content: draft.trim(),
      clientMessageId: crypto.randomUUID(),
    };
    if (!message.content) return;

    setPending(message);
    setBusy(true);
    setError(null);
    try {
      await sendHumanMessage(roomCode, accessToken, message.content, message.clientMessageId);
      setDraft("");
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
      if (session) await leaveHumanSession(roomCode, accessToken);
      const { error: signOutError } = await humanAuthSupabase.auth.signOut();
      if (signOutError) throw signOutError;
      setSession(null);
      setParticipants([]);
      setPending(null);
      setDraft("");
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
            <textarea id="human-message" value={pending?.content ?? draft} onChange={(event) => setDraft(event.target.value)} disabled={Boolean(pending) || busy || isLocked} maxLength={4000} rows={3} style={{ ...controlStyle, resize: "vertical", marginTop: 6, fontFamily: "inherit" }} placeholder={isLocked ? "A sala foi encerrada" : "Escreva uma mensagem…"} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => void handleLeave()} disabled={busy} style={quietButtonStyle}>{busy ? "Aguarde…" : "Sair"}</button>
              <button type="submit" disabled={busy || isLocked || !(pending?.content ?? draft).trim()} style={primaryButtonStyle}>
                {pending ? (busy ? "Enviando…" : "Tentar novamente") : busy ? "Enviando…" : "Enviar"}
              </button>
            </div>
            {pending && <p role="status" style={{ margin: "7px 0 0", color: "var(--room-text-muted)", fontSize: 11 }}>A mensagem permanece salva para nova tentativa com o mesmo identificador.</p>}
          </form>
        </>
      )}
    </section>
  );
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, color: "var(--room-text-secondary)", fontSize: 12, fontWeight: 500 };
const primaryButtonStyle = { border: 0, borderRadius: 7, padding: "9px 13px", background: "var(--room-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const quietButtonStyle = { border: "1px solid var(--room-border)", borderRadius: 7, padding: "8px 12px", background: "transparent", color: "var(--room-text-secondary)", fontSize: 12, cursor: "pointer" };
const iconButtonStyle = { border: 0, borderRadius: 20, width: 28, height: 28, background: "transparent", color: "var(--room-text-secondary)", fontSize: 22, lineHeight: 1, cursor: "pointer" };
