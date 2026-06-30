# SWIFT — VA Recruitment, Trial, Scoring & Onboarding System

A single dashboard that runs the VA hiring pipeline end-to-end: **apply → role +
why → training → trial → score → decision → onboard**. It replaces the manual
Telegram + Drive + memory workflow with a real system of record, scores every
trial against a fixed weighted rubric, and removes the tedious first-touch /
brief-sending grind.

This is **Phase 1 (MVP)** of the build spec — the core that removes ~80% of the
manual work. See [Roadmap](#roadmap) for what's next.

---

## What's in Phase 1

- **Data model** (Prisma): Creator, Role (all 6 seeded), Candidate, Application,
  Trial, Rubric, ScoreCard, MessageTemplate, User (+ Message log, Notification,
  AuditLog).
- **Pipeline Kanban board** — drag a card between stages; the destination stage
  fires its automation (send training, create trial + send brief, queue for
  scoring).
- **Candidate detail** — timeline of applications/trials, their "why", trial
  links, scorecard, full message history, and quick actions (select role, move
  stage, quick-send a template, submit a trial, archive).
- **Scorer Queue + live scoring** — submitted trials in one focused screen;
  score each criterion 0–5 against the rubric anchors with the **weighted total
  and tier (A/B/C/REJECT) calculating live**; hard-fail flags cap the tier at
  REJECT. Finalize → moves to DECISION and fires the outcome message.
- **Telegram bot** — sends first-touch + role briefs + training + outcome
  messages, and receives "first post is up" links (auto-submits the trial).
  **Graceful fallback:** with no bot token, messages are recorded as
  `simulated` so the whole pipeline is testable now; add a token and the same
  code path goes live.
- **Outcome templates** — offer (A/B) / re-trial (C, with auto-built feedback) /
  decline (REJECT), plus all six role trial briefs and the first-touch script.
- **Public apply form** (`/apply`) — drop the link in your OnlineJobs.ph reply;
  submissions write straight into the pipeline.

---

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Prisma** ORM
- **SQLite** for zero-config local dev — Postgres/Supabase-ready (one-line swap,
  see below)

---

## Quickstart

```bash
cd swift
cp .env.example .env          # defaults work out of the box (SQLite, no bot)
npm install
npm run setup                 # prisma generate + migrate + seed demo data
npm run dev                   # http://localhost:3000
```

Open **http://localhost:3000** — the board comes pre-loaded with demo candidates
across every stage. The public apply form is at **/apply**.

> **Behind a restrictive proxy?** If `npm install`'s Prisma engine download is
> blocked, install with `npm install --ignore-scripts` then run
> `npx prisma generate` (it fetches the engine separately and retries).

---

## Environment variables (`.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | DB connection. Default `file:./dev.db` (SQLite). |
| `TELEGRAM_BOT_TOKEN` | BotFather token. Unset → messages are `simulated`. |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret on the webhook URL. |
| `SLACK_WEBHOOK_URL` / `OPS_TELEGRAM_CHAT_ID` | Internal ops alerts (optional). |
| `ANTHROPIC_API_KEY` | Phase 4 AI scoring assist (not used in Phase 1). |
| `NEXT_PUBLIC_BASE_URL` | Public base URL for the apply-form link. |

### Going live on Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN`.
2. Point the webhook at this app:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<BASE_URL>/api/telegram/webhook?secret=<TELEGRAM_WEBHOOK_SECRET>
   ```
3. Candidates' chat ids are captured automatically the first time they message
   the bot (matched by `@username`).

---

## The pipeline (state machine)

```
APPLIED → ROLE_SELECTED → TRAINING → TRIAL_READY → TRIAL_ACTIVE
   → SUBMITTED → SCORING → DECISION → ONBOARDING → ACTIVE
   (ARCHIVED / REJECTED at any point)
```

Automations fire on entering a stage:

| Enter stage | Automation |
|---|---|
| `ROLE_SELECTED` | Send the role's training message + group link |
| `TRIAL_READY` | Create the Trial (deadline = now + `trialHours`), send the role brief + content link |
| `SUBMITTED` | Create a draft scorecard, push to the Scorer Queue, ping ops |
| *(finalize score)* | Move to `DECISION`, send offer / re-trial / decline |

## Scoring

- Each rubric criterion is scored **0–5**; weights across a role's rubric sum to
  **100**.
- **Weighted total = Σ(score/5 × weight)**, 0–100.
- Tiers: **A ≥ 80**, **B 65–79**, **C 50–64**, **REJECT < 50**.
- Any **hard-fail flag** (account banned, nudity on a SFW platform, ignored
  instructions, no-show) caps the tier at **REJECT** regardless of points.

The six roles and their full rubrics are seeded from
[`src/lib/roles-config.ts`](src/lib/roles-config.ts) and viewable at **/roles**.

---

## Switching to Postgres / Supabase

The schema is Postgres-compatible. To switch:

1. In `prisma/schema.prisma`, set `datasource.provider = "postgresql"`.
2. Set `DATABASE_URL` to your Postgres/Supabase URL.
3. (Optional) Promote the String-encoded JSON columns (`scores`, `flags`,
   `criteria`, `submissionUrls`, …) to `Json`/`jsonb`.
4. `npm run db:migrate`.

SQLite has no native enums, so stage/tier/status values are validated in app
code via [`src/lib/constants.ts`](src/lib/constants.ts) — they map cleanly to
Postgres enums later if desired.

---

## Project structure

```
swift/
├── prisma/
│   ├── schema.prisma        # data model
│   └── seed.ts              # roles, rubrics, templates, demo candidates
├── src/
│   ├── app/
│   │   ├── page.tsx                 # pipeline board
│   │   ├── candidates/[id]/         # candidate detail
│   │   ├── scoring/                 # scorer queue + live scoring screen
│   │   ├── templates/               # template editor
│   │   ├── roles/                   # roles & rubrics reference
│   │   ├── apply/                   # public apply form
│   │   └── api/                     # route handlers
│   ├── components/          # Board, Scorer, CandidateActions, …
│   └── lib/
│       ├── constants.ts     # stages, tiers, role keys, rubric types
│       ├── scoring.ts       # weighted total + tier
│       ├── stages.ts        # state machine + per-stage automations
│       ├── services.ts      # orchestration (transitions, send, submit, finalize)
│       ├── templates.ts     # {{merge_field}} rendering
│       ├── telegram.ts      # bot send + ops alerts (graceful fallback)
│       └── roles-config.ts  # canonical role/rubric/template seed config
```

---

## Roadmap

- **Phase 2 — Training gate:** TrainingModule + auto-graded Quiz that gates the
  trial ("I've read it" → quiz → pass 80% → trial unlocks).
- **Phase 3 — Account inventory & access tiers:** Account + AccessGrant +
  Assignment, warm-status pipeline, one-click offboard/revoke.
- **Phase 4 — AI scoring assist:** Claude draft scores into the Scorer Queue.
- **Phase 5 — Automations & reporting:** deadline reminders (T-12h/T-2h),
  auto-expiry, stale-candidate sweep, manager routing, funnel/score reports.
