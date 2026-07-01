// Canonical seed configuration for SWIFT — creators, the six roles, their
// rubrics, and the message-template library. Shared by prisma/seed.ts and the
// app. Edit values here; keep the structure.

import { RubricCriterion } from "./constants";

export type CreatorSeed = {
  name: string;
  niche?: string;
  xMainUrl?: string;
  igHandle?: string;
  tiktokHandle?: string;
  contentDriveUrl?: string;
};

export const CREATORS: CreatorSeed[] = [
  {
    name: "Lola",
    niche: "X / Twitter growth",
    xMainUrl: "https://x.com/mostwantedbimbo",
    contentDriveUrl: "", // <Lola Drive folder>
  },
  {
    name: "Lae",
    niche: "TikTok / Instagram",
    contentDriveUrl: "https://drive.google.com/drive/folders/1ABHMTwixtxF2xfiu0-TLB38OtaxD4AfI",
  },
];

export type RoleSeed = {
  key: string;
  displayName: string;
  trialHours: number;
  capacity?: number; // target headcount; role "closes" on the apply form when full (omit = unlimited)
  active?: boolean; // false = retired: hidden from the apply form, steering pool & role pickers (existing people in it are untouched). Defaults true.
  trainingGroupUrl?: string;
  defaultCreator?: string; // creator name
  manager?: string; // manager display name (e.g. Haria for Reddit)
};

export const ROLES: RoleSeed[] = [
  {
    key: "x_va",
    displayName: "X (Twitter) VA",
    trialHours: 24,
    capacity: 15,
    defaultCreator: "Lola",
    trainingGroupUrl: "", // <add>
  },
  // ── Retired: Instagram/TikTok ban waves make these unscalable, so all intake
  //    now funnels to X and Reddit only. active:false hides them from the apply
  //    form, the steering pool and role pickers. Anyone already in these roles
  //    is untouched. Flip active back to true (redeploy) to reopen.
  {
    key: "tiktok_va",
    displayName: "TikTok VA",
    trialHours: 24,
    capacity: 15,
    active: false,
    defaultCreator: "Lae",
    trainingGroupUrl: "https://t.me/+WIGJd1ocdz83MjU1",
  },
  {
    key: "ig_manager",
    displayName: "Instagram Account Manager",
    trialHours: 24,
    capacity: 12,
    active: false,
    defaultCreator: "Lae",
    trainingGroupUrl: "https://t.me/+IsalwXJfY5dkNWQ1",
  },
  {
    key: "ig_dm_handler",
    displayName: "Instagram DM Handler",
    trialHours: 24,
    capacity: 10,
    active: false,
    defaultCreator: "Lae",
    trainingGroupUrl: "", // <add>
  },
  {
    key: "video_editor",
    displayName: "Video Editor",
    trialHours: 24,
    capacity: 10,
    active: false,
    defaultCreator: "Lae",
    trainingGroupUrl: "", // <add>
  },
  {
    key: "reddit_va",
    displayName: "Reddit VA",
    trialHours: 24,
    capacity: 20,
    manager: "Haria",
    trainingGroupUrl: "", // <Haria Reddit SOP>
  },
];

// ── Platform + trial output targets (drive the watcher's 1–10 rating) ────────
export const ROLE_PLATFORM: Record<string, "x" | "instagram" | "reddit" | "tiktok"> = {
  x_va: "x",
  tiktok_va: "tiktok",
  ig_manager: "instagram",
  ig_dm_handler: "instagram",
  video_editor: "tiktok",
  reddit_va: "reddit",
};

// postsPerDay = the trial's daily output target; window is the role's trial_hours.
export const ROLE_TARGETS: Record<string, { postsPerDay: number; label: string }> = {
  x_va: { postsPerDay: 8, label: "multiple posts/day + viral-reply targeting" },
  tiktok_va: { postsPerDay: 3, label: "3 reels/slideshows a day" },
  ig_manager: { postsPerDay: 3, label: "3 reels/day + 1 story" },
  ig_dm_handler: { postsPerDay: 1, label: "DMs worked once/day" },
  video_editor: { postsPerDay: 6, label: "a full batch of edits" },
  reddit_va: { postsPerDay: 4, label: "posts to allowed subs, well spaced" },
};

// ── Rubrics (criteria sum to 100 for every role) ─────────────────────────────
export const RUBRICS: Record<string, { name: string; criteria: RubricCriterion[] }> = {
  x_va: {
    name: "X (Twitter) VA — Trial Rubric",
    criteria: [
      {
        key: "posting_volume",
        label: "Posting volume / cadence",
        weight: 20,
        anchor_5: "Hit the multi-post/day target, spaced naturally across the day",
        anchor_3: "Posted a few times but cadence uneven or below target",
        anchor_1: "One or two posts; clearly under the bar",
      },
      {
        key: "caption_quality",
        label: "Caption quality & hooks",
        weight: 20,
        anchor_5: "On-persona, teasy, scroll-stopping; varied, not copy-paste",
        anchor_3: "Readable captions but generic or repetitive",
        anchor_1: "Flat, off-persona, or copy-pasted captions",
      },
      {
        key: "reply_targeting",
        label: "Reply targeting",
        weight: 15,
        anchor_5: "Replies placed under genuinely viral, <20h-old posts with reach",
        anchor_3: "Some replies but on low-reach or older posts",
        anchor_1: "No targeted replies, or replies with no strategy",
      },
      {
        key: "visual_selection",
        label: "Visual selection",
        weight: 15,
        anchor_5: "Picked the strongest photos for the format/audience",
        anchor_3: "Acceptable photos but not the best available",
        anchor_1: "Weak or off-brand image choices",
      },
      {
        key: "persona_fit",
        label: "Persona fit",
        weight: 10,
        anchor_5: "Matched the model's voice/brand consistently",
        anchor_3: "Mostly on-voice with some slips",
        anchor_1: "Off-voice / inconsistent persona",
      },
      {
        key: "account_safety",
        label: "Account safety",
        weight: 10,
        anchor_5: "Natural behaviour, no spammy link dumping, no flags/ban",
        anchor_3: "Mostly safe but some risky patterns",
        anchor_1: "Spammy behaviour or got the account flagged",
      },
      {
        key: "communication",
        label: "Communication & reliability",
        weight: 10,
        anchor_5: "Responsive, showed first post promptly, followed the brief",
        anchor_3: "Some lag or partial brief adherence",
        anchor_1: "Unresponsive or ignored the brief",
      },
    ],
  },
  tiktok_va: {
    name: "TikTok VA — Trial Rubric",
    criteria: [
      {
        key: "output_volume",
        label: "Output volume",
        weight: 20,
        anchor_5: "Hit the daily reel/slideshow target (3/day)",
        anchor_3: "Some output but below the daily target",
        anchor_1: "Minimal output",
      },
      {
        key: "hook_strength",
        label: "Hook strength",
        weight: 20,
        anchor_5: "First 1–2s stops the scroll every time",
        anchor_3: "Hooks present but inconsistent",
        anchor_1: "Weak or absent hooks",
      },
      {
        key: "edit_quality",
        label: "Edit quality",
        weight: 15,
        anchor_5: "Vertical, full-res, clean, no watermark, on-screen text where it fits",
        anchor_3: "Watchable but rough edges or watermarks",
        anchor_1: "Low quality, watermarked, or wrong format",
      },
      {
        key: "trend_use",
        label: "Trend/format use",
        weight: 15,
        anchor_5: "Trending/fitting audio; copied proven viral formats",
        anchor_3: "Some trend awareness but generic",
        anchor_1: "No trend/format awareness",
      },
      {
        key: "account_safety",
        label: "Account safety / ban avoidance",
        weight: 15,
        anchor_5: "SFW, correct setup, no account-mixing, no nudity",
        anchor_3: "Mostly safe with minor risks",
        anchor_1: "Posted unsafe content or risked a ban",
      },
      {
        key: "cta_link_routing",
        label: "CTA / link routing",
        weight: 10,
        anchor_5: "Clear funnel to bio/link",
        anchor_3: "CTA present but weak",
        anchor_1: "No CTA / no funnel",
      },
      {
        key: "consistency",
        label: "Consistency & reliability",
        weight: 5,
        anchor_5: "Steady output, followed instructions",
        anchor_3: "Some inconsistency",
        anchor_1: "Erratic, ignored instructions",
      },
    ],
  },
  ig_manager: {
    name: "Instagram Account Manager — Trial Rubric",
    criteria: [
      {
        key: "reels_volume",
        label: "Reels: volume (3/day)",
        weight: 18,
        anchor_5: "Three edited + posted reels",
        anchor_3: "One or two reels",
        anchor_1: "No reels posted",
      },
      {
        key: "reels_edit_quality",
        label: "Reels: edit quality",
        weight: 17,
        anchor_5: "Vertical, full quality, on-brand, strong hook",
        anchor_3: "Acceptable edits, weak hook",
        anchor_1: "Poor edits / off-brand",
      },
      {
        key: "daily_story_cta",
        label: "Daily story + link sticker + CTA",
        weight: 15,
        anchor_5: "Teasy photo, link sticker, clear 'tap here' CTA",
        anchor_3: "Story posted but missing sticker or CTA",
        anchor_1: "No story / no link routing",
      },
      {
        key: "engagement_activity",
        label: "Engagement activity",
        weight: 12,
        anchor_5: "Real ~1h in-niche scrolling/liking/commenting",
        anchor_3: "Some engagement, not in-niche or brief",
        anchor_1: "No meaningful engagement",
      },
      {
        key: "dm_redirect",
        label: "DM redirect skill",
        weight: 13,
        anchor_5: "Warm, natural nudge to bio — not link spam",
        anchor_3: "Redirects but stiff or repetitive",
        anchor_1: "Spammy or no redirect",
      },
      {
        key: "account_safety",
        label: "Account safety",
        weight: 15,
        anchor_5: "No URL spam in DMs, no banned behaviour",
        anchor_3: "Mostly safe, minor risks",
        anchor_1: "Risky behaviour / URL spam",
      },
      {
        key: "reliability",
        label: "Reliability & communication",
        weight: 10,
        anchor_5: "Followed the system, responsive",
        anchor_3: "Partial adherence",
        anchor_1: "Unreliable / unresponsive",
      },
    ],
  },
  ig_dm_handler: {
    name: "Instagram DM Handler — Trial Rubric",
    criteria: [
      {
        key: "redirect_technique",
        label: "Redirect technique",
        weight: 20,
        anchor_5: "Compliment first, warm nudge to bio, in-persona",
        anchor_3: "Redirects but mechanical",
        anchor_1: "No redirect skill",
      },
      {
        key: "script_rotation",
        label: "Script rotation",
        weight: 15,
        anchor_5: "Varied openers, never identical blasts",
        anchor_3: "Some variation",
        anchor_1: "Identical copy-paste blasts",
      },
      {
        key: "link_safety",
        label: "Link safety",
        weight: 20,
        anchor_5: "Sends to bio, never spams the raw URL",
        anchor_3: "Mostly safe, occasional raw link",
        anchor_1: "Repeatedly pastes the raw URL",
      },
      {
        key: "lead_prioritisation",
        label: "Lead prioritisation",
        weight: 15,
        anchor_5: "Works story-repliers / engaged users first",
        anchor_3: "Some prioritisation",
        anchor_1: "No lead prioritisation",
      },
      {
        key: "volume",
        label: "Volume",
        weight: 10,
        anchor_5: "Worked a solid number of DMs",
        anchor_3: "Moderate volume",
        anchor_1: "Very few DMs worked",
      },
      {
        key: "boundary_discipline",
        label: "Boundary discipline",
        weight: 10,
        anchor_5: "One nudge → move on; ignores time-wasters/abuse",
        anchor_3: "Mostly disciplined",
        anchor_1: "Over-engages time-wasters",
      },
      {
        key: "tone_persona",
        label: "Tone / persona match",
        weight: 10,
        anchor_5: "Sounds like the model",
        anchor_3: "Close but inconsistent",
        anchor_1: "Off-tone / off-persona",
      },
    ],
  },
  video_editor: {
    name: "Video Editor — Trial Rubric",
    criteria: [
      {
        key: "output_volume",
        label: "Output volume",
        weight: 18,
        anchor_5: "Hit the batch target on time",
        anchor_3: "Partial batch",
        anchor_1: "Minimal output",
      },
      {
        key: "hook_strength",
        label: "Hook strength",
        weight: 20,
        anchor_5: "First frame stops the scroll",
        anchor_3: "Hooks present but weak",
        anchor_1: "No hook",
      },
      {
        key: "technical_quality",
        label: "Technical quality",
        weight: 17,
        anchor_5: "Vertical, full-res, clean cuts, no watermark",
        anchor_3: "Acceptable with rough edges",
        anchor_1: "Low quality / watermarked",
      },
      {
        key: "caption_quality",
        label: "Caption quality",
        weight: 15,
        anchor_5: "Teasy, on-brand, platform-safe",
        anchor_3: "Generic captions",
        anchor_1: "Weak or unsafe captions",
      },
      {
        key: "trend_awareness",
        label: "Trend/format awareness",
        weight: 12,
        anchor_5: "Matched proven formats / reference accounts",
        anchor_3: "Some awareness",
        anchor_1: "No format awareness",
      },
      {
        key: "turnaround_speed",
        label: "Turnaround speed",
        weight: 10,
        anchor_5: "Fast without quality drop",
        anchor_3: "Acceptable speed",
        anchor_1: "Slow / missed timing",
      },
      {
        key: "brief_adherence",
        label: "Brief adherence",
        weight: 8,
        anchor_5: "Followed instructions/reference exactly",
        anchor_3: "Mostly followed",
        anchor_1: "Ignored the brief/reference",
      },
    ],
  },
  reddit_va: {
    name: "Reddit VA — Trial Rubric",
    criteria: [
      {
        key: "subreddit_selection",
        label: "Subreddit selection & rule compliance",
        weight: 20,
        anchor_5: "Posts only to allowed subs, follows every sub's rules",
        anchor_3: "Mostly compliant, minor rule slips",
        anchor_1: "Posted to disallowed subs / broke rules",
      },
      {
        key: "title_quality",
        label: "Title/caption quality",
        weight: 15,
        anchor_5: "Engaging, sub-appropriate, varied",
        anchor_3: "Acceptable but generic",
        anchor_1: "Weak or inappropriate titles",
      },
      {
        key: "posting_cadence",
        label: "Posting cadence / volume",
        weight: 15,
        anchor_5: "Hit target without tripping spam filters",
        anchor_3: "Some posts, uneven pacing",
        anchor_1: "Too few or spam-flagged",
      },
      {
        key: "account_health",
        label: "Account-health awareness",
        weight: 20,
        anchor_5: "Understands karma/age/verification + warming; no instant bans",
        anchor_3: "Some awareness, a couple of missteps",
        anchor_1: "No account-health awareness; got banned",
      },
      {
        key: "verification_handling",
        label: "Verification handling",
        weight: 10,
        anchor_5: "Completes sub verification properly where required",
        anchor_3: "Partial verification handling",
        anchor_1: "Skipped/failed verification",
      },
      {
        key: "funnel_routing",
        label: "Funnel routing",
        weight: 10,
        anchor_5: "Routes traffic correctly",
        anchor_3: "Some routing",
        anchor_1: "No funnel routing",
      },
      {
        key: "reliability_process",
        label: "Reliability + works within Haria's process",
        weight: 10,
        anchor_5: "Follows the SOP, responsive",
        anchor_3: "Partial SOP adherence",
        anchor_1: "Ignored the SOP",
      },
    ],
  },
};

// ── Message templates (merge fields in {{double_braces}}) ────────────────────
export type TemplateSeed = {
  key: string;
  roleKey?: string | null;
  category: "first_touch" | "brief" | "offer" | "retrial" | "decline" | "training" | "other";
  subject?: string;
  body: string;
};

export const TEMPLATES: TemplateSeed[] = [
  {
    key: "first_touch",
    roleKey: null,
    category: "first_touch",
    subject: "First touch — which role + why",
    body: `Hey {{first_name}}! Nice to meet you.

Thanks for applying! We're focused on two roles right now:

• X (Twitter) VA
• Reddit VA

Which one is your strong point — and WHY?`,
  },
  {
    key: "training_generic",
    roleKey: null,
    category: "training",
    subject: "Training before your trial",
    body: `Awesome, {{first_name}} — great choice.

Before the trial, read the training top to bottom so you know exactly what good looks like: {{training_group_url}}

Tap "I've read it" when you're done and I'll unlock the next step 🙂`,
  },
  {
    key: "brief_x_va",
    roleKey: "x_va",
    category: "brief",
    subject: "X VA trial brief",
    body: `Here's how this works: a {{trial_hours}}hr trial so we can see your skill set. Use any X account — this is just about your ability.

How we operate: post multiple times a day with easy photos and engaging captions, mixing regular feed posts with replies placed under posts that went viral in the last ~20h.

Model for your trial: {{model_name}}.
Her main page (which you could manage if your trial is strong): {{model_main_url}}
Content to use: {{content_drive_url}}

Show me when your first post is up 🙂`,
  },
  {
    key: "brief_tiktok_va",
    roleKey: "tiktok_va",
    category: "brief",
    subject: "TikTok VA trial brief",
    body: `Training first — read this top to bottom before you start: {{training_group_url}}

Model for your trial: {{model_name}}. This is a {{trial_hours}}hr trial — strong performance = hired. Use any account; it's just to see how well you understand the job.

Content to use: {{content_drive_url}}
(If there's any nude/explicit content in the folder, ignore it — that would get the account banned. Trial is SFW only.)

Send me the account you'll be using.`,
  },
  {
    key: "brief_ig_manager",
    roleKey: "ig_manager",
    category: "brief",
    subject: "Instagram Account Manager trial brief",
    body: `Training first — read this fully before you start: {{training_group_url}}

Next step is seeing how you run an IG account. Model: {{model_name}}. This is a {{trial_hours}}hr trial — if you're good, you're hired. Use any account; it's just to see how well you understand the job.

Content to use: {{content_drive_url}}

Show me the account you'll be using 🙂`,
  },
  {
    key: "brief_ig_dm_handler",
    roleKey: "ig_dm_handler",
    category: "brief",
    subject: "Instagram DM Handler trial brief",
    body: `Training first — read this fully before you start: {{training_group_url}}

This is a {{trial_hours}}hr trial for DM handling. Work DMs once through: compliment first, then a warm nudge to the bio — never paste the raw link. Rotate your openers, prioritise story-repliers (warmest leads), and give one nudge then move on.

Model: {{model_name}}.

Show me the account you'll be working from 🙂`,
  },
  {
    key: "brief_video_editor",
    roleKey: "video_editor",
    category: "brief",
    subject: "Video Editor trial brief",
    body: `Training first — read this fully before you start: {{training_group_url}}

This is a {{trial_hours}}hr trial. Repurpose the shot content into slideshows/short clips with teasy, platform-safe captions. Volume + consistency matters, and keep everything safe so accounts don't get banned. Match the reference accounts.

Content to use: {{content_drive_url}}

Send me your first batch of edits when they're ready 🙂`,
  },
  {
    key: "brief_reddit_va",
    roleKey: "reddit_va",
    category: "brief",
    subject: "Reddit VA trial brief",
    body: `Training first — read the SOP fully before you start: {{training_group_url}}

This is a {{trial_hours}}hr trial. Post to allowed NSFW subs only, following each sub's rules to the letter. Mind karma/age/verification and account warming — no instant bans. Strong, sub-appropriate titles, and route traffic correctly.

Show me the account you'll be using and your first post when it's up 🙂`,
  },
  {
    key: "offer",
    roleKey: null,
    category: "offer",
    subject: "Offer — you're in",
    body: `{{first_name}}, great news — your trial was strong and we'd love to bring you on for {{model_name}}'s {{role_name}} 🎉

Next steps: I'll get your onboarding started (payment setup + access). Welcome aboard!`,
  },
  {
    key: "retrial",
    roleKey: null,
    category: "retrial",
    subject: "Re-trial — one more go",
    body: `{{first_name}}, thanks for the trial — you're close. A couple of things to tighten up:

{{feedback}}

I'd like to give you one more {{trial_hours}}hr go with that in mind. Up for it? 🙂`,
  },
  {
    key: "decline",
    roleKey: null,
    category: "decline",
    subject: "Polite decline",
    body: `Hey {{first_name}}, thanks so much for taking the time to trial with us. It's not the right fit this time, but we genuinely appreciate the effort you put in and wish you the best 🙏`,
  },
];
