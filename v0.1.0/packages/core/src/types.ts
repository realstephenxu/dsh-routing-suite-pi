export type Route = "plan" | "inspect" | "fix" | "build" | "adaptive" | "off";
export type RouteWithWork = Exclude<Route, "off">;
export type Scope = "read_only" | "change" | "no_engineering";
export type Difficulty = "L1" | "L2" | "L3" | "L4";

export interface RoutingSignals {
  greeting: string;
  planExplicit: string;
  inspect: string;
  fix: string;
  build: string;
  complex: string;
  noChange: string;
}

export interface RoutingGuidance {
  prefix: string;
  plan: string;
  inspect: string;
  fix: string;
  build: string;
  adaptive: string;
  simpleTail: string;
  complexTail: string;
}

export interface RoutingRules {
  version: number;
  signals: RoutingSignals;
  complexity: {
    minLength: number;
  };
  guidance: RoutingGuidance;
}

export interface RouterInput {
  prompt: string;
  permissionMode?: string;
  /** Compatibility alias used by the existing Codex test corpus. */
  permission_mode?: string;
  model?: string;
}

export interface RouteClassification {
  route: Route;
  complex: boolean;
}

export interface RouterOutput {
  route: RouteWithWork;
  complex: boolean;
  marker: string;
  identity: string;
  guidance: string;
}
