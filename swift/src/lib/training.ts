// Training gate (Phase 4): load a candidate's training module by their public
// deep-link token, grade the quiz, record the attempt, and on a pass advance
// them to TRIAL_READY (which creates the trial + sends the brief).

import { prisma } from "./db";
import { Stage } from "./constants";
import { parseJSON } from "./serialize";
import { stageIndex, isTerminal } from "./stages";
import { moveStage } from "./services";

export type PublicQuestion = { prompt: string; options: string[] };

export type TrainingView = {
  candidateName: string;
  roleName: string;
  module: { title: string; content: string; passPct: number; questions: PublicQuestion[] } | null;
  // no_role: no application yet · no_module: role has no training · ready: can
  // take the quiz · unlocked: already past training (trial created).
  status: "no_role" | "no_module" | "ready" | "unlocked";
  lastAttempt: { score: number; passed: boolean } | null;
};

export function trainingUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/training/${token}`;
}

export async function getTrainingByToken(token: string): Promise<TrainingView | null> {
  const candidate = await prisma.candidate.findUnique({
    where: { startToken: token },
    include: {
      applications: {
        orderBy: { appliedAt: "desc" },
        take: 1,
        include: { role: { include: { trainingModule: true } } },
      },
      quizAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!candidate) return null;

  const app = candidate.applications[0] ?? null;
  const role = app?.role ?? null;
  const mod = role?.trainingModule ?? null;
  const attempt = candidate.quizAttempts[0];
  const lastAttempt = attempt ? { score: attempt.score, passed: attempt.passed } : null;

  let status: TrainingView["status"];
  if (!app || !role) status = "no_role";
  else if (!mod) status = "no_module";
  else {
    const idx = stageIndex(app.stage as Stage);
    const trialIdx = stageIndex("TRIAL_READY");
    status = isTerminal(app.stage as Stage) || (idx >= 0 && idx >= trialIdx) ? "unlocked" : "ready";
  }

  const questions: PublicQuestion[] = mod
    ? parseJSON<{ prompt: string; options: string[] }[]>(mod.questions, []).map((q) => ({
        prompt: q.prompt,
        options: q.options,
      }))
    : [];

  return {
    candidateName: candidate.fullName,
    roleName: role?.displayName ?? "",
    module: mod
      ? { title: mod.title, content: mod.content, passPct: mod.passPct, questions }
      : null,
    status,
    lastAttempt,
  };
}

export type SubmitResult =
  | {
      ok: true;
      score: number;
      passed: boolean;
      passPct: number;
      correctCount: number;
      total: number;
      unlocked: boolean;
    }
  | { ok: false; reason: string };

export async function submitQuiz(token: string, answers: number[]): Promise<SubmitResult> {
  const candidate = await prisma.candidate.findUnique({
    where: { startToken: token },
    include: {
      applications: {
        orderBy: { appliedAt: "desc" },
        take: 1,
        include: { role: { include: { trainingModule: true } } },
      },
    },
  });
  if (!candidate) return { ok: false, reason: "invalid or expired training link" };

  const app = candidate.applications[0] ?? null;
  const mod = app?.role.trainingModule ?? null;
  if (!app || !mod) return { ok: false, reason: "no training is assigned yet" };

  const questions = parseJSON<{ answer: number }[]>(mod.questions, []);
  const total = questions.length;
  if (total === 0) return { ok: false, reason: "this quiz has no questions" };

  let correct = 0;
  questions.forEach((q, i) => {
    if (Number(answers[i]) === Number(q.answer)) correct++;
  });
  const score = Math.round((correct / total) * 100);
  const passed = score >= mod.passPct;

  await prisma.quizAttempt.create({
    data: {
      moduleId: mod.id,
      candidateId: candidate.id,
      applicationId: app.id,
      score,
      passed,
      answers: JSON.stringify(answers.map((a) => Number(a))),
    },
  });

  // On a pass, unlock the trial — but only from a pre-trial, non-terminal stage.
  let unlocked = false;
  if (passed) {
    const idx = stageIndex(app.stage as Stage);
    const trialIdx = stageIndex("TRIAL_READY");
    if (!isTerminal(app.stage as Stage) && idx >= 0 && idx < trialIdx) {
      await moveStage(app.id, "TRIAL_READY");
      unlocked = true;
    }
  }

  return { ok: true, score, passed, passPct: mod.passPct, correctCount: correct, total, unlocked };
}
