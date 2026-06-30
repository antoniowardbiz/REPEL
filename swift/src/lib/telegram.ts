// Telegram bot delivery with graceful fallback.
//
// If TELEGRAM_BOT_TOKEN is set and we have a chat id, messages are sent for
// real. Otherwise they are recorded as "simulated" so the whole pipeline is
// testable without a live bot — the moment you add a token + the candidate's
// chat id, the same code path goes live.

export type SendResult = {
  status: "sent" | "simulated" | "failed";
  detail?: string;
};

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegramMessage(
  chatId: string | null | undefined,
  text: string
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) {
    return { status: "simulated", detail: !token ? "no bot token" : "no chat id" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { status: "failed", detail: `HTTP ${res.status} ${body}`.slice(0, 300) };
    }
    return { status: "sent" };
  } catch (e: any) {
    return { status: "failed", detail: String(e?.message ?? e).slice(0, 300) };
  }
}

/** Internal ops alert → Slack webhook or an ops Telegram chat. Best-effort. */
export async function sendOpsAlert(text: string): Promise<void> {
  const slack = process.env.SLACK_WEBHOOK_URL;
  const opsChat = process.env.OPS_TELEGRAM_CHAT_ID;
  try {
    if (slack) {
      await fetch(slack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } else if (opsChat) {
      await sendTelegramMessage(opsChat, text);
    } else {
      // No ops channel configured — log so it's still visible in dev.
      console.log("[ops]", text);
    }
  } catch (e) {
    console.warn("ops alert failed:", e);
  }
}
