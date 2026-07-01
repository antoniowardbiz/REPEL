import { ok, fail, readJSON } from "@/lib/api";
import { createAccount } from "@/lib/accounts";

// POST /api/accounts — add an account to the inventory.
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.handle || typeof body.handle !== "string") return fail("handle is required");
  try {
    const account = await createAccount({
      platform: body.platform ?? "other",
      handle: body.handle,
      label: body.label ?? null,
      creatorId: body.creatorId ?? null,
      status: body.status,
      notes: body.notes ?? null,
    });
    return ok({ ok: true, accountId: account.id }, 201);
  } catch (e: any) {
    return fail(e?.message ?? "failed to create account", 500);
  }
}
