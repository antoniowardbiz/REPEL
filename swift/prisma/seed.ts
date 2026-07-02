/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import { CREATORS, ROLES, RUBRICS, TEMPLATES } from "../src/lib/roles-config";
import { TRAINING_MODULES } from "../src/lib/training-config";
import { computeWeightedTotal, tierFor } from "../src/lib/scoring";
import { randomBytes } from "crypto";

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

async function findOrCreateManager(name: string, telegramHandle?: string) {
  const existing = await prisma.user.findFirst({ where: { name, role: "manager" } });
  if (existing) {
    // Keep the handle current from config (only when config provides one).
    if (telegramHandle && existing.telegramHandle !== telegramHandle) {
      return prisma.user.update({ where: { id: existing.id }, data: { telegramHandle } });
    }
    return existing;
  }
  return prisma.user.create({
    data: { name, role: "manager", status: "active", telegramHandle: telegramHandle || null },
  });
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
      const m = await findOrCreateManager(r.manager, r.managerHandle);
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
        // capacity is intentionally omitted here: it's operator-editable in the
        // UI, and the seed re-runs on every deploy — don't clobber their target.
        // active IS set from config (no live toggle): code owns which roles are open.
        active: r.active ?? true,
        trainingGroupUrl: r.trainingGroupUrl || null,
        defaultCreatorId,
        managerUserId,
      },
      create: {
        key: r.key,
        displayName: r.displayName,
        trialHours: r.trialHours,
        capacity: r.capacity ?? null,
        active: r.active ?? true,
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

    const tm = TRAINING_MODULES[r.key];
    if (tm) {
      await prisma.trainingModule.upsert({
        where: { roleId: role.id },
        update: {
          title: tm.title,
          content: tm.content,
          questions: JSON.stringify(tm.questions),
          passPct: tm.passPct,
        },
        create: {
          roleId: role.id,
          title: tm.title,
          content: tm.content,
          questions: JSON.stringify(tm.questions),
          passPct: tm.passPct,
        },
      });
    }
  }

  // 3b) One-time capacity initialization. Roles that already exist (e.g. on a
  // live DB from before Phase 5) don't get capacity via the upsert `update`
  // above — that's deliberate so re-seeds never clobber operator edits. Apply
  // the seed targets exactly ONCE, gated on a PERSISTENT marker (not on the
  // capacity values). Keying on a marker instead of `count(capacity != null)`:
  //   • survives a mid-loop crash — a retry re-runs and fills only the roles
  //     still NULL (per-role `updateMany where capacity: null`), so no role is
  //     ever left permanently unset;
  //   • never re-stamps defaults after the operator blanks roles to "unlimited"
  //     (null), because the marker — not the null values — says we're done.
  const CAP_MARKER = "capacities_initialized";
  const alreadyInit = await prisma.auditLog.findFirst({ where: { action: CAP_MARKER } });
  if (!alreadyInit) {
    for (const r of ROLES) {
      if (r.capacity != null) {
        await prisma.role.updateMany({ where: { key: r.key, capacity: null }, data: { capacity: r.capacity } });
      }
    }
    await prisma.auditLog.create({ data: { action: CAP_MARKER, entity: "Role", entityId: "all" } });
    console.log("  seeded role capacities (first-time).");
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

  // Telegram "folders": a Trial group per role + a Qualified group per role×model.
  const creatorEntries = [...creatorsByName.entries()];
  let groupCount = 0;
  for (const r of ROLES) {
    const roleId = rolesByKey.get(r.key)!;
    await prisma.telegramGroup.upsert({
      where: { key: `grp_trial_${r.key}` },
      update: { label: `${r.displayName} – Trial`, roleId, kind: "trial" },
      create: {
        key: `grp_trial_${r.key}`,
        label: `${r.displayName} – Trial`,
        roleId,
        kind: "trial",
        inviteUrl: r.trainingGroupUrl || null,
      },
    });
    groupCount++;
    for (const [cname, cid] of creatorEntries) {
      await prisma.telegramGroup.upsert({
        where: { key: `grp_qual_${r.key}_${cname.toLowerCase()}` },
        update: { label: `${r.displayName} – ${cname}`, roleId, creatorId: cid, kind: "qualified" },
        create: {
          key: `grp_qual_${r.key}_${cname.toLowerCase()}`,
          label: `${r.displayName} – ${cname}`,
          roleId,
          creatorId: cid,
          kind: "qualified",
        },
      });
      groupCount++;
    }
  }
  console.log(`  telegram groups: ${groupCount}`);

  // ── Demo / sample board data ────────────────────────────────────────────────
  // This is SAMPLE data for local + preview only. It must NEVER seed fake
  // candidates onto a live production board — they'd sit next to real applicants
  // and confuse the operator (e.g. a retired-role "Instagram DM Handler" demo
  // showing a trial page). Two explicit, independent opt-ins:
  //   • PURGE_DEMO=1 → one-time cleanup of the known demo rows from a live DB
  //     that was first seeded before this gate existed. Runs once (marker).
  //   • SEED_DEMO=1  → (re)create the demo board data. Left unset in production.

  // Exact demo identities, so the purge matches precisely and can never touch a
  // real applicant/hire: (fullName, telegramHandle) for candidates; plain names
  // for the fabricated hired VAs.
  const DEMO_CANDIDATES: [string, string][] = [
    ["Anna Reyes", "@annareyes"],
    ["Liza Mendoza", "@lizam"],
    ["John Cruz", "@johncruz"],
    ["Maria Santos", "@mariasantos"],
    ["Grace Lim", "@gracelim"],
    ["Paolo Garcia", "@paolog"],
  ];
  const DEMO_VA_NAMES = ["Rin Tolentino", "Mara Diaz", "Kit Aquino", "Bea Navarro", "Tim Soriano"];

  // One-time demo purge (opt-in). Marker-gated so it runs exactly once even if
  // the flag is left set across deploys.
  const PURGE_MARKER = "demo_data_purged";
  if (process.env.PURGE_DEMO === "1" && !(await prisma.auditLog.findFirst({ where: { action: PURGE_MARKER } }))) {
    let removedCands = 0;
    for (const [fullName, telegramHandle] of DEMO_CANDIDATES) {
      // Match the exact fabricated identity AND only rows never touched by a real
      // person (no bound Telegram chat). A real applicant sharing a demo's exact
      // name+handle with no chat bound is vanishingly unlikely.
      const rows = await prisma.candidate.findMany({
        where: { fullName, telegramHandle, telegramChatId: null },
      });
      for (const c of rows) {
        // ActivityEvent.candidate has no delete-cascade — clear it first. The
        // rest (Application→Trial→ScoreCard, Message, QuizAttempt) cascade.
        await prisma.activityEvent.deleteMany({ where: { candidateId: c.id } });
        await prisma.candidate.delete({ where: { id: c.id } });
        removedCands++;
      }
    }
    let removedVas = 0;
    for (const name of DEMO_VA_NAMES) {
      // Real hires always have candidateId set (created at onboarding); demo VAs
      // don't. Managers/admins aren't role "va". Both protect real users.
      const users = await prisma.user.findMany({ where: { name, role: "va", candidateId: null } });
      for (const u of users) {
        await prisma.assignment.deleteMany({ where: { userId: u.id } }); // no cascade from User
        await prisma.user.delete({ where: { id: u.id } });
        removedVas++;
      }
    }
    await prisma.auditLog.create({
      data: { action: PURGE_MARKER, entity: "Candidate", entityId: "demo", meta: JSON.stringify({ removedCands, removedVas }) },
    });
    console.log(`  purged demo data: ${removedCands} candidates, ${removedVas} VAs.`);
  }

  // Only (re)create demo board data when explicitly asked — never in production.
  if (process.env.SEED_DEMO !== "1") {
    console.log("  SEED_DEMO not set — skipping demo board data (production-safe).");
    return;
  }

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
        startToken: randomBytes(9).toString("hex"),
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

  // ROLE_SELECTED — Reddit (routes to Haria). At the training gate, so its
  // deep-link makes a good demo of the training + quiz flow.
  const liza = await makeCandidate({
    fullName: "Liza Mendoza",
    handle: "@lizam",
    country: "PH",
    roleKey: "reddit_va",
    stage: "ROLE_SELECTED",
    why: "I've run NSFW Reddit funnels before and understand karma/verification.",
  });
  console.log(`  ▶ sample training link: /training/${liza.cand.startToken}`);

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

  // Demo hired VAs to populate the distribution view (3 on Lola, 2 on Lae).
  const lolaId = creatorsByName.get("Lola")!;
  const laeId = creatorsByName.get("Lae")!;
  const xRoleId = rolesByKey.get("x_va")!;
  const ttRoleId = rolesByKey.get("tiktok_va")!;
  const demoVas: [string, string, string][] = [
    ["Rin Tolentino", xRoleId, lolaId],
    ["Mara Diaz", xRoleId, lolaId],
    ["Kit Aquino", xRoleId, lolaId],
    ["Bea Navarro", ttRoleId, laeId],
    ["Tim Soriano", ttRoleId, laeId],
  ];
  for (const [name, roleId, creatorId] of demoVas) {
    const u = await prisma.user.create({ data: { name, role: "va", status: "active" } });
    await prisma.assignment.create({ data: { userId: u.id, roleId, creatorId, status: "active" } });
  }
  console.log(`  demo assignments: ${demoVas.length} (Lola 3 / Lae 2)`);
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
