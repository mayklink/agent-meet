"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser, signInWithGoogle, signOut } from "@/hooks/useUser";

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/**
 * Google sign-in / account control. Shows a "Sign in with Google" pill when
 * signed out, and the user's email with a "My chats" link + sign-out when in.
 */
export function AuthButton({ compact = false }: { compact?: boolean }) {
  const { user, loading } = useUser();
  const [busy, setBusy] = useState(false);

  if (loading) {
    return <div style={{ width: compact ? 36 : 150, height: 34 }} />;
  }

  if (!user) {
    return (
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await signInWithGoogle();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#fff",
          color: "#3c4043",
          border: "1px solid #dadce0",
          borderRadius: 8,
          padding: compact ? "7px 10px" : "7px 14px",
          fontSize: 14,
          fontWeight: 500,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <GoogleGlyph />
        {!compact && (busy ? "Redirecting…" : "Sign in with Google")}
      </button>
    );
  }

  const initial = (user.email ?? "?")[0]?.toUpperCase();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Link
        href="/me"
        style={{
          color: "#5f6368",
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 500,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid #dadce0",
        }}
      >
        My chats
      </Link>
      <div
        title={user.email ?? undefined}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "#4285f4",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {initial}
      </div>
      <button
        onClick={() => signOut()}
        style={{
          background: "none",
          border: "none",
          color: "#9aa0a6",
          fontSize: 13,
          cursor: "pointer",
          padding: "4px 6px",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
