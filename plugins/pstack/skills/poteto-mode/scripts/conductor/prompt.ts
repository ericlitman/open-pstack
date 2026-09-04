import type {
  ModelTarget,
  TranscriptMessage,
  WorkerBrief,
  WorkerRequest,
  WorkerResult,
} from "./types.ts";

export class WorkerResultError extends Error {
  override readonly name = "WorkerResultError";
}

interface RenderWorkerPromptInput {
  readonly runId: string;
  readonly coordinatorSessionId: string;
  readonly request: WorkerRequest;
  readonly target: ModelTarget;
  readonly brief: WorkerBrief;
}

export function renderWorkerPrompt(input: RenderWorkerPromptInput): string {
  const { brief, coordinatorSessionId, request, runId, target } = input;
  return [
    "# Poteto worker assignment",
    "",
    `Run ID: ${runId}`,
    `Coordinator session: ${coordinatorSessionId}`,
    `Attempt ID: ${request.attemptId}`,
    `Role: ${request.role}`,
    `Purpose: ${request.purpose}`,
    `Repository: ${brief.repository}`,
    `Base branch: ${request.baseBranch}`,
    `Workspace name: ${request.workspaceName}`,
    `Requested runtime: agent=${target.agent}, model=${target.model}, resolvedModel=${target.resolvedModel}, effort=${target.effort}, fastMode=false`,
    "",
    "## Task",
    "",
    brief.task,
    "",
    "Allowed files:",
    ...brief.allowedFiles.map((path) => `- ${path}`),
    "",
    "Questions to answer:",
    ...(brief.questions.length === 0
      ? ["- None."]
      : brief.questions.map((question) => `- ${question}`)),
    "",
    "Required evidence:",
    ...brief.requiredEvidence.map((item) => `- ${item}`),
    "",
    "Do not invoke Poteto Mode. Do not create or dispatch workers.",
    "Work only inside this isolated workspace and return the result to the coordinator.",
    "End with exactly one assistant result block in this form:",
    "",
    `<PSTACK_RESULT attempt="${request.attemptId}">`,
    `{"attemptId":"${request.attemptId}","status":"complete","summary":"...","evidence":["..."],"changedFiles":["..."]}`,
    "</PSTACK_RESULT>",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new WorkerResultError(`${label} must be a string array`);
  }
  return value;
}

function parseResultObject(value: unknown): WorkerResult {
  if (!isRecord(value)) {
    throw new WorkerResultError("worker result must be an object");
  }
  const expected = new Set([
    "attemptId",
    "status",
    "summary",
    "evidence",
    "changedFiles",
  ]);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new WorkerResultError(`worker result has unknown key ${key}`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new WorkerResultError(`worker result is missing ${key}`);
    }
  }
  if (typeof value.attemptId !== "string" || value.attemptId.length === 0) {
    throw new WorkerResultError("worker result attemptId is invalid");
  }
  if (value.status !== "complete" && value.status !== "dropout") {
    throw new WorkerResultError("worker result status is invalid");
  }
  if (typeof value.summary !== "string" || value.summary.length === 0) {
    throw new WorkerResultError("worker result summary is invalid");
  }
  return {
    attemptId: value.attemptId,
    status: value.status,
    summary: value.summary,
    evidence: stringArray(value.evidence, "worker result evidence"),
    changedFiles: stringArray(
      value.changedFiles,
      "worker result changedFiles"
    ),
  };
}

export function parseWorkerResult(
  messages: readonly TranscriptMessage[],
  expectedAttemptId: string
): WorkerResult {
  const matches: { readonly attemptId: string; readonly body: string }[] = [];
  const pattern = /<PSTACK_RESULT\s+attempt="([^"]+)">\s*([\s\S]*?)\s*<\/PSTACK_RESULT>/g;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const match of message.text.matchAll(pattern)) {
      const attemptId = match[1];
      const body = match[2];
      if (attemptId !== undefined && body !== undefined) {
        matches.push({ attemptId, body });
      }
    }
  }
  if (matches.length !== 1) {
    throw new WorkerResultError("expected a single result block");
  }
  const match = matches[0];
  if (match === undefined || match.attemptId !== expectedAttemptId) {
    throw new WorkerResultError("worker result attempt mismatch");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(match.body);
  } catch {
    throw new WorkerResultError("worker result must contain valid JSON");
  }
  const result = parseResultObject(decoded);
  if (result.attemptId !== expectedAttemptId) {
    throw new WorkerResultError("worker result attempt mismatch");
  }
  return result;
}
