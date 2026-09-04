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
