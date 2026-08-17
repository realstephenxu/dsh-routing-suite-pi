import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mod = require("../dist/extension.js");
const dshRoutingPi = mod.default ?? mod;

function createMockPi(initialTools = ["read", "bash", "edit", "write"], flags = {}) {
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  let activeTools = [...initialTools];

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
    _activeTools() {
      return [...activeTools];
    },
    _setActiveTools(tools) {
      activeTools = [...tools];
    },
  };

  return pi;
}

function makeCtx() {
  const notifications = [];
  return {
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
    _notifications: notifications,
  };
}

test("before_agent_start injects routing guidance for fix", async () => {
  const pi = createMockPi();
  dshRoutingPi(pi);
  const handler = pi._handlers.get("before_agent_start");
  assert.ok(handler, "before_agent_start handler is registered");

  const result = await handler(
    { prompt: "修复登录失败", systemPrompt: "base system" },
    makeCtx(),
  );
  assert.ok(result, "expected a result");
  assert.match(result.systemPrompt, /\[DSH route: fix/);
  assert.match(result.systemPrompt, /DSH-ROUTER-V1/);
  assert.match(result.systemPrompt, /rules v3/);
});

test("off prompt returns undefined", async () => {
  const pi = createMockPi();
  dshRoutingPi(pi);
  const handler = pi._handlers.get("before_agent_start");
  const result = await handler(
    { prompt: "你好", systemPrompt: "base" },
    makeCtx(),
  );
  assert.equal(result, undefined);
});

test("own plan mode forces plan route", async () => {
  const pi = createMockPi();
  dshRoutingPi(pi);

  const commandHandler = pi._commands.get("dsh-plan")?.handler;
  assert.ok(commandHandler, "dsh-plan command is registered");
  await commandHandler(undefined, makeCtx());

  const handler = pi._handlers.get("before_agent_start");
  const result = await handler(
    { prompt: "实现这个功能", systemPrompt: "base" },
    makeCtx(),
  );
  assert.ok(result);
  assert.match(result.systemPrompt, /\[DSH route: plan/);
});

test("external plan mode (no write tools) forces plan route", async () => {
  const pi = createMockPi(["read", "bash", "grep", "find", "ls"]);
  dshRoutingPi(pi);
  const handler = pi._handlers.get("before_agent_start");
  const result = await handler(
    { prompt: "实现这个功能", systemPrompt: "base" },
    makeCtx(),
  );
  assert.ok(result);
  assert.match(result.systemPrompt, /\[DSH route: plan/);
});

test("two-phase tools: minimal then expand after tool call", async () => {
  const pi = createMockPi(["read", "bash", "edit", "write"], { "dsh-two-phase": true });
  dshRoutingPi(pi);

  const handler = pi._handlers.get("before_agent_start");
  const result = await handler(
    { prompt: "修复这个 bug", systemPrompt: "base" },
    makeCtx(),
  );
  assert.ok(result);
  // fix minimal set should not include write
  const activeAfterStart = pi._activeTools();
  assert.ok(activeAfterStart.includes("edit"));
  assert.ok(!activeAfterStart.includes("write"));

  const toolCallHandler = pi._handlers.get("tool_call");
  assert.ok(toolCallHandler, "tool_call handler is registered");
  await toolCallHandler({ toolName: "edit" }, makeCtx());
  assert.ok(pi._activeTools().includes("write"), "full tools should be restored after first tool call");
});

test("dsh-status command reports state", async () => {
  const pi = createMockPi();
  dshRoutingPi(pi);
  const command = pi._commands.get("dsh-status");
  assert.ok(command, "dsh-status command is registered");
  const ctx = makeCtx();
  await command.handler(undefined, ctx);
  assert.ok(ctx._notifications.length > 0);
  assert.match(ctx._notifications[0].message, /identity=DSH-ROUTER-V1/);
});

test("dsh-route command sets override", async () => {
  const pi = createMockPi();
  dshRoutingPi(pi);
  const command = pi._commands.get("dsh-route");
  assert.ok(command, "dsh-route command is registered");
  const ctx = makeCtx();
  await command.handler("plan", ctx);
  assert.match(ctx._notifications[0].message, /Route override set to plan/);

  const handler = pi._handlers.get("before_agent_start");
  const result = await handler(
    { prompt: "你好", systemPrompt: "base" },
    makeCtx(),
  );
  assert.ok(result);
  assert.match(result.systemPrompt, /\[DSH route: plan/);
});

test("malformed prompt fails open", async () => {
  const pi = createMockPi();
  dshRoutingPi(pi);
  const handler = pi._handlers.get("before_agent_start");
  const result = await handler(
    { prompt: null, systemPrompt: "base" },
    makeCtx(),
  );
  assert.equal(result, undefined);
});
