import { describe, expect, test } from "bun:test";

import {
  PolicyError,
  parsePolicy,
  resolveRole,
  validateCatalog,
} from "./policy.ts";
import type { CatalogEntry } from "./types.ts";

function validPolicy(): unknown {
  return {
    schemaVersion: 1,
    mode: "conductor",
    lanes: {
      judgment: {
        agent: "claude",
        model: "fable-5-1",
        resolvedModel: "fable-5-1",
        effort: "high",
        fastMode: false,
      },
      "hard-review": {
        agent: "claude",
        model: "opus-5-1m",
        resolvedModel: "opus-5-1m",
        effort: "high",
        fastMode: false,
      },
      implementation: {
        agent: "codex",
        model: "gpt-5.6-sol",
        resolvedModel: "gpt-5.6-sol",
        effort: "xhigh",
        fastMode: false,
      },
      exploration: {
        agent: "cursor",
        model: "grok-4.6",
        resolvedModel: "grok-4.6",
        effort: "xhigh",
        fastMode: false,
      },
    },
    roles: {
      feature: ["exploration"],
      refactoring: ["exploration"],
      "bug-fix": ["implementation"],
      "perf-issue": ["implementation"],
      hillclimb: ["implementation"],
      judgment: ["judgment"],
      prose: ["judgment"],
      "hardest-tasks": ["judgment"],
      "how-explorer": ["exploration"],
      "how-explainer": ["judgment"],
      "how-critics": [
        "judgment",
        "implementation",
        "exploration",
        "hard-review",
      ],
      why: "coordinator",
      reflect: "coordinator",
      "arena-runners": [
        "judgment",
        "implementation",
        "exploration",
        "hard-review",
      ],
      "arena-cross-judge-pool": [
        "judgment",
        "implementation",
        "exploration",
        "hard-review",
      ],
      "swarm-workers": ["exploration"],
      "architect-runners": [
        "judgment",
        "implementation",
        "exploration",
        "hard-review",
      ],
      "interrogate-reviewers": [
        "judgment",
        "implementation",
        "exploration",
        "hard-review",
      ],
    },
    budget: {
      maxWorkspaces: 5,
      maxConcurrentWorkspaces: 4,
      maxAttempts: 6,
      maxFollowUpsPerAttempt: 2,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function policyRecord(): Record<string, unknown> {
  const value = structuredClone(validPolicy());
  if (!isRecord(value)) {
    throw new Error("valid policy fixture must be an object");
  }
  return value;
}

const exactCatalog: readonly CatalogEntry[] = [
  {
    agent: "claude",
    model: "fable-5-1",
    efforts: ["high"],
    supportsFastMode: true,
  },
  {
    agent: "claude",
    model: "opus-5-1m",
    efforts: ["high"],
    supportsFastMode: true,
  },
  {
    agent: "codex",
    model: "gpt-5.6-sol",
    efforts: ["xhigh"],
    supportsFastMode: true,
  },
  {
    agent: "cursor",
    model: "grok-4.6",
    efforts: ["low", "medium", "high", "xhigh"],
    supportsFastMode: true,
  },
];

describe("Conductor policy", () => {
  test("parses every documented role and exact project ceiling", () => {
    const policy = parsePolicy(validPolicy());

    expect(resolveRole(policy, "bug-fix")).toEqual(["implementation"]);
    expect(resolveRole(policy, "why")).toBe("coordinator");
    expect(policy.budget).toEqual({
      maxWorkspaces: 5,
      maxConcurrentWorkspaces: 4,
      maxAttempts: 6,
      maxFollowUpsPerAttempt: 2,
    });
  });

  test("rejects an unknown top-level key", () => {
    const value = policyRecord();
    value.fallback = "auto";

    expect(() => parsePolicy(value)).toThrow("unknown policy key: fallback");
  });

  test("rejects a missing documented role", () => {
    const value = policyRecord();
    const roles = value.roles;
    if (!isRecord(roles)) {
      throw new Error("roles fixture must be an object");
    }
    delete roles.feature;

    expect(() => parsePolicy(value)).toThrow("missing policy role: feature");
  });

  test("rejects Cursor max effort before catalog validation", () => {
    const value = policyRecord();
    const lanes = value.lanes;
    if (!isRecord(lanes)) {
      throw new Error("lanes fixture must be an object");
    }
    const exploration = lanes.exploration;
    if (!isRecord(exploration)) {
      throw new Error("exploration fixture must be an object");
    }
    exploration.effort = "max";

    expect(() => parsePolicy(value)).toThrow("unsupported effort: max");
  });

  test("rejects a concurrency ceiling above the workspace ceiling", () => {
    const value = policyRecord();
    const budget = value.budget;
    if (!isRecord(budget)) {
      throw new Error("budget fixture must be an object");
    }
    budget.maxConcurrentWorkspaces = 6;

    expect(() => parsePolicy(value)).toThrow(
      "maxConcurrentWorkspaces cannot exceed maxWorkspaces"
    );
  });

  test("rejects fast mode and duplicate role lanes", () => {
    const fast = policyRecord();
    const fastLanes = fast.lanes;
    if (!isRecord(fastLanes)) {
      throw new Error("lanes fixture must be an object");
    }
    const judgment = fastLanes.judgment;
    if (!isRecord(judgment)) {
      throw new Error("judgment fixture must be an object");
    }
    judgment.fastMode = true;
    expect(() => parsePolicy(fast)).toThrow("fastMode must be false");

    const duplicate = policyRecord();
    const duplicateRoles = duplicate.roles;
    if (!isRecord(duplicateRoles)) {
      throw new Error("roles fixture must be an object");
    }
    duplicateRoles.feature = ["exploration", "exploration"];
    expect(() => parsePolicy(duplicate)).toThrow(
      "policy role feature repeats lane exploration"
    );
  });

  test("validates every exact agent, model, and effort against the live catalog", () => {
    const policy = parsePolicy(validPolicy());

    expect(() => validateCatalog(policy, exactCatalog)).not.toThrow();
    expect(() => validateCatalog(policy, exactCatalog.slice(0, 3))).toThrow(
      "unavailable Conductor target: cursor:grok-4.6@xhigh"
    );
    const lowerEffort: readonly CatalogEntry[] = exactCatalog.map((entry) =>
      entry.agent === "cursor" ? { ...entry, efforts: ["high"] } : entry
    );
    expect(() => validateCatalog(policy, lowerEffort)).toThrow(
      "unavailable Conductor target: cursor:grok-4.6@xhigh"
    );
  });

  test("rejects an unknown role at dispatch", () => {
    const policy = parsePolicy(validPolicy());
    expect(() => resolveRole(policy, "surprise")).toThrow(PolicyError);
    expect(() => resolveRole(policy, "surprise")).toThrow(
      "unknown Conductor role: surprise"
    );
  });
});
