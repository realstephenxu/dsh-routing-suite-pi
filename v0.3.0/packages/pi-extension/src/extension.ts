import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildGuidance,
  classifyPrompt,
  type Route,
  type RouterInput,
} from "dsh-routing-core";
import {
  addMemoryEntry,
  buildMemorySnapshot,
  DEFAULT_MEMORY_POLICY,
  ensureActiveTopic,
  extractMemoryFromText,
  getActiveTopic,
  getSessionMemory,
  loadStore,
  markEntrySuperseded,
  matchTopicScore,
  saveStore,
  type MemoryInjectPolicy,
  type MemoryStoreData,
} from "./memory";

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

export default function dshRoutingPi(pi: ExtensionAPI): void {
  let ownPlanMode = false;
  let toolsBeforePlanMode: string[] | undefined;
  let twoPhaseEnabled = false;
  let toolPhaseExpanded = false;
  let routeOverride: Route | "auto" | undefined;
  let memoryEnabled = false;
  const memoryStore: MemoryStoreData = loadStore();
  const memoryPolicy: MemoryInjectPolicy = { ...DEFAULT_MEMORY_POLICY };

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

  pi.registerCommand("dsh-status", {
    description: "Show current DSH routing status",
    handler: async (_args, ctx) => {
      const route = routeOverride && routeOverride !== "auto" ? routeOverride : "auto";
      ctx.ui.notify([
        `route=${route}`,
        `override=${routeOverride ?? "none"}`,
        `planMode=${isPlanModeActive() ? "on" : "off"}`,
        `twoPhase=${twoPhaseEnabled ? (toolPhaseExpanded ? "expanded" : "minimal") : "off"}`,
        `memory=${memoryEnabled ? "on" : "off"}`,
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

  pi.on("tool_call", async () => {
    expandTools();
  });

  pi.on("session_before_compact", async (event: any, ctx: ExtensionContext) => {
    if (!memoryEnabled) return undefined;
    try {
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
      const snapshot = buildMemorySnapshot(session, memoryPolicy);
      if (!snapshot) return undefined;
      return {
        compaction: {
          summary: snapshot,
          firstKeptEntryId: event.preparation?.firstKeptEntryId,
          tokensBefore: event.preparation?.tokensBefore,
        },
      };
    } catch {
      return undefined;
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!memoryEnabled) return;
    try {
      const text = assistantText(event);
      if (!text) return;
      const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
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
        const session = getSessionMemory(memoryStore, sessionKey(ctx), ctx.cwd);
        const topic = ensureActiveTopic(session, event.prompt);
        const score = matchTopicScore(event.prompt, topic);
        if (score >= memoryPolicy.minScore || memoryPolicy.injectOn === "every_turn") {
          const memorySnapshot = buildMemorySnapshot(session, memoryPolicy);
          if (memorySnapshot) {
            systemPrompt = `${event.systemPrompt}\n\n${memorySnapshot}\n\n${output.guidance}`;
          }
        }
        saveStore(memoryStore);
      }

      return { systemPrompt };
    } catch {
      // Fail open: routing and memory must never break Pi.
      return undefined;
    }
  });
}
