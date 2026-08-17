import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type MemoryKind = "decision" | "design" | "error" | "todo" | "preference" | "fact";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  createdAt: string;
  source: {
    sessionId: string;
    excerpt?: string;
  };
  supersededBy?: string;
}

export interface MemoryTopic {
  id: string;
  title: string;
  tags: string[];
  status: "in_progress" | "completed";
  decisions: MemoryEntry[];
  designs: MemoryEntry[];
  errors: MemoryEntry[];
  todos: MemoryEntry[];
  files: string[];
  source: {
    firstSeen: string;
    sessionId: string;
  };
  derivedFrom?: string;
  links: string[];
}

export interface SessionMemory {
  sessionId: string;
  workspace: string;
  activeTopicId?: string;
  topics: MemoryTopic[];
  lastSummary?: string;
  updatedAt: string;
}

export interface MemoryStoreData {
  sessions: Record<string, SessionMemory>;
}

export interface MemoryInjectPolicy {
  enabled: boolean;
  maxChars: number;
  maxDecisions: number;
  maxFiles: number;
  maxErrors: number;
  maxTodos: number;
  topK: number;
  minScore: number;
  injectOn: "every_turn" | "active_topic_only" | "before_compact";
}

export const DEFAULT_MEMORY_POLICY: MemoryInjectPolicy = {
  enabled: false,
  maxChars: 4000,
  maxDecisions: 8,
  maxFiles: 12,
  maxErrors: 5,
  maxTodos: 5,
  topK: 5,
  minScore: 0.4,
  injectOn: "every_turn",
};

export function defaultMemoryPath(): string {
  const base = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(base, "dsh-memory-v0.3.json");
}

export function loadStore(filePath = defaultMemoryPath()): MemoryStoreData {
  try {
    if (!existsSync(filePath)) return { sessions: {} };
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as MemoryStoreData;
    return { sessions: parsed.sessions ?? {} };
  } catch {
    return { sessions: {} };
  }
}

export function saveStore(store: MemoryStoreData, filePath = defaultMemoryPath()): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    renameSync(tmp, filePath);
  } catch {
    // Memory persistence must never break Pi.
  }
}

export function getSessionMemory(
  store: MemoryStoreData,
  sessionId: string,
  workspace: string,
): SessionMemory {
  if (!store.sessions[sessionId]) {
    store.sessions[sessionId] = {
      sessionId,
      workspace,
      topics: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const session = store.sessions[sessionId];
  session.workspace = workspace;
  session.updatedAt = new Date().toISOString();
  return session;
}

export function getActiveTopic(session: SessionMemory): MemoryTopic | undefined {
  if (session.activeTopicId) {
    const topic = session.topics.find((t) => t.id === session.activeTopicId);
    if (topic) return topic;
  }
  return session.topics.find((t) => t.status === "in_progress") ?? session.topics[0];
}

export function ensureActiveTopic(session: SessionMemory, prompt?: string): MemoryTopic {
  const existing = getActiveTopic(session);
  if (existing) return existing;
  const title = (prompt || "Untitled task").trim().slice(0, 60) || "Untitled task";
  const topic: MemoryTopic = {
    id: randomUUID(),
    title,
    tags: [],
    status: "in_progress",
    decisions: [],
    designs: [],
    errors: [],
    todos: [],
    files: [],
    source: {
      firstSeen: new Date().toISOString(),
      sessionId: session.sessionId,
    },
    links: [],
  };
  session.topics.push(topic);
  session.activeTopicId = topic.id;
  session.updatedAt = new Date().toISOString();
  return topic;
}

export function addMemoryEntry(
  session: SessionMemory,
  topic: MemoryTopic,
  kind: MemoryKind,
  content: string,
  importance = 5,
  excerpt?: string,
): MemoryEntry {
  const entry: MemoryEntry = {
    id: randomUUID(),
    kind,
    content,
    importance,
    createdAt: new Date().toISOString(),
    source: { sessionId: session.sessionId, excerpt },
  };
  const list =
    kind === "decision"
      ? topic.decisions
      : kind === "design"
        ? topic.designs
        : kind === "error"
          ? topic.errors
          : kind === "todo"
            ? topic.todos
            : topic.decisions;
  const normalized = content.trim().toLowerCase();
  const existing = list.find((e) => e.content.trim().toLowerCase() === normalized);
  if (existing) {
    existing.supersededBy = entry.id;
  }
  list.push(entry);
  if (/(?:^|\/)[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|css|html|yml|yaml)$/i.test(content)) {
    topic.files.push(content);
  }
  session.updatedAt = new Date().toISOString();
  return entry;
}

export function markEntrySuperseded(
  session: SessionMemory,
  topic: MemoryTopic,
  entryId: string,
  byEntryId?: string,
): boolean {
  for (const list of [topic.decisions, topic.designs, topic.errors, topic.todos]) {
    const entry = list.find((e) => e.id === entryId);
    if (entry) {
      entry.supersededBy = byEntryId ?? "manual";
      session.updatedAt = new Date().toISOString();
      return true;
    }
  }
  return false;
}

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((s) => s.length > 1);
  const hanChars = Array.from(text).filter((ch) => /\p{Script=Han}/u.test(ch));
  return new Set([...words, ...hanChars]);
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return (2 * hit) / (a.size + b.size);
}

export function matchTopicScore(input: string, topic: MemoryTopic): number {
  const inputTokens = tokenize(input);
  if (inputTokens.size === 0) return 0;
  const titleTokens = tokenize(topic.title);
  const tagTokens = tokenize(topic.tags.join(" "));
  const decisionTokens = tokenize(topic.decisions.map((d) => d.content).join(" "));
  const score =
    dice(inputTokens, titleTokens) * 0.6 +
    dice(inputTokens, tagTokens) * 0.25 +
    dice(inputTokens, decisionTokens) * 0.15;
  return score;
}

export function buildMemorySnapshot(
  session: SessionMemory,
  policy: MemoryInjectPolicy = DEFAULT_MEMORY_POLICY,
): string {
  const topic = getActiveTopic(session);
  if (!topic) return "";
  const lines: string[] = [];
  lines.push("[DSH Memory]");
  lines.push(`当前主题: ${topic.title}`);
  if (topic.decisions.length > 0) {
    lines.push("已确认决策:");
    for (const d of topic.decisions.slice(0, policy.maxDecisions)) {
      if (d.supersededBy) continue;
      lines.push(`- ${d.content}`);
    }
  }
  if (topic.files.length > 0) {
    lines.push("关键文件:");
    for (const f of topic.files.slice(0, policy.maxFiles)) {
      lines.push(`- ${f}`);
    }
  }
  if (topic.errors.length > 0) {
    lines.push("已知错误:");
    for (const e of topic.errors.slice(0, policy.maxErrors)) {
      if (e.supersededBy) continue;
      lines.push(`- ${e.content}`);
    }
  }
  if (topic.todos.length > 0) {
    lines.push("未完成:");
    for (const t of topic.todos.slice(0, policy.maxTodos)) {
      if (t.supersededBy) continue;
      lines.push(`- ${t.content}`);
    }
  }
  let snapshot = lines.join("\n");
  if (snapshot.length > policy.maxChars) {
    snapshot = snapshot.slice(0, policy.maxChars) + "\n…(truncated)";
  }
  return snapshot;
}

export function extractMemoryFromText(
  text: string,
  sessionId: string,
): { kind: MemoryKind; content: string; importance: number }[] {
  if (!text) return [];
  const entries: { kind: MemoryKind; content: string; importance: number }[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/决定|采用|使用|不用|改为|改成|选择|确认|我们决定|we decide/i.test(trimmed)) {
      entries.push({ kind: "decision", content: trimmed.slice(0, 200), importance: 7 });
    }
    const fileMatch = trimmed.match(/(?:^|\/)[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|css|html|yml|yaml)\b/i);
    if (fileMatch) {
      entries.push({ kind: "fact", content: fileMatch[0], importance: 6 });
    }
    if (/error|exception|failed|失败|报错|异常|超时|crash|leak|vulnerability/i.test(trimmed)) {
      entries.push({ kind: "error", content: trimmed.slice(0, 200), importance: 8 });
    }
    if (/待办|下一步|需要做|还要|todo|next step|remaining/i.test(trimmed)) {
      entries.push({ kind: "todo", content: trimmed.slice(0, 200), importance: 4 });
    }
    if (/设计|架构|约束|边界|兼容|方案|design|architecture|constraint/i.test(trimmed)) {
      entries.push({ kind: "design", content: trimmed.slice(0, 200), importance: 6 });
    }
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = e.content.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


export interface MemorySearchResult {
  entry: MemoryEntry;
  topicTitle: string;
  sessionId: string;
  score: number;
}

function entryText(entry: MemoryEntry): string {
  return entry.content;
}

function recencyBoost(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const days = ageMs / 86400000;
  return Math.max(0, 1 - days / 30);
}

export function searchMemory(
  store: MemoryStoreData,
  workspace: string,
  query: string,
  limit = 5,
  minScore = 0.25,
): MemorySearchResult[] {
  if (!query.trim()) return [];
  const results: MemorySearchResult[] = [];
  const queryTokens = tokenize(query);
  for (const session of Object.values(store.sessions)) {
    if (session.workspace !== workspace) continue;
    for (const topic of session.topics) {
      const topicTokens = tokenize(topic.title);
      const allEntries = [
        ...topic.decisions,
        ...topic.designs,
        ...topic.errors,
        ...topic.todos,
      ];
      for (const entry of allEntries) {
        if (entry.supersededBy) continue;
        const entryTokens = tokenize(entryText(entry));
        const contentScore = dice(queryTokens, entryTokens);
        const titleScore = dice(queryTokens, topicTokens);
        const score = contentScore * 0.5 + titleScore * 0.3 + recencyBoost(entry.createdAt) * 0.2;
        if (score >= minScore) {
          results.push({ entry, topicTitle: topic.title, sessionId: session.sessionId, score });
        }
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function buildRecallSnapshot(
  results: MemorySearchResult[],
  maxChars = 2000,
): string {
  if (results.length === 0) return "";
  const lines = ["[DSH History Memory]"];
  for (const r of results.slice(0, 5)) {
    lines.push(`- [${r.topicTitle}] ${r.entry.content}`);
  }
  let snapshot = lines.join("\n");
  if (snapshot.length > maxChars) {
    snapshot = snapshot.slice(0, maxChars) + "\n…(truncated)";
  }
  return snapshot;
}


export interface MemoryDistillPolicy {
  maxDecisions: number;
  maxDesigns: number;
  maxErrors: number;
  maxTodos: number;
  maxSummaryChars: number;
}

export const DEFAULT_DISTILL_POLICY: MemoryDistillPolicy = {
  maxDecisions: 8,
  maxDesigns: 5,
  maxErrors: 5,
  maxTodos: 5,
  maxSummaryChars: 2000,
};

function activeEntries(entries: MemoryEntry[], max: number): MemoryEntry[] {
  return entries.filter((e) => !e.supersededBy).slice(0, max);
}

export function distillTopic(topic: MemoryTopic, policy: MemoryDistillPolicy = DEFAULT_DISTILL_POLICY): void {
  topic.decisions = activeEntries(topic.decisions, policy.maxDecisions);
  topic.designs = activeEntries(topic.designs, policy.maxDesigns);
  topic.errors = activeEntries(topic.errors, policy.maxErrors);
  topic.todos = activeEntries(topic.todos, policy.maxTodos);
}

export function distillSession(session: SessionMemory, policy: MemoryDistillPolicy = DEFAULT_DISTILL_POLICY): string {
  const topic = getActiveTopic(session);
  if (!topic) {
    session.lastSummary = "";
    return "";
  }
  distillTopic(topic, policy);
  const lines = [
    `主题: ${topic.title}`,
  ];
  if (topic.decisions.length > 0) {
    lines.push(`决策: ${topic.decisions.slice(0, 3).map((d) => d.content).join("; ")}`);
  }
  if (topic.designs.length > 0) {
    lines.push(`设计: ${topic.designs.slice(0, 2).map((d) => d.content).join("; ")}`);
  }
  if (topic.errors.length > 0) {
    lines.push(`错误: ${topic.errors.slice(0, 2).map((e) => e.content).join("; ")}`);
  }
  if (topic.todos.length > 0) {
    lines.push(`待办: ${topic.todos.slice(0, 2).map((t) => t.content).join("; ")}`);
  }
  let summary = lines.join("\n");
  if (summary.length > policy.maxSummaryChars) {
    summary = summary.slice(0, policy.maxSummaryChars) + "\n…(truncated)";
  }
  session.lastSummary = summary;
  session.updatedAt = new Date().toISOString();
  return summary;
}

export function buildCompactionSummary(session: SessionMemory, policy: MemoryDistillPolicy = DEFAULT_DISTILL_POLICY): string {
  const snapshot = buildMemorySnapshot(session);
  const summary = distillSession(session, policy);
  if (snapshot && summary) {
    return `${snapshot}\n\n${summary}`;
  }
  return snapshot || summary;
}
