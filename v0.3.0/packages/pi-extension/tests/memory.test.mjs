import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const memoryMod = require("../dist/memory.js");
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

test("memory store CRUD and snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-memory-"));
  const file = join(dir, "memory.json");
  try {
    const store = memoryMod.loadStore(file);
    const session = memoryMod.getSessionMemory(store, "s1", "/tmp/project");
    const topic = memoryMod.ensureActiveTopic(session, "修复登录超时");
    memoryMod.addMemoryEntry(session, topic, "decision", "使用 Redis 分布式锁", 7);
    memoryMod.addMemoryEntry(session, topic, "fact", "src/auth/login.ts", 6);
    memoryMod.saveStore(store, file);

    const reloaded = memoryMod.loadStore(file);
    const session2 = memoryMod.getSessionMemory(reloaded, "s1", "/tmp/project");
    const snapshot = memoryMod.buildMemorySnapshot(session2);
    assert.match(snapshot, /使用 Redis 分布式锁/);
    assert.match(snapshot, /src\/auth\/login.ts/);

    const extracted = memoryMod.extractMemoryFromText("我们决定使用 Redis 分布式锁，不用 DB 锁", "s1");
    assert.ok(extracted.some((e) => e.kind === "decision"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("matchTopicScore returns higher for related input", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-memory-"));
  const file = join(dir, "memory.json");
  try {
    const store = memoryMod.loadStore(file);
    const session = memoryMod.getSessionMemory(store, "s1", "/tmp/project");
    const topic = memoryMod.ensureActiveTopic(session, "修复登录超时");
    const related = memoryMod.matchTopicScore("继续修复登录超时", topic);
    const unrelated = memoryMod.matchTopicScore("写一个网页游戏", topic);
    assert.ok(related > unrelated);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extension memory injection and extraction", async () => {
  const pi = createMockPi({ "dsh-memory": true });
  dshRoutingPi(pi);
  const ctx = makeCtx("s1");

  const noteCmd = pi._commands.get("dsh-memory-note");
  await noteCmd.handler("记住：使用 Redis 分布式锁", ctx);

  const before = pi._handlers.get("before_agent_start");
  const result = await before(
    { prompt: "修复登录失败", systemPrompt: "base" },
    ctx,
  );
  assert.ok(result);
  assert.match(result.systemPrompt, /\[DSH Memory\]/);
  assert.match(result.systemPrompt, /使用 Redis 分布式锁/);

  const turnEnd = pi._handlers.get("turn_end");
  await turnEnd(
    { message: { content: [{ type: "text", text: "我们决定把超时阈值改为 5s" }] } },
    ctx,
  );

  const result2 = await before(
    { prompt: "继续修复登录", systemPrompt: "base" },
    ctx,
  );
  assert.ok(result2);
  assert.match(result2.systemPrompt, /超时阈值改为 5s/);
});

test("memory commands are registered", async () => {
  const pi = createMockPi({ "dsh-memory": true });
  dshRoutingPi(pi);
  for (const name of ["dsh-memory", "dsh-memory-note", "dsh-memory-forget", "dsh-memory-config"]) {
    assert.ok(pi._commands.get(name), `command ${name} should be registered`);
  }
});

test("session_before_compact returns memory summary", async () => {
  const pi = createMockPi({ "dsh-memory": true });
  dshRoutingPi(pi);
  const ctx = makeCtx("s1");
  const noteCmd = pi._commands.get("dsh-memory-note");
  await noteCmd.handler("记住：使用 Redis 分布式锁", ctx);

  const handler = pi._handlers.get("session_before_compact");
  assert.ok(handler, "session_before_compact handler is registered");
  const result = await handler(
    {
      preparation: {
        previousSummary: "old",
        firstKeptEntryId: "e1",
        tokensBefore: 1000,
      },
    },
    ctx,
  );
  assert.ok(result);
  assert.match(result.compaction.summary, /使用 Redis 分布式锁/);
});
