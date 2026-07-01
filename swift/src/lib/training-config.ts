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

// Shared safety rules every VA must internalize before a trial.
const SAFETY = `## Account safety (applies to every role)
- Never post nudity or explicit content on a SFW platform (X SFW, TikTok, Instagram, Reddit SFW subs). One violation can ban the account — that is an automatic fail.
- Use only the trial account we give you. Never log into it from a flagged device, never change the password, email, or 2FA.
- Space your activity out naturally. Dumping 20 posts in 10 minutes looks like a bot and gets accounts limited.
- If anything looks risky (a shadowban, a warning, a takedown), stop and message the operator — do not push through it.`;

export const TRAINING_MODULES: Record<string, TrainingModuleConfig> = {
  x_va: {
    title: "X (Twitter) VA — Trial Training",
    passPct: 80,
    content: `# X VA trial
Your job is to grow and warm the model's X presence with on-brand replies and
reposts that drive attention back to the main account — without getting the
account limited.

## What a great trial looks like
- Reply under larger accounts in the niche with short, witty, on-brand hooks.
- Keep a natural cadence (a handful of quality replies per hour, not a burst).
- Every action points attention back toward the model's main — no random spam.
- Match the model's voice: flirty-but-SFW, confident, never crude on a SFW account.

${SAFETY}`,
    questions: [
      {
        prompt: "You have 30 replies to make during the trial. What's the best approach?",
        options: [
          "Post all 30 in the first 15 minutes to hit the number fast",
          "Spread them out naturally over the window with quality hooks",
          "Copy-paste the same reply under every post",
        ],
        answer: 1,
      },
      {
        prompt: "The trial account is on SFW X. Someone asks for explicit content. You:",
        options: [
          "Post explicit content to convert them",
          "Keep it SFW and steer attention to the model's main",
          "Ignore the platform rules since it's just a trial",
        ],
        answer: 1,
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
    content: `# Reddit VA trial
You'll post the model's content into the right subreddits, respecting each sub's
rules, verification, and karma requirements to avoid removals and bans.

## What a great trial looks like
- Posts land in subs where they fit, with titles that follow each sub's rules.
- You respect verification, karma, and cooldown requirements per sub.
- Natural spacing across subs — not the same post spammed everywhere at once.
- Removals are minimized; a banned account is an automatic fail.

${SAFETY}`,
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
        prompt: "Many NSFW subs require:",
        options: [
          "Nothing — anyone can post",
          "Verification and/or a minimum karma before posting",
          "A paid subscription to Reddit",
        ],
        answer: 1,
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
          "An automatic fail",
          "A sign you're posting enough",
        ],
        answer: 1,
      },
    ],
  },
};
