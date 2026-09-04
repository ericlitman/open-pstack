import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "./cli.ts";

const fixtureDirectory = join(import.meta.dir, "fixtures");
const policyPath = join(fixtureDirectory, "policy.json");
const modelsPath = join(fixtureDirectory, "models.json");
const createdPath = join(fixtureDirectory, "create-workspace.json");
const sessionPath = join(fixtureDirectory, "session.json");
const messagesPath = join(fixtureDirectory, "messages.json");
const idlePath = join(fixtureDirectory, "status-idle.json");
const workspacesPath = join(fixtureDirectory, "workspaces.json");

let directory = "";
let storeDirectory = "";
let identityPath = "";
let coordinatorStatusPath = "";
let budgetPath = "";
let briefPath = "";
let emptyMessagesPath = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pstack-conductor-cli-"));
  storeDirectory = join(directory, "store");
  identityPath = join(directory, "identity.json");
  coordinatorStatusPath = join(directory, "coordinator-status.json");
  budgetPath = join(directory, "budget.json");
  briefPath = join(directory, "brief.json");
  emptyMessagesPath = join(directory, "empty-messages.json");
  await Promise.all([
    writeFile(
      identityPath,
      JSON.stringify({
        userId: "user-fixture",
        authMethod: "access-jwt",
        workspaceId: "coordinator-workspace",
      })
    ),
    writeFile(
      coordinatorStatusPath,
      JSON.stringify({
        workspaceId: "coordinator-workspace",
        sessionId: "coordinator-session",
        status: "idle",
        updatedAt: "2026-09-04T00:00:00Z",
      })
    ),
    writeFile(
      budgetPath,
      JSON.stringify({
        maxWorkspaces: 5,
        maxConcurrentWorkspaces: 4,
        maxAttempts: 6,
        maxFollowUpsPerAttempt: 2,
      })
    ),
    writeFile(
      briefPath,
      JSON.stringify({
        repository: "https://example.invalid/repo.git",
        allowedFiles: ["src/marker.ts"],
        questions: [],
        requiredEvidence: ["marker:42"],
        task: "Create the marker file.",
      })
    ),
    writeFile(
      emptyMessagesPath,
      JSON.stringify({ data: [], offset: 0, hasMore: false })
    ),
  ]);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

interface Invocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function invoke(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {
    CONDUCTOR_SESSION_ID: "coordinator-session",
  }
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const exitCode = await main(
    ["--store", storeDirectory, "--policy", policyPath, ...args],
    environment,
    {
      stdout: (value) => {
        stdout += value;
      },
      stderr: (value) => {
        stderr += value;
      },
    }
  );
  return { exitCode, stdout, stderr };
}

function output(invocation: Invocation): Record<string, unknown> {
  expect(invocation.exitCode).toBe(0);
  expect(invocation.stderr).toBe("");
  const value: unknown = JSON.parse(invocation.stdout);
  if (!isRecord(value)) {
    throw new Error("CLI output must be an object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function startRun(): Promise<Record<string, unknown>> {
  return output(
    await invoke([
      "run",
      "start",
      "--run-id",
      "run-1",
      "--coordinator-agent",
      "codex",
      "--coordinator-model",
      "gpt-5.6-sol",
      "--identity",
      identityPath,
      "--coordinator-status",
      coordinatorStatusPath,
      "--budget",
      budgetPath,
    ])
  );
}

describe("pstack-conductor CLI", () => {
  test("validates policy against authenticated context and the exact catalog", async () => {
    const result = output(
      await invoke([
        "policy",
        "validate",
        "--identity",
        identityPath,
        "--coordinator-status",
        coordinatorStatusPath,
        "--models",
        modelsPath,
      ])
    );
    expect(result.valid).toBe(true);
    expect(result.context).toEqual({
      sessionId: "coordinator-session",
      workspaceId: "coordinator-workspace",
    });
  });

  test("rejects missing identity, worker recursion, and Cursor coordination", async () => {
    const missing = await invoke(
      [
        "run",
        "start",
        "--coordinator-agent",
        "codex",
        "--coordinator-model",
        "gpt-5.6-sol",
        "--identity",
        identityPath,
        "--coordinator-status",
        coordinatorStatusPath,
        "--budget",
        budgetPath,
      ],
      {}
    );
    expect(missing.exitCode).toBe(64);
    expect(missing.stderr).toContain("CONDUCTOR_SESSION_ID");

    const worker = await invoke(
      [
        "run",
        "start",
        "--coordinator-agent",
        "codex",
        "--coordinator-model",
        "gpt-5.6-sol",
        "--identity",
        identityPath,
        "--coordinator-status",
        coordinatorStatusPath,
        "--budget",
        budgetPath,
      ],
      { CONDUCTOR_SESSION_ID: "coordinator-session", PSTACK_WORKER: "1" }
    );
    expect(worker.exitCode).toBe(64);
    expect(worker.stderr).toContain("worker cannot coordinate");

    const cursor = await invoke([
      "run",
      "start",
      "--coordinator-agent",
      "cursor",
      "--coordinator-model",
      "grok-4.6",
      "--identity",
      identityPath,
      "--coordinator-status",
      coordinatorStatusPath,
      "--budget",
      budgetPath,
    ]);
    expect(cursor.exitCode).toBe(64);
    expect(cursor.stderr).toContain("claude or codex");
  });

  test("runs the deterministic attempt lifecycle and emits only MCP data", async () => {
    expect((await startRun()).runId).toBe("run-1");

    const planned = output(
      await invoke([
        "attempt",
        "plan",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
        "--role",
        "feature",
        "--purpose",
        "write",
        "--base-branch",
        "origin/main",
        "--brief",
        briefPath,
      ])
    );
    expect(planned.workspace).toEqual({
      name: "poteto-run-1-attempt-1",
      branch: "origin/main",
      agent: "cursor",
      model: "grok-4.6",
      effort: "xhigh",
      fastMode: false,
      env: {
        PSTACK_WORKER: "1",
        PSTACK_RUN_ID: "run-1",
        PSTACK_WORKER_ATTEMPT_ID: "attempt-1",
        PSTACK_COORDINATOR_SESSION_ID: "coordinator-session",
      },
    });
    expect(planned.initialMessage).toBeNull();
    expect(planned.prompt).toContain("Do not invoke Poteto Mode");
    expect(JSON.stringify(planned)).not.toMatch(
      /scripts\/runner\/pstack-runner|bearer|spawn_agent|native Agent/
    );

    expect(
      output(
        await invoke([
          "attempt",
          "creating",
          "--run-id",
          "run-1",
          "--attempt-id",
          "attempt-1",
        ])
      ).state
    ).toBe("creating");

    expect(
      output(
        await invoke([
          "attempt",
          "created",
          "--run-id",
          "run-1",
          "--attempt-id",
          "attempt-1",
          "--workspace-response",
          createdPath,
          "--session-response",
          sessionPath,
        ])
      ).state
    ).toBe("queued");

    expect(
      output(
        await invoke([
          "attempt",
          "dispatched",
          "--run-id",
          "run-1",
          "--attempt-id",
          "attempt-1",
          "--messages-before",
          emptyMessagesPath,
        ])
      ).state
    ).toBe("queued");

    const followUp = output(
      await invoke([
        "attempt",
        "follow-up-plan",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
      ])
    );
    expect(followUp.messageId).toBe("poteto-run-1-attempt-1-followup-1");
    output(
      await invoke([
        "attempt",
        "follow-up-sent",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
        "--message-id",
        "poteto-run-1-attempt-1-followup-1",
      ])
    );

    const completed = output(
      await invoke([
        "attempt",
        "observe",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
        "--session-response",
        sessionPath,
        "--status-response",
        idlePath,
        "--messages-response",
        messagesPath,
      ])
    );
    expect(completed.outcome).toBe("complete");

    const cleanup = output(
      await invoke([
        "cleanup",
        "targets",
        "--run-id",
        "run-1",
        "--workspaces-response",
        workspacesPath,
      ])
    );
    expect(cleanup.targets).toEqual([
      {
        attemptId: "attempt-1",
        workspaceId: "worker-workspace",
        sessionId: "worker-session",
        expectedWorkspaceName: "poteto-run-1-attempt-1",
      },
    ]);
  });

  test("resumes only the run owned by the same coordinator", async () => {
    await startRun();
    const resumed = output(
      await invoke([
        "run",
        "start",
        "--coordinator-agent",
        "codex",
        "--coordinator-model",
        "gpt-5.6-sol",
        "--identity",
        identityPath,
        "--coordinator-status",
        coordinatorStatusPath,
        "--budget",
        budgetPath,
      ])
    );
    expect(resumed.runId).toBe("run-1");

    const otherStatus = join(directory, "other-status.json");
    await writeFile(
      otherStatus,
      JSON.stringify({
        workspaceId: "coordinator-workspace",
        sessionId: "other-session",
        status: "idle",
        updatedAt: "2026-09-04T00:00:00Z",
      })
    );
    const refused = await invoke(
      [
        "run",
        "start",
        "--run-id",
        "run-1",
        "--coordinator-agent",
        "codex",
        "--coordinator-model",
        "gpt-5.6-sol",
        "--identity",
        identityPath,
        "--coordinator-status",
        otherStatus,
        "--budget",
        budgetPath,
      ],
      { CONDUCTOR_SESSION_ID: "other-session" }
    );
    expect(refused.exitCode).toBe(64);
    expect(refused.stderr).toContain("cannot take ownership");
  });

  test("reconciles an uncertain create through the exact workspace and its session", async () => {
    await startRun();
    output(
      await invoke([
        "attempt",
        "plan",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
        "--role",
        "feature",
        "--purpose",
        "write",
        "--base-branch",
        "origin/main",
        "--brief",
        briefPath,
      ])
    );
    output(
      await invoke([
        "attempt",
        "creating",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
      ])
    );
    output(
      await invoke([
        "attempt",
        "unknown",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
        "--error",
        "create response was lost",
      ])
    );

    const reconciled = output(
      await invoke([
        "attempt",
        "reconcile",
        "--run-id",
        "run-1",
        "--attempt-id",
        "attempt-1",
        "--workspaces-response",
        workspacesPath,
        "--workspace-sessions-response",
        join(fixtureDirectory, "workspace-sessions.json"),
      ])
    );
    expect(reconciled.kind).toBe("adopted");
    expect(reconciled.worker).toMatchObject({
      state: "queued",
      ids: {
        workspaceId: "worker-workspace",
        sessionId: "worker-session",
      },
    });
  });
});
