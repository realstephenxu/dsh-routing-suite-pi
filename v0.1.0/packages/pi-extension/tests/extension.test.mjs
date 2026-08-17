import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mod = require("../dist/extension.js");
const dshRoutingPi = mod.default ?? mod;

function createMockPi(initialTools = ["read", "bash", "edit", "write"]) {
  const handlers = new Map();
  const commands = new Map();
  let activeTools = [...initialTools];

  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerFlag() {},
    getFlag() {
      return false;
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(tools) {
      activeTools = [...tools];
    },
    _handlers: handlers,
    _commands: commands,
    _setActiveTools(tools) {
      activeTools = [...tools];
    },
  };

  return pi;
}

function makeCtx() {
  return {
    ui: {
      notify() {},
    },
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
  // Enable plan mode
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
