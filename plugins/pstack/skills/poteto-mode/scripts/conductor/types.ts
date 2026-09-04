export type CoordinatorAgent = "claude" | "codex";
export type WorkerAgent = CoordinatorAgent | "cursor";
export type Effort = "low" | "medium" | "high" | "xhigh";
export type LaneName =
  | "judgment"
  | "hard-review"
  | "implementation"
  | "exploration";

export interface ModelTarget {
  readonly agent: WorkerAgent;
  readonly model: string;
  readonly resolvedModel: string;
  readonly effort: Effort;
  readonly fastMode: false;
}

export type RoleRoute = "coordinator" | readonly LaneName[];

export interface RunBudget {
  readonly maxWorkspaces: number;
  readonly maxConcurrentWorkspaces: number;
  readonly maxAttempts: number;
  readonly maxFollowUpsPerAttempt: number;
}

export interface ConductorPolicy {
  readonly schemaVersion: 1;
  readonly mode: "conductor";
  readonly lanes: Readonly<Record<LaneName, ModelTarget>>;
  readonly roles: Readonly<Record<string, RoleRoute>>;
  readonly budget: RunBudget;
}

export interface CatalogEntry {
  readonly agent: WorkerAgent;
  readonly model: string;
  readonly efforts: readonly Effort[];
  readonly supportsFastMode: boolean;
}

export type WorkerPurpose = "review" | "write";

export interface Coordinator {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly agent: CoordinatorAgent;
  readonly model: string;
}

export interface WorkerRequest {
  readonly attemptId: string;
  readonly role: string;
  readonly purpose: WorkerPurpose;
  readonly baseBranch: string;
  readonly workspaceName: string;
  readonly agent: WorkerAgent;
  readonly model: string;
  readonly effort: Effort;
  readonly fastMode: false;
}

export interface WorkerIds {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface ObservedSession {
  readonly model: string;
  readonly resolvedModel: string;
  readonly effort: string;
  readonly fastMode: boolean;
}

export interface FollowUpDelivery {
  readonly messageId: string;
  readonly state: "planned" | "sent";
}

export interface AttemptBase {
  readonly request: WorkerRequest;
  readonly dispatchMessageId: string;
  readonly followUps: readonly FollowUpDelivery[];
}

export type DispatchRecord =
  | { readonly state: "pending" }
  | {
      readonly state: "sent";
      readonly transcriptCursorBeforeDispatch: string | null;
    };

export type WorkerAttempt =
  | (AttemptBase & { readonly state: "planned" | "creating" })
  | (AttemptBase & {
      readonly state: "unknown";
      readonly candidateWorkspaceIds: readonly string[];
      readonly error: string;
    })
  | (AttemptBase & {
      readonly state: "queued";
      readonly ids: WorkerIds;
      readonly postCreateSession: ObservedSession;
      readonly dispatch: DispatchRecord;
    })
  | (AttemptBase & {
      readonly state: "working";
      readonly ids: WorkerIds;
      readonly postCreateSession: ObservedSession;
      readonly transcriptCursorBeforeDispatch: string | null;
    })
  | (AttemptBase & {
      readonly state: "complete";
      readonly ids: WorkerIds;
      readonly postCreateSession: ObservedSession;
      readonly observedSession: ObservedSession;
      readonly resultMessageId: string;
    })
  | (AttemptBase & {
      readonly state: "dropout" | "cancelled";
      readonly ids: WorkerIds | null;
      readonly error: string;
    });

export interface PotetoRun {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: "active" | "complete" | "cancelled" | "needs-cleanup";
  readonly coordinator: Coordinator;
  readonly budget: RunBudget;
  readonly workspaceCreationCount: number;
  readonly workers: readonly WorkerAttempt[];
}

export interface StartRunInput {
  readonly runId: string;
  readonly coordinator: Coordinator;
  readonly budget: RunBudget;
  readonly existing?: PotetoRun;
}

export interface PlanAttemptInput {
  readonly attemptId: string;
  readonly role: string;
  readonly purpose: WorkerPurpose;
  readonly baseBranch: string;
  readonly target: ModelTarget;
  readonly dispatchMessageId: string;
}

export interface CleanupTarget extends WorkerIds {
  readonly attemptId: string;
  readonly expectedWorkspaceName: string;
}

export type ReconcileDecision =
  | { readonly kind: "unresolved"; readonly run: PotetoRun }
  | {
      readonly kind: "adopt-workspace";
      readonly run: PotetoRun;
      readonly workspaceId: string;
    }
  | {
      readonly kind: "ambiguous";
      readonly run: PotetoRun;
      readonly candidateWorkspaceIds: readonly string[];
    };

export interface CurrentContext {
  readonly sessionId: string;
  readonly workspaceId: string;
}

export interface SessionStatus {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly status: "idle" | "working" | "error";
  readonly error: string | null;
}

export interface TranscriptMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly index: number;
  readonly role: "assistant" | "user" | "other";
  readonly text: string;
}

export interface Transcript {
  readonly messages: readonly TranscriptMessage[];
  readonly lastMessageId: string | null;
  readonly afterCursor: string | null;
}

export interface WorkspaceListing {
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface WorkerResult {
  readonly attemptId: string;
  readonly status: "complete" | "dropout";
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly changedFiles: readonly string[];
}

export interface WorkerBrief {
  readonly repository: string;
  readonly allowedFiles: readonly string[];
  readonly questions: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly task: string;
}

export type CompletionObservation =
  | { readonly kind: "waiting" }
  | { readonly kind: "working" }
  | { readonly kind: "dropout"; readonly error: string }
  | {
      readonly kind: "complete";
      readonly message: TranscriptMessage;
      readonly result: WorkerResult;
    };
