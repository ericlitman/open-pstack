import { readFile } from "node:fs/promises";

import type {
  CatalogEntry,
  ConductorPolicy,
  Effort,
  LaneName,
  ModelTarget,
  RoleRoute,
  RunBudget,
  WorkerAgent,
} from "./types.ts";

const LANE_NAMES: readonly LaneName[] = [
  "judgment",
  "hard-review",
  "implementation",
  "exploration",
];

const ROLE_NAMES: readonly string[] = [
  "feature",
  "refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment",
  "prose",
  "hardest-tasks",
  "how-explorer",
  "how-explainer",
  "how-critics",
  "why",
  "reflect",
  "arena-runners",
  "arena-cross-judge-pool",
  "swarm-workers",
  "architect-runners",
  "interrogate-reviewers",
];

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh"];

export class PolicyError extends Error {
  override readonly name = "PolicyError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PolicyError(`${label} must be an object`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const expectedKeys = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new PolicyError(`unknown ${label} key: ${key}`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new PolicyError(`missing ${label} key: ${key}`);
    }
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PolicyError(`${label} must be a non-empty string`);
  }
  return value;
}

function parseAgent(value: unknown): WorkerAgent {
  if (value === "claude" || value === "codex" || value === "cursor") {
    return value;
  }
  throw new PolicyError(`unsupported worker agent: ${String(value)}`);
}

function parseEffort(value: unknown): Effort {
  if (typeof value !== "string") {
    throw new PolicyError(`unsupported effort: ${String(value)}`);
  }
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  throw new PolicyError(`unsupported effort: ${value}`);
}

function parseLaneName(value: unknown, label: string): LaneName {
  if (typeof value !== "string") {
    throw new PolicyError(`${label} must name a policy lane`);
  }
  if (
    value === "judgment" ||
    value === "hard-review" ||
    value === "implementation" ||
    value === "exploration"
  ) {
    return value;
  }
  throw new PolicyError(`${label} names unknown lane ${value}`);
}

function parseTarget(value: unknown, lane: LaneName): ModelTarget {
  const target = record(value, `policy lane ${lane}`);
  exactKeys(
    target,
    ["agent", "model", "resolvedModel", "effort", "fastMode"],
    `policy lane ${lane}`
  );
  if (target.fastMode !== false) {
    throw new PolicyError("fastMode must be false");
  }
  return {
    agent: parseAgent(target.agent),
    model: nonEmptyString(target.model, `${lane}.model`),
    resolvedModel: nonEmptyString(
      target.resolvedModel,
      `${lane}.resolvedModel`
    ),
    effort: parseEffort(target.effort),
    fastMode: false,
  };
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1) {
    throw new PolicyError(`${label} must be a positive integer`);
  }
  return value;
}

function parseBudget(value: unknown): RunBudget {
  const budget = record(value, "policy budget");
  exactKeys(
    budget,
    [
      "maxWorkspaces",
      "maxConcurrentWorkspaces",
      "maxAttempts",
      "maxFollowUpsPerAttempt",
    ],
    "policy budget"
  );
  const result: RunBudget = {
    maxWorkspaces: positiveInteger(budget.maxWorkspaces, "maxWorkspaces"),
    maxConcurrentWorkspaces: positiveInteger(
      budget.maxConcurrentWorkspaces,
      "maxConcurrentWorkspaces"
    ),
    maxAttempts: positiveInteger(budget.maxAttempts, "maxAttempts"),
    maxFollowUpsPerAttempt: positiveInteger(
      budget.maxFollowUpsPerAttempt,
      "maxFollowUpsPerAttempt"
    ),
  };
  if (result.maxConcurrentWorkspaces > result.maxWorkspaces) {
    throw new PolicyError(
      "maxConcurrentWorkspaces cannot exceed maxWorkspaces"
    );
  }
  return result;
}

function parseRole(value: unknown, role: string): RoleRoute {
  if (value === "coordinator") {
    return value;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new PolicyError(
      `policy role ${role} must be coordinator or a non-empty lane list`
    );
  }
  const lanes: LaneName[] = [];
  for (const item of value) {
    const lane = parseLaneName(item, `policy role ${role}`);
    if (lanes.includes(lane)) {
      throw new PolicyError(`policy role ${role} repeats lane ${lane}`);
    }
    lanes.push(lane);
  }
  return lanes;
}

export function parsePolicy(value: unknown): ConductorPolicy {
  const policy = record(value, "policy");
  exactKeys(policy, ["schemaVersion", "mode", "lanes", "roles", "budget"], "policy");
  if (policy.schemaVersion !== 1) {
    throw new PolicyError("policy schemaVersion must be 1");
  }
  if (policy.mode !== "conductor") {
    throw new PolicyError("policy mode must be conductor");
  }

  const laneValues = record(policy.lanes, "policy lanes");
  exactKeys(laneValues, LANE_NAMES, "policy lane");
  const lanes: Record<LaneName, ModelTarget> = {
    judgment: parseTarget(laneValues.judgment, "judgment"),
    "hard-review": parseTarget(laneValues["hard-review"], "hard-review"),
    implementation: parseTarget(laneValues.implementation, "implementation"),
    exploration: parseTarget(laneValues.exploration, "exploration"),
  };

  const seenTargets = new Set<string>();
  for (const target of Object.values(lanes)) {
    const key = `${target.agent}:${target.model}`;
    if (seenTargets.has(key)) {
      throw new PolicyError(`duplicate policy target: ${key}`);
    }
    seenTargets.add(key);
  }

  const roleValues = record(policy.roles, "policy roles");
  const knownRoles = new Set<string>(ROLE_NAMES);
  for (const role of Object.keys(roleValues)) {
    if (!knownRoles.has(role)) {
      throw new PolicyError(`unknown policy role: ${role}`);
    }
  }
  const roles: Record<string, RoleRoute> = {};
  for (const role of ROLE_NAMES) {
    if (!(role in roleValues)) {
      throw new PolicyError(`missing policy role: ${role}`);
    }
    roles[role] = parseRole(roleValues[role], role);
  }

  return {
    schemaVersion: 1,
    mode: "conductor",
    lanes,
    roles,
    budget: parseBudget(policy.budget),
  };
}

export async function readPolicy(path: string): Promise<ConductorPolicy> {
  const source = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PolicyError(`invalid Conductor policy JSON: ${message}`);
  }
  return parsePolicy(value);
}

export function resolveRole(
  policy: ConductorPolicy,
  role: string
): RoleRoute {
  const route = policy.roles[role];
  if (route === undefined) {
    throw new PolicyError(`unknown Conductor role: ${role}`);
  }
  return route;
}

export function validateCatalog(
  policy: ConductorPolicy,
  entries: readonly CatalogEntry[]
): void {
  for (const target of Object.values(policy.lanes)) {
    const entry = entries.find(
      (candidate) =>
        candidate.agent === target.agent && candidate.model === target.model
    );
    if (entry === undefined || !entry.efforts.includes(target.effort)) {
      throw new PolicyError(
        `unavailable Conductor target: ${target.agent}:${target.model}@${target.effort}`
      );
    }
  }
}
