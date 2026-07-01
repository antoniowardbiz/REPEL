import { BOARD_STAGES, Stage, STAGES } from "./constants";

// The linear "happy path" order used to decide forward vs. back moves.
export const ORDERED_STAGES: Stage[] = [...BOARD_STAGES];

export function isTerminal(stage: Stage): boolean {
  return stage === "ARCHIVED" || stage === "REJECTED";
}

export function stageIndex(stage: Stage): number {
  return ORDERED_STAGES.indexOf(stage);
}

/**
 * Permissive transition rule for the MVP board: you can move forward or back
 * along the pipeline, and archive/reject from anywhere. Invalid only if the
 * target isn't a real stage.
 */
export function canTransition(_from: Stage, to: Stage): boolean {
  return (STAGES as readonly string[]).includes(to);
}

/**
 * Which automation should fire when an application ENTERS `stage`.
 * The API route reads this to decide side effects (send template, create trial…).
 * Returning null means "no automation".
 */
export type StageAutomation =
  | { kind: "send_template"; category: "first_touch" | "training" | "brief" }
  | { kind: "create_trial_and_brief" }
  | { kind: "queue_for_scoring" }
  | null;

export function automationOnEnter(stage: Stage): StageAutomation {
  switch (stage) {
    case "ROLE_SELECTED":
      return { kind: "send_template", category: "training" };
    case "TRIAL_READY":
      return { kind: "create_trial_and_brief" };
    case "SUBMITTED":
      return { kind: "queue_for_scoring" };
    default:
      return null;
  }
}
