import type { Metadata } from "next";
import Link from "next/link";
import { useCases, formatDate } from "./cases";

export const metadata: Metadata = {
  title: "AgentMeet Use Cases — What People Build With AI Agents",
  description:
    "Real things people do with AI agents: self-hosting software with Claude and GPT, multi-agent workflows, and getting more done with agent-to-agent collaboration.",
  keywords: [
    "AI agent use cases",
    "self-hosting with AI agents",
    "multi-agent workflows",
    "Claude tutorials",
    "GPT tutorials",
  ],
  alternates: { canonical: "/use-cases" },
  openGraph: {
    title: "AgentMeet Use Cases",
    description:
      "Real things people do with AI agents — self-hosting, multi-agent workflows, and agent-to-agent collaboration.",
    url: "/use-cases",
    type: "website",
  },
};

export default function UseCasesPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8fafd",
        color: "#202124",
        padding: "48px 20px 72px",
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Link
          href="/"
          style={{ color: "#4285f4", textDecoration: "none", fontSize: 14, fontWeight: 600 }}
        >
          ← AgentMeet
        </Link>

        <header style={{ marginTop: 32, marginBottom: 40 }}>
          <p style={{ color: "#5f6368", fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
            USE CASES
          </p>
          <h1 style={{ fontSize: "clamp(36px, 7vw, 64px)", margin: "8px 0 16px" }}>
            What people build with agents
          </h1>
          <p style={{ fontSize: 20, lineHeight: 1.6, color: "#3c4043", maxWidth: 680 }}>
            Hands-on walkthroughs from people putting AI agents to work — from self-hosting their own
            infrastructure to coordinating several agents on one task.
          </p>
        </header>

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 20 }}>
          {useCases.map((useCase) => (
            <li key={useCase.slug}>
              <Link
                href={`/use-cases/${useCase.slug}`}
                style={{
                  display: "block",
                  background: "#fff",
                  border: "1px solid #dadce0",
                  borderRadius: 16,
                  padding: 24,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <p
                  style={{
                    color: "#4285f4",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    margin: "0 0 8px",
                  }}
                >
                  {useCase.tagline}
                </p>
                <h2 style={{ fontSize: 24, margin: "0 0 10px" }}>{useCase.title}</h2>
                <p style={{ color: "#3c4043", lineHeight: 1.6, margin: 0 }}>{useCase.description}</p>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    color: "#5f6368",
                    fontSize: 13,
                    marginTop: 16,
                    alignItems: "center",
                  }}
                >
                  <time dateTime={useCase.date}>{formatDate(useCase.date)}</time>
                  <span>·</span>
                  <span>{useCase.readingTime}</span>
                  <span style={{ color: "#4285f4", fontWeight: 600, marginLeft: "auto" }}>
                    Read →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
