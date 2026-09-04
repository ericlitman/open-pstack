import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RunStateError,
  adoptUnknown,
  assertCoordinator,
  cleanupTargets,
  createRun,
  markCreating,
  markUnknown,
  openRunStore,
  planAttempt,
  planFollowUp,
  reconcileUnknown,
  recordComplete,
  recordCreated,
  recordDispatch,
  recordDropout,
  recordFollowUpSent,
  recordWorking,
} from "./store.ts";
import type {
  ModelTarget,
  ObservedSession,
  PlanAttemptInput,
  PotetoRun,
  RunBudget,
  WorkspaceListing,
} from "./types.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const target: ModelTarget = {
  agent: "cursor",
  model: "grok-4.6",
  resolvedModel: "grok-4.6",
  effort: "xhigh",
  fastMode: false,
};

const budget: RunBudget = {
  maxWorkspaces: 5,
  maxConcurrentWorkspaces: 4,
  maxAttempts: 6,
  maxFollowUpsPerAttempt: 2,
};

function runBudget(overrides: Partial<RunBudget> = {}): RunBudget {
  return { ...budget, ...overrides };
}

function freshRun(overrides: Partial<RunBudget> = {}): PotetoRun {
  return createRun({
    runId: "run-1",
    coordinator: {
      workspaceId: "coordinator-workspace",
      sessionId: "coordinator-session",
      agent: "codex",
      model: "gpt-5.6-sol",
    },
    budget: runBudget(overrides),
  });
}

function attemptInput(index: number): PlanAttemptInput {
  return {
    attemptId: `attempt-${index}`,
    role: "feature",
    purpose: "write",
    baseBranch: "origin/main",
    target,
    dispatchMessageId: `dispatch-${index}`,
  };
}

function plan(run: PotetoRun, count: number): PotetoRun {
  let next = run;
  for (let index = 1; index <= count; index += 1) {
    next = planAttempt(next, attemptInput(index));
  }
  return next;
}

function creating(run: PotetoRun, count: number): PotetoRun {
  let next = plan(run, count);
  for (let index = 1; index <= count; index += 1) {
    next = markCreating(next, `attempt-${index}`);
  }
  return next;
}

const postCreate: ObservedSession = {
  model: "grok-4.6",
  resolvedModel: "grok-4.6",
  effort: "xhigh",
  fastMode: false,
};

describe("Conductor run state", () => {
  test("binds one coordinator and rejects ownership transfer", () => {
    const run = freshRun();

    expect(run.coordinator.sessionId).toBe("coordinator-session");
    expect(() => assertCoordinator(run, "other-session")).toThrow(
      "session other-session cannot take ownership from coordinator-session"
    );
    expect(() => assertCoordinator(run, "coordinator-session")).not.toThrow();
    expect(() =>
      createRun({
        runId: "run-1",
        coordinator: {
          workspaceId: "coordinator-workspace",
          sessionId: "coordinator-session",
          agent: "claude",
          model: "fable-5-1",
        },
        budget,
        existing: run,
      })
    ).toThrow("persisted run coordinator does not match");
  });

  test("derives a unique workspace name from the run and attempt", () => {
    const run = planAttempt(freshRun(), attemptInput(1));

    expect(run.workers[0]?.request.workspaceName).toBe(
      "poteto-run-1-attempt-1"
    );
    expect(run.workers[0]?.state).toBe("planned");
  });

  test("enforces lifetime attempt and workspace budgets", () => {
    const attempts = plan(freshRun({ maxAttempts: 2 }), 2);
    expect(() => planAttempt(attempts, attemptInput(3))).toThrow(
      "attempt budget exhausted"
    );

    let workspaces = plan(freshRun({ maxWorkspaces: 2 }), 3);
    workspaces = markCreating(workspaces, "attempt-1");
    workspaces = markUnknown(workspaces, "attempt-1", "lost response");
    workspaces = markCreating(workspaces, "attempt-2");
    expect(() => markCreating(workspaces, "attempt-3")).toThrow(
      "workspace budget exhausted"
    );
  });

  test("enforces concurrent workspace budget", () => {
    let run = plan(
      freshRun({ maxWorkspaces: 3, maxConcurrentWorkspaces: 2 }),
      3
    );
    run = markCreating(run, "attempt-1");
    run = markCreating(run, "attempt-2");

    expect(() => markCreating(run, "attempt-3")).toThrow(
      "concurrency budget exhausted"
    );
  });

  test("counts an uncertain creation against the concurrent workspace budget", () => {
    let run = plan(
      freshRun({ maxWorkspaces: 3, maxConcurrentWorkspaces: 2 }),
      3
    );
    run = markUnknown(
      markCreating(run, "attempt-1"),
      "attempt-1",
      "create response was lost"
    );
    run = markCreating(run, "attempt-2");

    expect(() => markCreating(run, "attempt-3")).toThrow(
      "concurrency budget exhausted"
    );
  });

  test("requires creating before accepting workspace IDs", () => {
    const run = plan(freshRun(), 1);

    expect(() =>
      recordCreated(
        run,
        "attempt-1",
        { workspaceId: "worker-workspace", sessionId: "worker-session" },
        postCreate
      )
    ).toThrow("attempt attempt-1 must be creating");
  });

  test("keeps uncertain creation unknown until one exact name is found", () => {
    const run = markUnknown(
      markCreating(plan(freshRun(), 1), "attempt-1"),
      "attempt-1",
      "lost response"
    );
    const wrong: WorkspaceListing = {
      workspaceId: "wrong-workspace",
      workspaceName: "another-name",
    };
    const exact: WorkspaceListing = {
      workspaceId: "worker-workspace",
      workspaceName: "poteto-run-1-attempt-1",
    };

    expect(reconcileUnknown(run, "attempt-1", []).kind).toBe("unresolved");
    expect(reconcileUnknown(run, "attempt-1", [wrong]).kind).toBe(
      "unresolved"
    );
    const decision = reconcileUnknown(run, "attempt-1", [wrong, exact]);
    expect(decision.kind).toBe("adopt-workspace");
    if (decision.kind !== "adopt-workspace") {
      throw new Error("exact workspace should be adopted");
    }
    expect(
      adoptUnknown(
        run,
        "attempt-1",
        { workspaceId: decision.workspaceId, sessionId: "worker-session" },
        postCreate
      ).workers[0]?.state
    ).toBe("queued");
  });

  test("records every duplicate exact-name candidate and fails closed", () => {
    const run = markUnknown(
      markCreating(plan(freshRun(), 1), "attempt-1"),
      "attempt-1",
      "lost response"
    );
    const candidates: readonly WorkspaceListing[] = [
      {
        workspaceId: "worker-a",
        workspaceName: "poteto-run-1-attempt-1",
      },
      {
        workspaceId: "worker-b",
        workspaceName: "poteto-run-1-attempt-1",
      },
    ];

    const decision = reconcileUnknown(run, "attempt-1", candidates);
    expect(decision.kind).toBe("ambiguous");
    if (decision.kind !== "ambiguous") {
      throw new Error("duplicate workspaces should fail closed");
    }
    expect(decision.run.workers[0]).toMatchObject({
      state: "unknown",
      candidateWorkspaceIds: ["worker-a", "worker-b"],
    });
  });

  test("persists a stable follow-up ID before delivery", () => {
    let run = markCreating(plan(freshRun(), 1), "attempt-1");
    run = recordCreated(
      run,
      "attempt-1",
      { workspaceId: "worker-workspace", sessionId: "worker-session" },
      postCreate
    );
    run = planFollowUp(run, "attempt-1");
    const retry = planFollowUp(run, "attempt-1");

    expect(retry).toEqual(run);
    expect(retry.workers[0]?.followUps).toEqual([
      {
        messageId: "poteto-run-1-attempt-1-followup-1",
        state: "planned",
      },
    ]);
    const sent = recordFollowUpSent(
      retry,
      "attempt-1",
      "poteto-run-1-attempt-1-followup-1"
    );
    const second = planFollowUp(sent, "attempt-1");
    expect(second.workers[0]?.followUps).toHaveLength(2);
    const secondSent = recordFollowUpSent(
      second,
      "attempt-1",
      "poteto-run-1-attempt-1-followup-2"
    );
    expect(() => planFollowUp(secondSent, "attempt-1")).toThrow(
      "follow-up budget exhausted"
    );
  });

  test("requires a dispatch cursor and completes from queued or working", () => {
    let run = markCreating(plan(freshRun(), 1), "attempt-1");
    run = recordCreated(
      run,
      "attempt-1",
      { workspaceId: "worker-workspace", sessionId: "worker-session" },
      postCreate
    );
    expect(() =>
      recordComplete(run, "attempt-1", postCreate, "result-message")
    ).toThrow("dispatch cursor");

    run = recordDispatch(run, "attempt-1", "message-before-dispatch");
    run = recordWorking(run, "attempt-1");
    run = recordComplete(run, "attempt-1", postCreate, "result-message");

    expect(run.status).toBe("complete");
    expect(run.workers[0]).toMatchObject({
      state: "complete",
      resultMessageId: "result-message",
      observedSession: postCreate,
    });
    expect(() => markCreating(run, "attempt-1")).toThrow(
      "attempt attempt-1 must be planned"
    );
  });

  test("accepts a recorded null cursor when the pre-dispatch transcript is empty", () => {
    let run = markCreating(plan(freshRun(), 1), "attempt-1");
    run = recordCreated(
      run,
      "attempt-1",
      { workspaceId: "worker-workspace", sessionId: "worker-session" },
      postCreate
    );
    run = recordDispatch(run, "attempt-1", null);

    expect(
      recordComplete(run, "attempt-1", postCreate, "result-message").status
    ).toBe("complete");
  });

  test("makes dispatch recording idempotent only for the same cursor", () => {
    let run = markCreating(plan(freshRun(), 1), "attempt-1");
    run = recordCreated(
      run,
      "attempt-1",
      { workspaceId: "worker-workspace", sessionId: "worker-session" },
      postCreate
    );
    run = recordDispatch(run, "attempt-1", "message-1");

    expect(recordDispatch(run, "attempt-1", "message-1")).toEqual(run);
    expect(() => recordDispatch(run, "attempt-1", "message-2")).toThrow(
      "different dispatch cursor"
    );
  });

  test("records a receipt-bearing dropout without inventing worker IDs", () => {
    const run = recordDropout(
      plan(freshRun(), 1),
      "attempt-1",
      "Conductor authentication failed"
    );

    expect(run.status).toBe("complete");
    expect(run.workers[0]).toEqual({
      state: "dropout",
      request: expect.any(Object),
      dispatchMessageId: "dispatch-1",
      followUps: [],
      ids: null,
      error: "Conductor authentication failed",
    });
  });

  test("cleanup returns recorded workers and never the coordinator", () => {
    let run = markCreating(plan(freshRun(), 1), "attempt-1");
    run = recordCreated(
      run,
      "attempt-1",
      { workspaceId: "worker-workspace", sessionId: "worker-session" },
      postCreate
    );

    expect(cleanupTargets(run)).toEqual([
      {
        attemptId: "attempt-1",
        workspaceId: "worker-workspace",
        sessionId: "worker-session",
        expectedWorkspaceName: "poteto-run-1-attempt-1",
      },
    ]);
    expect(cleanupTargets(run)).not.toContainEqual(
      expect.objectContaining({ workspaceId: "coordinator-workspace" })
    );
  });

  test("writes one atomic JSON file and restores it after reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pstack-conductor-test-"));
    directories.push(directory);
    const store = openRunStore(directory);
    const run = plan(freshRun(), 1);

    await store.save(run);
    await store.close();
    const source = await readFile(join(directory, "run-1.json"), "utf8");
    const reopened = openRunStore(directory);
    expect(await reopened.load("run-1")).toEqual(run);
    await reopened.close();
    expect(JSON.parse(source)).toEqual(run);
  });

  test("rejects malformed persisted state at the storage boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pstack-conductor-test-"));
    directories.push(directory);
    await writeFile(
      join(directory, "run-1.json"),
      JSON.stringify({ schemaVersion: 1, runId: "run-1", workers: "wrong" })
    );
    const store = openRunStore(directory);

    await expect(store.load("run-1")).rejects.toThrow(
      "invalid persisted Conductor run"
    );
    await store.close();
  });

  test("blocks a live writer and accepts the store after lock release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pstack-conductor-test-"));
    directories.push(directory);
    const first = openRunStore(directory);
    const second = openRunStore(directory);
    const run = freshRun();

    await first.save(run);
    await expect(second.save(run)).rejects.toThrow("run store is locked");
    await first.close();
    await second.save(run);
    await second.close();
  });

  test("replaces a lock whose recorded process is dead", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pstack-conductor-test-"));
    directories.push(directory);
    await writeFile(join(directory, ".conductor.lock"), "999999999\n");
    const store = openRunStore(directory);

    await store.save(freshRun());
    expect(await store.load("run-1")).toEqual(freshRun());
    await store.close();
  });

  test("refuses a duplicate attempt ID and an increased resume budget", () => {
    const run = plan(freshRun(), 1);
    expect(() => planAttempt(run, attemptInput(1))).toThrow(
      "duplicate attempt ID: attempt-1"
    );
    expect(
      () =>
        createRun({
          runId: run.runId,
          coordinator: run.coordinator,
          budget: { ...run.budget, maxAttempts: 7 },
          existing: run,
        })
    ).toThrow("persisted run budget cannot increase");
  });

  test("rejects invalid source states", () => {
    expect(() => markUnknown(freshRun(), "missing", "error")).toThrow(
      RunStateError
    );
  });
});
