export type TrajectoryPhase =
  | "IDLE"
  | "UNDERSTAND"
  | "INSPECT"
  | "DIAGNOSE"
  | "PLAN"
  | "IMPLEMENT"
  | "TEST"
  | "VERIFY"
  | "DONE"
  | "BLOCKED";

export type TrajectoryMode = "off" | "guarded" | "strict";

export interface EvidenceLedger {
  inspectedFiles: string[];
  searchedSymbols: string[];
  observedErrors: string[];
  hypotheses: string[];
  decisions: string[];
  modifiedFiles: string[];
  validations: string[];
  blockers: string[];
}

export interface TrajectoryState {
  route: string;
  phase: TrajectoryPhase;
  objective: string;
  evidence: EvidenceLedger;
  blockers: string[];
  nextPhase?: TrajectoryPhase;
  updatedAt: string;
}

export interface TrajectorySnapshot {
  route: string;
  phase: TrajectoryPhase;
  objective: string;
  evidence: EvidenceLedger;
  blockers: string[];
  nextPhase?: TrajectoryPhase;
}

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
  nextPhase?: TrajectoryPhase;
}

export const PHASES: TrajectoryPhase[] = [
  "IDLE",
  "UNDERSTAND",
  "INSPECT",
  "DIAGNOSE",
  "PLAN",
  "IMPLEMENT",
  "TEST",
  "VERIFY",
  "DONE",
  "BLOCKED",
];

export function emptyEvidence(): EvidenceLedger {
  return {
    inspectedFiles: [],
    searchedSymbols: [],
    observedErrors: [],
    hypotheses: [],
    decisions: [],
    modifiedFiles: [],
    validations: [],
    blockers: [],
  };
}

export function initialPhaseForRoute(route: string): TrajectoryPhase {
  if (route === "off") return "IDLE";
  return "UNDERSTAND";
}

export function addEvidence(
  state: TrajectoryState,
  kind: keyof EvidenceLedger,
  value: string,
  max = 12,
): void {
  const list = state.evidence[kind] as string[];
  if (!Array.isArray(list)) return;
  const v = value.trim().slice(0, 200);
  if (!v) return;
  if (!list.includes(v)) {
    list.push(v);
    if (list.length > max) list.splice(0, list.length - max);
  }
}

export function addBlocker(state: TrajectoryState, blocker: string): void {
  const v = blocker.trim().slice(0, 200);
  if (!v) return;
  if (!state.blockers.includes(v)) {
    state.blockers.push(v);
    if (state.blockers.length > 5) state.blockers.shift();
  }
}

export function isFastPath(route: string, prompt: string, evidence: EvidenceLedger): boolean {
  if (route === "off" || route === "weak") return false;
  const short = prompt.trim().length < 80;
  const noComplexity = !/架构|重构|迁移|安全|并发|分布式|全面|详细|system|architecture|refactor|migration|security|concurrency|distributed/i.test(prompt);
  const trivial = /typo|拼写|错别字|rename|改名|format|格式化/i.test(prompt);
  return (short && noComplexity) || trivial;
}

export function canTransition(
  state: TrajectoryState,
  to: TrajectoryPhase,
  mode: TrajectoryMode,
): TransitionResult {
  if (mode === "off") return { allowed: true, nextPhase: to };
  const from = state.phase;

  if (to === "BLOCKED") return { allowed: true, nextPhase: to };

  if (from === "BLOCKED" && to !== "DONE") {
    return { allowed: true, nextPhase: to, reason: "blocker resolved, resume" };
  }

  const allowedPairs: Record<string, TrajectoryPhase[]> = {
    UNDERSTAND: ["INSPECT", "PLAN", "IMPLEMENT", "DONE"],
    INSPECT: ["DIAGNOSE", "PLAN", "IMPLEMENT", "UNDERSTAND", "DONE"],
    DIAGNOSE: ["PLAN", "IMPLEMENT", "INSPECT", "DONE"],
    PLAN: ["IMPLEMENT", "DONE"],
    IMPLEMENT: ["TEST", "VERIFY", "INSPECT"],
    TEST: ["VERIFY", "IMPLEMENT", "DONE"],
    VERIFY: ["DONE", "IMPLEMENT", "TEST"],
    DONE: ["UNDERSTAND", "IMPLEMENT"],
    IDLE: ["UNDERSTAND", "DONE"],
  };

  const allowed = allowedPairs[from] ?? [];
  if (allowed.includes(to)) {
    return { allowed: true, nextPhase: to };
  }

  if (mode === "strict") {
    return { allowed: false, reason: `Invalid transition ${from} -> ${to}` };
  }

  // guarded mode allows slightly flexible transitions but records a warning.
  return { allowed: true, nextPhase: to, reason: `guarded flexible transition ${from} -> ${to}` };
}

export function transition(
  state: TrajectoryState,
  to: TrajectoryPhase,
  reason?: string,
): TrajectoryState {
  state.phase = to;
  state.nextPhase = suggestNextPhase(state);
  state.updatedAt = new Date().toISOString();
  if (reason) state.objective = reason;
  return state;
}

export function suggestNextPhase(state: TrajectoryState): TrajectoryPhase | undefined {
  const e = state.evidence;
  switch (state.phase) {
    case "UNDERSTAND":
      return e.inspectedFiles.length > 0 || e.observedErrors.length > 0 ? "INSPECT" : "PLAN";
    case "INSPECT":
      return e.hypotheses.length > 0 || e.observedErrors.length > 0 ? "DIAGNOSE" : "PLAN";
    case "DIAGNOSE":
      return e.hypotheses.length > 0 ? "IMPLEMENT" : "PLAN";
    case "PLAN":
      return "IMPLEMENT";
    case "IMPLEMENT":
      return e.modifiedFiles.length > 0 ? "TEST" : "VERIFY";
    case "TEST":
      return e.validations.length > 0 ? "VERIFY" : "TEST";
    case "VERIFY":
      return "DONE";
    default:
      return undefined;
  }
}

export function shouldBlockTool(
  state: TrajectoryState,
  toolName: string,
  mode: TrajectoryMode,
): { block: boolean; reason?: string } {
  if (mode === "off") return { block: false };
  const phase = state.phase;
  const writeTools = new Set(["edit", "write"]);
  if (writeTools.has(toolName)) {
    if (["PLAN", "INSPECT", "DIAGNOSE", "VERIFY"].includes(phase)) {
      return {
        block: true,
        reason: `Trajectory phase ${phase} does not allow ${toolName}. Use /dsh-phase to override if intended.`,
      };
    }
  }
  return { block: false };
}

export function buildTrajectoryInjection(state: TrajectoryState, budget = 800): string {
  const lines = ["[DSH Trajectory]"];
  lines.push(`route: ${state.route}`);
  lines.push(`phase: ${state.phase}`);
  if (state.objective) lines.push(`objective: ${state.objective}`);
  const e = state.evidence;
  const evidenceParts: string[] = [];
  if (e.inspectedFiles.length > 0) evidenceParts.push(`inspected=${e.inspectedFiles.length}`);
  if (e.hypotheses.length > 0) evidenceParts.push(`hypotheses=${e.hypotheses.length}`);
  if (e.modifiedFiles.length > 0) evidenceParts.push(`modified=${e.modifiedFiles.length}`);
  if (e.validations.length > 0) evidenceParts.push(`validated=${e.validations.length}`);
  if (evidenceParts.length > 0) lines.push(`evidence: ${evidenceParts.join(" ")}`);
  if (state.blockers.length > 0) lines.push(`blockers: ${state.blockers.join("; ")}`);
  if (state.nextPhase) lines.push(`next: ${state.nextPhase}`);
  let text = lines.join("\n");
  if (text.length > budget) {
    text = text.slice(0, budget) + "\n…";
  }
  return text;
}

export function serializeTrajectory(state: TrajectoryState): TrajectorySnapshot {
  return {
    route: state.route,
    phase: state.phase,
    objective: state.objective,
    evidence: { ...state.evidence, ...Object.fromEntries(Object.entries(state.evidence).map(([k, v]) => [k, [...v]])) },
    blockers: [...state.blockers],
    nextPhase: state.nextPhase,
  };
}

export function deserializeTrajectory(snapshot: TrajectorySnapshot): TrajectoryState {
  return {
    route: snapshot.route,
    phase: snapshot.phase,
    objective: snapshot.objective,
    evidence: snapshot.evidence,
    blockers: snapshot.blockers,
    nextPhase: snapshot.nextPhase,
    updatedAt: new Date().toISOString(),
  };
}
