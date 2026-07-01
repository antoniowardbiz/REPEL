import { ok, fail, readJSON } from "@/lib/api";
import { submitQuiz } from "@/lib/training";

// POST /api/training/[token]/submit — grade the quiz; on a pass, unlock the
// trial. Body: { answers: number[] } (chosen option index per question).
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const body = await readJSON(req);
  if (!Array.isArray(body.answers)) return fail("answers array is required");
  try {
    const result = await submitQuiz(params.token, body.answers.map((a: unknown) => Number(a)));
    if (!result.ok) return fail(result.reason, 400);
    return ok(result);
  } catch (e: any) {
    return fail(e?.message ?? "failed to submit quiz", 500);
  }
}
