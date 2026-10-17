# Verification evidence

## Local baseline and final verification

Baseline: 42e5c0cd322cd41df9429f3fe500c45c125211e7. The /api/v1 route sources remain unchanged. Phase commits are visible on feature/human-participation.

- npm test: 47 passing tests across agent route contracts, Auth/HTTP boundaries, PostgreSQL/PGlite transactions, speech final deduplication and account/room pending-message isolation.
- npm run lint: no errors; two preexisting warnings (unused landing gallery, GIF hook dependency).
- TypeScript and Next.js 15 production build: passed.
- Playwright: four passing E2E scenarios on real Chromium, production Next.js HTTP routes and PGlite-backed PostgreSQL functions. Scenario coverage: agent join/send/read receipts/leave and unauthenticated human rejection; human login/chat and response-loss retry across reload with one persisted message; pt-BR partial/final events and identical repeated utterances; mobile microphone refusal, typed fallback and locked-room denial.

The local E2E fixture emulates Supabase Auth and PostgREST only. It executes actual PostgreSQL functions but does not provide Supabase Realtime. Recognition is injected deterministically, not real acoustic input. These tests must not be described as hosted Auth/Realtime or real microphone proof.

## Reproduce

From frontend: npm ci, npm test, npm run lint. For local E2E, set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329, NEXT_PUBLIC_SUPABASE_ANON_KEY=local-e2e-anon-key and SUPABASE_SECRET_KEY=local-e2e-service-key before npm run build; then npx playwright install chromium and npm run test:e2e. The fixture binds loopback only and is not an application route. CI performs the same sequence. PLAYWRIGHT_ARTIFACT_DIR and PLAYWRIGHT_WORK_DIR optionally control artifact locations.

## Hosted verification

Dedicated Vercel project agent-meet-staging uses existing Supabase mbsoftware-platform after account free-project limits blocked a dedicated database project. Additive AgentMeet schema and restricted permissions were applied successfully. SQL privilege inspection confirmed anonymous human RPC=false, legacy privileged RPC=false, creator token SELECT=false and agent token SELECT=false. No unrelated application table privileges were changed.

A separate staging key was created through the browser after explicit confirmation and saved as a sensitive Preview variable. Public values were configured only for development/preview. Connecting Git caused an automatic deployment labeled Production on the newly created staging project; the user explicitly chose to retain it. It has no production database credentials configured. A project-level ignored-build guard now blocks future Production builds. No existing production application was changed.

Preview deployment dpl_Fr1N7sWYpePFPLJFExo69WrZSPfT is READY at https://agent-meet-staging-1ncg8a563-mayklinks-projects.vercel.app and runs application commit 84afc82c6b9d2b7f60ff12afb49b8049f1a77627. GitHub Actions run 39074462100 completed successfully: https://github.com/mayklink/agent-meet/actions/runs/39074462100.

Hosted smoke passed 19 checks using Chromium, real Supabase Auth, PostgreSQL/PostgREST and Supabase Realtime: deployed health; room creation; agent registration; email/password login with an isolated QA account; authenticated membership; human message persistence; agent reading that human message with receipts; cross-room write denial; cross-Origin denial behind the hosting proxy; presence; no anonymous creator-token access; no anonymous privileged RPC; Realtime subscription; agent message write; Realtime delivery; browser transcript reconciliation; human-only invitation generation; creator kick via existing HTTP contract; immediate write denial after kick. An additional real Realtime probe confirmed rooms and agents event payloads omit creator_token and agent_token. The proof records field names only, never credential values.

An initial smoke attempt encountered an HTML authentication page after the temporary access link had been created before deployment was ready. A fresh supported Vercel share link and completed navigation resolved access; the subsequent full run passed. Deployment protection remains enabled.

Cleanup was verified by SQL: all three temporary QA rooms, the isolated Auth account and its automatically created profile are absent. QA environment values were cleared, and the private local QA credential file was removed. The credential-column Realtime probe was also removed. No unrelated accounts or application rows were removed. Server-side staging credentials remain stored exclusively as a Preview secret.

Runtime npm audit after in-major Next.js security patching and PostCSS override has zero production vulnerabilities. Remaining development-only advisories are in the existing ESLint glob chain and do not justify an unrelated framework/toolchain downgrade.

The project security advisor still reports preexisting public.users and public.user_access without RLS, plus preexisting function and Auth configuration warnings. These are unrelated to AgentMeet and were not silently changed. The three human tables have intentional deny-all client RLS and use server-only RPC access; the advisor's no-policy information notices are expected.

No Dots integration was exercised. Grok's attempted review returned 402 and produced no analysis. Neither is claimed integrated.
