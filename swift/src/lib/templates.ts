// Template merge-field rendering. Templates use {{merge_field}} placeholders.

export type MergeContext = {
  first_name?: string | null;
  model_name?: string | null;
  model_main_url?: string | null;
  content_drive_url?: string | null;
  training_group_url?: string | null;
  training_url?: string | null;
  trial_hours?: number | string | null;
  [k: string]: string | number | null | undefined;
};

const FIELD_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function renderTemplate(body: string, ctx: MergeContext): string {
  // Applicant-facing: never leak a raw {{placeholder}}. Empty/unset fields
  // render blank, and a line whose ONLY purpose was a now-empty field (a
  // dangling "Label: ") is dropped so the message still reads clean.
  const lines = body.split("\n").map((line) => {
    let emptied = false;
    const rendered = line.replace(FIELD_RE, (_m, key: string) => {
      const v = ctx[key.toLowerCase()];
      if (v === null || v === undefined || v === "") {
        emptied = true;
        return "";
      }
      return String(v);
    });
    // Drop a label line left dangling by an empty field (e.g. "Content to use: ").
    if (emptied && /:\s*$/.test(rendered)) return null;
    return rendered;
  });
  return lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** List the merge fields referenced by a template body. */
export function mergeFieldsIn(body: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(FIELD_RE);
  while ((m = re.exec(body))) out.add(m[1].toLowerCase());
  return [...out];
}

/** First name from a full name (best-effort). */
export function firstNameOf(fullName?: string | null): string {
  if (!fullName) return "there";
  return fullName.trim().split(/\s+/)[0] || "there";
}
