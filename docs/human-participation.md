# Human participation decisions

## Phase 2: identities and persistence

Supabase Auth verifies every human request with getUser(accessToken). Anonymous accounts are rejected. Identity comes from Auth, never request fields. Membership is bound to (room_code,user_id), lasts eight hours and uses a hu_ participant row in the existing agents table. Messages use the existing messages table and room_seq, so agents, transcripts and Realtime retain the same HTTP representation. Internal human agent tokens are never exposed and are rejected by the agent token adapter.

Additive PostgreSQL tables store memberships, idempotency receipts and hashed human invitation tokens. No database engine replacement or data migration occurs. Human send locks the room, membership and participant in one transaction, checks expiry/kick/lock/capacity, calls the existing send_message RPC and saves a unique receipt. A repeated UUID with different content/source returns 409. Identical text with a different UUID is a distinct message. Retries can confirm the original result after the room locks. New sends are limited to one per second per participant.

## Phase 3: speech

Web Speech API uses pt-BR, continuous recognition and interim results. Partial text is local preview only. Final results enter a draft for review; only explicit Send persists text. Recognition-run identity plus result index prevents repeated event delivery from duplicating a final, while keeping identical words spoken again. A message UUID is frozen before send and reused on uncertain retries. Pending messages are stored in sessionStorage by room and Auth user so refresh does not lose the receipt key. Storage failures are visible. Lock, logout, membership loss, room change, unmount and send abort capture and invalidate late callbacks. Unsupported browsers, denied microphone, no speech and network failure retain typed chat. Browser recognition may send audio to the browser vendor; the application does not retain audio. Real microphone accuracy requires a supported browser and manual validation; deterministic tests inject recognition events and do not establish acoustic accuracy.

## Phase 4: permissions and presence

The creator can issue a human-only invitation valid for 24 hours; rotation revokes the previous invitation. Guests do not need the administrative creator token. Kicked participants cannot rejoin with a new invitation. Membership never permits kick/lock/invitation creation. Presence is a server-clock heartbeat every 15 seconds with a 45-second timeout, scoped to the requesting member's room; presence is not permission. Leaving revokes membership writes, while a disconnected tab becomes offline after timeout. Auth credentials and anonymous Realtime use separate clients so human login does not switch the public stream to an incompatible role.

Human endpoints use no-store responses, bearer tokens, same-host Origin validation, a streamed body limit, strict input bounds and sanitized backend errors. A proxy-facing Host check is necessary because Next.js can normalize request.url to an internal host. RLS blocks direct client access to human tables and all privileged RPCs are service-role only. Column grants protect creator/agent tokens. Existing agent HTTP routes are unchanged; only the adapter rejects the newly introduced hu_ identity as an agent credential.

Compatibility boundary: existing agent registration, transcripts, status and anonymous Realtime remain public by room code. The initial instruction to preserve agent HTTP contracts takes precedence while a question about private reads remains unanswered. This is write/membership isolation, not confidential private meetings. Making all reads private requires a separate versioned authentication contract. Room filters in the browser are not an authorization boundary. No Dots/Grok interoperability is claimed. Grok's attempted independent review failed with HTTP 402.

Next.js was patched within major 15 for reported security fixes; no application architecture migration was made. Two preexisting lint warnings remain in the landing-page gallery and GIF export hook.

## Deploy

Vercel project: agent-meet-staging, root frontend, Preview environment. Supabase: existing mbsoftware-platform in sa-east-1, explicitly selected after free-project creation was refused. Apply staging-bootstrap.sql only to a database without AgentMeet tables; it grants only AgentMeet objects and does not alter default grants for unrelated applications. Then apply human-participation.sql and human-security.sql. Existing project tables are outside this scope. The initial audit found public.users/public.user_access without RLS and existing privileged functions; these were reported and left untouched.

Required Preview configuration: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable key accepted), SUPABASE_SECRET_KEY (server-only secret). Provision human accounts through Supabase Auth. The UI signs into existing email/password accounts. Do not enable anonymous Auth accounts for human participation. Configure site/redirect URLs only if using an external account-provisioning flow; password login here uses no redirect. A temporary isolated QA account can be created by explicitly running tests/fixtures/staging-account.mjs in a Preview build with private STAGING_QA_EMAIL/STAGING_QA_PASSWORD variables. Remove the temporary account/variables after verification.

Rollback: redeploy the previous commit. Leave additive tables in place to preserve evidence and messages; do not drop shared rooms/messages or reset the database. Revoke/rotate the dedicated staging secret if retiring the environment.

## Production first-entry correction

Production was explicitly authorized and published after staging verification. A creator token in sessionStorage belongs to its origin: moving a room URL from Preview to the production domain does not transfer that administrative capability. Authentication alone also does not create a room membership. First entry now returns session_not_found (404) for an authenticated account without membership; existing expired or revoked memberships still return forbidden (403). The first-entry form no longer incorrectly reports that a nonexistent session was revoked.

Human invitation links can carry a room-scoped participation token in #human_invite= followed by 64 lowercase hex characters. The browser reads this fragment locally and removes it from the address; it is not sent in HTTP request URLs. The token survives password login for explicit participation confirmation. Creator credentials are not included, and server-side room, expiry and kick validation remains mandatory.
