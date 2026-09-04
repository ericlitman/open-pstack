import { parseWorkerResult } from "./prompt.ts";
import type {
  CatalogEntry,
  CompletionObservation,
  CurrentContext,
  Effort,
  ModelTarget,
  ObservedSession,
  SessionStatus,
  Transcript,
  TranscriptMessage,
  WorkerAgent,
  WorkerIds,
  WorkerRequest,
  WorkspaceListing,
} from "./types.ts";

export class BoundaryError extends Error {
  override readonly name = "BoundaryError";
}

function fail(detail: string): never {
  throw new BoundaryError(`invalid Conductor response: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function unwrap(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  if (raw.structuredContent !== undefined) {
    return raw.structuredContent;
  }
  if (!Array.isArray(raw.content)) {
    return raw;
  }
  const blocks = raw.content.filter(
    (item) => isRecord(item) && item.type === "text" && typeof item.text === "string"
  );
  if (blocks.length !== 1) {
    fail("MCP envelope must contain one JSON text block");
  }
  const block = blocks[0];
  if (block === undefined || typeof block.text !== "string") {
    fail("MCP envelope text is missing");
  }
  try {
    return JSON.parse(block.text);
  } catch {
    return fail("MCP envelope text must be valid JSON");
  }
}

function pagedData(raw: unknown, label: string): readonly unknown[] {
  const page = record(unwrap(raw), label);
  if (!Array.isArray(page.data)) {
    fail(`${label}.data must be an array`);
  }
  if (page.hasMore !== false) {
    fail(`${label}.hasMore must be false after pagination`);
  }
  return page.data;
}

function agent(value: unknown): WorkerAgent {
  if (value === "claude" || value === "codex" || value === "cursor") {
    return value;
  }
  return fail(`unknown agent: ${String(value)}`);
}

function effort(value: unknown): Effort {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return fail(`unsupported effort: ${String(value)}`);
}

function efforts(value: unknown, label: string): readonly Effort[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} must be a non-empty array`);
  }
  return value.map(effort);
}

function catalogModel(
  value: unknown,
  inheritedAgent?: WorkerAgent
): CatalogEntry {
  const item = record(value, "model catalog entry");
  const itemAgent = inheritedAgent ?? agent(item.agent);
  const model = text(item.model ?? item.id, "model catalog model");
  const supportedEfforts = efforts(
    item.efforts ?? item.effortLevels,
    `${itemAgent}:${model} efforts`
  );
  const supportsFastMode = item.supportsFastMode ?? item.fastModeSupported;
  if (typeof supportsFastMode !== "boolean") {
    fail(`${itemAgent}:${model} supportsFastMode must be boolean`);
  }
  return {
    agent: itemAgent,
    model,
    efforts: supportedEfforts,
    supportsFastMode,
  };
}

export function parseCurrentContext(
  identityRaw: unknown,
  sessionStatusRaw: unknown,
  expectedSessionId: string
): CurrentContext {
  const identity = record(unwrap(identityRaw), "whoami");
  const workspaceId = text(identity.workspaceId, "whoami.workspaceId");
  const status = parseSessionStatus(sessionStatusRaw);
  if (status.sessionId !== expectedSessionId) {
    throw new BoundaryError("Conductor coordinator session mismatch");
  }
  if (status.workspaceId !== workspaceId) {
    throw new BoundaryError("Conductor coordinator workspace mismatch");
  }
  return { sessionId: status.sessionId, workspaceId };
}

export function parseModelCatalog(raw: unknown): readonly CatalogEntry[] {
  const value = unwrap(raw);
  if (Array.isArray(value)) {
    return value.map((item) => catalogModel(item));
  }
  const root = record(value, "model catalog");
  if (Array.isArray(root.agents)) {
    const entries: CatalogEntry[] = [];
    for (const rawAgent of root.agents) {
      const group = record(rawAgent, "model catalog agent");
      const groupAgent = agent(group.agent);
      if (!Array.isArray(group.models)) {
        fail(`${groupAgent} models must be an array`);
      }
      entries.push(
        ...group.models.map((item) => catalogModel(item, groupAgent))
      );
    }
    return entries;
  }
  if (Array.isArray(root.data)) {
    return root.data.map((item) => catalogModel(item));
  }
  return fail("model catalog agents must be an array");
}

export function parseCreatedWorkspace(raw: unknown): WorkerIds {
  const created = record(unwrap(raw), "created workspace");
  return {
    workspaceId: text(created.workspaceId, "created workspace.workspaceId"),
    sessionId: text(created.sessionId, "created workspace.sessionId"),
  };
}

export function parseObservedSession(raw: unknown): ObservedSession {
  const session = record(unwrap(raw), "session");
  if (session.fastMode !== false) {
    fail("session.fastMode must be false");
  }
  return {
    model: text(session.model, "session.model"),
    resolvedModel: text(session.resolvedModel, "session.resolvedModel"),
    effort: text(session.effort, "session.effort"),
    fastMode: false,
  };
}

export function parseSessionStatus(raw: unknown): SessionStatus {
  const value = record(unwrap(raw), "session status");
  if (value.status !== "idle" && value.status !== "working" && value.status !== "error") {
    fail("session status.status is unsupported");
  }
  const errorValue = value.lastError ?? value.errorMessage ?? null;
  if (errorValue !== null && typeof errorValue !== "string") {
    fail("session status error must be a string");
  }
  return {
    workspaceId: text(value.workspaceId, "session status.workspaceId"),
    sessionId: text(value.sessionId, "session status.sessionId"),
    status: value.status,
    error: errorValue,
  };
}

function messageRole(value: string): TranscriptMessage["role"] {
  if (value === "assistant" || value === "assistant_message") {
    return "assistant";
  }
  if (value === "user" || value === "user_message") {
    return "user";
  }
  return "other";
}

function contentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.text === "string") {
    return value.text;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const block of value) {
      if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
        fail("message content contains a non-text block");
      }
      parts.push(block.text);
    }
    return parts.join("\n");
  }
  return fail("message content must be text");
}

export function parseTranscript(
  raw: unknown,
  afterCursor: string | null = null
): Transcript {
  const values = pagedData(raw, "messages");
  const messages = values.map((value, index): TranscriptMessage => {
    const item = record(value, `message ${index}`);
    const type = text(item.type, `message ${index}.type`);
    return {
      id: text(item.id, `message ${index}.id`),
      sessionId: text(item.sessionId, `message ${index}.sessionId`),
      index: integer(item.sessionIndex, `message ${index}.sessionIndex`),
      role: messageRole(type),
      text: contentText(item.content),
    };
  });
  return {
    messages,
    lastMessageId: messages.at(-1)?.id ?? afterCursor,
    afterCursor,
  };
}

export function parseWorkspaceList(raw: unknown): readonly WorkspaceListing[] {
  return pagedData(raw, "workspaces").map((value, index) => {
    const workspace = record(value, `workspace ${index}`);
    return {
      workspaceId: text(workspace.id, `workspace ${index}.id`),
      workspaceName: text(workspace.name, `workspace ${index}.name`),
    };
  });
}

export function parseWorkspaceSessions(
  workspaceId: string,
  raw: unknown,
  target: ModelTarget
): { readonly ids: WorkerIds; readonly observation: ObservedSession } {
  const sessions = pagedData(raw, "workspace sessions");
  if (sessions.length !== 1) {
    fail("reconciled workspace must contain exactly one session");
  }
  const session = record(sessions[0], "workspace session");
  const sessionId = text(session.id, "workspace session.id");
  const observation = parseObservedSession(session);
  if (
    observation.model !== target.model ||
    observation.resolvedModel !== target.resolvedModel ||
    observation.effort !== target.effort
  ) {
    throw new BoundaryError("Conductor reconciled session receipt mismatch");
  }
  return { ids: { workspaceId, sessionId }, observation };
}

export function validateReceipt(
  target: ModelTarget,
  request: WorkerRequest,
  postCreate: ObservedSession,
  postRun: ObservedSession
): ObservedSession {
  const matches = (value: ObservedSession): boolean =>
    value.model === request.model &&
    value.model === target.model &&
    value.resolvedModel === target.resolvedModel &&
    value.effort === request.effort &&
    value.effort === target.effort &&
    value.fastMode === false;
  if (!matches(postCreate) || !matches(postRun)) {
    throw new BoundaryError("Conductor receipt mismatch");
  }
  return postRun;
}

function messagesAfter(
  transcript: Transcript,
  cursor: string | null
): readonly TranscriptMessage[] {
  if (cursor === null) {
    return transcript.messages;
  }
  if (transcript.afterCursor === cursor) {
    return transcript.messages;
  }
  const index = transcript.messages.findIndex((message) => message.id === cursor);
  return index < 0 ? [] : transcript.messages.slice(index + 1);
}

export function completionObservation(
  status: SessionStatus,
  transcript: Transcript,
  cursor: string | null,
  attemptId: string
): CompletionObservation {
  if (status.status === "error") {
    return { kind: "dropout", error: status.error ?? "Conductor session error" };
  }
  if (status.status === "working") {
    return { kind: "working" };
  }
  const candidates = messagesAfter(transcript, cursor).filter(
    (message) => message.role === "assistant" && message.text.includes("<PSTACK_RESULT")
  );
  if (candidates.length === 0) {
    return { kind: "waiting" };
  }
  const result = parseWorkerResult(candidates, attemptId);
  const message = candidates[0];
  if (message === undefined) {
    return { kind: "waiting" };
  }
  return { kind: "complete", message, result };
}
