import { describe, expect, test } from "bun:test";

import {
  completionObservation,
  parseCreatedWorkspace,
  parseCurrentContext,
  parseModelCatalog,
  parseObservedSession,
  parseSessionStatus,
  parseTranscript,
  parseWorkspaceList,
  parseWorkspaceSessions,
  validateReceipt,
} from "./boundary.ts";
import type { ModelTarget, WorkerRequest } from "./types.ts";

const target: ModelTarget = {
  agent: "cursor",
  model: "grok-4.6",
  resolvedModel: "grok-4.6",
  effort: "xhigh",
  fastMode: false,
};

const request: WorkerRequest = {
  attemptId: "attempt-1",
  role: "feature",
  purpose: "write",
  baseBranch: "origin/main",
  workspaceName: "poteto-run-1-attempt-1",
  agent: "cursor",
  model: "grok-4.6",
  effort: "xhigh",
  fastMode: false,
};

const observed = {
  model: "grok-4.6",
  resolvedModel: "grok-4.6",
  effort: "xhigh",
  fastMode: false,
};

const idle = {
  workspaceId: "worker-workspace",
  sessionId: "worker-session",
  status: "idle",
  updatedAt: "2026-09-04T00:00:00Z",
};

function transcript(
  data: readonly Record<string, unknown>[],
  hasMore = false
): unknown {
  return { data, offset: 0, hasMore };
}

function message(
  id: string,
  type: "user" | "assistant",
  content: unknown
): Record<string, unknown> {
  return {
    id,
    sessionId: "worker-session",
    sessionIndex: Number(id.replace("message-", "")),
    type,
    content,
    receivedAt: "2026-09-04T00:00:00Z",
  };
}

describe("Conductor response boundary", () => {
  test("binds the environment session through authenticated workspace status", () => {
    expect(
      parseCurrentContext(
        {
          userId: "user-fixture",
          authMethod: "access-jwt",
          workspaceId: "workspace-fixture",
        },
        {
          workspaceId: "workspace-fixture",
          sessionId: "session-fixture",
          status: "idle",
          updatedAt: "2026-09-04T00:00:00Z",
        },
        "session-fixture"
      )
    ).toEqual({
      sessionId: "session-fixture",
      workspaceId: "workspace-fixture",
    });
  });

  test("rejects missing and mismatched current identity fields", () => {
    expect(() => parseCurrentContext({}, idle, "worker-session")).toThrow(
      "workspaceId"
    );
    expect(() =>
      parseCurrentContext(
        { workspaceId: "other-workspace" },
        idle,
        "worker-session"
      )
    ).toThrow("workspace mismatch");
    expect(() =>
      parseCurrentContext(
        { workspaceId: "worker-workspace" },
        idle,
        "other-session"
      )
    ).toThrow("session mismatch");
  });

  test("parses an MCP text envelope and a created workspace", () => {
    const raw = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            workspaceId: "worker-workspace",
            sessionId: "worker-session",
            deepLink: "https://example.invalid/workspace",
          }),
        },
      ],
    };
    expect(parseCreatedWorkspace(raw)).toEqual({
      workspaceId: "worker-workspace",
      sessionId: "worker-session",
    });
    expect(() => parseCreatedWorkspace({ workspaceId: "only-one" })).toThrow(
      "sessionId"
    );
  });

  test("normalizes the nested model catalog without changing identifiers", () => {
    const catalog = parseModelCatalog({
      agents: [
        {
          agent: "cursor",
          models: [
            {
              id: "grok-4.6",
              efforts: ["high", "xhigh"],
              supportsFastMode: false,
            },
          ],
        },
      ],
    });
    expect(catalog).toEqual([
      {
        agent: "cursor",
        model: "grok-4.6",
        efforts: ["high", "xhigh"],
        supportsFastMode: false,
      },
    ]);
    expect(() => parseModelCatalog({ agents: {} })).toThrow("array");
    expect(() =>
      parseModelCatalog({
        agents: [
          {
            agent: "unknown",
            models: [
              { id: "model", efforts: ["high"], supportsFastMode: false },
            ],
          },
        ],
      })
    ).toThrow("unknown agent");
  });

  test("requires every exact session receipt field and fast mode off", () => {
    expect(parseObservedSession({ id: "session", ...observed })).toEqual(
      observed
    );
    const { resolvedModel: _removed, ...withoutResolvedModel } = observed;
    expect(() => parseObservedSession(withoutResolvedModel)).toThrow(
      "resolvedModel"
    );
    expect(() =>
      parseObservedSession({ ...observed, fastMode: true })
    ).toThrow("fastMode");
    expect(() =>
      validateReceipt(target, request, observed, {
        ...observed,
        resolvedModel: "grok-4.5",
      })
    ).toThrow("receipt mismatch");
    expect(validateReceipt(target, request, observed, observed)).toEqual(
      observed
    );
  });

  test("parses status errors and requires exact status IDs", () => {
    expect(parseSessionStatus(idle)).toEqual({
      workspaceId: "worker-workspace",
      sessionId: "worker-session",
      status: "idle",
      error: null,
    });
    expect(
      parseSessionStatus({
        ...idle,
        status: "error",
        lastError: "worker failed",
      })
    ).toEqual({
      workspaceId: "worker-workspace",
      sessionId: "worker-session",
      status: "error",
      error: "worker failed",
    });
    expect(() => parseSessionStatus({ ...idle, status: "paused" })).toThrow(
      "status"
    );
  });

  test("parses complete transcripts and rejects partial pages", () => {
    expect(
      parseTranscript(
        transcript([
          message("message-1", "user", { text: "task" }),
          message("message-2", "assistant", [
            { type: "text", text: "result" },
          ]),
        ])
      )
    ).toEqual({
      messages: [
        {
          id: "message-1",
          sessionId: "worker-session",
          index: 1,
          role: "user",
          text: "task",
        },
        {
          id: "message-2",
          sessionId: "worker-session",
          index: 2,
          role: "assistant",
          text: "result",
        },
      ],
      lastMessageId: "message-2",
      afterCursor: null,
    });
    expect(() => parseTranscript(transcript([], true))).toThrow("hasMore");
  });

  test("returns every workspace and resolves a single initial session", () => {
    expect(
      parseWorkspaceList({
        data: [
          {
            id: "workspace-a",
            name: "poteto-run-1-attempt-1",
            state: "ready",
            repoUrl: "https://example.invalid/repo.git",
            createdAt: "2026-09-04T00:00:00Z",
            deepLink: "https://example.invalid/workspace-a",
          },
          {
            id: "workspace-b",
            name: "poteto-run-1-attempt-1",
            state: "ready",
            repoUrl: "https://example.invalid/repo.git",
            createdAt: "2026-09-04T00:00:00Z",
            deepLink: "https://example.invalid/workspace-b",
          },
        ],
        offset: 0,
        hasMore: false,
      })
    ).toEqual([
      {
        workspaceId: "workspace-a",
        workspaceName: "poteto-run-1-attempt-1",
      },
      {
        workspaceId: "workspace-b",
        workspaceName: "poteto-run-1-attempt-1",
      },
    ]);
    expect(
      parseWorkspaceSessions(
        "workspace-a",
        { data: [{ id: "session-a", ...observed }], offset: 0, hasMore: false },
        target
      )
    ).toEqual({
      ids: { workspaceId: "workspace-a", sessionId: "session-a" },
      observation: observed,
    });
    expect(() =>
      parseWorkspaceSessions(
        "workspace-a",
        { data: [], offset: 0, hasMore: false },
        target
      )
    ).toThrow("exactly one session");
  });

  test("requires idle plus one new assistant result", () => {
    const result = `<PSTACK_RESULT attempt="attempt-1">\n${JSON.stringify({
      attemptId: "attempt-1",
      status: "complete",
      summary: "marker returned",
      evidence: ["marker:42"],
      changedFiles: [],
    })}\n</PSTACK_RESULT>`;
    const before = parseTranscript(
      transcript([message("message-1", "user", "task")])
    );
    const noResult = completionObservation(
      parseSessionStatus(idle),
      before,
      "message-1",
      "attempt-1"
    );
    expect(noResult.kind).toBe("waiting");

    const complete = completionObservation(
      parseSessionStatus(idle),
      parseTranscript(
        transcript([
          message("message-1", "user", "task"),
          message("message-2", "assistant", result),
        ])
      ),
      "message-1",
      "attempt-1"
    );
    expect(complete.kind).toBe("complete");

    const filtered = completionObservation(
      parseSessionStatus(idle),
      parseTranscript(
        transcript([message("message-2", "assistant", result)]),
        "message-1"
      ),
      "message-1",
      "attempt-1"
    );
    expect(filtered.kind).toBe("complete");

    const unscoped = completionObservation(
      parseSessionStatus(idle),
      parseTranscript(transcript([message("message-2", "assistant", result)])),
      "message-1",
      "attempt-1"
    );
    expect(unscoped.kind).toBe("waiting");

    expect(
      completionObservation(
        parseSessionStatus({ ...idle, status: "working" }),
        before,
        "message-1",
        "attempt-1"
      ).kind
    ).toBe("working");
    expect(
      completionObservation(
        parseSessionStatus({
          ...idle,
          status: "error",
          lastError: "terminal failure",
        }),
        before,
        "message-1",
        "attempt-1"
      )
    ).toEqual({ kind: "dropout", error: "terminal failure" });
  });
});
