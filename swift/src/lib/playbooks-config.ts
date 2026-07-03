// Short, public per-role SOPs ("playbooks") shown at /playbook/<roleKey>. Linked
// from the trial brief so applicants have one place to learn exactly how we
// operate. Keep them tight and scannable — this is a quick reference, not a book.

export type PlaybookSection = { h: string; body: string; bullets?: string[] };
export type Playbook = { title: string; intro: string; sections: PlaybookSection[] };

export const PLAYBOOKS: Record<string, Playbook> = {
  x_va: {
    title: "X (Twitter) VA — Playbook",
    intro:
      "You run a model's X presence like it's the job: grow her reach, keep the account active and natural, and turn attention into fans on her page. This is exactly what a strong trial (and a strong hire) looks like.",
    sections: [
      {
        h: "Your daily numbers",
        body: "Hit these every day — it's the rhythm of the role:",
        bullets: [
          "6 feed posts (teasy, SFW, strong captions)",
          "50–60 follows + 50–60 unfollows (relevant accounts, keep the ratio healthy)",
          "5 viral comments (replies under posts that blew up in the last ~20h)",
          "Likes + retweets through the day to stay active",
          "Horny/teasy text posts 1–3× a day",
          "DMs worked as they come in",
        ],
      },
      {
        h: "What to post",
        body:
          "Strong, teasy SFW photos with captions that stop the scroll. Vary them — never copy-paste the same line. Stay on-brand for the model's voice. Mix in a few text-only teasy posts and retweets so the feed feels alive.",
      },
      {
        h: "Replies are the growth engine",
        body:
          "Find posts that went viral in the last ~20 hours in the niche and drop a teasy, on-brand reply that earns profile clicks. This is where most of your growth comes from — pick big, fresh posts, not old or low-reach ones.",
      },
      {
        h: "DMs",
        body:
          "Warm and human. Compliment first, then a natural nudge toward her page/link — never paste a raw link or spam. One nudge, then move on.",
      },
      {
        h: "Stay safe (don't get the account banned)",
        body: "Bans kill the account and the income. Non-negotiables:",
        bullets: [
          "SFW only on the feed — no nudity or explicit content",
          "Natural pacing — don't blast posts/follows in bursts",
          "Vary captions and replies — repetition looks like a bot",
          "No link-dumping, no bought followers",
          "No password changes; stop + report anything risky (shadowban, warning)",
        ],
      },
      {
        h: "The trial → getting hired",
        body:
          "It's a paid 24-hour trial: use any X account, hit the targets above, and show us your skill. Send your first post link in Telegram with the word SUBMIT. Strong trials get hired fastest — hires get a model, a content drive, daily targets, and pay ($75 bi-weekly, rising after your first two weeks if performance is high).",
      },
    ],
  },
  reddit_va: {
    title: "Reddit VA — Playbook",
    intro:
      "You post a model's content to the right subreddits, safely and by each sub's rules, to drive traffic to her page. Your manager sets you up and tells you exactly what to post.",
    sections: [
      {
        h: "How it works",
        body:
          "After you pass the quiz you'll be asked if you have a Reddit account. Either way you go to your manager, who checks or sets up + warms an account so it never gets banned, then tells you what to post. Once you're posting, send your link in Telegram with the word SUBMIT.",
      },
      {
        h: "Posting",
        body: "Quality over quantity — get it right for each sub:",
        bullets: [
          "Post only to allowed NSFW subs, following each sub's rules exactly",
          "Space posts out — don't trip spam filters",
          "Strong, sub-appropriate titles (vary them)",
          "Complete any required verification properly",
        ],
      },
      {
        h: "Account health",
        body:
          "Karma, account age and verification matter. A brand-new account posting hard gets banned instantly — that's why we warm accounts first. Follow your manager's process.",
      },
      {
        h: "Pay",
        body: "$75 bi-weekly + 10% commission on all spend from your subs — rises after your first two weeks if performance is high. Top Reddit VAs make $500+/week.",
      },
    ],
  },

  // ── Manager playbooks ──────────────────────────────────────────────────────
  // Forward to the person running each manager handle. Same skin as the VA
  // playbooks; served at /playbook/x_manager and /playbook/reddit_manager.
  x_manager: {
    title: "X (Twitter) Manager — Playbook",
    intro:
      "Every X VA reaches you already hired — they pass a self-serve trial, then the bot sends them straight to you. Your job is to get them live and earning fast: account access, payment, and their first day sorted.",
    sections: [
      {
        h: "How they arrive",
        body:
          "They message you already hired, usually: “Just got hired as X VA for [model] — ready for account access + payment.” That's your cue. No trial to run, no account to warm — they've proven they can do the job. Get them set up.",
      },
      {
        h: "1 · Welcome + connect",
        body: "Warm first — people who feel part of a team work harder.",
        bullets: [
          "“Congrats & welcome to the team 🎉 I'm your X manager — you're running [model].”",
          "Get their name, timezone (their posting hours), and any X/promo experience",
        ],
      },
      {
        h: "2 · Account access",
        body:
          "Get them into the model's X account the way we do it — secure login / shared access. Confirm they can post, comment, retweet and handle DMs before moving on.",
        bullets: [
          "Never share a raw password in plain chat",
          "Set the rules up front: no password changes, natural pacing, stop + report anything risky (shadowban, lock)",
        ],
      },
      {
        h: "3 · Payment",
        body:
          "Set up how they get paid and confirm the terms + payout schedule so there's no confusion later. (Current pay is on the SWIFT dashboard.)",
      },
      {
        h: "4 · Add to the X team group",
        body:
          "Add them to the SWIFT X VA group so they see the rules, content, reminders and the rest of the team.",
      },
      {
        h: "5 · First day",
        body: "Point them at the content drive + their daily target, and send them the VA playbook for examples + do's and don'ts.",
        bullets: [
          "Daily: 6 feed posts · comment on 5 viral posts · RTs + teasy text 1–3×/day · DMs as they come",
          "VA playbook: /playbook/x_va",
        ],
      },
      {
        h: "Ongoing",
        body:
          "They check in with you daily, hit their target, and keep the account safe. Watch for risk (shadowban, engagement drop) and tell them to stop + report the moment something looks off.",
      },
    ],
  },
  reddit_manager: {
    title: "Reddit Manager — Playbook",
    intro:
      "Every Reddit VA is handed to you after they pass the quiz — either “I have an account” or “I need one set up.” Your job is to get them a safe, warmed account, into the group, and posting.",
    sections: [
      {
        h: "How they arrive",
        body:
          "The bot sends them to you with one of two lines: “I passed the quiz — I have a Reddit account” (with username) or “I don't have one, can you set me up?” Either way, same goal: a warmed, safe account ready to post.",
      },
      {
        h: "1 · Welcome + connect",
        body:
          "2–3 friendly messages before business — get their name, where they're based + timezone, and whether they've done Reddit/promo before. People who feel connected work harder and stay.",
      },
      {
        h: "2 · The account",
        body:
          "If they have one: get the username and check age / karma / not shadowbanned. If it's weak or brand-new, treat it like no account. If they don't have one: set one up on a clean email and save the login safely.",
      },
      {
        h: "3 · Warm it before ANY posting",
        body:
          "This is what stops bans. Spend a day or two joining subs, upvoting, a few comments, building karma, verifying where needed. Tell them why: “We warm it first so it never gets banned — that protects your money.”",
      },
      {
        h: "4 · Add to the group + first task",
        body:
          "Add them to the SWIFT Reddit VA's group (rules are pinned), then give them the content to post, the allowed subs, and the spacing rules.",
      },
      {
        h: "5 · 🔑 Get them to SUBMIT",
        body:
          "This is the step that hires them. Once their first post is live, they must go back to the SWIFT bot chat (not your DM) and send the post link + the word SUBMIT. If they only tell you “I posted,” nothing happens — say it clearly.",
      },
      {
        h: "Ongoing",
        body:
          "They check in daily, hit target, keep the account safe. Any removals or shadowban risk → stop and report to you before it becomes a ban.",
      },
    ],
  },
};
