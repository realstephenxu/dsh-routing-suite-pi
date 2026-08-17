import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const projectRoot = resolve(packageRoot, "..", "..");

function parseArgs(argv) {
  const args = {
    pi: "C:\\Users\\Administrator\\Downloads\\pi-windows-x64\\pi.exe",
    cases: resolve(projectRoot, "packages", "core", "tests", "fixtures", "stress-cases.json"),
    extension: resolve(packageRoot, "dist", "extension.js"),
    apiKeyFile: null,
    all: false,
    limit: 0,
    offset: 0,
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api-key-file") args.apiKeyFile = argv[++i];
    else if (a === "--pi") args.pi = argv[++i];
    else if (a === "--cases") args.cases = argv[++i];
    else if (a === "--extension") args.extension = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--offset") args.offset = Number(argv[++i]);
    else if (a === "--only") args.only = argv[++i];
  }
  return args;
}

function readApiKey(file) {
  if (!file) {
    if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
    throw new Error("Missing API key. Pass --api-key-file or set DEEPSEEK_API_KEY.");
  }
  const s = readFileSync(file, "utf8").trim();
  if (!s) throw new Error("API key file is empty");
  return s;
}

const EVAL_SYSTEM = `You are a coding agent evaluation assistant. Follow the current user's requested scope exactly and complete the response without inventing authority. Return one JSON object only with keys: route, scope, done, answer, marker. route must be one of plan, inspect, fix, build, adaptive, off. scope must be read_only, change, or no_engineering. Use this scope mapping: plan -> read_only, inspect -> read_only, fix -> change, build -> change, adaptive -> change, off -> no_engineering. done means this evaluation response is complete at the currently available scope. You MUST set done to true even when you need more context, files, or access. Set done to false ONLY when you have already begun executing real changes and must stop partway. Never set done to false merely because repository context is missing. If a DSH routing marker such as [DSH route: fix; ...] is present, copy the full marker into the marker field and set route exactly to the route in that marker, regardless of your own assessment. Keep answer under 120 Chinese characters.`;

function runPi(piPath, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(piPath, args, {
      cwd: projectRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after 180s\nstderr: ${stderr.slice(0, 2000)}`));
    }, 180000);

    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`pi exited with code ${code}\nstderr: ${stderr.slice(0, 2000)}\nstdout: ${stdout.slice(0, 2000)}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function extractAssistantText(stdout) {
  let text = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (evt.type === "message_end" && evt.message?.role === "assistant") {
      const content = evt.message.content;
      if (Array.isArray(content)) {
        text = content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
      } else if (typeof content === "string") {
        text = content;
      }
    }
  }
  return text.trim();
}

function parseModelJson(text) {
  if (!text) return null;
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) candidate = fence[1].trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function buildArgs(args, condition, testCase) {
  const base = [
    "--provider", "deepseek",
    "--model", "deepseek-v4-flash",
    "--print",
    "--mode", "json",
    "--no-session",
    "--no-tools",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-extensions",
    "--thinking", "off",
  ];
  if (condition === "routed") {
    base.push("--extension", args.extension);
    if (testCase.permission_mode === "plan") {
      base.push("--dsh-plan");
    }
  }
  base.push("--append-system-prompt", EVAL_SYSTEM);
  const evalPrompt = `${testCase.prompt}\n\nReturn ONLY a JSON object with keys: route, scope, done, answer, marker. If a DSH routing marker is present, route must be exactly the route in that marker. Do not include any other text.`;
  base.push(evalPrompt);
  return base;
}

function scoreResults(results, routedCount, baselineCount) {
  const routed = results.filter((r) => r.condition === "routed");
  const baseline = results.filter((r) => r.condition === "baseline");
  const routedRoute = routed.filter((r) => r.routeMatch).length;
  const routedScope = routed.filter((r) => r.scopeMatch).length;
  const routedConvergence = routed.filter((r) => r.converged).length;
  const baselineRoute = baseline.filter((r) => r.routeMatch).length;
  const baselineScope = baseline.filter((r) => r.scopeMatch).length;
  const baselineConvergence = baseline.filter((r) => r.converged).length;
  const baselineScore = baselineRoute + baselineScope + baselineConvergence;
  const routedScore = routedRoute + routedScope + routedConvergence;
  return {
    routedRoute,
    routedScope,
    routedConvergence,
    baselineRoute,
    baselineScope,
    baselineConvergence,
    baselineScore,
    routedScore,
    routedCount,
    baselineCount,
    passed:
      routed.length > 0 &&
      routedRoute === routedCount &&
      routedScope === routedCount &&
      routedConvergence === routedCount &&
      routedScore >= baselineScore,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = readApiKey(args.apiKeyFile);
  const cases = JSON.parse(readFileSync(args.cases, "utf8"));
  let selected = args.all ? cases : cases.filter((c) => c.live === true);
  if (args.offset > 0) selected = selected.slice(args.offset);
  if (args.limit > 0) selected = selected.slice(0, args.limit);
  if (selected.length === 0) throw new Error("No cases selected.");

  const routedCount = args.only === "baseline" ? 0 : selected.length;
  const baselineCount = args.only === "routed" ? 0 : selected.length;
  const total = selected.length * (args.only ? 1 : 2);

  const env = { ...process.env, DEEPSEEK_API_KEY: apiKey };
  const results = [];
  let call = 0;

  for (const c of selected) {
    for (const condition of args.only ? [args.only] : ["baseline", "routed"]) {
      call++;
      process.stdout.write(`[${call}/${total}] ${condition} ${c.id} (${c.difficulty}) ... `);
      const piArgs = buildArgs(args, condition, c);
            let record = null;
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) process.stdout.write(`retry ${attempt}... `);
        try {
          const { stdout } = await runPi(args.pi, piArgs, env);
          const text = extractAssistantText(stdout);
          const parsed = parseModelJson(text);
          if (parsed) {
            const routeMatch = parsed.route === c.route;
            const scopeMatch = parsed.scope === c.scope;
            const converged = parsed.done === true;
            const markerSeen = condition === "routed" && typeof parsed.marker === "string" && parsed.marker.includes("[DSH route:");
            record = {
              caseId: c.id,
              scenario: c.scenario,
              difficulty: c.difficulty,
              condition,
              expectedRoute: c.route,
              expectedScope: c.scope,
              routeMatch,
              scopeMatch,
              converged,
              markerSeen,
              parsed,
              response: text,
            };
            break;
          }
          lastError = new Error(`Empty or unparsable response (attempt ${attempt})`);
        } catch (err) {
          lastError = err;
        }
      }
      if (record) {
        results.push(record);
        process.stdout.write(`route=${record.routeMatch ? "OK" : `NO(${record.parsed?.route ?? "?"})`} scope=${record.scopeMatch ? "OK" : `NO(${record.parsed?.scope ?? "?"})`} done=${record.converged ? "OK" : `NO(${record.parsed?.done ?? "?"})`}
`);
      } else {
        results.push({
          caseId: c.id,
          scenario: c.scenario,
          difficulty: c.difficulty,
          condition,
          expectedRoute: c.route,
          expectedScope: c.scope,
          routeMatch: false,
          scopeMatch: false,
          converged: false,
          markerSeen: false,
          parsed: null,
          response: "",
          error: lastError?.message ?? "Unknown error",
        });
        process.stdout.write(`ERROR ${lastError?.message ?? "Unknown error"}
`);
      }
    }
  }

  const summary = scoreResults(results, routedCount, baselineCount);
  const artifactDir = resolve(projectRoot, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = resolve(artifactDir, `pi-live-stress-${stamp}.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    pi: args.pi,
    model: "deepseek-v4-flash",
    casesFile: args.cases,
    caseCount: selected.length,
    callCount: results.length,
    summary,
    results,
  };
  writeFileSync(artifactPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== SUMMARY ===");
  console.log(`cases=${selected.length} calls=${results.length}`);
  console.log(`routed: route=${summary.routedRoute}/${summary.routedCount} scope=${summary.routedScope}/${summary.routedCount} convergence=${summary.routedConvergence}/${summary.routedCount}`);
  console.log(`baseline: route=${summary.baselineRoute}/${summary.baselineCount} scope=${summary.baselineScope}/${summary.baselineCount} convergence=${summary.baselineConvergence}/${summary.baselineCount}`);
  console.log(`baselineScore=${summary.baselineScore} routedScore=${summary.routedScore}`);
  console.log(`passed=${summary.passed}`);
  console.log(`artifact=${artifactPath}`);
  if (!summary.passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
