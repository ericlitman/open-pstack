export const PARENTS = {
  claude: {
    harness: "Claude Code",
    native: "Agent",
    externalSelf: false,
    identity: [
      "CLAUDECODE",
      "CLAUDE_CODE_CHILD_SESSION",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    ],
  },
  codex: {
    harness: "Codex",
    native: "spawn_agent",
    externalSelf: false,
    identity: [
      "CODEX_THREAD_ID",
      "CODEX_SESSION_ID",
      "CODEX_CI",
      "CODEX_SHELL",
      "CODEX_SANDBOX",
      "CODEX_SANDBOX_NETWORK_DISABLED",
      "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    ],
  },
  grok: {
    harness: "Grok",
    native: "spawn_subagent",
    externalSelf: true,
    identity: ["GROK_SESSION_ID", "GROK_AGENT"],
  },
} as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra", "default"] as const;
export const ACCESS_MODES = ["read-only", "isolated-write"] as const;
export const WRITER_SANDBOXES = ["bounded", "full-access"] as const;
export const ACCESS_KINDS = [...ACCESS_MODES, "isolated-write-full-access"] as const;

export type Parent = keyof typeof PARENTS;
export type Effort = (typeof EFFORTS)[number];
export type AccessMode = (typeof ACCESS_MODES)[number];
export type WriterSandbox = (typeof WRITER_SANDBOXES)[number];
export type AccessKind = (typeof ACCESS_KINDS)[number];

export type ReceiptStatus =
  | "complete"
  | "cancelled"
  | "unavailable-cli"
  | "unauthenticated"
  | "unavailable-model"
  | "timed-out"
  | "child-failed"
  | "malformed-output";

export interface NormalizedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface RunnerReceipt {
  readonly schemaVersion: 1;
  readonly status: ReceiptStatus;
  readonly parent: Parent;
  readonly provider: string;
  readonly model: string;
  readonly effort: Effort;
  readonly mode: AccessMode;
  /** Null for a read-only lane. */
  readonly writerSandbox: WriterSandbox | null;
  readonly cwd: string;
  readonly promptPath: string;
  readonly outputPath: string;
  readonly stdoutPath: string | null;
  readonly stderrPath: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly executable: string | null;
  readonly preflight: {
    readonly argv: readonly string[];
    readonly status: "passed" | "failed" | "timed-out" | "cancelled" | "not-run";
    readonly evidence: string;
  };
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reportedModel: string | null;
  readonly modelVerified: boolean;
  readonly modelEvidence: "provider-report" | "pinned-argv" | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
  readonly error: {
    readonly message: string;
    readonly evidence: string;
  } | null;
}

export class UsageError extends Error {}

export const ERROR_EVIDENCE_LIMIT = 4_000;

export function evidence(value: string): string {
  return value.trim().slice(0, ERROR_EVIDENCE_LIMIT);
}

export function modelFailureStatus(value: string): "unavailable-model" | "child-failed" {
  return /model.{0,40}(not found|unknown|unavailable|unsupported|not supported|invalid)|invalid.{0,20}model/i.test(value)
      || /^Error: Unknown model: /m.test(value) // Devin CLI 3000.10.21
      || /^Cannot use this model: /m.test(value) // Cursor CLI 2026.10.14-0f9edde
      || /^dsh: INVALID_REQUEST: The supported API model names are .+, but you passed /m.test(value) // dsh 0.2.0-rc.2
      || /model `[^`]+` does not exist or you lack access/.test(value) // Muse Code 1.4.14
    ? "unavailable-model"
    : "child-failed";
}
