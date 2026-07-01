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

## Phase 2 — Watcher, folders, distribution, daily ops (built)

- **Trial-account watcher → 1–10 rating.** A watcher monitors each trial over its
  window and lands a **non-finalized auto-draft scorecard** with a 1–10 rating
  (shown on the scoring screen; sliders pre-filled, you adjust + finalize).
  Data source per the cost-free design:
  - **Reddit** — free public API (`src/lib/watcher/reddit.ts`): real post/volume/
    spacing/removal monitoring.
  - **X / Instagram / TikTok** — **activity-based** (`src/lib/watcher/activity.ts`):
    volume + natural spacing of submitted links + check-in responsiveness.
  - **Apify (optional)** — set `APIFY_TOKEN` to later add richer IG/X scraping;
    the watcher is pluggable, falls back to activity automatically.
- **Telegram "folders".** The Bot API can't manage real chat folders, so each
  folder = a Telegram **group** with an invite link. VAs are routed into the
  **Trial** group while trialing, then their model's **Qualified** group on hire
  (e.g. "X VA – Lae"); the bot DMs the link and membership is tracked at
  **/folders**.
- **Even distribution across models.** New hires auto-assign to the **least-loaded**
  model (weighted least-loaded supports non-even target ratios), keeping e.g.
  Lola/Lae balanced. View at **/vas**.
- **Daily ops.** The operator gets a **daily VA digest** (what each VA did, who's
  offline, deadlines, auto-ratings) and VAs get a **morning message** (yesterday's
  count + today's focus).
- **Hands-off intake delivery.** The apply form returns a **`/start` deep-link**
  (`t.me/<bot>?start=<token>`). Telegram bots can't DM someone first, so on the
  first tap the bot binds the candidate's chat id and **instantly delivers the
  message for their current stage** (first-touch / training / brief) — the
  auto-reply actually lands.
- **Time-based automations** (`src/lib/{deadlines,stale}.ts`): trial **T-12h /
  T-2h reminders**, **auto-expire** when the 24h window lapses with no
  submission, and a **stale-candidate sweep** (nudge what's stuck, auto-archive
  dead role-less applicants).
- **Self-running scheduler** (`src/lib/scheduler.ts` via `src/instrumentation.ts`).
  On a persistent server (Railway) the app runs all recurring jobs itself — **no
  external cron needed.** Cadence: watcher hourly, deadlines every 15m, stale
  every 6h, morning + digest once/day at `MORNING_HOUR` / `DIGEST_HOUR`
  (`TZ_OFFSET`). The `/api/cron/*` routes remain as a manual/external backup.

### Deploying on Railway

Railway runs a persistent Node server, so the in-process scheduler just works.

1. New project → deploy this repo; set **root directory** to `swift/`.
2. Build: `npm run build` · Start: `npm run start`. Add a release/deploy step
   `npx prisma migrate deploy` (and `npm run db:seed` once) to set up the DB.
3. Set env vars: `DATABASE_URL` (Railway Postgres — flip `schema.prisma`
   `provider` to `postgresql`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `TELEGRAM_WEBHOOK_SECRET`, `TZ_OFFSET`, `MORNING_HOUR`, `DIGEST_HOUR`,
   `NEXT_PUBLIC_BASE_URL`.
4. Point the Telegram webhook at the deployment (see "Going live on Telegram").

### Scheduling the cron jobs

Protect with `CRON_SECRET`, then hit these on a schedule (Vercel Cron, GitHub
Actions, or any external cron):

| Endpoint | Cadence | Does |
|---|---|---|
| `/api/cron/watch?secret=…` | hourly | run every due trial watch → refresh ratings |
| `/api/cron/morning?secret=…` | daily ~08:00 | morning messages to VAs on trial |
| `/api/cron/daily-digest?secret=…` | daily ~21:00 | operator's daily VA digest |

> "Online today" is approximated by whether the VA messaged the bot today — the
> Bot API can't read true presence. Real online/last-seen + force-adding to
> groups + chat-folder management would require a Telethon **userbot**.

## Phase 3 — Reporting, account inventory & AI scoring (built)

- **Reporting dashboard (`/reports`).** Hiring funnel (applied → role → trial →
  submitted → scored → hired), conversion rates, tier-outcome and weighted-score
  distributions, average time-to-hire / scoring turnaround, and a per-role
  breakdown. Everything is derived from real entities (trials, scorecards,
  hires) rather than mutable stage strings, so the numbers hold up even on
  seeded/imported data. See [`src/lib/reports.ts`](src/lib/reports.ts).
- **Account inventory & access tiers (`/accounts`).** Track each social account
  per model, its warm-status (`warming → active → limited → suspended → banned →
  retired`), and which VAs hold access. Grant/revoke per account and **one-click
  offboard** revokes every account a departing VA can touch. New tables
  `Account` + `AccessGrant`; logic in [`src/lib/accounts.ts`](src/lib/accounts.ts).
- **AI scoring assist.** The **🤖 AI draft** button on the scoring screen asks
  Claude to score every rubric criterion (0–5), flag hard-fails, and suggest a
  tier from the submission + watcher data; the sliders pre-fill for you to review
  and finalize. Set `ANTHROPIC_API_KEY` to enable (defaults to `claude-opus-4-8`,
  override with `ANTHROPIC_MODEL`); with no key the button reports the feature is
  off. Structured output is forced via a tool call — see
  [`src/lib/ai-scoring.ts`](src/lib/ai-scoring.ts).

## Phase 4 — Training gate + quiz (built)

- **Reading module + auto-graded quiz that gates the trial.** Each role has a
  `TrainingModule` (reading material + multiple-choice quiz, seeded from
  [`src/lib/training-config.ts`](src/lib/training-config.ts)). The candidate
  gets a public deep-link (`/training/<startToken>`) in their training message;
  they read, take the quiz, and on **≥ passPct (default 80%)** the app
  **auto-advances them to `TRIAL_READY`** — creating the trial and sending the
  brief with no operator action. Failing lets them re-read and retake. Attempts
  are recorded (`QuizAttempt`); status + the link show on the candidate detail
  page. Logic in [`src/lib/training.ts`](src/lib/training.ts).

## Roadmap (next)

- **Optional userbot:** real Telegram folder management + presence + auto-add
  (the Bot API can't add users to groups — this needs a Telethon userbot).
