import { ok, fail, readJSON } from "@/lib/api";
import { selectRole } from "@/lib/services";
import { ROLE_KEYS } from "@/lib/constants";

// POST /api/candidates/[id]/select-role — { roleKey, whyText }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  if (!body.roleKey || !(ROLE_KEYS as readonly string[]).includes(body.roleKey)) {
    return fail("valid roleKey is required");
  }
  try {
    const application = await selectRole(params.id, body.roleKey, body.whyText);
    return ok({ ok: true, applicationId: application.id });
  } catch (e: any) {
    return fail(e?.message ?? "failed to select role", 500);
  }
}
