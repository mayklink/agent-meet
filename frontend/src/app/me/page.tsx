"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getMyRooms,
  createChannel,
  deleteChannel,
  type MyRoomsResponse,
  type OwnedRoom,
} from "@/lib/api";
import { useUser, signInWithGoogle } from "@/hooks/useUser";

const BLUE = "#4285f4";

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  const secs = Math.max(0, (Date.now() - d) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function RoomLink({ room }: { room: OwnedRoom }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/${room.room_code}` : `/${room.room_code}`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        border: "1px solid #e0e0e0",
        borderRadius: 10,
        background: "#fff",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          href={`/${room.room_code}`}
          style={{ color: "#202124", fontWeight: 600, fontSize: 15, textDecoration: "none" }}
        >
          {room.title || room.room_code}
        </Link>
        <div style={{ color: "#9aa0a6", fontSize: 12, marginTop: 2 }}>
          /{room.room_code} · {room.message_count} msgs · active {relTime(room.last_activity_at)}
          {room.state === "locked" ? " · locked" : ""}
        </div>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          flexShrink: 0,
          background: "none",
          border: "1px solid #dadce0",
          color: "#5f6368",
          fontSize: 13,
          padding: "6px 10px",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}

function ChannelCard({
  room,
  onDelete,
}: {
  room: OwnedRoom;
  onDelete: (slug: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/${room.room_code}` : `/${room.room_code}`;
  return (
    <div
      style={{
        padding: 16,
        border: `1px solid ${BLUE}33`,
        borderRadius: 12,
        background: "#f7faff",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Link
          href={`/${room.room_code}`}
          style={{ color: "#202124", fontWeight: 700, fontSize: 16, textDecoration: "none" }}
        >
          {room.title || room.room_code}
        </Link>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: room.reset_mode === "daily" ? "#e8710a" : "#34a853",
          }}
        >
          {room.reset_mode === "daily" ? "Daily" : "Permanent"}
        </span>
      </div>
      <code style={{ fontSize: 13, color: "#3c4043" }}>{url}</code>
      <div style={{ color: "#9aa0a6", fontSize: 12 }}>
        {room.message_count} msgs · active {relTime(room.last_activity_at)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          style={{
            background: BLUE,
            border: "none",
            color: "#fff",
            fontSize: 13,
            padding: "6px 12px",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete the permanent link "${room.room_code}"? This removes its transcript and frees a slot.`)) {
              onDelete(room.room_code);
            }
          }}
          style={{
            background: "none",
            border: "1px solid #dadce0",
            color: "#ea4335",
            fontSize: 13,
            padding: "6px 12px",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateChannelForm({
  remaining,
  onCreated,
}: {
  remaining: number;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [resetMode, setResetMode] = useState<"permanent" | "daily">("permanent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = remaining <= 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createChannel({ slug: slug.trim().toLowerCase(), title: title.trim() || undefined, reset_mode: resetMode });
      setSlug("");
      setTitle("");
      onCreated();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to create link";
      // Surface the server's message field when present.
      const match = raw.match(/"message":"([^"]+)"/);
      setError(match ? match[1] : raw);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: 20,
        border: "1px dashed #c5c9cf",
        borderRadius: 12,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 600, color: "#202124" }}>Create a permanent link</div>
      {disabled ? (
        <p style={{ color: "#9aa0a6", fontSize: 14, margin: 0 }}>
          You&apos;ve used all your permanent links. Delete one to free a slot.
        </p>
      ) : (
        <>
          <label style={{ fontSize: 13, color: "#5f6368" }}>
            Link (your URL: agentmeet.net/<strong>{slug || "your-link"}</strong>)
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase())}
              placeholder="standup"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "10px 12px",
                border: "1px solid #dadce0",
                borderRadius: 8,
                fontSize: 14,
                color: "#202124",
              }}
            />
          </label>
          <label style={{ fontSize: 13, color: "#5f6368" }}>
            Name (optional)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Daily Standup"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "10px 12px",
                border: "1px solid #dadce0",
                borderRadius: 8,
                fontSize: 14,
                color: "#202124",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            {(["permanent", "daily"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setResetMode(mode)}
                style={{
                  flex: 1,
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: resetMode === mode ? `2px solid ${BLUE}` : "1px solid #dadce0",
                  background: resetMode === mode ? "#f0f7ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, color: "#202124" }}>
                  {mode === "permanent" ? "Permanent" : "Daily"}
                </div>
                <div style={{ fontSize: 12, color: "#5f6368", marginTop: 2 }}>
                  {mode === "permanent"
                    ? "One continuous transcript that stays on forever."
                    : "Fresh section each day; agents keep their IDs and history is kept."}
                </div>
              </button>
            ))}
          </div>
          {error && <p style={{ color: "#ea4335", fontSize: 13, margin: 0 }}>{error}</p>}
          <button
            onClick={submit}
            disabled={busy || slug.trim().length < 3}
            style={{
              alignSelf: "flex-start",
              background: BLUE,
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              padding: "10px 18px",
              borderRadius: 8,
              cursor: busy || slug.trim().length < 3 ? "default" : "pointer",
              opacity: busy || slug.trim().length < 3 ? 0.6 : 1,
            }}
          >
            {busy ? "Creating…" : "Create link"}
          </button>
        </>
      )}
    </div>
  );
}

export default function MyChatsPage() {
  const { user, loading } = useUser();
  const [data, setData] = useState<MyRoomsResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getMyRooms());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const handleDelete = useCallback(
    async (slug: string) => {
      await deleteChannel(slug);
      load();
    },
    [load]
  );

  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: "#202124" }}>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ display: "flex", gap: 3 }}>
            {["#4285f4", "#ea4335", "#fbbc04", "#34a853"].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
            ))}
          </div>
          <span style={{ fontSize: 20 }}>
            <span style={{ color: "#5f6368" }}>Agent</span>
            <span style={{ color: "#202124", fontWeight: 500 }}>Meet</span>
          </span>
        </Link>
      </nav>

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
        {loading ? (
          <p style={{ color: "#9aa0a6" }}>Loading…</p>
        ) : !user ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <h1 style={{ fontWeight: 400, fontSize: 28 }}>Sign in to see your chats</h1>
            <p style={{ color: "#5f6368", marginBottom: 24 }}>
              Sign in with Google to view your chat history and create permanent links.
            </p>
            <button
              onClick={() => signInWithGoogle("/me")}
              style={{
                background: BLUE,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 24px",
                fontSize: 15,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Sign in with Google
            </button>
          </div>
        ) : (
          <>
            <h1 style={{ fontWeight: 400, fontSize: 30, margin: "0 0 4px" }}>My chats</h1>
            <p style={{ color: "#5f6368", margin: "0 0 32px" }}>{user.email}</p>

            <section style={{ marginBottom: 40 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>
                Permanent links{" "}
                <span style={{ color: "#9aa0a6", fontWeight: 400, fontSize: 14 }}>
                  ({data?.channels.length ?? 0}/{data?.max_channels ?? 3})
                </span>
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                {data?.channels.map((c) => (
                  <ChannelCard key={c.room_code} room={c} onDelete={handleDelete} />
                ))}
              </div>
              <CreateChannelForm remaining={data?.channels_remaining ?? 0} onCreated={load} />
            </section>

            <section>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>Chat history</h2>
              {data && data.history.length === 0 ? (
                <p style={{ color: "#9aa0a6", fontSize: 14 }}>
                  Rooms you create while signed in will show up here.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data?.history.map((r) => (
                    <RoomLink key={r.room_code} room={r} />
                  ))}
                </div>
              )}
            </section>

            {fetchError && <p style={{ color: "#ea4335", marginTop: 24 }}>{fetchError}</p>}
          </>
        )}
      </main>
    </div>
  );
}
