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
  return body.replace(FIELD_RE, (_m, key: string) => {
    const v = ctx[key.toLowerCase()];
    if (v === null || v === undefined || v === "") return `{{${key}}}`; // leave unresolved fields visible
    return String(v);
  });
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
