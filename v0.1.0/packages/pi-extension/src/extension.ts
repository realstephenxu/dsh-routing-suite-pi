import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildGuidance,
  classifyPrompt,
  type RouterInput,
} from "dsh-routing-core";

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
const WRITE_TOOLS = new Set(["edit", "write"]);

function isExternalPlanModeActive(pi: ExtensionAPI): boolean {
  const active = pi.getActiveTools();
  if (!Array.isArray(active) || active.length === 0) return false;
  const hasWrite = active.some((name) => WRITE_TOOLS.has(name));
  const hasRead = active.some((name) => READ_ONLY_TOOLS.includes(name));
  return !hasWrite && hasRead;
}

export default function dshRoutingPi(pi: ExtensionAPI): void {
  let ownPlanMode = false;
  let toolsBeforePlanMode: string[] | undefined;

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

  if (pi.getFlag?.("dsh-plan")) {
    toolsBeforePlanMode = pi.getActiveTools();
    const base = toolsBeforePlanMode ?? [];
    pi.setActiveTools([...new Set([...READ_ONLY_TOOLS, ...base.filter((name) => !WRITE_TOOLS.has(name))])]);
    ownPlanMode = true;
  }

  pi.on("before_agent_start", async (event) => {
    try {
      const input: RouterInput = {
        prompt: event.prompt,
        permissionMode: isPlanModeActive() ? "plan" : undefined,
      };

      const classification = classifyPrompt(input);
      if (!classification || classification.route === "off") {
        return undefined;
      }

      const output = buildGuidance(classification);
      if (!output) {
        return undefined;
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
