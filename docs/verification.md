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

A separate staging key was created through the browser after explicit confirmation and saved as a sensitive Preview variable. Public values were configured only for development/preview. Production has not been deployed. Deployment/hosted smoke results will be recorded after the first Preview finishes.

Runtime npm audit after in-major Next.js security patching and PostCSS override has zero production vulnerabilities. Remaining development-only advisories are in the existing ESLint glob chain and do not justify an unrelated framework/toolchain downgrade.

No Dots integration was exercised. Grok's attempted review returned 402 and produced no analysis. Neither is claimed integrated.
