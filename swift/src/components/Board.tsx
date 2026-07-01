"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BOARD_STAGES, Stage, STAGE_META, Tier } from "@/lib/constants";
import { stageBadgeClass, tierBadgeClass } from "@/lib/ui";
import AddCandidate from "@/components/AddCandidate";

export type BoardCard = {
  applicationId: string | null;
  candidateId: string;
  name: string;
  roleLabel: string | null;
  stage: Stage;
  timeInStage: string;
  tier: Tier | null;
  score: number | null;
  country?: string | null;
  deadline: { text: string; tone: "good" | "warn" | "bad" } | null;
  needsRole: boolean;
};

export default function Board({
  cards,
  roleOptions,
}: {
  cards: BoardCard[];
  roleOptions: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);

  const byStage = (stage: Stage) => cards.filter((c) => c.stage === stage);

  async function moveTo(card: BoardCard, to: Stage) {
    if (card.stage === to) return;
    if (!card.applicationId) {
      alert("This candidate hasn't selected a role yet. Open the card to pick a role first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/applications/${card.applicationId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Move failed: ${j.error ?? res.status}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
      setDragId(null);
      setOverStage(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted">{cards.length} in pipeline</div>
        <AddCandidate roleOptions={roleOptions} onDone={() => router.refresh()} />
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {BOARD_STAGES.map((stage) => {
          const list = byStage(stage);
          const meta = STAGE_META[stage];
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={() => {
                const card = cards.find((c) => c.applicationId === dragId || c.candidateId === dragId);
                if (card) moveTo(card, stage);
              }}
              className={`flex w-[240px] shrink-0 flex-col rounded-xl border bg-panel/60 ${
                overStage === stage ? "border-brand" : "border-line"
              }`}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <div>
                  <div className="text-sm font-semibold">{meta.label}</div>
                  <div className="text-[11px] text-muted">{meta.hint}</div>
                </div>
                <span className="pill bg-panel2 text-muted">{list.length}</span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {list.map((card) => (
                  <article
                    key={card.applicationId ?? card.candidateId}
                    draggable={!busy}
                    onDragStart={() => setDragId(card.applicationId ?? card.candidateId)}
                    onClick={() => router.push(`/candidates/${card.candidateId}`)}
                    className="cursor-pointer rounded-lg border border-line bg-panel2 p-2.5 hover:border-brand/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-tight">{card.name}</div>
                      {card.tier && (
                        <span className={`pill ${tierBadgeClass(card.tier)}`}>
                          {card.tier}
                          {card.score != null ? ` · ${card.score}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {card.needsRole ? (
                        <span className="pill border border-dashed border-line text-muted">pick a role</span>
                      ) : (
                        <span className={`badge ${stageBadgeClass(card.stage)}`}>{card.roleLabel}</span>
                      )}
                      {card.country && <span className="text-[11px] text-muted">{card.country}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
                      <span>{card.timeInStage}</span>
                      {card.deadline && (
                        <span
                          className={
                            card.deadline.tone === "bad"
                              ? "text-bad"
                              : card.deadline.tone === "warn"
                              ? "text-warn"
                              : "text-good"
                          }
                        >
                          {card.deadline.text}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
                {list.length === 0 && (
                  <div className="rounded-lg border border-dashed border-line/60 px-2 py-4 text-center text-[11px] text-muted">
                    drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
