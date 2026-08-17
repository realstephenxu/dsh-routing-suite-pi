import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildGuidance,
  classifyPrompt,
  type Route,
  type RouterInput,
} from "dsh-routing-core";
import {
  addMemoryEntry,
  buildCompactionSummary,
  buildMemorySnapshot,
  buildRecallSnapshot,
  DEFAULT_DISTILL_POLICY,
  DEFAULT_MEMORY_POLICY,
  distillSession,
  ensureActiveTopic,
  extractMemoryFromText,
  getActiveTopic,
  getSessionMemory,
  loadStore,
  markEntrySuperseded,
  matchTopicScore,
  saveStore,
  searchMemory,
  type MemoryDistillPolicy,
  type MemoryInjectPolicy,
  type MemoryStoreData,
} from "./memory";
import {
  addBlocker,
  addEvidence,
  buildTrajectoryInjection,
  canTransition,
  deserializeTrajectory,
  emptyEvidence,
  initialPhaseForRoute,
  isFastPath,
  serializeTrajectory,
  shouldBlockTool,
  suggestNextPhase,
  transition,
  type TrajectoryMode,
  type TrajectoryPhase,
  type TrajectoryState,
} from "./trajectory";

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
const WRITE_TOOLS = new Set(["edit", "write"]);
const FULL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

const MINIMAL_TOOLS: Record<string, string[]> = {
  plan: READ_ONLY_TOOLS,
  inspect: READ_ONLY_TOOLS,
  fix: ["read", "bash", "edit"],
  build: ["read", "bash", "edit", "write"],
  adaptive: ["read", "bash", "edit", "write"],
  weak: ["read", "bash"],
};

function isExternalPlanModeActive(pi: ExtensionAPI): boolean {
  const active = pi.getActiveTools();
  if (!Array.isArray(active) || active.length === 0) return false;
  const hasWrite = active.some((name) => WRITE_TOOLS.has(name));
  const hasRead = active.some((name) => READ_ONLY_TOOLS.includes(name));
  return !hasWrite && hasRead;
}

function isRoute(value: string): value is Route {
  return ["plan", "inspect", "fix", "build", "adaptive", "weak", "off"].includes(value);
}

function sessionKey(ctx: ExtensionContext | undefined): string {
  const sm = ctx?.sessionManager as { getSessionId?(): string; getSessionFile?(): string } | undefined;
  return sm?.getSessionId?.() ?? sm?.getSessionFile?.() ?? "ephemeral";
}

function assistantText(event: { message?: unknown }): string {
  const content = (event.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c && typeof c === "object" && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string")
      .map((c) => (c as { text: string }).text)
      .join("\n");
  }
  return "";
}

function trajectoryPath(): string {
  const base = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(base, "dsh-trajectory-v0.6.json");
}

function loadTrajectories(): Map<string, TrajectoryState> {
  try {
    if (!existsSync(trajectoryPath())) return new Map();
    const raw = readFileSync(trajectoryPath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, ReturnType<typeof serializeTrajectory>>;
    const map = new Map<string, TrajectoryState>();
    for (const [k, v] of Object.entries(parsed)) {
      map.set(k, deserializeTrajectory(v));
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveTrajectories(map: Map<string, TrajectoryState>): void {
  try {
    const file = trajectoryPath();
    mkdirSync(dirname(file), { recursive: true });
    const obj: Record<string, ReturnType<typeof serializeTrajectory>> = {};
    for (const [k, v] of map) {
      obj[k] = serializeTrajectory(v);
    }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    renameSync(tmp, file);
  } catch {
    // Trajectory persistence must never break Pi.
  }
}

function getOrCreateTrajectory(
  map: Map<string, TrajectoryState>,
  sid: string,
  route: string,
  prompt: string,
): TrajectoryState {
  let state = map.get(sid);
  if (!state || state.route !== route) {
    state = {
      route,
      phase: initialPhaseForRoute(route),
      objective: prompt.slice(0, 160) || "Continue current task",
      evidence: emptyEvidence(),
      blockers: [],
      updatedAt: new Date().toISOString(),
    };
    map.set(sid, state);
  }
  return state;
}

function updateTrajectoryPhaseFromEvidence(state: TrajectoryState, mode: TrajectoryMode): void {
  const e = state.evidence;
  let target: TrajectoryPhase | undefined;
  if (state.phase === "UNDERSTAND") {
    target = e.inspectedFiles.length > 0 || e.observedErrors.length > 0 ? "INSPECT" : "PLAN";
  } else if (state.phase === "INSPECT") {
    target = e.hypotheses.length > 0 || e.observedErrors.length > 0 ? "DIAGNOSE" : "PLAN";
  } else if (state.phase === "DIAGNOSE") {
    target = e.hypotheses.length > 0 ? "IMPLEMENT" : "PLAN";
  } else if (state.phase === "IMPLEMENT") {
    target = e.modifiedFiles.length > 0 ? "TEST" : "VERIFY";
  } else if (state.phase === "TEST") {
    target = e.validations.length > 0 ? "VERIFY" : "TEST";
  } else if (state.phase === "VERIFY") {
    target = state.blockers.length === 0 ? "DONE" : "BLOCKED";
  }
  if (target && target !== state.phase) {
    const result = canTransition(state, target, mode);
    if (result.allowed && result.nextPhase) {
      transition(state, result.nextPhase, `evidence-based transition to ${result.nextPhase}`);
    }
  }
}

export default function dshRoutingPi(pi: ExtensionAPI): void {
  let ownPlanMode = false;
  let toolsBeforePlanMode: string[] | undefined;
  let twoPhaseEnabled = false;
  let toolPhaseExpanded = false;
  let routeOverride: Route | "auto" | undefined;
  let memoryEnabled = false;
  const memoryStore: MemoryStoreData = loadStore();
  const memoryPolicy: MemoryInjectPolicy = { ...DEFAULT_MEMORY_POLICY };
  const memoryDistillPolicy: MemoryDistillPolicy = { ...DEFAULT_DISTILL_POLICY };
  const trajectories: Map<string, TrajectoryState> = loadTrajectories();
  let trajectoryMode: TrajectoryMode = "guarded";

  function isPlanModeActive(): boolean {
    return ownPlanMode || pi.getFlag?.("dsh-plan") === true || isExternalPlanModeActive(pi);
  }

  function enableOwnPlanMode(ctx: ExtensionContext): void {
    if (toolsBeforePlanMode === undefined) {
      toolsBeforePlanMode = pi.getActiveTools();
    }
    const base = toolsBeforePlanMode ?? [];
    const next = [...new Set([...READ_ONLY_TOOLS, ...base.filter((name) => !WRITE_TOOLS.has(name))])];
    pi.setActiveTools(next);
    ownPlanMode = true;
    ctx.ui.notify("DSH Plan Mode enabled (read-only).");
  }

  function disableOwnPlanMode(ctx: ExtensionContext): void {
    if (toolsBeforePlanMode !== undefined) {
      pi.setActiveTools(toolsBeforePlanMode);
      toolsBeforePlanMode = undefined;
    }
    ownPlanMode = false;
    ctx.ui.notify("DSH Plan Mode disabled.");
  }

  function applyMinimalTools(route: string): void {
    if (!twoPhaseEnabled || toolPhaseExpanded) return;
    const minimal = MINIMAL_TOOLS[route] ?? READ_ONLY_TOOLS;
    const next = ownPlanMode || isExternalPlanModeActive(pi) ? READ_ONLY_TOOLS : minimal;
    pi.setActiveTools([...new Set(next)]);
  }

  function expandTools(): void {
    if (!twoPhaseEnabled || toolPhaseExpanded) return;
    toolPhaseExpanded = true;
    const full = toolsBeforePlanMode && toolsBeforePlanMode.length > 0 ? toolsBeforePlanMode : FULL_TOOLS;
    pi.setActiveTools([...new Set(full)]);
  }

  pi.registerCommand("dsh-plan", {
    description: "Toggle DSH plan mode (read-only exploration)",
    handler: async (_args, ctx) => {
      if (ownPlanMode) {
        disableOwnPlanMode(ctx);
      } else {
        enableOwnPlanMode(ctx);
      }
    },
  });

  pi.registerFlag("dsh-plan", {
    description: "Start with DSH plan mode enabled",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("dsh-two-phase", {
    description: "Enable two-phase tool surface (minimal first, expand after first tool call)",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("dsh-memory", {
    description: "Enable DSH session memory and context re-injection",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("dsh-trajectory", {
    description: "Enable DSH trajectory control (guarded by default)",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("dsh-trajectory-strict", {
    description: "Enable DSH trajectory control in strict mode",
    type: "boolean",
    default: false,
  });

  if (pi.getFlag?.("dsh-plan")) {
    toolsBeforePlanMode = pi.getActiveTools();
    const base = toolsBeforePlanMode ?? [];
    pi.setActiveTools([...new Set([...READ_ONLY_TOOLS, ...base.filter((name) => !WRITE_TOOLS.has(name))])]);
    ownPlanMode = true;
  }

  if (pi.getFlag?.("dsh-two-phase")) {
    twoPhaseEnabled = true;
  }

  if (pi.getFlag?.("dsh-memory")) {
    memoryEnabled = true;
  }

  if (pi.getFlag?.("dsh-trajectory-strict")) {
    trajectoryMode = "strict";
  } else if (pi.getFlag?.("dsh-trajectory")) {
    trajectoryMode = "guarded";
  }

  pi.registerCommand("dsh-status", {
    description: "Show current DSH routing status",
    handler: async (_args, ctx) => {
      const route = routeOverride && routeOverride !== "auto" ? routeOverride : "auto";
      const sid = sessionKey(ctx);
      const traj = trajectories.get(sid);
      const phase = traj?.phase ?? "IDLE";
      const next = traj?.nextPhase ?? "none";
      const ev = traj?.evidence;
      ctx.ui.notify([
        `route=${route}`,
        `phase=${phase}`,
        `mode=${trajectoryMode}`,
        `next=${next}`,
        `override=${routeOverride ?? "none"}`,
        `planMode=${isPlanModeActive() ? "on" : "off"}`,
        `twoPhase=${twoPhaseEnabled ? (toolPhaseExpanded ? "expanded" : "minimal") : "off"}`,
        `memory=${memoryEnabled ? "on" : "off"}`,
        `evidence=inspected:${ev?.inspectedFiles.length ?? 0} hypotheses:${ev?.hypotheses.length ?? 0} modified:${ev?.modifiedFiles.length ?? 0} validations:${ev?.validations.length ?? 0}`,
        `identity=DSH-ROUTER-V1`,
      ].join("\n"));
    },
  });

  pi.registerCommand("dsh-route", {
    description: "Set route override: plan|inspect|fix|build|adaptive|weak|off|auto",
    handler: async (args, ctx) => {
      const value = String(args || "").trim().toLowerCase();
      if (value === "auto") {
        routeOverride = "auto";
        ctx.ui.notify("Route override cleared.");
        return;
      }
      if (!isRoute(value) || value === "off") {
        ctx.ui.notify(`Invalid route: ${value}. Use plan|inspect|fix|build|adaptive|weak|auto.`, "warning");
        return;
      }
      routeOverride = value;
      ctx.ui.notify(`Route override set to ${value}.`);
    },
  });

  pi.registerCommand("dsh-trajectory", {
    description: "Show current trajectory state",
    handler: async (_args, ctx) => {
      const sid = sessionKey(ctx);
      const state = trajectories.get(sid);
      if (!state) {
        ctx.ui.notify("No active trajectory.", "info");
        return;
      }
      const injection = buildTrajectoryInjection(state, 1200);
      ctx.ui.notify(`${injection}\n\nmode: ${trajectoryMode}`, "info");
    },
  });

  pi.registerCommand("dsh-phase", {
    description: "Set trajectory phase: /dsh-phase <phase>",
    handler: async (args, ctx) => {
      const value = String(args || "").trim().toUpperCase();
      const phases = ["IDLE", "UNDERSTAND", "INSPECT", "DIAGNOSE", "PLAN", "IMPLEMENT", "TEST", "VERIFY", "DONE", "BLOCKED"];
      if (!phases.includes(value)) {
        ctx.ui.notify(`Invalid phase: ${value}`, "warning");
        return;
      }
      const sid = sessionKey(ctx);
      const state = trajectories.get(sid);
      if (!state) {
        ctx.ui.notify("No active trajectory.", "warning");
        return;
      }
      transition(state, value as TrajectoryPhase, `manual phase set to ${value}`);
      saveTrajectories(trajectories);
      ctx.ui.notify(`Phase set to ${value}.`, "info");
    },
  });

  pi.registerCommand("dsh-trajectory-mode", {
    description: "Set trajectory mode: /dsh-trajectory-mode <off|guarded|strict>",
    handler: async (args, ctx) => {
      const value = String(args || "").trim().toLowerCase();
      if (!["off", "guarded", "strict"].includes(value)) {
        ctx.ui.notify("Invalid mode. Use off|guarded|strict.", "warning");
        return;
      }
      trajectoryMode = value as TrajectoryMode;
      ctx.ui.notify(`Trajectory mode set to ${value}.`, "info");
    },
  });

  pi.registerCommand("dsh-memory", {
    description: "Show current DSH session memory",
    handler: async (_args, ctx) => {
      if (!memoryEnabled) {
        ctx.ui.notify("DSH memory is disabled. Start Pi with --dsh-memory to enable it.", "warning");
        return;
      }
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
      const snapshot = buildMemorySnapshot(session, memoryPolicy);
      ctx.ui.notify(snapshot || "[DSH Memory] (empty)", "info");
    },
  });

  pi.registerCommand("dsh-memory-note", {
    description: "Add a manual memory note: /dsh-memory-note <text>",
    handler: async (args, ctx) => {
      const text = String(args || "").trim();
      if (!text) {
        ctx.ui.notify("Usage: /dsh-memory-note <text>", "warning");
        return;
      }
      if (!memoryEnabled) {
        ctx.ui.notify("DSH memory is disabled. Start Pi with --dsh-memory to enable it.", "warning");
        return;
      }
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
      const topic = ensureActiveTopic(session);
      addMemoryEntry(session, topic, "fact", text, 5);
      saveStore(memoryStore);
      ctx.ui.notify("Memory note added.", "info");
    },
  });

  pi.registerCommand("dsh-memory-forget", {
    description: "Forget a memory entry by id: /dsh-memory-forget <id>",
    handler: async (args, ctx) => {
      const id = String(args || "").trim();
      if (!id) {
        ctx.ui.notify("Usage: /dsh-memory-forget <id>", "warning");
        return;
      }
      if (!memoryEnabled) {
        ctx.ui.notify("DSH memory is disabled. Start Pi with --dsh-memory to enable it.", "warning");
        return;
      }
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
      const topic = getActiveTopic(session);
      if (!topic) {
        ctx.ui.notify("No active topic.", "warning");
        return;
      }
      const ok = markEntrySuperseded(session, topic, id);
      if (ok) {
        saveStore(memoryStore);
        ctx.ui.notify("Memory entry forgotten.", "info");
      } else {
        ctx.ui.notify(`Memory entry not found: ${id}`, "warning");
      }
    },
  });

  pi.registerCommand("dsh-memory-config", {
    description: "Show DSH memory injection policy",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify(memoryPolicy, null, 2), "info");
    },
  });

  pi.registerCommand("dsh-memory-search", {
    description: "Search memory across sessions: /dsh-memory-search <query>",
    handler: async (args, ctx) => {
      const query = String(args || "").trim();
      if (!query) {
        ctx.ui.notify("Usage: /dsh-memory-search <query>", "warning");
        return;
      }
      if (!memoryEnabled) {
        ctx.ui.notify("DSH memory is disabled. Start Pi with --dsh-memory to enable it.", "warning");
        return;
      }
      const results = searchMemory(memoryStore, ctx.cwd, query, memoryPolicy.topK, memoryPolicy.minScore);
      const snapshot = buildRecallSnapshot(results, 2000);
      ctx.ui.notify(snapshot || "[DSH History Memory] (no results)", "info");
    },
  });

  pi.registerCommand("dsh-memory-distill", {
    description: "Distill current session memory",
    handler: async (_args, ctx) => {
      if (!memoryEnabled) {
        ctx.ui.notify("DSH memory is disabled. Start Pi with --dsh-memory to enable it.", "warning");
        return;
      }
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
      const summary = distillSession(session, memoryDistillPolicy);
      saveStore(memoryStore);
      ctx.ui.notify(summary || "[DSH Memory] (empty)", "info");
    },
  });

  pi.registerCommand("dsh-memory-summary", {
    description: "Show current distilled memory summary",
    handler: async (_args, ctx) => {
      if (!memoryEnabled) {
        ctx.ui.notify("DSH memory is disabled. Start Pi with --dsh-memory to enable it.", "warning");
        return;
      }
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
      ctx.ui.notify(session.lastSummary || "[DSH Memory] (no summary)", "info");
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      const sid = sessionKey(ctx);
      const traj = trajectories.get(sid);
      if (traj) {
        updateTrajectoryPhaseFromEvidence(traj, trajectoryMode);
        saveTrajectories(trajectories);
      }
      if (!memoryEnabled) return;
      const session = getSessionMemory(memoryStore, sid, ctx.cwd);
      distillSession(session, memoryDistillPolicy);
      saveStore(memoryStore);
    } catch {
      // Memory maintenance must never break Pi.
    }
  });

  pi.on("tool_call", async (event: any, ctx: ExtensionContext) => {
    const toolName = event?.toolName as string | undefined;
    if (!toolName) return undefined;
    const sid = sessionKey(ctx);
    const traj = trajectories.get(sid);
    if (traj) {
      const decision = shouldBlockTool(traj, toolName, trajectoryMode);
      if (decision.block) {
        return { block: true, reason: decision.reason ?? "Blocked by trajectory controller" };
      }
      const input = event?.input ?? {};
      if (toolName === "read" && typeof input.path === "string") addEvidence(traj, "inspectedFiles", input.path);
      if (["grep", "find", "ls"].includes(toolName)) {
        const pattern = input.pattern ?? input.path ?? input.glob ?? "";
        if (pattern) addEvidence(traj, "searchedSymbols", String(pattern));
      }
      if (["edit", "write"].includes(toolName)) {
        const filePath = input.file_path ?? input.path ?? input.filePath ?? "";
        if (filePath) addEvidence(traj, "modifiedFiles", String(filePath));
      }
      saveTrajectories(trajectories);
    }
    expandTools();
    return undefined;
  });

  pi.on("session_before_compact", async (event: any, ctx: ExtensionContext) => {
    try {
      const sid = sessionKey(ctx);
      const traj = trajectories.get(sid);
      const trajText = traj ? buildTrajectoryInjection(traj, 600) : "";
      let summary = "";
      if (memoryEnabled) {
        const session = getSessionMemory(memoryStore, sid, ctx.cwd);
        summary = buildCompactionSummary(session, memoryDistillPolicy);
        saveStore(memoryStore);
      }
      if (trajText) {
        summary = summary ? `${trajText}\n\n${summary}` : trajText;
      }
      if (!summary) return undefined;
      saveTrajectories(trajectories);
      return {
        compaction: {
          summary,
          firstKeptEntryId: event.preparation?.firstKeptEntryId,
          tokensBefore: event.preparation?.tokensBefore,
        },
      };
    } catch {
      return undefined;
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    try {
      const sid = sessionKey(ctx);
      const traj = trajectories.get(sid);
      if (traj) {
        updateTrajectoryPhaseFromEvidence(traj, trajectoryMode);
        saveTrajectories(trajectories);
      }
      if (!memoryEnabled) return;
      const text = assistantText(event);
      if (!text) return;
      const session = getSessionMemory(memoryStore, sid, ctx.cwd);
      const topic = ensureActiveTopic(session);
      const extracted = extractMemoryFromText(text, session.sessionId);
      for (const item of extracted) {
        addMemoryEntry(session, topic, item.kind, item.content, item.importance, text.slice(0, 500));
      }
      saveStore(memoryStore);
    } catch {
      // Memory extraction must never break Pi.
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const override = routeOverride && routeOverride !== "auto" ? routeOverride : undefined;
      const input: RouterInput = {
        prompt: event.prompt,
        permissionMode: isPlanModeActive() ? "plan" : undefined,
        overrideRoute: override,
      };

      const classification = classifyPrompt(input);
      if (!classification || classification.route === "off") {
        return undefined;
      }

      const output = buildGuidance(classification);
      if (!output) {
        return undefined;
      }

      if (twoPhaseEnabled) {
        applyMinimalTools(classification.route);
      }

      let systemPrompt = `${event.systemPrompt}\n\n${output.guidance}`;

      if (memoryEnabled) {
        const sid = sessionKey(ctx);
        const session = getSessionMemory(memoryStore, sid, ctx.cwd);
        const topic = ensureActiveTopic(session, event.prompt);
        const score = matchTopicScore(event.prompt, topic);
        const parts: string[] = [];
        if (score >= memoryPolicy.minScore || memoryPolicy.injectOn === "every_turn") {
          const memorySnapshot = buildMemorySnapshot(session, memoryPolicy);
          if (memorySnapshot) parts.push(memorySnapshot);
        }
        const historyResults = searchMemory(memoryStore, ctx.cwd, event.prompt, memoryPolicy.topK, memoryPolicy.minScore)
          .filter((r) => r.sessionId !== sid);
        const recallSnapshot = buildRecallSnapshot(historyResults, 2000);
        if (recallSnapshot) parts.push(recallSnapshot);
        if (parts.length > 0) {
          systemPrompt = `${event.systemPrompt}\n\n${parts.join("\n\n")}\n\n${output.guidance}`;
        }
        saveStore(memoryStore);
      }

      const sid = sessionKey(ctx);
      const traj = getOrCreateTrajectory(trajectories, sid, classification.route, event.prompt);
      if (isFastPath(classification.route, event.prompt, traj.evidence) && traj.phase === "UNDERSTAND") {
        transition(traj, "IMPLEMENT", "fast path");
      }
      const trajInjection = buildTrajectoryInjection(traj, 800);
      if (trajInjection) {
        systemPrompt = `${systemPrompt}\n\n${trajInjection}`;
      }
      saveTrajectories(trajectories);

      return { systemPrompt };
    } catch {
      // Fail open: routing, memory, and trajectory must never break Pi.
      return undefined;
    }
  });
}
