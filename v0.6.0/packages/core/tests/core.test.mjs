import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPrompt,
  buildGuidance,
  createRouterOutput,
  DEFAULT_ROUTER_IDENTITY,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const baseCases = JSON.parse(
  readFileSync(resolve(here, "fixtures", "router-cases.json"), "utf8"),
);
const stressCases = JSON.parse(
  readFileSync(resolve(here, "fixtures", "stress-cases.json"), "utf8"),
);

test("base router cases", () => {
  for (const testCase of baseCases) {
    const actual = classifyPrompt(testCase.payload);
    assert.equal(actual.route, testCase.route, testCase.name);
    const output = buildGuidance(actual);
    if (testCase.route === "off") {
      assert.equal(output, null, `${testCase.name}: off must emit no output`);
    } else {
      assert.ok(output.guidance.includes(`[DSH route: ${testCase.route}`), `${testCase.name}: route marker`);
      assert.match(output.guidance, /DSH-ROUTER-V1/, `${testCase.name}: identity`);
      assert.match(output.guidance, /rules v3/, `${testCase.name}: rules version`);
    }
  }
});

test("stress corpus", () => {
  let count = 0;
  for (const testCase of stressCases) {
    const payload = testCase.payload ?? {
      prompt: testCase.prompt,
      permission_mode: testCase.permission_mode,
      model: testCase.model,
    };
    const actual = classifyPrompt(payload);
    assert.equal(actual.route, testCase.route, `${testCase.id}: route`);
    assert.equal(actual.complex, testCase.complex, `${testCase.id}: complex`);
    const output = buildGuidance(actual);
    if (testCase.route === "off") {
      assert.equal(output, null, `${testCase.id}: off must emit no output`);
    } else {
      assert.match(output.guidance, /DSH-ROUTER-V1/, `${testCase.id}: identity`);
      assert.match(output.guidance, /rules v3/, `${testCase.id}: rules version`);
    }
    count++;
  }
  assert.ok(count >= 64, `expected at least 64 stress cases, got ${count}`);
});

test("model slug invariance", () => {
  const a = classifyPrompt({ prompt: "修复测试", model: "model-a" });
  const b = classifyPrompt({ prompt: "修复测试", model: "model-b" });
  assert.deepEqual(a, b);
});

test("createRouterOutput returns null for off", () => {
  assert.equal(createRouterOutput({ prompt: "你好" }), null);
});

test("identity is cross-platform universal", () => {
  const output = createRouterOutput({ prompt: "修复这个 bug" });
  assert.equal(output.identity, DEFAULT_ROUTER_IDENTITY);
  assert.equal(output.identity, "DSH-ROUTER-V1");
});


test("engineering fallback maps ambiguous task to adaptive by default", () => {
  const result = classifyPrompt({ prompt: "看看这段代码" });
  assert.equal(result.route, "adaptive");
});

test("engineering fallback can use weak when allowWeak is true", () => {
  const result = classifyPrompt({ prompt: "看看这段代码", allowWeak: true });
  assert.equal(result.route, "weak");
});

test("overrideRoute forces route", () => {
  const result = classifyPrompt({ prompt: "你好", overrideRoute: "plan" });
  assert.equal(result.route, "plan");
});

test("guidance includes action rhythm", () => {
  const output = createRouterOutput({ prompt: "修复这个 bug" });
  assert.match(output.guidance, /one action per sentence/);
});
