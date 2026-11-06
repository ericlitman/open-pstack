import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { adapter, type ChildRun, type Lane, type LaunchFacts, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { modelFailureStatus, type NormalizedUsage } from "../types.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// By default dsh loads host and project rules and skills, offers web, subagent and workflow tools, writes a
// session title with a second model call, and uploads the whole session log and the plugin inventory with
// every request. Measured with dsh 0.2.0-rc.2.
const DISABLED_ROWS = [
  "agent-instructions",
  "skill-filesystem",
  "tool-skill",
  "tool-web",
  "web",
  "web-search-deepseek",
  "web-fetch-http",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-workflow",
  "workflow-ptc",
  "plugin-package-inventory-deepseek",
  "session-title-llm",
];

// dsh-home-paths' resolveDshHome in dsh 0.2.0-rc.2: a blank value is unset, a leading `~`, `~/` or `~\` is the
// home directory, and a relative path resolves against the runner's cwd.
function dshHome(value: string | undefined): string {
  const path = value !== undefined && value.trim().length > 0 ? value : join(homedir(), ".dsh");
  if (path === "~") return homedir();
  return resolve(path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path);
}

// The lane runs on its own DSH_HOME, so no user layer or home-level file loads, and the stored login is read in
// place through the `credentials` row. A patch replaces a row's whole config. Pinning `sandbox-policy` and
// `approval` also overrides DSH_PERMISSION_MODE. JSON strings are YAML double-quoted scalars, so a path or model
// cannot be reinterpreted.
function patch(lane: Lane): string {
  const quoted = JSON.stringify;
  const credentials = join(dshHome(process.env.DSH_HOME), ".credentials.yaml");
  return [
    "- id: sandbox-policy",
    "  config:",
    `    mode: ${lane.access.mode === "read-only" ? "read-only" : "workspace-write"}`,
    `    workspaceRoot: ${quoted(lane.cwd)}`,
    "- id: approval",
    "  config:",
    "    policy: ask",
    "- id: credentials",
    "  disabled: false",
    "  config:",
    `    path: ${quoted(credentials)}`,
    "- id: agent-default-model",
    "  config:",
    "    provider: deepseek-official",
    `    model: ${quoted(lane.cliModel)}`,
    ...(lane.effort === "default" ? [] : [`    reasoningEffort: ${quoted(lane.effort)}`]),
    ...DISABLED_ROWS.flatMap((id) => [`- id: ${id}`, "  disabled: true"]),
    "- id: session-log-deepseek",
    "  config:",
    "    enabled: false",
    "",
  ].join("\n");
}

const PREFLIGHT_PATCH = join(import.meta.dir, "dsh-preflight.yml");

function lanePatch(sidecar: LaunchFacts["providerSidecar"]): string {
  const config = sidecar?.config;
  if (config == null) throw new Error("dsh argv needs the lane's patch path");
  return config;
}
const SIGINT_EXIT = 130;
const NO_METADATA: ProviderMetadata = { reportedModel: null, sessionId: null, usage: null, costUsd: null };

type Events = { readonly kind: "events"; readonly list: readonly JsonObject[] } | { readonly kind: "malformed" };

function events(stdout: string): Events {
  const list: JsonObject[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = object(JSON.parse(line));
      if (event !== null) list.push(event);
    } catch {
      return { kind: "malformed" };
    }
  }
  return { kind: "events", list };
}

function turnEnd(list: readonly JsonObject[]): JsonObject | null {
  const end = list.findLast((event) => event.type === "status" && event.phase === "turn_end");
  return end === undefined ? null : object(end.reason);
}

function errorCode(reason: JsonObject | null): string | null {
  return reason?.kind === "error" ? nullableString(object(reason.error)?.code) : null;
}

const USAGE_FIELDS = [
  ["inputTokens", "inputTokens"],
  ["outputTokens", "outputTokens"],
  ["totalTokens", "totalTokens"],
  ["cacheReadTokens", "cachedInputTokens"],
  ["cacheWriteTokens", "cacheCreationInputTokens"],
  ["reasoningTokens", "reasoningTokens"],
] as const;

// Each step reports its own usage, so the turn's usage is the sum over `step_end` events.
function usage(list: readonly JsonObject[]): NormalizedUsage | null {
  const sum: Partial<Record<keyof NormalizedUsage, number>> = {};
  for (const event of list) {
    if (event.type !== "status" || event.phase !== "step_end") continue;
    const step = object(event.usage);
    for (const [from, to] of USAGE_FIELDS) {
      const value = finiteNumber(step?.[from]);
      if (value !== undefined) sum[to] = (sum[to] ?? 0) + value;
    }
  }
  return Object.keys(sum).length === 0 ? null : sum;
}

function parse(run: ModelRun): ParseResult {
  if (run.exitCode === SIGINT_EXIT) {
    return { kind: "provider-failure", status: "cancelled", message: "dsh exited with status 130 after SIGINT", metadata: NO_METADATA };
  }
  const parsed = events(run.stdout);
  if (parsed.kind === "malformed") return { kind: "malformed", message: "dsh emitted a non-JSON event" };
  const metadata: ProviderMetadata = {
    reportedModel: null,
    sessionId: nullableString(parsed.list.find((event) => event.type === "session")?.sessionId),
    usage: usage(parsed.list),
    costUsd: null,
  };
  const reason = turnEnd(parsed.list);
  if (reason?.kind === "error") {
    if (modelFailureStatus(run.stderr) === "unavailable-model") return { kind: "malformed", message: "dsh named an unavailable model" };
    const error = object(reason.error);
    const message = `dsh turn failed: ${errorCode(reason) ?? "unknown code"}: ${nullableString(error?.message) ?? "no message"}`;
    return { kind: "provider-failure", status: "child-failed", message, metadata };
  }
  // SIGTERM exits 0 and still writes a `final` with the partial reply, but no `turn_end`.
  if (reason?.kind !== "completed") return { kind: "malformed", message: "dsh ended without a completed turn" };
  const text = nullableString(parsed.list.findLast((event) => event.type === "final")?.text);
  if (text === null) return { kind: "malformed", message: "dsh completed the turn without final text" };
  return { kind: "complete", text, metadata };
}

const VERSION = "0.2.1-rc.2";

// dsh has no status command. The preflight turn's error code says only whether a key is stored or exported.
function classify(run: ChildRun) {
  const parsed = events(run.stdout);
  const code = parsed.kind === "events" ? errorCode(turnEnd(parsed.list)) : null;
  if (code === "TRANSPORT") return { kind: "passed", evidence: "credential present; not validated" } as const;
  return code === "MISSING_CREDENTIAL" ? { kind: "unauthenticated" } as const : { kind: "inconclusive" } as const;
}

export const dsh = adapter({
  id: "dsh",
  executable: "dsh",
  effortIn: "config",
  preflight: {
    // A positional task: the preflight gets no stdin. It runs on the lane's DSH_HOME with the lane's patch, so
    // the loopback patch after it redirects the only route the lane can use.
    argv: (lane, sidecar) => ["--profile", "headless", "--patch", lanePatch(sidecar), "--patch", PREFLIGHT_PATCH, "--json", "preflight"],
    retryAfterUnauthenticatedMs: null,
    classify,
    // dsh ignores a patch row it does not have, so another version could drop the lockdown silently.
    guard: {
      argv: ["--version"],
      check: (run) => run.stdout.trim() === VERSION ? null : {
        status: "unavailable-cli",
        message: `dsh ${run.stdout.trim()} is not the measured ${VERSION}; the adapter must be re-measured before it runs this version`,
      },
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: "patch.yml", content: patch } },
    supports: ["read-only", "isolated-write"],
    needsSharedGitDir: () => false,
    // Launcher flags must come before `--json`.
    argv: (_lane, facts) => ["--profile", "headless", "--patch", lanePatch(facts.providerSidecar), "--json", "-"],
  },
  parse: (run) => parse(run),
  // The stream carries no model, and the session log records the requested model whatever the server ran.
  proof: { report: "absent", matches: () => false },
  // No inherited DSH_* name or other DEEPSEEK_* name: DSH_PERMISSION_MODE widens the lane, DSH_HOME and its kin
  // change what loads, and DEEPSEEK_BASE_URL redirects inference and the key with it. DSH_HOME is the lane's
  // provider directory.
  environment: (_access, sidecarDir) => {
    if (sidecarDir === null) throw new Error("dsh needs the lane's provider directory as its DSH_HOME");
    return { kind: "allowlist", names: [...BASE_ALLOWLIST, "DEEPSEEK_API_KEY"], prefixes: BASE_PREFIXES, set: { DSH_HOME: sidecarDir } };
  },
  docs: {
    name: "DeepSeek Harness",
    hostPrerequisites: ["dsh 0.2.1-rc.2 exactly"],
    statePaths: [
      "`<receipt>.provider/`, the lane's own `DSH_HOME`: the sessions (`sessions/<cwd-slug>/<session-id>/`), projection cache (`storages/session_projcache/`), `profiles/headless/` and `.anonymous-user-id` that dsh writes on every run",
      "The stored key `<DSH_HOME, else ~/.dsh>/.credentials.yaml`, which the lane reads in place and does not copy",
    ],
    notes: [
      "Measured with dsh 0.2.0-rc.2, a developer preview, and rechecked on 0.2.1-rc.2 for the patch rows, the stored-login preflight and the writer. The runner checks `dsh --version` before the preflight and refuses any version but 0.2.1-rc.2 as `unavailable-cli`/69. Recheck on an upgrade: the config row IDs the patch names (dsh silently ignores a patch row it does not have, so a renamed row would drop that part of the lockdown), the SIGTERM exit 0 with a partial `final`, the hardcoded `/tmp` writable root, the session-log upload being on by default, that dsh reads only the cwd's `.env` and skips a directory there, the transport retry row, and the `credentials` row's `path` config. dsh 0.2.1-rc.2 ships the `credentials` row disabled, so the patch enables it.",
      "Model and effort are config, not flags. Each lane gets a run-owned `--patch` file at `<receipt>.provider/patch.yml` (directory 0700, file 0600) that pins `agent-default-model` to provider `deepseek-official`, the lane's model and, unless the effort is `default`, its `reasoningEffort`. dsh offers efforts `off`, `low`, `high` and `max`, and fails `medium` locally.",
      "Each lane runs with `DSH_HOME` set to its `<receipt>.provider/` directory, and the allowlist drops every inherited `DSH_*` name. dsh creates the `headless` profile there on first use with no network or `pnpm` install (about 70 ms), so no user layer (`profiles/headless/cordis.patch.yml`) and no home `.env` from the operator's dsh home loads. Measured with `--dump-config`: a planted user layer that redirected `llm-deepseek.config.baseURL`, moved `fs-sandbox.config.cwd`, picked another `agent-default-model` provider and disabled `bash-sandbox` changed nothing, and the composed tree was the default rows plus the lane's patch. The patch's `credentials` row points the credential store at `<the parent's DSH_HOME, else ~/.dsh>/.credentials.yaml`, read in place. A key kept only in the operator's `<DSH_HOME>/.env` no longer authenticates; store it or export `DEEPSEEK_API_KEY`.",
      "The patch pins `sandbox-policy` to `read-only` for a read-only lane and `workspace-write` for an `isolated-write` lane, with the lane's cwd as the workspace root, and `approval` to `ask`, which overrides `DSH_PERMISSION_MODE`. The other sandbox rows keep dsh's defaults, including the bash tool's own timeout; the runner adds no deadline. Seatbelt enforces it on macOS for bash and the file tools. Headless has no approval channel, so an escalation request fails closed. Bash keeps network access, and the `read` tool is not confined to the cwd.",
      "The bounded writer is confined to the worktree except for the system temporary folders. Measured with dsh 0.2.1-rc.2 on macOS in a linked worktree under the home directory, whose main repository and a sibling directory sat beside it: edits, shell writes and a Python run inside the worktree succeeded, and edit-tool and shell writes into the sibling, the main checkout, the main repository's shared `.git`, a home directory and through symlinks to the sibling and the main checkout all failed (`file access denied under workspace-write mode` or `Operation not permitted`). Shell writes into `/tmp` and `$TMPDIR` succeeded. dsh has no full-access writer here, so the runner refuses `isolated-write-full-access`.",
      "The patch turns off host and project rules (`AGENTS.md`, `CLAUDE.md` and their local variants), every skill root, the web, subagent and workflow tools, the session-title model call, the plugin inventory and the `dsh_session_log` upload. The goal, job, todo, plan-mode and `read_image` tools still load. dsh loads no project patch, hook or MCP file.",
      "A dsh lane runs in any cwd, and a `.env` file there applies as it is. dsh loads the cwd's `.env` at boot, before any config row applies, and no setting turns it off. dsh rejects only bootstrap names there (`DSH_*`, `DEEPSEEK_BASE_URL`, `PATH`, `NODE_OPTIONS`, `XDG_*`, `DYLD_*`, proxies), and every other value reaches the bash tool: a repository `.env` that sets `GIT_CONFIG_PARAMETERS` with `core.fsmonitor` makes a plain `git status` run the repository's script. dsh reads only the cwd's `.env`, not a parent's, and warns and skips a directory named `.env`, such as a Python virtual environment.",
      "dsh has no status command. The preflight is a turn on the lane's `DSH_HOME` with the lane's patch and then the shipped `providers/dsh-preflight.yml` patch, which points inference at a closed loopback port and turns off retries. The lane's patch already turns off the title call and the session-log upload. `TRANSPORT` passes with the fixed evidence `credential present; not validated`: it proves only that a key is stored or exported, not that the key works. `MISSING_CREDENTIAL` is `unauthenticated`/77, and any other output is `child-failed`/70.",
      "The reply is the `--json` stream's `final` text, accepted only after a `status` `turn_end` with `reason.kind` `completed`. SIGTERM exits 0 with a partial `final` and no `turn_end`, so that is `malformed-output`/65, never complete. Exit 130 after SIGINT is `cancelled`/130. A `turn_end` error is `child-failed`/70 with its code and message, except that DeepSeek's `The supported API model names are ...` refusal is `unavailable-model`/69. Usage sums the `step_end` usage; the session ID is the `session` event's. No cost is reported.",
      "No served model is reported, so the model proof is the pinned patch (`pinned-argv`).",
      "Server side: requests still carry the `x-deepseek-harness-user-id` and `x-deepseek-harness-session-id` headers. Whether DeepSeek keeps request content is not measured.",
    ],
  },
});
