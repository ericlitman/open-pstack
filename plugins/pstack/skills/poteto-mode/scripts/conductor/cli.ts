import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Command, CommanderError } from "commander";

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
import { readPolicy, resolveRole, validateCatalog } from "./policy.ts";
import { renderWorkerPrompt } from "./prompt.ts";
import {
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
  ConductorPolicy,
  CoordinatorAgent,
  LaneName,
  ModelTarget,
  PotetoRun,
  RunBudget,
  WorkerAttempt,
  WorkerBrief,
  WorkerPurpose,
} from "./types.ts";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

interface GlobalOptions {
  readonly store: string;
  readonly policy?: string;
}

type CliEnvironment = Readonly<Record<string, string | undefined>>;

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

class CliError extends Error {
  override readonly name = "CliError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CliError(`${label} must be a JSON object`);
  }
  return value;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CliError(
      `cannot read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const keys = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new CliError(`${label} has unknown key ${key}`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new CliError(`${label} is missing ${key}`);
    }
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliError(`${label} must be a non-empty string`);
  }
  return value;
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new CliError(`${label} must contain only letters, digits, _ or -`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new CliError(`${label} must be a positive integer`);
  }
  return value;
}

function parseBudget(value: unknown, ceiling: RunBudget): RunBudget {
  const budget = object(value, "run budget");
  exactKeys(
    budget,
    [
      "maxWorkspaces",
      "maxConcurrentWorkspaces",
      "maxAttempts",
      "maxFollowUpsPerAttempt",
    ],
    "run budget"
  );
  const parsed: RunBudget = {
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
  if (parsed.maxConcurrentWorkspaces > parsed.maxWorkspaces) {
    throw new CliError("maxConcurrentWorkspaces cannot exceed maxWorkspaces");
  }
  if (parsed.maxWorkspaces > ceiling.maxWorkspaces) {
    throw new CliError("run budget exceeds project maxWorkspaces");
  }
  if (parsed.maxConcurrentWorkspaces > ceiling.maxConcurrentWorkspaces) {
    throw new CliError("run budget exceeds project maxConcurrentWorkspaces");
  }
  if (parsed.maxAttempts > ceiling.maxAttempts) {
    throw new CliError("run budget exceeds project maxAttempts");
  }
  if (parsed.maxFollowUpsPerAttempt > ceiling.maxFollowUpsPerAttempt) {
    throw new CliError("run budget exceeds project maxFollowUpsPerAttempt");
  }
  return parsed;
}

function coordinatorAgent(value: string): CoordinatorAgent {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new CliError("coordinator agent must be claude or codex");
}

function purpose(value: string): WorkerPurpose {
  if (value === "review" || value === "write") {
    return value;
  }
  throw new CliError("purpose must be review or write");
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new CliError(`${label} must be a string array`);
  }
  return value;
}

function parseBrief(value: unknown): WorkerBrief {
  const brief = object(value, "worker brief");
  exactKeys(
    brief,
    ["repository", "allowedFiles", "questions", "requiredEvidence", "task"],
    "worker brief"
  );
  return {
    repository: nonEmpty(brief.repository, "worker brief repository"),
    allowedFiles: stringArray(brief.allowedFiles, "worker brief allowedFiles"),
    questions: stringArray(brief.questions, "worker brief questions"),
    requiredEvidence: stringArray(
      brief.requiredEvidence,
      "worker brief requiredEvidence"
    ),
    task: nonEmpty(brief.task, "worker brief task"),
  };
}

function emit(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value)}\n`);
}

function sessionId(environment: CliEnvironment): string {
  const value = environment.CONDUCTOR_SESSION_ID;
  if (value === undefined || value.length === 0) {
    throw new CliError("CONDUCTOR_SESSION_ID is required");
  }
  return value;
}

function guardCoordinator(environment: CliEnvironment): string {
  if (environment.PSTACK_WORKER === "1") {
    throw new CliError("a Poteto worker cannot coordinate or dispatch workers");
  }
  return sessionId(environment);
}

function requiredPolicyPath(program: Command): string {
  const path = program.opts<GlobalOptions>().policy;
  if (path === undefined) {
    throw new CliError("--policy is required for this command");
  }
  return path;
}

function attempt(run: PotetoRun, attemptId: string): WorkerAttempt {
  const value = run.workers.find(
    (candidate) => candidate.request.attemptId === attemptId
  );
  if (value === undefined) {
    throw new CliError(`unknown attempt ID: ${attemptId}`);
  }
  return value;
}

function targetForAttempt(
  policy: ConductorPolicy,
  worker: WorkerAttempt
): ModelTarget {
  const target = Object.values(policy.lanes).find(
    (candidate) =>
      candidate.agent === worker.request.agent &&
      candidate.model === worker.request.model &&
      candidate.effort === worker.request.effort
  );
  if (target === undefined) {
    throw new CliError("attempt target is absent from the current policy");
  }
  return target;
}

function selectedTarget(
  policy: ConductorPolicy,
  role: string,
  requestedLane: string | undefined
): ModelTarget {
  const route = resolveRole(policy, role);
  if (route === "coordinator") {
    throw new CliError(`role ${role} must remain in the coordinator`);
  }
  let lane: LaneName;
  if (requestedLane === undefined) {
    if (route.length !== 1) {
      throw new CliError(`role ${role} requires an explicit --lane`);
    }
    const only = route[0];
    if (only === undefined) {
      throw new CliError(`role ${role} has no worker lane`);
    }
    lane = only;
  } else {
    const parsedLane = laneName(requestedLane);
    if (!route.includes(parsedLane)) {
      throw new CliError(`lane ${requestedLane} is not allowed for role ${role}`);
    }
    lane = parsedLane;
  }
  return policy.lanes[lane];
}

function laneName(value: string): LaneName {
  if (
    value === "judgment" ||
    value === "hard-review" ||
    value === "implementation" ||
    value === "exploration"
  ) {
    return value;
  }
  throw new CliError(`unknown policy lane: ${value}`);
}

async function withStore<T>(
  directory: string,
  action: (store: ReturnType<typeof openRunStore>) => Promise<T>
): Promise<T> {
  const store = openRunStore(directory);
  try {
    return await action(store);
  } finally {
    await store.close();
  }
}

function requireAttemptIds(worker: WorkerAttempt): {
  readonly workspaceId: string;
  readonly sessionId: string;
} {
  if (
    worker.state !== "queued" &&
    worker.state !== "working" &&
    worker.state !== "complete"
  ) {
    throw new CliError(`attempt ${worker.request.attemptId} has no active session`);
  }
  return worker.ids;
}

function verifyObservationIds(
  worker: WorkerAttempt,
  workspaceId: string,
  observedSessionId: string
): void {
  const ids = requireAttemptIds(worker);
  if (ids.workspaceId !== workspaceId || ids.sessionId !== observedSessionId) {
    throw new CliError("Conductor observation IDs do not match the attempt");
  }
}

function buildProgram(
  environment: CliEnvironment,
  io: CliIo
): Command {
  const program = new Command("pstack-conductor")
    .description("Validate and persist Poteto Mode Conductor operations")
    .requiredOption("--store <directory>", "durable run store")
    .option("--policy <file>", "Conductor project policy")
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();

  program
    .command("policy")
    .command("validate")
    .requiredOption("--identity <file>")
    .requiredOption("--coordinator-status <file>")
    .requiredOption("--models <file>")
    .action(async (options: {
      identity: string;
      coordinatorStatus: string;
      models: string;
    }) => {
      const expectedSessionId = guardCoordinator(environment);
      const policy = await readPolicy(requiredPolicyPath(program));
      const context = parseCurrentContext(
        await readJson(options.identity),
        await readJson(options.coordinatorStatus),
        expectedSessionId
      );
      validateCatalog(policy, parseModelCatalog(await readJson(options.models)));
      emit(io, { valid: true, context });
    });

  program
    .command("run")
    .command("start")
    .option("--run-id <id>")
    .requiredOption("--coordinator-agent <agent>")
    .requiredOption("--coordinator-model <model>")
    .requiredOption("--identity <file>")
    .requiredOption("--coordinator-status <file>")
    .requiredOption("--budget <file>")
    .action(async (options: {
      runId?: string;
      coordinatorAgent: string;
      coordinatorModel: string;
      identity: string;
      coordinatorStatus: string;
      budget: string;
    }) => {
      const expectedSessionId = guardCoordinator(environment);
      const context = parseCurrentContext(
        await readJson(options.identity),
        await readJson(options.coordinatorStatus),
        expectedSessionId
      );
      const policy = await readPolicy(requiredPolicyPath(program));
      const budget = parseBudget(await readJson(options.budget), policy.budget);
      const globals = program.opts<GlobalOptions>();
      const run = await withStore(globals.store, async (store) => {
        const runs = await store.list();
        let existing: PotetoRun | undefined;
        let runId: string;
        if (options.runId !== undefined) {
          runId = safeId(options.runId, "run ID");
          existing = runs.find((candidate) => candidate.runId === runId);
        } else {
          const owned = runs.filter(
            (candidate) =>
              candidate.status === "active" &&
              candidate.coordinator.sessionId === context.sessionId
          );
          if (owned.length > 1) {
            throw new CliError("multiple active runs require an explicit --run-id");
          }
          existing = owned[0];
          runId = existing?.runId ?? randomUUID();
        }
        if (existing !== undefined) {
          assertCoordinator(existing, context.sessionId);
        }
        const next = createRun({
          runId,
          coordinator: {
            ...context,
            agent: coordinatorAgent(options.coordinatorAgent),
            model: nonEmpty(options.coordinatorModel, "coordinator model"),
          },
          budget,
          existing,
        });
        await store.save(next);
        return next;
      });
      emit(io, run);
    });

  const attemptCommand = program.command("attempt");

  attemptCommand
    .command("plan")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--role <role>")
    .option("--lane <lane>")
    .requiredOption("--purpose <purpose>")
    .requiredOption("--base-branch <branch>")
    .requiredOption("--brief <file>")
    .action(async (options: {
      runId: string;
      attemptId: string;
      role: string;
      lane?: string;
      purpose: string;
      baseBranch: string;
      brief: string;
    }) => {
      const coordinatorSessionId = guardCoordinator(environment);
      const policy = await readPolicy(requiredPolicyPath(program));
      const target = selectedTarget(policy, options.role, options.lane);
      const brief = parseBrief(await readJson(options.brief));
      const runId = safeId(options.runId, "run ID");
      const attemptId = safeId(options.attemptId, "attempt ID");
      const globals = program.opts<GlobalOptions>();
      const next = await withStore(globals.store, async (store) => {
        const run = await store.load(runId);
        assertCoordinator(run, coordinatorSessionId);
        const updated = planAttempt(run, {
          attemptId,
          role: options.role,
          purpose: purpose(options.purpose),
          baseBranch: nonEmpty(options.baseBranch, "base branch"),
          target,
          dispatchMessageId: `poteto-${runId}-${attemptId}-dispatch`,
        });
        await store.save(updated);
        return updated;
      });
      const worker = attempt(next, attemptId);
      emit(io, {
        workspace: {
          name: worker.request.workspaceName,
          branch: worker.request.baseBranch,
          agent: worker.request.agent,
          model: worker.request.model,
          effort: worker.request.effort,
          fastMode: false,
          env: {
            PSTACK_WORKER: "1",
            PSTACK_RUN_ID: runId,
            PSTACK_WORKER_ATTEMPT_ID: attemptId,
            PSTACK_COORDINATOR_SESSION_ID: coordinatorSessionId,
          },
        },
        initialMessage: null,
        prompt: renderWorkerPrompt({
          runId,
          coordinatorSessionId,
          request: worker.request,
          target,
          brief,
        }),
        dispatchMessageId: worker.dispatchMessageId,
      });
    });

  attemptCommand
    .command("creating")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .action(async (options: { runId: string; attemptId: string }) => {
      const owner = guardCoordinator(environment);
      const globals = program.opts<GlobalOptions>();
      const updated = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const next = markCreating(run, safeId(options.attemptId, "attempt ID"));
        await store.save(next);
        return attempt(next, options.attemptId);
      });
      emit(io, updated);
    });

  attemptCommand
    .command("created")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--workspace-response <file>")
    .requiredOption("--session-response <file>")
    .action(async (options: {
      runId: string;
      attemptId: string;
      workspaceResponse: string;
      sessionResponse: string;
    }) => {
      const owner = guardCoordinator(environment);
      const policy = await readPolicy(requiredPolicyPath(program));
      const ids = parseCreatedWorkspace(await readJson(options.workspaceResponse));
      const observation = parseObservedSession(
        await readJson(options.sessionResponse),
        ids.sessionId
      );
      const globals = program.opts<GlobalOptions>();
      const updated = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const worker = attempt(run, safeId(options.attemptId, "attempt ID"));
        validateReceipt(targetForAttempt(policy, worker), worker.request, observation, observation);
        const next = recordCreated(run, options.attemptId, ids, observation);
        await store.save(next);
        return attempt(next, options.attemptId);
      });
      emit(io, updated);
    });

  attemptCommand
    .command("unknown")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--error <text>")
    .action(async (options: { runId: string; attemptId: string; error: string }) => {
      const owner = guardCoordinator(environment);
      const globals = program.opts<GlobalOptions>();
      const worker = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const next = markUnknown(
          run,
          safeId(options.attemptId, "attempt ID"),
          nonEmpty(options.error, "error")
        );
        await store.save(next);
        return attempt(next, options.attemptId);
      });
      emit(io, worker);
    });

  attemptCommand
    .command("reconcile")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--workspaces-response <file>")
    .option("--workspace-sessions-response <file>")
    .action(async (options: {
      runId: string;
      attemptId: string;
      workspacesResponse: string;
      workspaceSessionsResponse?: string;
    }) => {
      const owner = guardCoordinator(environment);
      const policy = await readPolicy(requiredPolicyPath(program));
      const listings = parseWorkspaceList(
        await readJson(options.workspacesResponse)
      );
      const globals = program.opts<GlobalOptions>();
      const result = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const attemptId = safeId(options.attemptId, "attempt ID");
        const decision = reconcileUnknown(run, attemptId, listings);
        if (decision.kind === "unresolved") {
          return decision;
        }
        if (decision.kind === "ambiguous") {
          await store.save(decision.run);
          return decision;
        }
        if (options.workspaceSessionsResponse === undefined) {
          throw new CliError(
            "--workspace-sessions-response is required for one exact workspace"
          );
        }
        const worker = attempt(run, attemptId);
        const reconciled = parseWorkspaceSessions(
          decision.workspaceId,
          await readJson(options.workspaceSessionsResponse),
          targetForAttempt(policy, worker)
        );
        const next = adoptUnknown(
          run,
          attemptId,
          reconciled.ids,
          reconciled.observation
        );
        await store.save(next);
        return { kind: "adopted", worker: attempt(next, attemptId) };
      });
      emit(io, result);
    });

  attemptCommand
    .command("dispatched")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--messages-before <file>")
    .action(async (options: {
      runId: string;
      attemptId: string;
      messagesBefore: string;
    }) => {
      const owner = guardCoordinator(environment);
      const transcript = parseTranscript(await readJson(options.messagesBefore));
      const globals = program.opts<GlobalOptions>();
      const worker = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const next = recordDispatch(
          run,
          safeId(options.attemptId, "attempt ID"),
          transcript.lastMessageId
        );
        await store.save(next);
        return attempt(next, options.attemptId);
      });
      emit(io, worker);
    });

  attemptCommand
    .command("observe")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--session-response <file>")
    .requiredOption("--status-response <file>")
    .requiredOption("--messages-response <file>")
    .action(async (options: {
      runId: string;
      attemptId: string;
      sessionResponse: string;
      statusResponse: string;
      messagesResponse: string;
    }) => {
      const owner = guardCoordinator(environment);
      const policy = await readPolicy(requiredPolicyPath(program));
      const globals = program.opts<GlobalOptions>();
      const result = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const attemptId = safeId(options.attemptId, "attempt ID");
        const worker = attempt(run, attemptId);
        if (worker.state !== "queued" && worker.state !== "working") {
          throw new CliError(`attempt ${attemptId} is not active`);
        }
        const ids = requireAttemptIds(worker);
        const observed = parseObservedSession(
          await readJson(options.sessionResponse),
          ids.sessionId
        );
        const status = parseSessionStatus(await readJson(options.statusResponse));
        verifyObservationIds(worker, status.workspaceId, status.sessionId);
        const cursor =
          worker.state === "queued"
            ? worker.dispatch.state === "sent"
              ? worker.dispatch.transcriptCursorBeforeDispatch
              : null
            : worker.state === "working"
              ? worker.transcriptCursorBeforeDispatch
              : null;
        if (worker.state === "queued" && worker.dispatch.state !== "sent") {
          throw new CliError(`attempt ${attemptId} has not been dispatched`);
        }
        const transcript = parseTranscript(
          await readJson(options.messagesResponse),
          cursor
        );
        for (const message of transcript.messages) {
          if (message.sessionId !== ids.sessionId) {
            throw new CliError("transcript message belongs to another session");
          }
        }
        const observation = completionObservation(
          status,
          transcript,
          cursor,
          attemptId
        );
        if (observation.kind === "waiting") {
          return { outcome: "waiting" };
        }
        if (observation.kind === "working") {
          if (worker.state === "queued") {
            const next = recordWorking(run, attemptId);
            await store.save(next);
          }
          return { outcome: "working" };
        }
        if (observation.kind === "dropout") {
          const next = recordDropout(run, attemptId, observation.error);
          await store.save(next);
          return { outcome: "dropout", error: observation.error };
        }
        validateReceipt(
          targetForAttempt(policy, worker),
          worker.request,
          worker.postCreateSession,
          observed
        );
        if (observation.result.status === "dropout") {
          const next = recordDropout(run, attemptId, observation.result.summary);
          await store.save(next);
          return { outcome: "dropout", result: observation.result };
        }
        const next = recordComplete(
          run,
          attemptId,
          observed,
          observation.message.id
        );
        await store.save(next);
        return { outcome: "complete", result: observation.result };
      });
      emit(io, result);
    });

  attemptCommand
    .command("follow-up-plan")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .action(async (options: { runId: string; attemptId: string }) => {
      const owner = guardCoordinator(environment);
      const globals = program.opts<GlobalOptions>();
      const delivery = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const next = planFollowUp(
          run,
          safeId(options.attemptId, "attempt ID")
        );
        await store.save(next);
        return attempt(next, options.attemptId).followUps.at(-1);
      });
      if (delivery === undefined) {
        throw new CliError("follow-up planning produced no delivery");
      }
      emit(io, delivery);
    });

  attemptCommand
    .command("follow-up-sent")
    .requiredOption("--run-id <id>")
    .requiredOption("--attempt-id <id>")
    .requiredOption("--message-id <id>")
    .action(async (options: {
      runId: string;
      attemptId: string;
      messageId: string;
    }) => {
      const owner = guardCoordinator(environment);
      const globals = program.opts<GlobalOptions>();
      const worker = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        assertCoordinator(run, owner);
        const next = recordFollowUpSent(
          run,
          safeId(options.attemptId, "attempt ID"),
          safeId(options.messageId, "message ID")
        );
        await store.save(next);
        return attempt(next, options.attemptId);
      });
      emit(io, worker);
    });

  program
    .command("cleanup")
    .command("targets")
    .requiredOption("--run-id <id>")
    .requiredOption("--workspaces-response <file>")
    .action(async (options: { runId: string; workspacesResponse: string }) => {
      const listings = parseWorkspaceList(
        await readJson(options.workspacesResponse)
      );
      const names = new Map(
        listings.map((workspace) => [
          workspace.workspaceId,
          workspace.workspaceName,
        ])
      );
      const globals = program.opts<GlobalOptions>();
      const targets = await withStore(globals.store, async (store) => {
        const run = await store.load(safeId(options.runId, "run ID"));
        return cleanupTargets(run).filter(
          (target) =>
            names.get(target.workspaceId) === target.expectedWorkspaceName
        );
      });
      emit(io, { targets });
    });

  return program;
}

export async function main(
  argv: readonly string[],
  environment: CliEnvironment = process.env,
  io: CliIo = defaultIo
): Promise<number> {
  try {
    await buildProgram(environment, io).parseAsync([...argv], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    return 64;
  }
}
