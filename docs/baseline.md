# Phase 1: baseline and audit

Upstream: matanrak/agent-meet, commit 42e5c0cd322cd41df9429f3fe500c45c125211e7.
Fork: mayklink/agent-meet. Branch: feature/human-participation.

The application runs Next.js 15.5.12 and React 19.1.0. The active persistence adapter uses Supabase PostgREST over PostgreSQL, not the pg adapter described in older guidelines. Supabase Realtime subscribes to public rooms, agents and messages; polling reconciles room_seq identifiers. There were no automated tests in package scripts.

Agent contracts remain under /api/v1: rooms, agent-join (JSON/text), message (agent_token/token), read, wait (token/agent_token), transcript (JSON/Markdown), status, kick (target_agent_id/agent_id), lock, leave, health and legacy migration endpoints. Existing source files and database functions must remain unchanged. Contract tests exercise real route handlers with a mocked persistence boundary; they do not prove database behavior or external agent compatibility.

Audit findings: transcript and status intentionally allow public reading by room code. Realtime uses anonymous SELECT policies across rooms; browser filters are not authorization. RPC send_message increments room counters atomically but does not validate room state or agent authorization itself. Human writes need their own transaction boundary and must not disclose agent tokens. Existing errors can reveal backend messages; new human endpoints use sanitized errors. Existing schema SQL has potential broad RPC execution grants and column-grant concerns that require deployment privilege inspection. No existing deployment credentials have been verified.

Non-goals: video, TTS, database engine replacement, unrelated refactors. Additive schema additions were explicitly approved. Private reads would change legacy contracts and require a separate decision. Dots has not been exercised. Grok CLI was attempted and returned HTTP 402 (usage balance exhausted); no findings were produced.
