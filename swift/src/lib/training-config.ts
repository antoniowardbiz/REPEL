// Canonical training modules seeded per role (Phase 4). Each has short reading
// material and an auto-graded multiple-choice quiz that gates the trial. Keep
// questions unambiguous — a wrong answer should reflect a real misunderstanding
// of the brief, not a trick.

export type QuizQuestion = {
  prompt: string;
  options: string[];
  answer: number; // index into options
};

export type TrainingModuleConfig = {
  title: string;
  passPct: number;
  content: string;
  questions: QuizQuestion[];
};

// Shared safety rules every VA must internalize before a trial. Plain text —
// the training page renders content verbatim, so no markdown markers here.
const SAFETY = `ACCOUNT SAFETY — applies to every role
• Never post nudity or explicit content on a SFW platform (X SFW, TikTok, Instagram, Reddit SFW subs). One violation can ban the account — that is an automatic fail.
• Use only the trial account we give you. Never log into it from a flagged device, never change the password, email, or 2FA.
• Space your activity out naturally. Dumping 20 posts in 10 minutes looks like a bot and gets accounts limited.
• If anything looks risky (a shadowban, a warning, a takedown), stop and message the operator — do not push through it.`;

export const TRAINING_MODULES: Record<string, TrainingModuleConfig> = {
  x_va: {
    title: "X (Twitter) VA — Trial Training",
    passPct: 80,
    content: `X VA TRIAL
Your job is to grow the model's X presence and drive attention back to her main
account — without getting the account limited.

YOUR DAILY NUMBERS (every day)
• POSTS: 6 to the main feed, spread naturally across the day.
• FOLLOW: 50-60 — people who like/comment, and other OF creators.
• UNFOLLOW: 50-60 (keeps the follow ratio clean).
• VIRAL: comment under 5 posts that went viral in the last 24 hours.
• LIKES: like posts across the niche throughout the day.
• RT (retweets): "horny text" — text-only, no images — 1-3x a day.
• DMs: reply to all that come in (volume depends on how many you get).

WHAT GREAT LOOKS LIKE
• Every post is quality: a strong photo with an engaging, on-persona caption — varied, never copy-paste.
• Viral comments land under big, fresh posts where the eyeballs are.
• Everything points attention back to the model's main account.
• Match the model's voice: flirty-but-SFW, confident, never crude on a SFW account.

${SAFETY}`,
    questions: [
      {
        prompt: "How many times should you post each day in total?",
        options: [
          "6 posts to the main page, plus multiple replies under posts that went viral in the last 24 hours",
          "1–2 posts whenever you get time",
          "As many as possible — dump 30+ posts in one burst",
        ],
        answer: 0,
      },
      {
        prompt: "What makes a post good enough to publish?",
        options: [
          "A strong photo with an engaging, on-persona caption — varied, never copy-paste",
          "Any photo with a one-word caption — volume is all that matters",
          "The exact same caption reused on every post to save time",
        ],
        answer: 0,
      },
      {
        prompt: "You notice the account may be shadowbanned mid-trial. You should:",
        options: [
          "Keep posting harder to push through it",
          "Stop and message the operator",
          "Change the account password to reset it",
        ],
        answer: 1,
      },
      {
        prompt: "What is the point of your replies?",
        options: [
          "Drive attention back to the model's main account",
          "Argue with big accounts for engagement",
          "Get as many of your own followers as possible",
        ],
        answer: 0,
      },
    ],
  },

  tiktok_va: {
    title: "TikTok VA — Trial Training",
    passPct: 80,
    content: `# TikTok VA trial
You'll batch SFW short-form content (slideshows / clips) for the model using
trending audio and strong first frames.

## What a great trial looks like
- A batch of posts with scroll-stopping first frames and clean captions.
- Current, trending audio that fits the clip — not random or copyrighted-risky tracks.
- Consistent posting spacing, not everything at once.
- 100% SFW: suggestive is fine within TikTok's rules, explicit is never.

${SAFETY}`,
    questions: [
      {
        prompt: "What matters most in the first second of a TikTok?",
        options: [
          "A strong, scroll-stopping first frame/hook",
          "A long intro explaining the video",
          "The number of hashtags",
        ],
        answer: 0,
      },
      {
        prompt: "Choosing audio for a clip, you should pick:",
        options: [
          "Any song you personally like",
          "Current trending audio that fits the clip",
          "The longest track available",
        ],
        answer: 1,
      },
      {
        prompt: "TikTok is a SFW platform. Your content must be:",
        options: [
          "Explicit to stand out",
          "Within TikTok's rules — suggestive at most, never explicit",
          "Whatever gets the most views regardless of rules",
        ],
        answer: 1,
      },
      {
        prompt: "You batched 8 posts. Best way to publish them?",
        options: [
          "All at once to save time",
          "Spaced out to look natural and avoid limits",
          "Only if they each already have views",
        ],
        answer: 1,
      },
    ],
  },

  ig_manager: {
    title: "Instagram Manager — Trial Training",
    passPct: 80,
    content: `# Instagram Manager trial
You'll manage the model's IG grid + stories: posting on-brand content, keeping a
consistent aesthetic, and using stories/close-friends to funnel attention.

## What a great trial looks like
- On-aesthetic posts and stories that match the model's existing look.
- Smart use of stories and CTAs to move viewers toward the funnel.
- Consistent cadence; no spammy bursts that trip IG's limits.
- Strictly within IG's rules — SFW grid, no nudity, no banned hashtags.

${SAFETY}`,
    questions: [
      {
        prompt: "Your IG content should:",
        options: [
          "Match the model's existing aesthetic and brand",
          "Look completely different each post for variety",
          "Copy a competitor's grid exactly",
        ],
        answer: 0,
      },
      {
        prompt: "Stories are best used to:",
        options: [
          "Post nudity that the grid can't show",
          "Funnel attention toward the model's offer with SFW CTAs",
          "Repost unrelated memes all day",
        ],
        answer: 1,
      },
      {
        prompt: "To avoid IG limiting the account you should:",
        options: [
          "Post 15 times in 5 minutes",
          "Keep a natural, consistent cadence",
          "Use as many banned hashtags as possible",
        ],
        answer: 1,
      },
      {
        prompt: "The grid is SFW. Nudity on it is:",
        options: [
          "Fine if it gets engagement",
          "An automatic fail — never post it",
          "OK in stories only",
        ],
        answer: 1,
      },
    ],
  },

  ig_dm_handler: {
    title: "Instagram DM Handler — Trial Training",
    passPct: 80,
    content: `# IG DM Handler trial
You'll run the model's DMs: warm, human replies that build rapport and guide fans
to the offer — without spamming links or breaking character.

## What a great trial looks like
- Warm, personable replies that sound like the model, not a script.
- Rapport first; the link comes naturally once there's genuine interest.
- Never blast the same link to everyone or spam on the first message.
- Follow the brief's tone and boundaries exactly.

${SAFETY}`,
    questions: [
      {
        prompt: "A fan just said hi. Your first move is to:",
        options: [
          "Immediately paste the paid link",
          "Build rapport with a warm, human reply",
          "Send five links in a row",
        ],
        answer: 1,
      },
      {
        prompt: "Good DM handling means your replies:",
        options: [
          "Sound like the model — warm and personable",
          "Are identical copy-paste to everyone",
          "Ignore what the fan actually said",
        ],
        answer: 0,
      },
      {
        prompt: "When should the offer link come up?",
        options: [
          "Naturally, once there's genuine interest",
          "In the very first message, always",
          "Never — links are banned",
        ],
        answer: 0,
      },
      {
        prompt: "The brief sets a boundary you disagree with. You:",
        options: [
          "Follow the brief exactly",
          "Do your own thing since you know better",
          "Ask the fan what they'd prefer",
        ],
        answer: 0,
      },
    ],
  },

  video_editor: {
    title: "Video Editor — Trial Training",
    passPct: 80,
    content: `# Video Editor trial
You'll turn raw clips into clean vertical short-form: strong first frames, tight
pacing, readable captions, fast turnaround.

## What a great trial looks like
- Vertical (9:16), clean cuts, strong hook in the first frame.
- Readable captions/subtitles synced to the audio.
- On-brief edits delivered on time in the batch folder we specify.
- SFW output for SFW platforms; follow the brief's spec exactly.

${SAFETY}`,
    questions: [
      {
        prompt: "Short-form edits should be delivered in what format?",
        options: ["Horizontal 16:9", "Vertical 9:16", "Square only"],
        answer: 1,
      },
      {
        prompt: "The single most important part of a short clip is:",
        options: [
          "A strong hook in the first frame",
          "A long outro with credits",
          "As many transitions as possible",
        ],
        answer: 0,
      },
      {
        prompt: "Captions/subtitles should be:",
        options: [
          "Skipped to save time",
          "Readable and synced to the audio",
          "In a tiny font in the corner",
        ],
        answer: 1,
      },
      {
        prompt: "Where do you deliver the finished batch?",
        options: [
          "Wherever is convenient for you",
          "The batch folder specified in the brief, on time",
          "Only after the deadline passes",
        ],
        answer: 1,
      },
    ],
  },

  reddit_va: {
    title: "Reddit VA — Trial Training",
    passPct: 80,
    content: `PLEASE READ THIS — IMPORTANT INFO TO SECURE YOUR JOB

This is a good-paying job if you perform, and there is massive room for growth.

💰 Pay: $2/hour · 4 hours a day · PLUS 10% commission on all spend from the subs that come from your link.
Many of our Reddit VAs are making upwards of $500 a week.

You will be under a manager. We prefer people who come with accounts ready — but if you don't have one, you will be trained and set up with an account.

THE JOB
Post the model's content into the right subreddits, following each sub's rules, verification and karma requirements — no removals, no bans.

NON-NEGOTIABLES
• A banned account is an automatic fail. Account safety comes first, always.
• Report to your manager every day.
• Space posts out naturally — never spam the same post everywhere at once.
• If anything looks risky (shadowban, warning, takedown), stop and message your manager.

Answer these questions so we understand your competency.`,
    questions: [
      {
        prompt: "Before posting to a subreddit you should:",
        options: [
          "Read and follow that sub's specific rules",
          "Ignore the rules — mods rarely check",
          "Post the same title everywhere",
        ],
        answer: 0,
      },
      {
        prompt: "Should you report to your manager each day?",
        options: ["Yes", "No"],
        answer: 0,
      },
      {
        prompt: "To avoid removals and bans you should:",
        options: [
          "Cross-post the identical post to 20 subs in one minute",
          "Space posts out and match each sub's rules",
          "Argue with mods who remove your posts",
        ],
        answer: 1,
      },
      {
        prompt: "Getting the trial account banned is:",
        options: [
          "No big deal, we'll make another",
          "An automatic fail — the most serious mistake you can make",
          "A sign you're posting enough",
        ],
        answer: 1,
      },
    ],
  },
};
