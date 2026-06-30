/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import { CREATORS, ROLES, RUBRICS, TEMPLATES } from "../src/lib/roles-config";
import { computeWeightedTotal, tierFor } from "../src/lib/scoring";

const prisma = new PrismaClient();

async function findOrCreateCreator(c: (typeof CREATORS)[number]) {
  const existing = await prisma.creator.findFirst({ where: { name: c.name } });
  if (existing) {
    return prisma.creator.update({
      where: { id: existing.id },
      data: {
        niche: c.niche,
        xMainUrl: c.xMainUrl,
        igHandle: c.igHandle,
        tiktokHandle: c.tiktokHandle,
        contentDriveUrl: c.contentDriveUrl,
      },
    });
  }
  return prisma.creator.create({
    data: {
      name: c.name,
      niche: c.niche,
      xMainUrl: c.xMainUrl,
      igHandle: c.igHandle,
      tiktokHandle: c.tiktokHandle,
      contentDriveUrl: c.contentDriveUrl,
    },
  });
}

async function findOrCreateManager(name: string) {
  const existing = await prisma.user.findFirst({ where: { name, role: "manager" } });
  if (existing) return existing;
  return prisma.user.create({ data: { name, role: "manager", status: "active" } });
}

async function main() {
  console.log("Seeding SWIFT…");

  // 1) Creators
  const creatorsByName = new Map<string, string>();
  for (const c of CREATORS) {
    const row = await findOrCreateCreator(c);
    creatorsByName.set(c.name, row.id);
  }

  // 2) Managers referenced by roles (e.g. Haria for Reddit)
  const managersByName = new Map<string, string>();
  for (const r of ROLES) {
    if (r.manager && !managersByName.has(r.manager)) {
      const m = await findOrCreateManager(r.manager);
      managersByName.set(r.manager, m.id);
    }
  }
  // An admin user (the operator) for scorer attribution
  const admin =
    (await prisma.user.findFirst({ where: { role: "admin" } })) ??
    (await prisma.user.create({ data: { name: "Admin", role: "admin", status: "active" } }));

  // 3) Roles + rubrics + templates
  const rolesByKey = new Map<string, string>();
  for (const r of ROLES) {
    const defaultCreatorId = r.defaultCreator ? creatorsByName.get(r.defaultCreator) ?? null : null;
    const managerUserId = r.manager ? managersByName.get(r.manager) ?? null : null;
    const role = await prisma.role.upsert({
      where: { key: r.key },
      update: {
        displayName: r.displayName,
        trialHours: r.trialHours,
        trainingGroupUrl: r.trainingGroupUrl || null,
        defaultCreatorId,
        managerUserId,
      },
      create: {
        key: r.key,
        displayName: r.displayName,
        trialHours: r.trialHours,
        trainingGroupUrl: r.trainingGroupUrl || null,
        defaultCreatorId,
        managerUserId,
      },
    });
    rolesByKey.set(r.key, role.id);

    const rubric = RUBRICS[r.key];
    if (rubric) {
      await prisma.rubric.upsert({
        where: { roleId: role.id },
        update: { name: rubric.name, criteria: JSON.stringify(rubric.criteria) },
        create: { roleId: role.id, name: rubric.name, criteria: JSON.stringify(rubric.criteria) },
      });
    }
  }

  // 4) Templates
  for (const t of TEMPLATES) {
    const roleId = t.roleKey ? rolesByKey.get(t.roleKey) ?? null : null;
    await prisma.messageTemplate.upsert({
      where: { key: t.key },
      update: { roleId, category: t.category, subject: t.subject ?? null, body: t.body, channel: "telegram" },
      create: {
        key: t.key,
        roleId,
        category: t.category,
        subject: t.subject ?? null,
        body: t.body,
        channel: "telegram",
      },
    });
  }

  console.log(
    `  roles: ${rolesByKey.size}, creators: ${creatorsByName.size}, templates: ${TEMPLATES.length}`
  );

  // 5) Demo candidates (only if the pipeline is empty) so the board isn't blank.
  const existingCandidates = await prisma.candidate.count();
  if (existingCandidates > 0) {
    console.log("  candidates already present — skipping demo data.");
    return;
  }

  const now = Date.now();
  const hrs = (h: number) => new Date(now + h * 3600_000);

  async function makeCandidate(opts: {
    fullName: string;
    handle: string;
    country: string;
    roleKey?: string;
    stage: string;
    why?: string;
  }) {
    const roleId = opts.roleKey ? rolesByKey.get(opts.roleKey) ?? null : null;
    const cand = await prisma.candidate.create({
      data: {
        fullName: opts.fullName,
        telegramHandle: opts.handle,
        country: opts.country,
        source: "onlinejobs_ph",
        whyText: opts.why ?? null,
        currentStage: opts.stage,
        currentRoleId: roleId,
      },
    });
    let application = null;
    if (roleId) {
      application = await prisma.application.create({
        data: {
          candidateId: cand.id,
          roleId,
          whyText: opts.why ?? null,
          stage: opts.stage,
        },
      });
    }
    return { cand, application, roleId };
  }

  // APPLIED — no role yet
  await makeCandidate({
    fullName: "Anna Reyes",
    handle: "@annareyes",
    country: "PH",
    stage: "APPLIED",
  });

  // ROLE_SELECTED — Reddit (routes to Haria)
  await makeCandidate({
    fullName: "Liza Mendoza",
    handle: "@lizam",
    country: "PH",
    roleKey: "reddit_va",
    stage: "ROLE_SELECTED",
    why: "I've run NSFW Reddit funnels before and understand karma/verification.",
  });

  // TRIAL_ACTIVE — X VA, clock ticking
  {
    const { application, roleId } = await makeCandidate({
      fullName: "John Cruz",
      handle: "@johncruz",
      country: "PH",
      roleKey: "x_va",
      stage: "TRIAL_ACTIVE",
      why: "Strong at hooks and timing replies under viral posts.",
    });
    if (application) {
      const role = await prisma.role.findUnique({ where: { id: roleId! } });
      const creatorId = role?.defaultCreatorId ?? null;
      await prisma.trial.create({
        data: {
          applicationId: application.id,
          creatorId,
          accountUsed: "@john_trial_x",
          briefSentAt: hrs(-6),
          startedAt: hrs(-6),
          deadlineAt: hrs(18),
          status: "active",
          submissionUrls: "[]",
        },
      });
    }
  }

  // SUBMITTED — TikTok VA, awaiting scoring
  {
    const { application, roleId } = await makeCandidate({
      fullName: "Maria Santos",
      handle: "@mariasantos",
      country: "PH",
      roleKey: "tiktok_va",
      stage: "SUBMITTED",
      why: "I batch SFW slideshows fast and know trending audio.",
    });
    if (application) {
      const role = await prisma.role.findUnique({ where: { id: roleId! } });
      await prisma.trial.create({
        data: {
          applicationId: application.id,
          creatorId: role?.defaultCreatorId ?? null,
          accountUsed: "@maria_trial_tt",
          briefSentAt: hrs(-26),
          startedAt: hrs(-26),
          deadlineAt: hrs(-2),
          submittedAt: hrs(-1),
          status: "submitted",
          submissionUrls: JSON.stringify([
            "https://www.tiktok.com/@maria_trial_tt/video/1",
            "https://www.tiktok.com/@maria_trial_tt/video/2",
            "https://www.tiktok.com/@maria_trial_tt/video/3",
          ]),
        },
      });
    }
  }

  // SCORING — IG DM Handler, draft scorecard in progress
  {
    const { application, roleId } = await makeCandidate({
      fullName: "Grace Lim",
      handle: "@gracelim",
      country: "PH",
      roleKey: "ig_dm_handler",
      stage: "SCORING",
      why: "I'm warm in DMs and never spam links.",
    });
    if (application) {
      const role = await prisma.role.findUnique({ where: { id: roleId! } });
      const trial = await prisma.trial.create({
        data: {
          applicationId: application.id,
          creatorId: role?.defaultCreatorId ?? null,
          accountUsed: "@grace_trial_ig",
          briefSentAt: hrs(-30),
          startedAt: hrs(-30),
          deadlineAt: hrs(-6),
          submittedAt: hrs(-5),
          status: "submitted",
          submissionUrls: JSON.stringify(["https://www.instagram.com/grace_trial_ig/"]),
        },
      });
      await prisma.scoreCard.create({
        data: {
          trialId: trial.id,
          scores: "{}",
          flags: "[]",
          weightedTotal: 0,
          finalized: false,
        },
      });
    }
  }

  // DECISION — Video Editor, finalized tier B
  {
    const { application, roleId } = await makeCandidate({
      fullName: "Paolo Garcia",
      handle: "@paolog",
      country: "PH",
      roleKey: "video_editor",
      stage: "DECISION",
      why: "Fast turnaround, clean vertical edits, strong first frames.",
    });
    if (application) {
      const role = await prisma.role.findUnique({ where: { id: roleId! } });
      const trial = await prisma.trial.create({
        data: {
          applicationId: application.id,
          creatorId: role?.defaultCreatorId ?? null,
          accountUsed: "batch-A",
          briefSentAt: hrs(-40),
          startedAt: hrs(-40),
          deadlineAt: hrs(-16),
          submittedAt: hrs(-15),
          status: "submitted",
          submissionUrls: JSON.stringify(["https://drive.google.com/drive/folders/paolo-batch-A"]),
        },
      });
      const criteria = RUBRICS["video_editor"].criteria;
      const scores: Record<string, number> = {
        output_volume: 4,
        hook_strength: 4,
        technical_quality: 4,
        caption_quality: 3,
        trend_awareness: 3,
        turnaround_speed: 4,
        brief_adherence: 4,
      };
      const total = computeWeightedTotal(scores, criteria);
      const tier = tierFor(total, []);
      await prisma.scoreCard.create({
        data: {
          trialId: trial.id,
          scorerUserId: admin.id,
          scores: JSON.stringify(scores),
          flags: "[]",
          weightedTotal: total,
          tier,
          rationale: "Solid edits and pacing; captions a touch generic. Hire on probation.",
          finalized: true,
          scoredAt: new Date(),
        },
      });
    }
  }

  console.log("  demo candidates created.");
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
