// Shared constants & lightweight "enums" (SQLite has no native enum type, so
// these string unions are the single source of truth, validated in app code).

// ── Pipeline stages ──────────────────────────────────────────────────────────
export const STAGES = [
  "APPLIED",
  "ROLE_SELECTED",
  "TRAINING",
  "TRIAL_READY",
  "TRIAL_ACTIVE",
  "SUBMITTED",
  "SCORING",
  "DECISION",
  "ONBOARDING",
  "ACTIVE",
  "ARCHIVED",
  "REJECTED",
] as const;
export type Stage = (typeof STAGES)[number];

// Columns shown on the Kanban board (terminal stages are filtered/grouped).
export const BOARD_STAGES: Stage[] = [
  "APPLIED",
  "ROLE_SELECTED",
  "TRAINING",
  "TRIAL_READY",
  "TRIAL_ACTIVE",
  "SUBMITTED",
  "SCORING",
  "DECISION",
  "ONBOARDING",
  "ACTIVE",
];

export const STAGE_META: Record<
  Stage,
  { label: string; hint: string; tone: "neutral" | "active" | "review" | "good" | "bad" }
> = {
  APPLIED: { label: "Applied", hint: "New — needs a role + why", tone: "neutral" },
  ROLE_SELECTED: { label: "Role selected", hint: "Role chosen, send training", tone: "neutral" },
  TRAINING: { label: "Training", hint: "Reading + quiz gate (Phase 2)", tone: "neutral" },
  TRIAL_READY: { label: "Trial ready", hint: "Brief + content sent, clock set", tone: "active" },
  TRIAL_ACTIVE: { label: "Trial active", hint: "Working — awaiting submission", tone: "active" },
  SUBMITTED: { label: "Submitted", hint: "Trial in, needs scoring", tone: "review" },
  SCORING: { label: "Scoring", hint: "Reviewing the scorecard", tone: "review" },
  DECISION: { label: "Decision", hint: "Tiered — offer / re-trial / decline", tone: "review" },
  ONBOARDING: { label: "Onboarding", hint: "Hired — setup & access", tone: "good" },
  ACTIVE: { label: "Active", hint: "Live VA (probation → active)", tone: "good" },
  ARCHIVED: { label: "Archived", hint: "Closed out", tone: "bad" },
  REJECTED: { label: "Rejected", hint: "Politely declined", tone: "bad" },
};

// ── Tiers ────────────────────────────────────────────────────────────────────
export const TIERS = ["A", "B", "C", "REJECT"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_THRESHOLDS: { tier: Tier; min: number; label: string; note: string }[] = [
  { tier: "A", min: 80, label: "A — Hire", note: "Fast-track; model-main eligible after probation" },
  { tier: "B", min: 65, label: "B — Hire (probation)", note: "Managed/warmed account only" },
  { tier: "C", min: 50, label: "C — Borderline", note: "Optional single re-trial, else archive" },
  { tier: "REJECT", min: 0, label: "REJECT", note: "Polite decline, archive" },
];

// ── Hard-fail flags (any one caps the tier at REJECT) ────────────────────────
export const HARD_FAIL_FLAGS = [
  { key: "account_banned", label: "Got the trial account banned" },
  { key: "posted_nudity_on_sfw_platform", label: "Posted nudity on a SFW platform" },
  { key: "ignored_instructions", label: "Ignored instructions entirely" },
  { key: "no_show", label: "No-show / never submitted" },
] as const;
export type HardFailFlag = (typeof HARD_FAIL_FLAGS)[number]["key"];

// ── Roles ────────────────────────────────────────────────────────────────────
export const ROLE_KEYS = [
  "x_va",
  "tiktok_va",
  "ig_manager",
  "ig_dm_handler",
  "video_editor",
  "reddit_va",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

// ── Trial status ─────────────────────────────────────────────────────────────
export const TRIAL_STATUSES = [
  "not_started",
  "account_check", // asked if they have an account; awaiting yes/no
  "needs_account", // no account → routed to the manager to set one up
  "active",
  "submitted",
  "expired",
] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

// ── Account inventory & access (Phase 3) ─────────────────────────────────────
export const ACCOUNT_PLATFORMS = [
  "x",
  "instagram",
  "tiktok",
  "reddit",
  "onlyfans",
  "other",
] as const;
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

// Lifecycle / warm-status of an account in the inventory.
export const ACCOUNT_STATUSES = [
  "warming",
  "active",
  "limited",
  "suspended",
  "banned",
  "retired",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_META: Record<
  AccountStatus,
  { label: string; tone: "neutral" | "active" | "review" | "good" | "bad" }
> = {
  warming: { label: "Warming", tone: "review" },
  active: { label: "Active", tone: "good" },
  limited: { label: "Limited", tone: "review" },
  suspended: { label: "Suspended", tone: "bad" },
  banned: { label: "Banned", tone: "bad" },
  retired: { label: "Retired", tone: "neutral" },
};

// ── Rubric types ─────────────────────────────────────────────────────────────
export type RubricCriterion = {
  key: string;
  label: string;
  weight: number; // weights across a rubric sum to 100
  anchor_5: string;
  anchor_3: string;
  anchor_1: string;
};
