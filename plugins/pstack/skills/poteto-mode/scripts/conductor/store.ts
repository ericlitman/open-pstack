import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AttemptBase,
  CleanupTarget,
  CoordinatorAgent,
  Effort,
  FollowUpDelivery,
  ObservedSession,
  PlanAttemptInput,
  PotetoRun,
  ReconcileDecision,
  RunBudget,
  StartRunInput,
  WorkerAgent,
  WorkerAttempt,
  WorkerIds,
  WorkerRequest,
  WorkspaceListing,
} from "./types.ts";

const LOCK_FILE = ".conductor.lock";

export class RunStateError extends Error {
  override readonly name = "RunStateError";
}

function increasedBudget(next: RunBudget, current: RunBudget): boolean {
  return (
    next.maxWorkspaces > current.maxWorkspaces ||
    next.maxConcurrentWorkspaces > current.maxConcurrentWorkspaces ||
    next.maxAttempts > current.maxAttempts ||
    next.maxFollowUpsPerAttempt > current.maxFollowUpsPerAttempt
  );
}

export function createRun(input: StartRunInput): PotetoRun {
  if (input.existing !== undefined) {
    if (
      input.existing.runId !== input.runId ||
      input.existing.coordinator.sessionId !== input.coordinator.sessionId ||
      input.existing.coordinator.workspaceId !== input.coordinator.workspaceId ||
      input.existing.coordinator.agent !== input.coordinator.agent ||
      input.existing.coordinator.model !== input.coordinator.model
    ) {
      throw new RunStateError("persisted run coordinator does not match");
    }
    if (increasedBudget(input.budget, input.existing.budget)) {
      throw new RunStateError("persisted run budget cannot increase");
    }
    return input.existing;
  }
  return {
    schemaVersion: 1,
    runId: input.runId,
    status: "active",
    coordinator: input.coordinator,
    budget: input.budget,
    workspaceCreationCount: 0,
    workers: [],
  };
}

export function assertCoordinator(run: PotetoRun, sessionId: string): void {
  if (run.coordinator.sessionId !== sessionId) {
    throw new RunStateError(
      `session ${sessionId} cannot take ownership from ${run.coordinator.sessionId}`
    );
  }
}

function attemptIndex(run: PotetoRun, attemptId: string): number {
  const index = run.workers.findIndex(
    (attempt) => attempt.request.attemptId === attemptId
  );
  if (index < 0) {
    throw new RunStateError(`unknown attempt ID: ${attemptId}`);
  }
  return index;
}

function replaceAttempt(
  run: PotetoRun,
  attemptId: string,
  update: (attempt: WorkerAttempt) => WorkerAttempt
): PotetoRun {
  const index = attemptIndex(run, attemptId);
  return {
    ...run,
    workers: run.workers.map((attempt, current) =>
      current === index ? update(attempt) : attempt
    ),
  };
}

function activeWorkspaceCount(run: PotetoRun): number {
  return run.workers.filter(
    (attempt) =>
      attempt.state === "creating" ||
      attempt.state === "unknown" ||
      attempt.state === "queued" ||
      attempt.state === "working"
  ).length;
}

function completeWhenTerminal(run: PotetoRun): PotetoRun {
  if (
    run.workers.length > 0 &&
    run.workers.every(
      (attempt) =>
        attempt.state === "complete" ||
        attempt.state === "dropout" ||
        attempt.state === "cancelled"
    )
  ) {
    return { ...run, status: "complete" };
  }
  return run;
}

export function planAttempt(
  run: PotetoRun,
  input: PlanAttemptInput
): PotetoRun {
  if (run.workers.some((item) => item.request.attemptId === input.attemptId)) {
    throw new RunStateError(`duplicate attempt ID: ${input.attemptId}`);
  }
  if (run.workers.length >= run.budget.maxAttempts) {
    throw new RunStateError("attempt budget exhausted");
  }
  const request: WorkerRequest = {
    attemptId: input.attemptId,
    role: input.role,
    purpose: input.purpose,
    baseBranch: input.baseBranch,
    workspaceName: `poteto-${run.runId}-${input.attemptId}`,
    agent: input.target.agent,
    model: input.target.model,
    effort: input.target.effort,
    fastMode: false,
  };
  return {
    ...run,
    workers: [
      ...run.workers,
      {
        state: "planned",
        request,
        dispatchMessageId: input.dispatchMessageId,
        followUps: [],
      },
    ],
  };
}

export function markCreating(run: PotetoRun, attemptId: string): PotetoRun {
  if (run.workspaceCreationCount >= run.budget.maxWorkspaces) {
    throw new RunStateError("workspace budget exhausted");
  }
  if (activeWorkspaceCount(run) >= run.budget.maxConcurrentWorkspaces) {
    throw new RunStateError("concurrency budget exhausted");
  }
  const next = replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "planned") {
      throw new RunStateError(`attempt ${attemptId} must be planned`);
    }
    return { ...attempt, state: "creating" };
  });
  return { ...next, workspaceCreationCount: next.workspaceCreationCount + 1 };
}

function queuedAttempt({
  attempt,
  ids,
  postCreateSession,
}: {
  attempt: AttemptBase;
  ids: WorkerIds;
  postCreateSession: ObservedSession;
}): WorkerAttempt {
  return {
    ...attempt,
    state: "queued",
    ids,
    postCreateSession,
    dispatch: { state: "pending" },
  };
}

export function recordCreated(
  run: PotetoRun,
  attemptId: string,
  ids: WorkerIds,
  postCreateSession: ObservedSession
): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "creating") {
      throw new RunStateError(`attempt ${attemptId} must be creating`);
    }
    return queuedAttempt({ attempt, ids, postCreateSession });
  });
}

export function markUnknown(
  run: PotetoRun,
  attemptId: string,
  error: string
): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "creating") {
      throw new RunStateError(`attempt ${attemptId} must be creating`);
    }
    return {
      ...attempt,
      state: "unknown",
      candidateWorkspaceIds: [],
      error,
    };
  });
}

export function reconcileUnknown(
  run: PotetoRun,
  attemptId: string,
  candidates: readonly WorkspaceListing[]
): ReconcileDecision {
  const attempt = run.workers[attemptIndex(run, attemptId)];
  if (attempt?.state !== "unknown") {
    throw new RunStateError(`attempt ${attemptId} must be unknown`);
  }
  const matches = candidates.filter(
    (candidate) => candidate.workspaceName === attempt.request.workspaceName
  );
  if (matches.length === 0) {
    return { kind: "unresolved", run };
  }
  if (matches.length === 1) {
    const match = matches[0];
    if (match === undefined) {
      throw new RunStateError("workspace reconciliation lost its exact match");
    }
    return {
      kind: "adopt-workspace",
      run,
      workspaceId: match.workspaceId,
    };
  }
  const candidateWorkspaceIds = matches.map((match) => match.workspaceId);
  const updated = replaceAttempt(run, attemptId, (current) => {
    if (current.state !== "unknown") {
      throw new RunStateError(`attempt ${attemptId} must be unknown`);
    }
    return {
      ...current,
      candidateWorkspaceIds,
      error: "multiple workspaces share the attempt name",
    };
  });
  return {
    kind: "ambiguous",
    run: updated,
    candidateWorkspaceIds,
  };
}

export function adoptUnknown(
  run: PotetoRun,
  attemptId: string,
  ids: WorkerIds,
  postCreateSession: ObservedSession
): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "unknown") {
      throw new RunStateError(`attempt ${attemptId} must be unknown`);
    }
    return queuedAttempt({ attempt, ids, postCreateSession });
  });
}

export function recordDispatch(
  run: PotetoRun,
  attemptId: string,
  transcriptCursorBeforeDispatch: string | null
): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "queued") {
      throw new RunStateError(`attempt ${attemptId} must be queued`);
    }
    if (attempt.dispatch.state === "sent") {
      if (
        attempt.dispatch.transcriptCursorBeforeDispatch !==
        transcriptCursorBeforeDispatch
      ) {
        throw new RunStateError(
          `attempt ${attemptId} has a different dispatch cursor`
        );
      }
      return attempt;
    }
    return {
      ...attempt,
      dispatch: { state: "sent", transcriptCursorBeforeDispatch },
    };
  });
}

export function recordWorking(run: PotetoRun, attemptId: string): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "queued") {
      throw new RunStateError(`attempt ${attemptId} must be queued`);
    }
    if (attempt.dispatch.state !== "sent") {
      throw new RunStateError(`attempt ${attemptId} has no dispatch cursor`);
    }
    return {
      request: attempt.request,
      dispatchMessageId: attempt.dispatchMessageId,
      followUps: attempt.followUps,
      state: "working",
      ids: attempt.ids,
      postCreateSession: attempt.postCreateSession,
      transcriptCursorBeforeDispatch:
        attempt.dispatch.transcriptCursorBeforeDispatch,
    };
  });
}

export function recordComplete(
  run: PotetoRun,
  attemptId: string,
  observedSession: ObservedSession,
  resultMessageId: string
): PotetoRun {
  const next = replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "queued" && attempt.state !== "working") {
      throw new RunStateError(`attempt ${attemptId} must be queued or working`);
    }
    if (attempt.state === "queued" && attempt.dispatch.state !== "sent") {
      throw new RunStateError(`attempt ${attemptId} has no dispatch cursor`);
    }
    return {
      request: attempt.request,
      dispatchMessageId: attempt.dispatchMessageId,
      followUps: attempt.followUps,
      state: "complete",
      ids: attempt.ids,
      postCreateSession: attempt.postCreateSession,
      observedSession,
      resultMessageId,
    };
  });
  return completeWhenTerminal(next);
}

export function recordDropout(
  run: PotetoRun,
  attemptId: string,
  error: string
): PotetoRun {
  const next = replaceAttempt(run, attemptId, (attempt) => {
    if (
      attempt.state === "complete" ||
      attempt.state === "dropout" ||
      attempt.state === "cancelled"
    ) {
      throw new RunStateError(`attempt ${attemptId} is already terminal`);
    }
    const ids =
      attempt.state === "queued" || attempt.state === "working"
        ? attempt.ids
        : null;
    return {
      request: attempt.request,
      dispatchMessageId: attempt.dispatchMessageId,
      followUps: attempt.followUps,
      state: "dropout",
      ids,
      error,
    };
  });
  return completeWhenTerminal(next);
}

export function planFollowUp(run: PotetoRun, attemptId: string): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "queued" && attempt.state !== "working") {
      throw new RunStateError(`attempt ${attemptId} cannot receive a follow-up`);
    }
    const pending = attempt.followUps.at(-1);
    if (pending?.state === "planned") {
      return attempt;
    }
    if (attempt.followUps.length >= run.budget.maxFollowUpsPerAttempt) {
      throw new RunStateError("follow-up budget exhausted");
    }
    const delivery: FollowUpDelivery = {
      messageId: `poteto-${run.runId}-${attemptId}-followup-${attempt.followUps.length + 1}`,
      state: "planned",
    };
    return { ...attempt, followUps: [...attempt.followUps, delivery] };
  });
}

export function recordFollowUpSent(
  run: PotetoRun,
  attemptId: string,
  messageId: string
): PotetoRun {
  return replaceAttempt(run, attemptId, (attempt) => {
    if (attempt.state !== "queued" && attempt.state !== "working") {
      throw new RunStateError(`attempt ${attemptId} cannot receive a follow-up`);
    }
    const last = attempt.followUps.at(-1);
    if (last?.state !== "planned" || last.messageId !== messageId) {
      throw new RunStateError(`follow-up ${messageId} is not pending`);
    }
    const followUps = attempt.followUps.map(
      (delivery): FollowUpDelivery =>
        delivery.messageId === messageId
          ? { ...delivery, state: "sent" }
          : delivery
    );
    return { ...attempt, followUps };
  });
}

export function cleanupTargets(run: PotetoRun): readonly CleanupTarget[] {
  const targets: CleanupTarget[] = [];
  for (const attempt of run.workers) {
    if (
      attempt.state !== "queued" &&
      attempt.state !== "working" &&
      attempt.state !== "complete" &&
      attempt.state !== "dropout" &&
      attempt.state !== "cancelled"
    ) {
      continue;
    }
    if (attempt.ids === null) {
      continue;
    }
    if (attempt.ids.workspaceId === run.coordinator.workspaceId) {
      throw new RunStateError("worker record points at the coordinator workspace");
    }
    targets.push({
      attemptId: attempt.request.attemptId,
      workspaceId: attempt.ids.workspaceId,
      sessionId: attempt.ids.sessionId,
      expectedWorkspaceName: attempt.request.workspaceName,
    });
  }
  return targets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPersisted(detail: string): never {
  throw new RunStateError(`invalid persisted Conductor run: ${detail}`);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const keys = Object.keys(value);
  const wanted = new Set(expected);
  for (const key of keys) {
    if (!wanted.has(key)) {
      invalidPersisted(`${label} has unknown key ${key}`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      invalidPersisted(`${label} is missing ${key}`);
    }
  }
}

function persistedRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidPersisted(`${label} must be an object`);
  }
  return value;
}

function persistedString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalidPersisted(`${label} must be a non-empty string`);
  }
  return value;
}

function persistedInteger(
  value: unknown,
  label: string,
  minimum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    invalidPersisted(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function persistedCoordinatorAgent(value: unknown): CoordinatorAgent {
  if (value === "claude" || value === "codex") {
    return value;
  }
  return invalidPersisted("coordinator agent must be claude or codex");
}

function persistedWorkerAgent(value: unknown): WorkerAgent {
  if (value === "claude" || value === "codex" || value === "cursor") {
    return value;
  }
  return invalidPersisted("worker agent is unsupported");
}

function persistedEffort(value: unknown): Effort {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return invalidPersisted("worker effort is unsupported");
}

function persistedBudget(value: unknown): RunBudget {
  const budget = persistedRecord(value, "budget");
  exactKeys(
    budget,
    [
      "maxWorkspaces",
      "maxConcurrentWorkspaces",
      "maxAttempts",
      "maxFollowUpsPerAttempt",
    ],
    "budget"
  );
  const parsed: RunBudget = {
    maxWorkspaces: persistedInteger(budget.maxWorkspaces, "maxWorkspaces", 1),
    maxConcurrentWorkspaces: persistedInteger(
      budget.maxConcurrentWorkspaces,
      "maxConcurrentWorkspaces",
      1
    ),
    maxAttempts: persistedInteger(budget.maxAttempts, "maxAttempts", 1),
    maxFollowUpsPerAttempt: persistedInteger(
      budget.maxFollowUpsPerAttempt,
      "maxFollowUpsPerAttempt",
      1
    ),
  };
  if (parsed.maxConcurrentWorkspaces > parsed.maxWorkspaces) {
    invalidPersisted("concurrency budget exceeds workspace budget");
  }
  return parsed;
}

function persistedCoordinator(value: unknown): PotetoRun["coordinator"] {
  const coordinator = persistedRecord(value, "coordinator");
  exactKeys(
    coordinator,
    ["workspaceId", "sessionId", "agent", "model"],
    "coordinator"
  );
  return {
    workspaceId: persistedString(
      coordinator.workspaceId,
      "coordinator.workspaceId"
    ),
    sessionId: persistedString(
      coordinator.sessionId,
      "coordinator.sessionId"
    ),
    agent: persistedCoordinatorAgent(coordinator.agent),
    model: persistedString(coordinator.model, "coordinator.model"),
  };
}

function persistedIds(value: unknown, label: string): WorkerIds {
  const ids = persistedRecord(value, label);
  exactKeys(ids, ["workspaceId", "sessionId"], label);
  return {
    workspaceId: persistedString(ids.workspaceId, `${label}.workspaceId`),
    sessionId: persistedString(ids.sessionId, `${label}.sessionId`),
  };
}

function persistedObservation(
  value: unknown,
  label: string
): ObservedSession {
  const observation = persistedRecord(value, label);
  exactKeys(
    observation,
    ["model", "resolvedModel", "effort", "fastMode"],
    label
  );
  if (typeof observation.fastMode !== "boolean") {
    invalidPersisted(`${label}.fastMode must be boolean`);
  }
  return {
    model: persistedString(observation.model, `${label}.model`),
    resolvedModel: persistedString(
      observation.resolvedModel,
      `${label}.resolvedModel`
    ),
    effort: persistedString(observation.effort, `${label}.effort`),
    fastMode: observation.fastMode,
  };
}

function persistedRequest(value: unknown): WorkerRequest {
  const request = persistedRecord(value, "worker request");
  exactKeys(
    request,
    [
      "attemptId",
      "role",
      "purpose",
      "baseBranch",
      "workspaceName",
      "agent",
      "model",
      "effort",
      "fastMode",
    ],
    "worker request"
  );
  if (request.purpose !== "review" && request.purpose !== "write") {
    invalidPersisted("worker purpose must be review or write");
  }
  if (request.fastMode !== false) {
    invalidPersisted("worker fastMode must be false");
  }
  return {
    attemptId: persistedString(request.attemptId, "worker attemptId"),
    role: persistedString(request.role, "worker role"),
    purpose: request.purpose,
    baseBranch: persistedString(request.baseBranch, "worker baseBranch"),
    workspaceName: persistedString(
      request.workspaceName,
      "worker workspaceName"
    ),
    agent: persistedWorkerAgent(request.agent),
    model: persistedString(request.model, "worker model"),
    effort: persistedEffort(request.effort),
    fastMode: false,
  };
}

function persistedFollowUps(value: unknown): readonly FollowUpDelivery[] {
  if (!Array.isArray(value)) {
    invalidPersisted("worker followUps must be an array");
  }
  return value.map((item, index) => {
    const delivery = persistedRecord(item, `followUp ${index}`);
    exactKeys(delivery, ["messageId", "state"], `followUp ${index}`);
    if (delivery.state !== "planned" && delivery.state !== "sent") {
      invalidPersisted(`followUp ${index}.state is unsupported`);
    }
    return {
      messageId: persistedString(
        delivery.messageId,
        `followUp ${index}.messageId`
      ),
      state: delivery.state,
    };
  });
}

function persistedBase(value: Record<string, unknown>): AttemptBase {
  return {
    request: persistedRequest(value.request),
    dispatchMessageId: persistedString(
      value.dispatchMessageId,
      "dispatchMessageId"
    ),
    followUps: persistedFollowUps(value.followUps),
  };
}

function persistedAttempt(value: unknown, index: number): WorkerAttempt {
  const attempt = persistedRecord(value, `worker ${index}`);
  const state = attempt.state;
  if (state === "planned" || state === "creating") {
    exactKeys(
      attempt,
      ["state", "request", "dispatchMessageId", "followUps"],
      `worker ${index}`
    );
    return { ...persistedBase(attempt), state };
  }
  if (state === "unknown") {
    exactKeys(
      attempt,
      [
        "state",
        "request",
        "dispatchMessageId",
        "followUps",
        "candidateWorkspaceIds",
        "error",
      ],
      `worker ${index}`
    );
    if (
      !Array.isArray(attempt.candidateWorkspaceIds) ||
      !attempt.candidateWorkspaceIds.every((item) => typeof item === "string")
    ) {
      invalidPersisted(`worker ${index}.candidateWorkspaceIds is invalid`);
    }
    return {
      ...persistedBase(attempt),
      state,
      candidateWorkspaceIds: attempt.candidateWorkspaceIds,
      error: persistedString(attempt.error, `worker ${index}.error`),
    };
  }
  if (state === "queued") {
    exactKeys(
      attempt,
      [
        "state",
        "request",
        "dispatchMessageId",
        "followUps",
        "ids",
        "postCreateSession",
        "dispatch",
      ],
      `worker ${index}`
    );
    const dispatch = persistedRecord(attempt.dispatch, `worker ${index}.dispatch`);
    if (dispatch.state === "pending") {
      exactKeys(dispatch, ["state"], `worker ${index}.dispatch`);
      return {
        ...persistedBase(attempt),
        state,
        ids: persistedIds(attempt.ids, `worker ${index}.ids`),
        postCreateSession: persistedObservation(
          attempt.postCreateSession,
          `worker ${index}.postCreateSession`
        ),
        dispatch: { state: "pending" },
      };
    }
    if (dispatch.state === "sent") {
      exactKeys(
        dispatch,
        ["state", "transcriptCursorBeforeDispatch"],
        `worker ${index}.dispatch`
      );
      const cursor = dispatch.transcriptCursorBeforeDispatch;
      if (cursor !== null && typeof cursor !== "string") {
        invalidPersisted(`worker ${index}.dispatch cursor is invalid`);
      }
      return {
        ...persistedBase(attempt),
        state,
        ids: persistedIds(attempt.ids, `worker ${index}.ids`),
        postCreateSession: persistedObservation(
          attempt.postCreateSession,
          `worker ${index}.postCreateSession`
        ),
        dispatch: {
          state: "sent",
          transcriptCursorBeforeDispatch: cursor,
        },
      };
    }
    return invalidPersisted(`worker ${index}.dispatch state is unsupported`);
  }
  if (state === "working") {
    exactKeys(
      attempt,
      [
        "state",
        "request",
        "dispatchMessageId",
        "followUps",
        "ids",
        "postCreateSession",
        "transcriptCursorBeforeDispatch",
      ],
      `worker ${index}`
    );
    const cursor = attempt.transcriptCursorBeforeDispatch;
    if (cursor !== null && typeof cursor !== "string") {
      invalidPersisted(`worker ${index}.transcript cursor is invalid`);
    }
    return {
      ...persistedBase(attempt),
      state,
      ids: persistedIds(attempt.ids, `worker ${index}.ids`),
      postCreateSession: persistedObservation(
        attempt.postCreateSession,
        `worker ${index}.postCreateSession`
      ),
      transcriptCursorBeforeDispatch: cursor,
    };
  }
  if (state === "complete") {
    exactKeys(
      attempt,
      [
        "state",
        "request",
        "dispatchMessageId",
        "followUps",
        "ids",
        "postCreateSession",
        "observedSession",
        "resultMessageId",
      ],
      `worker ${index}`
    );
    return {
      ...persistedBase(attempt),
      state,
      ids: persistedIds(attempt.ids, `worker ${index}.ids`),
      postCreateSession: persistedObservation(
        attempt.postCreateSession,
        `worker ${index}.postCreateSession`
      ),
      observedSession: persistedObservation(
        attempt.observedSession,
        `worker ${index}.observedSession`
      ),
      resultMessageId: persistedString(
        attempt.resultMessageId,
        `worker ${index}.resultMessageId`
      ),
    };
  }
  if (state === "dropout" || state === "cancelled") {
    exactKeys(
      attempt,
      [
        "state",
        "request",
        "dispatchMessageId",
        "followUps",
        "ids",
        "error",
      ],
      `worker ${index}`
    );
    return {
      ...persistedBase(attempt),
      state,
      ids:
        attempt.ids === null
          ? null
          : persistedIds(attempt.ids, `worker ${index}.ids`),
      error: persistedString(attempt.error, `worker ${index}.error`),
    };
  }
  return invalidPersisted(`worker ${index}.state is unsupported`);
}

function persistedStatus(value: unknown): PotetoRun["status"] {
  if (
    value === "active" ||
    value === "complete" ||
    value === "cancelled" ||
    value === "needs-cleanup"
  ) {
    return value;
  }
  return invalidPersisted("run status is unsupported");
}

function parsePersistedRun(value: unknown): PotetoRun {
  const run = persistedRecord(value, "run");
  exactKeys(
    run,
    [
      "schemaVersion",
      "runId",
      "status",
      "coordinator",
      "budget",
      "workspaceCreationCount",
      "workers",
    ],
    "run"
  );
  if (run.schemaVersion !== 1) {
    invalidPersisted("schemaVersion must be 1");
  }
  if (!Array.isArray(run.workers)) {
    invalidPersisted("workers must be an array");
  }
  const budget = persistedBudget(run.budget);
  const workspaceCreationCount = persistedInteger(
    run.workspaceCreationCount,
    "workspaceCreationCount",
    0
  );
  const workers = run.workers.map(persistedAttempt);
  if (workers.length > budget.maxAttempts) {
    invalidPersisted("worker count exceeds attempt budget");
  }
  if (workspaceCreationCount > budget.maxWorkspaces) {
    invalidPersisted("workspace count exceeds workspace budget");
  }
  const attemptIds = workers.map((attempt) => attempt.request.attemptId);
  if (new Set(attemptIds).size !== attemptIds.length) {
    invalidPersisted("attempt IDs must be unique");
  }
  return {
    schemaVersion: 1,
    runId: persistedString(run.runId, "runId"),
    status: persistedStatus(run.status),
    coordinator: persistedCoordinator(run.coordinator),
    budget,
    workspaceCreationCount,
    workers,
  };
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export interface RunStore {
  readonly load: (runId: string) => Promise<PotetoRun>;
  readonly save: (run: PotetoRun) => Promise<void>;
  readonly list: () => Promise<readonly PotetoRun[]>;
  readonly close: () => Promise<void>;
}

export function openRunStore(directory: string): RunStore {
  const lockPath = join(directory, LOCK_FILE);
  let locked = false;
  let closed = false;

  async function recordedOwnerIsDead(): Promise<boolean> {
    let contents: string;
    try {
      contents = await readFile(lockPath, "utf8");
    } catch {
      return false;
    }
    const owner = contents.trim();
    if (!/^[1-9]\d*$/.test(owner)) {
      return false;
    }
    const pid = Number(owner);
    if (!Number.isSafeInteger(pid)) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return isRecord(error) && error.code === "ESRCH";
    }
  }

  async function acquireLock(): Promise<void> {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      return;
    } catch (error) {
      if (!(isRecord(error) && error.code === "EEXIST")) {
        throw new RunStateError(
          `cannot create Conductor run-store lock: ${lockPath}`
        );
      }
    }
    if (!(await recordedOwnerIsDead())) {
      throw new RunStateError(`Conductor run store is locked: ${lockPath}`);
    }
    await unlink(lockPath).catch(() => undefined);
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      throw new RunStateError(`Conductor run store is locked: ${lockPath}`);
    }
  }

  async function lock(): Promise<void> {
    if (closed) {
      throw new RunStateError("Conductor run store is closed");
    }
    if (locked) {
      return;
    }
    await mkdir(directory, { recursive: true });
    await acquireLock();
    locked = true;
  }

  return {
    async load(runId) {
      await lock();
      try {
        const source = await readFile(join(directory, `${runId}.json`), "utf8");
        return parsePersistedRun(JSON.parse(source));
      } catch (error) {
        if (error instanceof RunStateError) {
          throw error;
        }
        throw new RunStateError(
          `invalid persisted Conductor run: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    async save(run) {
      await lock();
      await atomicWrite(
        join(directory, `${run.runId}.json`),
        `${JSON.stringify(run, null, 2)}\n`
      );
    },
    async list() {
      await lock();
      const names = (await readdir(directory))
        .filter((name) => name.endsWith(".json"))
        .sort();
      return await Promise.all(
        names.map(async (name) => {
          const value: unknown = JSON.parse(
            await readFile(join(directory, name), "utf8")
          );
          return parsePersistedRun(value);
        })
      );
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      if (locked) {
        await unlink(lockPath).catch(() => undefined);
        locked = false;
      }
    },
  };
}
