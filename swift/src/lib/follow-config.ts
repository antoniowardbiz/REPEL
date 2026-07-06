// Example accounts VAs should FOLLOW + STUDY — top creators in the niche whose
// captions, visuals and teasing style are the model to copy. Following them and
// engaging their newest viral posts also warms the account and trains the
// algorithm. Edit this list here (a quick config deploy); it flows into the
// onboarding profile-setup message and the "who to follow" bot command.

export const FOLLOW_EXAMPLES: string[] = [
  "imdestinymac",
  "milfshub2",
  "mysnowbqueen",
  "esperanzagomez",
  "fifisdrt",
  "avanicks",
  "lilbellyjellyx",
  "saracelest98776",
  "itsrubycakes",
];

/**
 * A ready-to-send "who to follow & study" block (empty string if the list is
 * empty, so callers can drop the section cleanly).
 */
export function followExamplesBlock(): string {
  if (FOLLOW_EXAMPLES.length === 0) return "";
  const lines = FOLLOW_EXAMPLES.map((h) => {
    const handle = h.replace(/^@/, "");
    return `• @${handle} — https://x.com/${handle}`;
  }).join("\n");
  return (
    `👀 WHO TO FOLLOW & STUDY — top creators in the niche:\n${lines}\n\n` +
    `Follow all of them, then every day like + reply on their NEWEST viral posts. ` +
    `It trains the algorithm, gets your account seen, and shows you the exact caption + teasing style to copy.`
  );
}
