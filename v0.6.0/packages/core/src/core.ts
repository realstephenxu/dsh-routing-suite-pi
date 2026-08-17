import routingRulesJson from "./routing-rules.json";
import type {
  Route,
  RouteClassification,
  RouteWithWork,
  RouterInput,
  RouterOutput,
  RoutingRules,
} from "./types";

export const DEFAULT_ROUTER_IDENTITY = "DSH-ROUTER-V1";
export const CORE_VERSION = 2;

const defaultRules = routingRulesJson as RoutingRules;

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Missing or invalid ${name}`);
  }
}

function assertNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number") {
    throw new Error(`Missing or invalid ${name}`);
  }
}

export function validateRules(rules: unknown): asserts rules is RoutingRules {
  if (!rules || typeof rules !== "object") {
    throw new Error("Routing rules must be an object");
  }
  const candidate = rules as Partial<RoutingRules>;

  assertNumber(candidate.version, "rules.version");
  if (!candidate.signals || typeof candidate.signals !== "object") {
    throw new Error("Missing rules.signals");
  }
  for (const key of [
    "greeting",
    "planExplicit",
    "inspect",
    "fix",
    "build",
    "engineering",
    "complex",
    "noChange",
  ] as const) {
    assertString(candidate.signals[key], `rules.signals.${key}`);
    // Throws if the signal is not a valid regular expression.
    new RegExp(candidate.signals[key], "iu");
  }

  if (!candidate.complexity || typeof candidate.complexity !== "object") {
    throw new Error("Missing rules.complexity");
  }
  assertNumber(candidate.complexity.minLength, "rules.complexity.minLength");

  if (!candidate.guidance || typeof candidate.guidance !== "object") {
    throw new Error("Missing rules.guidance");
  }
  for (const key of [
    "prefix",
    "plan",
    "inspect",
    "fix",
    "build",
    "adaptive",
    "simpleTail",
    "complexTail",
  ] as const) {
    assertString(candidate.guidance[key], `rules.guidance.${key}`);
  }
}

function countMatches(text: string, pattern: string): number {
  return text.match(new RegExp(pattern, "giu"))?.length ?? 0;
}

export function classifyPrompt(
  input: RouterInput,
  rules: RoutingRules = defaultRules,
): RouteClassification {
  validateRules(rules);

  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  const rawPermissionMode =
    typeof input?.permissionMode === "string"
      ? input.permissionMode
      : typeof input?.permission_mode === "string"
        ? input.permission_mode
        : "";
  const permissionMode = rawPermissionMode.toLowerCase();

  if (!prompt) {
    return { route: "off", complex: false };
  }

  const overrideRoute = input?.overrideRoute;
  if (overrideRoute && overrideRoute !== "auto") {
    const complex =
      prompt.length >= rules.complexity.minLength ||
      new RegExp(rules.signals.complex, "iu").test(prompt);
    return { route: overrideRoute, complex };
  }

  if (permissionMode === "plan") {
    return { route: "plan", complex: true };
  }

  const signals = rules.signals;
  if (new RegExp(signals.greeting, "iu").test(prompt)) {
    return { route: "off", complex: false };
  }
  if (new RegExp(signals.planExplicit, "iu").test(prompt)) {
    return { route: "plan", complex: true };
  }

  const fixScore = countMatches(prompt, signals.fix);
  const buildScore = countMatches(prompt, signals.build);
  const inspectScore = countMatches(prompt, signals.inspect);
  const noChange = new RegExp(signals.noChange, "iu").test(prompt);

  const effectiveFix = noChange ? 0 : fixScore;
  const effectiveBuild = noChange ? 0 : buildScore;

  let route: Route = "off";
  if (effectiveFix > 0 && effectiveBuild > 0) {
    route = "adaptive";
  } else if (effectiveFix > 0) {
    route = "fix";
  } else if (effectiveBuild > 0) {
    route = "build";
  } else if (inspectScore > 0) {
    route = "inspect";
  } else if (new RegExp(signals.engineering, "iu").test(prompt)) {
    route = input?.allowWeak === true ? "weak" : "adaptive";
  }

  const complex =
    route !== "off" &&
    (prompt.length >= rules.complexity.minLength ||
      new RegExp(signals.complex, "iu").test(prompt));

  return { route, complex };
}

export function buildGuidance(
  classification: RouteClassification,
  rules: RoutingRules = defaultRules,
  identity: string = DEFAULT_ROUTER_IDENTITY,
  coreVersion: number = CORE_VERSION,
): RouterOutput | null {
  validateRules(rules);
  if (!classification || classification.route === "off") {
    return null;
  }

  const route = classification.route as RouteWithWork;
  const tail = classification.complex ? rules.guidance.complexTail : rules.guidance.simpleTail;
  const routeGuidance = route === "weak" ? rules.guidance.adaptive : rules.guidance[route];
  const marker = `[DSH route: ${route}; ${identity}; core v${coreVersion}; rules v${rules.version}]`;
  const guidance = [
    marker,
    rules.guidance.prefix,
    routeGuidance,
    tail,
  ].join(" ");

  return {
    route,
    complex: classification.complex,
    marker,
    identity,
    guidance,
  };
}

export function createRouterOutput(
  input: RouterInput,
  rules: RoutingRules = defaultRules,
  identity: string = DEFAULT_ROUTER_IDENTITY,
  coreVersion: number = CORE_VERSION,
): RouterOutput | null {
  return buildGuidance(classifyPrompt(input, rules), rules, identity, coreVersion);
}

export { defaultRules as defaultRoutingRules };
