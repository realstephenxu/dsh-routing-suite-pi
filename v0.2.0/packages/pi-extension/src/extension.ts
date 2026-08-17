import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildGuidance,
  classifyPrompt,
  type Route,
  type RouterInput,
} from "dsh-routing-core";

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

export default function dshRoutingPi(pi: ExtensionAPI): void {
  let ownPlanMode = false;
  let toolsBeforePlanMode: string[] | undefined;
  let twoPhaseEnabled = false;
  let toolPhaseExpanded = false;
  let routeOverride: Route | "auto" | undefined;

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

  if (pi.getFlag?.("dsh-plan")) {
    toolsBeforePlanMode = pi.getActiveTools();
    const base = toolsBeforePlanMode ?? [];
    pi.setActiveTools([...new Set([...READ_ONLY_TOOLS, ...base.filter((name) => !WRITE_TOOLS.has(name))])]);
    ownPlanMode = true;
  }

  if (pi.getFlag?.("dsh-two-phase")) {
    twoPhaseEnabled = true;
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

  pi.on("tool_call", async () => {
    expandTools();
  });

  pi.on("before_agent_start", async (event) => {
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

      return {
        systemPrompt: `${event.systemPrompt}\n\n${output.guidance}`,
      };
    } catch {
      // Fail open: routing must never block Pi.
      return undefined;
    }
  });
}
