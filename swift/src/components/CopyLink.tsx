"use client";

import { useState } from "react";

// Read-only tracked-link display with a one-tap copy button. Used on the
// Links & Clicks page so you can grab any VA's personal /go/ link fast.
export default function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  if (!url) {
    return <span className="text-[11px] text-faint">— no link yet</span>;
  }

  const short = url.replace(/^https?:\/\//, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="truncate font-mono text-[11px] text-muted hover:text-white"
        style={{ maxWidth: 220 }}
        title={url}
      >
        {short}
      </a>
      <button className="btn-ghost btn-sm shrink-0" onClick={copy}>
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
