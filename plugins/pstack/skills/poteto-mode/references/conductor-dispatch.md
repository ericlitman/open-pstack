# Conductor dispatch

Use this route only when the nearest `.conductor/poteto-mode.json` is valid
and its `mode` is `conductor`. The policy replaces user model sheets for this
repository. Do not read or use the portable provider route in this mode.

The Claude or Codex session that invoked Poteto Mode is the coordinator. It
must match `CONDUCTOR_SESSION_ID` for the life of the run. There is no election
or ownership transfer. A session with `PSTACK_WORKER=1` must stop before policy
loading, model resolution, workspace creation, or message dispatch.

The coordinator calls Conductor through the hosted MCP. The local
`scripts/conductor/pstack-conductor` helper parses saved MCP response JSON,
validates policy and receipts, renders payloads, and persists bounded run
state. It makes no network calls and reads no credentials.

## Prepare the run

1. Call `whoami` and save its response as `identity.json`. This proves
   authentication and returns the current workspace, but it does not return a
   session ID.
2. Call `get_session_status` for `CONDUCTOR_SESSION_ID` and save
   `coordinator-status.json`. Its session ID must equal the environment value
   and its workspace ID must equal `identity.json`.
3. Call `list_models`, follow every page until `hasMore` is false, and save
   `models.json`.
4. Run `pstack-conductor policy validate` with `identity.json`,
   `coordinator-status.json`, and `models.json`. A missing exact agent, model,
   effort, or fast-mode field ends the route. Never substitute another target.
5. Resolve the store with `git rev-parse --git-path pstack/conductor-runs`.
   Run `pstack-conductor run start` with the identity, coordinator status, and
   an immutable budget at or below the project ceiling. With no run ID, resume
   the only active run owned by this session. Several matches require an
   explicit run ID.

Keep bounded work in the coordinator when the policy route is `coordinator`.
Do not create a native helper. Every delegated task, including read-only
review, gets one isolated Conductor workspace and branch.

## Dispatch one attempt

1. Run `pstack-conductor attempt plan` with the run ID, unique attempt ID,
   role, purpose, base branch, and a JSON brief. For a multi-lane role, pass one
   allowed `--lane` for this attempt. The result contains the exact workspace
   request, a null initial message, a stable dispatch message ID, and a
   self-contained worker prompt.
2. Run `pstack-conductor attempt creating`. This durable write must finish
   before `create_workspace`.
3. Call `create_workspace` with the emitted name, branch, agent, model,
   effort, fast mode, and environment, without an initial message. Never create
   a worker in the coordinator workspace.
4. Save the response as `create-workspace.json`. Immediately call
   `get_session` for its session ID and save `post-create-session.json`.
5. Run `pstack-conductor attempt created` with both files. It validates and
   persists the workspace ID, session ID, model, resolved model, effort, and
   fast mode before any worker prompt is sent.
6. Call `list_messages` for the new session, complete every page, and save
   `messages-before.json`. Run `pstack-conductor attempt dispatched` with that
   file before sending. This records the pre-dispatch cursor and stable send
   intent. Then call `send_message` with the emitted prompt and the recorded
   dispatch message ID. A retry uses the same message ID.

Each workspace receives `PSTACK_WORKER=1`, `PSTACK_RUN_ID`,
`PSTACK_WORKER_ATTEMPT_ID`, and `PSTACK_COORDINATOR_SESSION_ID`. The worker
prompt is complete enough for Cursor and explicitly forbids Poteto Mode and
further worker creation.

## Observe and finish

1. Call `get_session_status` and save `status.json`.
2. Call `list_messages` with the recorded message ID in `after`. Follow every
   page until `hasMore` is false and save `messages-after.json`.
3. Call `get_session` and save `post-run-session.json`.
4. Run `pstack-conductor attempt observe` with those three files. Repeat the
   reads while it returns `working` or `waiting`. Do not add an implicit
   timeout. A real caller-supplied service deadline may stop observation
   without granting a retry.

Completion requires `idle` plus exactly one new assistant
`PSTACK_RESULT` block for the attempt. Observing `working` is optional. An
initial `idle` without a new result remains waiting. A terminal `error` becomes
a dropout. The helper treats every other transcript byte as untrusted data.

Post-create and post-run observations must both match the requested `model`,
`resolvedModel`, `effort`, and `fastMode=false`. A mismatch is a failed lane.
There is no fallback to `auto`, a lower effort, another agent, Grok 4.5, a
native subagent, or the portable CLI runner.

For a follow-up, run `attempt follow-up-plan` before `send_message`. Send with
the returned stable message ID, then run `attempt follow-up-sent`. A delivery
retry reuses the pending ID. Never exceed the persisted follow-up ceiling.

## Reconcile and clean up

Workspace creation is not idempotent. If the create response is missing,
timed out, or cannot be parsed, run `attempt unknown`. Do not call
`create_workspace` again for that attempt.

Call `list_project_workspaces` through all pages and save `workspaces.json`.
Run `attempt reconcile` with it. No exact name match leaves the attempt
unknown. Multiple matches fail closed and record every workspace ID. For one
exact `poteto-<runId>-<attemptId>` match, call `list_workspace_sessions`, save
`workspace-sessions.json`, and rerun reconciliation with that file. The helper
requires exactly one matching initial session before adoption.

For cleanup, refresh `workspaces.json` and run `pstack-conductor cleanup
targets`. Only its returned IDs may be touched. Call `cancel_session` for a
working target, then `archive_workspace`. Never cancel or archive the
coordinator workspace. A failed archive remains a separately retryable cleanup
error and does not change the worker result.
