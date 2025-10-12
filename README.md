# Draftly Server (Backend)

AI‑powered email assistant backend for generating smart, personalized email replies and drafts. It connects to Gmail, learns your writing style from a short questionnaire plus samples, synthesizes a “writeprint” persona, and drafts replies using Google Vertex AI Gemini models.

This document explains the architecture, how it works end‑to‑end, how AI is used, and how to run, configure, and troubleshoot the system.

## Overview

Draftly is a two‑part app:
- Frontend (Next.js) in `../frontend/` for onboarding, questionnaire, and inbox UI.
- This backend (Fastify + TypeScript) for auth, Gmail sync, AI integration, caching, and persistence.

Key capabilities:
- Gmail integration: pull threads, upsert messages, send replies.
- Persona generation: A PROSE‑inspired pipeline to synthesize a style profile from your answers and sample writing.
- Draft generation: Compose replies aligned with your personal style and preferences (greeting, sign‑off, tone, etc.).
- Reliability: Intelligent retries, rate limiting, and prompt trimming to avoid API throttling (HTTP 429).

## Architecture

Main components in `src/`:
- `server.ts` + `app.ts`: Fastify server bootstrap and plugin wiring.
- `controllers/`: HTTP handlers (onboarding, auth, emails).
- `routes/`: Route definitions mapping to controllers.
- `services/`: Business logic orchestration (EmailService, AuthService, UserService).
- `repositories/`: Data access (Prisma for MongoDB), thread and user persistence.
- `integrations/`:
   - `GmailIntegration.ts`: Gmail OAuth, message fetch, send/reply.
   - `VertexAIIntegration.ts`: Vertex AI wrapper for simple style/draft calls.
- `lib/`:
   - `vertexai.ts`: Advanced PROSE pipeline, JSON‑schema enforced profile generation, draft generation helpers.
   - `aiRateLimiter.ts`: Global limiter to smooth out bursts across AI calls.
   - `cache.ts`: Simple cache helpers (e.g., suggested replies via Redis or in‑memory strategy).
   - `prisma.ts`: Prisma client bootstrap.
- `middleware/`: Auth middleware (Firebase) and presence tracking.
- `types/`: App types (User, Thread, Email, AIStyleProfile, EmailGenerationContext).
- `utils/`: Helpers (encryption, Gmail parsing, name/company extraction from signatures, etc.).

Backing services:
- MongoDB (via Prisma) for users, threads, emails, drafts, and stored profiles.
- Redis for presence and ephemeral caches.
- Google APIs (Gmail, Vertex AI) for mail operations and AI.

### Data flow (high‑level)
1. User signs in with Firebase → backend resolves/creates the user in DB.
2. User connects Gmail → tokens stored (encrypted if configured).
3. Onboarding questionnaire → answers + sample emails are captured.
4. Persona generation:
    - Pipeline analyzes scenario responses (stylometry), runs generate‑compare‑refine loops per scenario, validates consistency, and synthesizes a profile JSON matching a schema.
    - Greeting preference and other signals seed the final profile.
5. Inbox view → backend pulls threads/messages (sync job), upserts to DB.
6. Draft generation → prompt includes style profile + thread context + real names and inferred company. Vertex AI returns a draft.
7. User can send reply via Gmail API (thread metadata preserved).

## AI usage

Draftly uses Google Vertex AI Gemini 2.0 Flash as the primary LLM. There are two paths:

1) Integration wrapper (`src/integrations/VertexAIIntegration.ts`)
- Simple prompts for style profile (enforced via response schema) and draft generation.
- Used by services when a direct call suffices.

2) PROSE‑inspired pipeline (`src/lib/vertexai.ts`)
- Multi‑step persona synthesis:
   - Stylometry hypothesis over scenario responses.
   - For each scenario, 2 configurable refinement loops (generate → compare → refine) to tighten a persona descriptor.
   - Cross‑scenario consistency verification.
   - Final synthesis into a JSON profile conforming to a strict schema (tone, structure, greetings/closings, lexical features, etc.).
- JSON Schema enforcement: Vertex AI responseSchema ensures structured JSON output.
- Prompt hygiene: avoids placeholders, inserts real names, and uses greeting/sign‑off logic with user preferences.

### Personalization signals
- Greeting preference (e.g., “Hi {FirstName}”, “Dear {Name}”, or none).
- Closing preference (Best/Regards/Thanks/Sincerely/Cheers/None).
- Writing style traits (Concise, Warm, Direct, Diplomatic, Detailed, etc.).
- Sentence complexity, paragraph length, emoji usage, bullet points.
- Sender name/company extracted from headers and signature blocks (best‑effort).

### Resiliency & cost controls
- Exponential backoff with jitter for transient 429/UNAVAILABLE.
- Global rate limiter (`aiRateLimiter.ts`) to smooth bursts (QPS control).
- Prompt size guards: trim original email/body and reduce thread history to last few items to avoid large token payloads.
- Configurable PROSE iterations to reduce API pressure.

## Gmail integration

- OAuth tokens are validated and refreshed when possible.
- Background sync pulls messages and upserts them to DB.
- Known edge case: `invalid_grant` (user revoked access) is handled gracefully—onboarding status is set to `GMAIL_CONNECTED` to prompt re‑auth without spamming 503s.
- Replies preserve threading via `In-Reply-To` and `References` headers.

## Security & privacy

- Firebase auth middleware ensures only authenticated users access their data.
- Optional encryption utilities exist for sensitive token storage (see `utils/encryption.ts`).
- Avoids fabricating personal details; prompts explicitly prohibit placeholders and unknown names/companies.
- Minimal scopes for Gmail and use of environment‑bound service accounts for Vertex AI.

## Configuration

Required environment variables (server):

- Database / Prisma
   - `DATABASE_URL`
- Firebase
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_PRIVATE_KEY` (use `\\n` for newlines in .env)
   - `FIREBASE_CLIENT_EMAIL`
- Google OAuth (Gmail)
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
- Vertex AI
   - `VERTEX_AI_PROJECT_ID`
   - `VERTEX_AI_LOCATION` (default `us-central1`)
   - `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON)
- Redis (one of)
   - `REDIS_URL`
   - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (optional)
- App security
   - `JWT_SECRET`
   - `TOKEN_ENCRYPTION_KEY` (optional)
- Optional tuning
   - `VERTEX_MAX_CONCURRENCY` (default 2)
   - `VERTEX_MIN_INTERVAL_MS` (default 150)
   - `PROSE_ITERATIONS` (default 2; set 1 to reduce load)

### Example (.env)

```
DATABASE_URL=mongodb+srv://USER:PASS@cluster0.x.mongodb.net/draftly
FIREBASE_PROJECT_ID=your-firebase-project
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-firebase-project.iam.gserviceaccount.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback

VERTEX_AI_PROJECT_ID=your-gcp-project
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=./gcp-sdk.json

REDIS_URL=redis://localhost:6379

JWT_SECRET=change-me
TOKEN_ENCRYPTION_KEY=optional-key

VERTEX_MAX_CONCURRENCY=2
VERTEX_MIN_INTERVAL_MS=150
PROSE_ITERATIONS=2
```

## Development

### Prerequisites
- Node.js 18+
- npm
- MongoDB
- Redis

### Install & run
1) Install deps
```
npm install
```

2) Generate Prisma client
```
npm run db:generate
```

3) Start dev server
```
npm run dev
```

4) Lint / Format / Typecheck / Tests
```
npm run lint
npm run format
npm run type-check
npm test
```

### Docker (optional)

Use the provided `docker-compose.yml` to run the server (and optionally Mongo/Redis if configured there). On Windows, helper scripts like `start-docker.ps1` are available.

## Onboarding & questionnaire

1) Choose profession and answer foundational style questions:
    - Primary goal, formality, favorite fragment, greeting preference
    - Writing style preferences (multi‑select), sentence complexity, paragraph length, closing preference, emoji usage, bullet points
2) Scenario responses (profession‑specific). These samples drive stylometry and persona refinement.
3) Persona generation runs in the background. Status fields under `onboardingStatus` reflect progress (e.g., `PROFILE_GENERATING`, `COMPLETED_INIT_PROFILE`).

## Draft generation details

Context used in prompts:
- Latest message’s sender name, email, and inferred company (from domain or signature block).
- User’s name (for sign‑offs) and explicit greeting/closing preferences.
- Thread history (trimmed to last few entries to control token size).

Prompt rules:
- No placeholders; never fabricate unknown names/companies.
- Use real greeting/sign‑off logic (respect preferences and relationship when known).
- Match tone, vocabulary level, structure, and sentence complexity from the profile.

## Troubleshooting

429 / RESOURCE_EXHAUSTED from Vertex AI
- Causes: short bursts, per‑region/model throttling, or very large prompts.
- Mitigations implemented:
   - Global rate limiter (QPS/concurrency smoothing).
   - Exponential backoff & jitter.
   - Prompt trimming (original email and thread history).
   - Configurable PROSE iterations.
- Tuning: set `VERTEX_MAX_CONCURRENCY=1`, `VERTEX_MIN_INTERVAL_MS=200–300`, `PROSE_ITERATIONS=1` during peak.

Gmail `invalid_grant`
- Indicates revoked/expired consent. The server degrades gracefully and prompts re‑auth (status set to `GMAIL_CONNECTED`).

JSON schema errors from Vertex AI
- Ensure `VERTEX_AI_PROJECT_ID`, `VERTEX_AI_LOCATION`, and service account permissions are correct (Vertex AI API enabled). The generation is enforced with `responseSchema` on the model side.

## Git workflow

Branches:
- `dev` → active development
- `staging` → pre‑prod integration
- `main` → production

Feature flow:
```
git checkout -b feature/your-feature-name dev
# commit work
git push origin feature/your-feature-name
# open PR into dev
```
Promote to `staging` after QA, then to `main` with approvals.

Pre‑commit hooks (optional)
```
pip install pre-commit
pre-commit install
```
Hooks ensure formatting, lint, typecheck, and schema validation.

## Directory map (server)

```
src/
   app.ts, server.ts
   config/               # env + app config
   controllers/          # Fastify route handlers
   integrations/         # Gmail + Vertex AI clients
   lib/                  # AI pipeline, rate limiter, prisma, cache
   middleware/           # auth
   repositories/         # Prisma repositories
   routes/               # route registrations
   services/             # business logic orchestration
   types/                # shared app types
   utils/                # crypto, parsing helpers, etc.
```

## License

Proprietary. All rights reserved by the repository owner.
