import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const traj = require("../dist/trajectory.js");
const extMod = require("../dist/extension.js");
const dshRoutingPi = extMod.default ?? extMod;

function createMockPi(flags = {}) {
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  let activeTools = ["read", "bash", "edit", "write"];
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerFlag() {},
    getFlag(name) {
      return flags[name] === true;
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(tools) {
      activeTools = [...tools];
    },
    _handlers: handlers,
    _commands: commands,
    _notifications: notifications,
  };
  return pi;
}


function freshEnv() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-traj-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

function makeCtx(sessionId = "s1") {
  const notifications = [];
  return {
    cwd: "/tmp/project",
    sessionManager: {
      getSessionFile() {
        return sessionId;
      },
      getSessionId() {
        return sessionId;
      },
    },
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
    _notifications: notifications,
  };
}

test("initial phase for routes", () => {
  assert.equal(traj.initialPhaseForRoute("fix"), "UNDERSTAND");
  assert.equal(traj.initialPhaseForRoute("off"), "IDLE");
});

test("valid and invalid transitions", () => {
  const state = traj.deserializeTrajectory({
    route: "fix",
    phase: "INSPECT",
    objective: "x",
    evidence: traj.emptyEvidence(),
    blockers: [],
  });
  assert.equal(traj.canTransition(state, "DIAGNOSE", "guarded").allowed, true);
  const implState = traj.deserializeTrajectory({ route: "fix", phase: "IMPLEMENT", objective: "x", evidence: traj.emptyEvidence(), blockers: [] });
  assert.equal(traj.canTransition(implState, "DONE", "strict").allowed, false);
});

test("evidence add deduplicates and truncates", () => {
  const state = traj.deserializeTrajectory({
    route: "fix",
    phase: "INSPECT",
    objective: "x",
    evidence: traj.emptyEvidence(),
    blockers: [],
  });
  traj.addEvidence(state, "inspectedFiles", "a.ts");
  traj.addEvidence(state, "inspectedFiles", "a.ts");
  assert.equal(state.evidence.inspectedFiles.length, 1);
  for (let i = 0; i < 20; i++) traj.addEvidence(state, "inspectedFiles", `f${i}.ts`);
  assert.ok(state.evidence.inspectedFiles.length <= 12);
});

test("fast path detects trivial tasks", () => {
  assert.equal(traj.isFastPath("fix", "fix typo in README", traj.emptyEvidence()), true);
  assert.equal(traj.isFastPath("build", "implement a full microservices architecture", traj.emptyEvidence()), false);
});

test("shouldBlockTool blocks edit in inspect phase", () => {
  const state = traj.deserializeTrajectory({
    route: "fix",
    phase: "INSPECT",
    objective: "x",
    evidence: traj.emptyEvidence(),
    blockers: [],
  });
  assert.equal(traj.shouldBlockTool(state, "edit", "guarded").block, true);
  assert.equal(traj.shouldBlockTool(state, "read", "guarded").block, false);
});

test("buildTrajectoryInjection includes phase and next", () => {
  const state = traj.deserializeTrajectory({
    route: "fix",
    phase: "DIAGNOSE",
    objective: "find root cause",
    evidence: traj.emptyEvidence(),
    blockers: [],
  });
  const text = traj.buildTrajectoryInjection(state, 800);
  assert.match(text, /phase: DIAGNOSE/);
  assert.match(text, /route: fix/);
});

test("extension injects trajectory in before_agent_start", async () => {
  freshEnv();
  const pi = createMockPi({ "dsh-trajectory": true });
  dshRoutingPi(pi);
  const ctx = makeCtx("s1");
  const before = pi._handlers.get("before_agent_start");
  const result = await before({ prompt: "修复登录失败并检查架构、安全、并发和分布式边界情况", systemPrompt: "base" }, ctx);
  assert.ok(result);
  assert.match(result.systemPrompt, /\[DSH Trajectory\]/);
  assert.match(result.systemPrompt, /phase: UNDERSTAND/);
});

test("tool_call blocks edit in inspect phase", async () => {
  freshEnv();
  const pi = createMockPi({ "dsh-trajectory": true });
  dshRoutingPi(pi);
  const ctx = makeCtx("s1");
  const before = pi._handlers.get("before_agent_start");
  await before({ prompt: "找出为什么测试失败，不修改文件", systemPrompt: "base" }, ctx);
  // force phase to INSPECT via command
  const phaseCmd = pi._commands.get("dsh-phase");
  await phaseCmd.handler("INSPECT", ctx);

  const toolCall = pi._handlers.get("tool_call");
  const result = await toolCall({ toolName: "edit", input: { file_path: "a.ts" } }, ctx);
  assert.ok(result);
  assert.equal(result.block, true);
});

test("compaction summary includes trajectory", async () => {
  freshEnv();
  const pi = createMockPi({ "dsh-trajectory": true });
  dshRoutingPi(pi);
  const ctx = makeCtx("s1");
  const before = pi._handlers.get("before_agent_start");
  await before({ prompt: "修复登录失败", systemPrompt: "base" }, ctx);
  const compact = pi._handlers.get("session_before_compact");
  const result = await compact(
    { preparation: { previousSummary: "old", firstKeptEntryId: "e1", tokensBefore: 1000 } },
    ctx,
  );
  assert.ok(result);
  assert.match(result.compaction.summary, /\[DSH Trajectory\]/);
});

test("serialization roundtrip", () => {
  const state = traj.deserializeTrajectory({
    route: "fix",
    phase: "IMPLEMENT",
    objective: "x",
    evidence: { ...traj.emptyEvidence(), modifiedFiles: ["a.ts"] },
    blockers: [],
    nextPhase: "TEST",
  });
  const snapshot = traj.serializeTrajectory(state);
  const restored = traj.deserializeTrajectory(snapshot);
  assert.equal(restored.phase, "IMPLEMENT");
  assert.deepEqual(restored.evidence.modifiedFiles, ["a.ts"]);
});
