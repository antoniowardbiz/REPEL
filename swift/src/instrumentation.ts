// Next.js runs register() once on server boot. We use it to start the in-process
// scheduler (Railway runs a persistent Node server, so this keeps running).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
