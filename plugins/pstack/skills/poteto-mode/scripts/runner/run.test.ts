import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { childEnvironment, discoverSharedGitDir, runLane } from "./run.ts";
import { main } from "./cli.ts";
import { type LaneRequest, REGISTRY, resolveLane } from "./registry/index.ts";
import { access, type Lane, type ProviderAdapter } from "./registry/contract.ts";
import { devin } from "./providers/devin.ts";
import { opencode } from "./providers/opencode.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES } from "./providers/shared.ts";
import type { ProviderId } from "./registry/family.ts";
import type { AccessKind, RunnerReceipt } from "./types.ts";

let scratch = "";
let bin = "";
let previousPath: string | undefined;

function streamPath(path: string | null): string {
  if (path === null) throw new Error("expected a reserved stream artifact path");
  return path;
}

const fake = `#!/usr/bin/env bun
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const name = process.argv[1].split("/").at(-1);
const isPreflight =
  (name === "claude" && args[0] === "auth") ||
  (name === "codex" && args[0] === "login") ||
  (name === "grok" && args[0] === "models");
const stage = isPreflight ? "preflight" : "model";
const startedPath = isPreflight
  ? process.env.GROK_FAKE_PREFLIGHT_STARTED_PATH
  : process.env.GROK_FAKE_MODEL_STARTED_PATH;
if (startedPath) writeFileSync(startedPath, String(process.pid));
const cancelStage = process.env.GROK_FAKE_CANCEL_STAGE ??
  (process.env.GROK_FAKE_CANCEL === "1" ? "model" : "");
if (cancelStage === stage) {
  const stop = (signal) => {
    writeFileSync(process.env.GROK_FAKE_TERMINATED_PATH, signal);
    if (process.env.GROK_FAKE_IGNORE_SIGNAL !== "1") process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  writeFileSync(process.env.GROK_FAKE_STARTED_PATH, String(process.pid));
  await Bun.sleep(5_000);
}
const delay = Number(
  stage === "preflight"
    ? process.env.GROK_FAKE_PREFLIGHT_DELAY_MS ?? 0
    : process.env.GROK_FAKE_MODEL_DELAY_MS ?? 0
);
if (delay > 0) await Bun.sleep(delay);
if (process.env.GROK_FAKE_TIMEOUT === "1" && !args.includes("status") && !args.includes("models")) {
  await Bun.sleep(5_000);
}
if (name === "claude" && args[0] === "auth") {
  if (process.env.GROK_FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT === "1") {
    unlinkSync(process.argv[1]);
  }
  console.log(JSON.stringify({loggedIn:true}));
  process.exit(0);
}
if (name === "codex" && args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (name === "grok" && args[0] === "models") {
  if (process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH) {
    appendFileSync(process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH, "attempt\\n");
  }
  if (process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT !== undefined) {
    console.log(process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT);
    if (process.env.GROK_FAKE_GROK_PREFLIGHT_ERROR) console.error(process.env.GROK_FAKE_GROK_PREFLIGHT_ERROR);
    process.exit(0);
  }
  const transientMarker = process.env.GROK_FAKE_GROK_TRANSIENT_UNAUTH_PATH;
  if (transientMarker && !existsSync(transientMarker)) {
    writeFileSync(transientMarker, String(process.pid));
    console.log("Available models:\\n  * grok-4.6 (default)");
    console.error("You are not authenticated.");
    process.exit(0);
  }
  if (process.env.GROK_FAKE_GROK_MISSING_MODEL === "1") {
    console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.5 (default)");
    process.exit(0);
  }
  if (process.env.GROK_FAKE_GROK_UNAUTH === "1") {
    console.error("Not logged in. Run grok auth login.");
    process.exit(1);
  }
  console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.6 (default)");
  process.exit(0);
}
const modelIndex = args.findIndex((value) => value === "--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "unknown";
const reportedModel = model === "fable"
  ? "claude-fable-9-9"
  : model === "opus"
    ? "claude-opus-9"
    : model;
if (process.env.GROK_FAKE_INVALID_MODEL === "1") {
  console.error("The requested model is not supported with this account.");
  process.exit(1);
}
if (stage === "model" && process.env.GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS) {
  const seconds = Number(process.env.GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS) / 1000;
  const descendant = Bun.spawn(["/bin/sh", "-c", "sleep " + seconds], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (process.env.GROK_FAKE_DESCENDANT_PID_PATH) {
    writeFileSync(process.env.GROK_FAKE_DESCENDANT_PID_PATH, String(descendant.pid));
  }
  descendant.unref();
}
if (stage === "model" && process.env.GROK_FAKE_SELF_SIGNAL) {
  process.kill(process.pid, process.env.GROK_FAKE_SELF_SIGNAL);
  await Bun.sleep(5_000);
}
if (name === "claude") {
  console.log(JSON.stringify({result:"CLAUDE_OK",session_id:"c1",usage:{input_tokens:10,output_tokens:2},total_cost_usd:0.01,modelUsage:{[reportedModel]:{}}}));
} else if (name === "codex") {
  console.log(JSON.stringify({type:"thread.started",thread_id:"o1"}));
  console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"CODEX_OK"}}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:20,cached_input_tokens:5,output_tokens:3,reasoning_output_tokens:1}}));
} else if (process.env.GROK_FAKE_GROK_ERROR_RESULT === "1") {
  console.log(JSON.stringify({type:"system",subtype:"init",skills:Array(500).fill("skill-name")}));
  console.log(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,stop_reason:"cancelled",errors:["cancelled"]}));
} else {
  console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"progress"}]}}));
  console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"GROK_OK",session_id:"g1",usage:{input_tokens:30,output_tokens:4,total_tokens:34},total_cost_usd:0.02,modelUsage:{[model + "-build"]:{}}}));
}
if (process.env.GROK_FAKE_MODEL_EXITING_PATH) {
  writeFileSync(process.env.GROK_FAKE_MODEL_EXITING_PATH, String(process.pid));
}
`;

function makeExecutable(name: string): void {
  const path = join(bin, name);
  writeFileSync(path, fake);
  chmodSync(path, 0o755);
}

function options(provider: ProviderId, suffix: string = provider): LaneRequest {
  const parent = provider === "codex" ? "claude" : "codex";
  const model =
    provider === "claude"
      ? "fable"
      : provider === "codex"
        ? "gpt-5.6-sol"
        : "grok-4.6";
  return {
    parent,
    provider,
    model,
    effort: provider === "grok" ? "xhigh" : "max",
    mode: "read-only",
    promptPath: join(scratch, "prompt.md"),
    cwd: scratch,
    outputPath: join(scratch, `${suffix}.out`),
    receiptPath: join(scratch, `${suffix}.receipt.json`),
    timeoutMs: null,
  };
}

const laneOf = resolveLane;

function receipt(path: string): RunnerReceipt {
  return JSON.parse(readFileSync(path, "utf8")) as RunnerReceipt;
}

function gitEnv(ceiling: string | null = null): NodeJS.ProcessEnv {
  const env = childEnvironment(laneOf({ ...options("claude"), mode: "isolated-write" }));
  return ceiling === null ? env : { ...env, GIT_CEILING_DIRECTORIES: ceiling };
}

function git(env: NodeJS.ProcessEnv, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], {
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function gitRepository(env: NodeJS.ProcessEnv, path: string): void {
  git(env, "-c", "init.defaultBranch=main", "init", "-q", path);
  git(
    env, "-C", path, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
    "commit", "-q", "--allow-empty", "-m", "init"
  );
}

function runnerArgs(input: LaneRequest): string[] {
  const args = [
    join(import.meta.dir, "pstack-runner"),
    "--parent", input.parent,
    "--provider", input.provider,
    "--model", input.model,
    "--effort", input.effort,
    "--mode", input.mode,
    "--prompt", input.promptPath,
    "--cwd", input.cwd,
    "--output", input.outputPath,
    "--receipt", input.receiptPath,
  ];
  if (input.timeoutMs !== null) {
    args.push("--timeout", String(input.timeoutMs / 1_000));
  }
  return args;
}

async function waitFor(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function exitWithin(child: Bun.Subprocess, milliseconds: number): Promise<number> {
  const result = await Promise.race([
    child.exited,
    Bun.sleep(milliseconds).then(() => null),
  ]);
  if (result !== null) return result;
  child.kill("SIGKILL");
  await child.exited;
  throw new Error(`runner did not exit within ${milliseconds}ms`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for process ${pid} to exit`);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-runner-test-"));
  bin = join(scratch, "bin");
  mkdirSync(bin);
  writeFileSync(join(scratch, "prompt.md"), "Return the marker.");
  for (const name of ["claude", "codex", "grok"]) makeExecutable(name);
  previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}:${previousPath ?? ""}`;
  delete process.env.GROK_FAKE_TIMEOUT;
  delete process.env.GROK_FAKE_INVALID_MODEL;
  delete process.env.GROK_FAKE_CANCEL;
  delete process.env.GROK_FAKE_CANCEL_STAGE;
  delete process.env.GROK_FAKE_IGNORE_SIGNAL;
  delete process.env.GROK_FAKE_PREFLIGHT_DELAY_MS;
  delete process.env.GROK_FAKE_MODEL_DELAY_MS;
  delete process.env.GROK_FAKE_STARTED_PATH;
  delete process.env.GROK_FAKE_TERMINATED_PATH;
  delete process.env.GROK_FAKE_PREFLIGHT_STARTED_PATH;
  delete process.env.GROK_FAKE_MODEL_STARTED_PATH;
  delete process.env.GROK_FAKE_MODEL_EXITING_PATH;
  delete process.env.GROK_FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT;
  delete process.env.GROK_FAKE_GROK_UNAUTH;
  delete process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT;
  delete process.env.GROK_FAKE_GROK_PREFLIGHT_ERROR;
  delete process.env.GROK_FAKE_GROK_TRANSIENT_UNAUTH_PATH;
  delete process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH;
  delete process.env.GROK_FAKE_GROK_MISSING_MODEL;
  delete process.env.GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS;
  delete process.env.GROK_FAKE_DESCENDANT_PID_PATH;
  delete process.env.GROK_FAKE_SELF_SIGNAL;
  delete process.env.GROK_FAKE_GROK_ERROR_RESULT;
});

afterEach(() => {
  process.env.PATH = previousPath;
  delete process.env.GROK_FAKE_TIMEOUT;
  delete process.env.GROK_FAKE_INVALID_MODEL;
  delete process.env.GROK_FAKE_CANCEL;
  delete process.env.GROK_FAKE_CANCEL_STAGE;
  delete process.env.GROK_FAKE_IGNORE_SIGNAL;
  delete process.env.GROK_FAKE_PREFLIGHT_DELAY_MS;
  delete process.env.GROK_FAKE_MODEL_DELAY_MS;
  delete process.env.GROK_FAKE_STARTED_PATH;
  delete process.env.GROK_FAKE_TERMINATED_PATH;
  delete process.env.GROK_FAKE_PREFLIGHT_STARTED_PATH;
  delete process.env.GROK_FAKE_MODEL_STARTED_PATH;
  delete process.env.GROK_FAKE_MODEL_EXITING_PATH;
  delete process.env.GROK_FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT;
  delete process.env.GROK_FAKE_GROK_UNAUTH;
  delete process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT;
  delete process.env.GROK_FAKE_GROK_PREFLIGHT_ERROR;
  delete process.env.GROK_FAKE_GROK_TRANSIENT_UNAUTH_PATH;
  delete process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH;
  delete process.env.GROK_FAKE_GROK_MISSING_MODEL;
  delete process.env.GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS;
  delete process.env.GROK_FAKE_DESCENDANT_PID_PATH;
  delete process.env.GROK_FAKE_SELF_SIGNAL;
  delete process.env.GROK_FAKE_GROK_ERROR_RESULT;
  rmSync(scratch, { recursive: true, force: true });
});

describe("Codex parent sandbox diagnostics", () => {
  let previousNetworkDisabled: string | undefined;

  beforeEach(() => {
    previousNetworkDisabled = process.env.CODEX_SANDBOX_NETWORK_DISABLED;
    delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  });

  afterEach(() => {
    if (previousNetworkDisabled === undefined) {
      delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
    } else {
      process.env.CODEX_SANDBOX_NETWORK_DISABLED = previousNetworkDisabled;
    }
  });

  it("names likely Codex sandbox cause after child failure", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    const invoked = join(scratch, "model-invoked.json");
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
writeFileSync(${JSON.stringify(invoked)}, JSON.stringify({
  argv: process.argv.slice(2),
  networkDisabled: process.env.CODEX_SANDBOX_NETWORK_DISABLED ?? null,
}));
console.error("ENOTFOUND api.anthropic.com");
process.exit(1);
`);
    const input = options("claude");
    const result = await runLane(laneOf(input));
    const saved = receipt(input.receiptPath);
    expect(JSON.parse(readFileSync(invoked, "utf8"))).toMatchObject({
      argv: expect.arrayContaining(["--model", "fable"]),
      networkDisabled: null,
    });
    expect(result.exitCode).toBe(70);
    expect(saved.status).toBe("child-failed");
    expect(saved.exitCode).toBe(1);
    expect(saved.preflight.status).toBe("passed");
    expect(saved.error?.message).toContain("child exited with status 1");
    expect(saved.error?.message).toContain("likely cause: Codex parent sandbox has network disabled");
    expect(saved.error?.evidence).toStartWith("likely cause: Codex parent sandbox has network disabled");
    expect(saved.error?.evidence).toContain("ENOTFOUND api.anthropic.com");
    expect(saved.error?.message).toContain("provider-dispatch.md#host-and-parent-prerequisites");
    expect(saved.schemaVersion).toBe(1);
    expect(saved.model).toBe(input.model);
    expect(saved.effort as string).toBe(input.effort);
    expect(readFileSync(streamPath(saved.stderrPath), "utf8")).toBe("ENOTFOUND api.anthropic.com\n");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  for (const marker of [undefined, "0", "true"]) {
    it(`does not infer blocked network from marker ${marker}`, async () => {
      if (marker !== undefined) process.env.CODEX_SANDBOX_NETWORK_DISABLED = marker;
      writeFileSync(join(bin, "claude"), `#!/usr/bin/env bun
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
console.error("ENOTFOUND api.anthropic.com; EACCES local-state");
process.exit(1);
`);
      const result = await runLane(laneOf(options("claude")));
      expect(result.exitCode).toBe(70);
      expect(result.receipt.error).toEqual({
        message: "child exited with status 1",
        evidence: "ENOTFOUND api.anthropic.com; EACCES local-state",
      });
    });
  }

  it("does not blame a Claude parent even with the network marker", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    writeFileSync(join(bin, "grok"), `#!/usr/bin/env bun
if (process.argv[2] === "models") {
  console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.6 (default)");
  process.exit(0);
}
console.error("ENOTFOUND grok.com");
process.exit(1);
`);
    const result = await runLane(laneOf({ ...options("grok"), parent: "claude" }));
    expect(result.exitCode).toBe(70);
    expect(result.receipt.error).toEqual({
      message: "child exited with status 1",
      evidence: "ENOTFOUND grok.com",
    });
  });

  it("puts the hint ahead of bounded evidence without changing raw sidecars", async () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    const stderr = "startup warning\n".repeat(400) + "EACCES ~/.grok/managed_config.toml\n";
    writeFileSync(join(bin, "grok"), `#!/usr/bin/env bun
if (process.argv[2] === "models") {
  console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.6 (default)");
  process.exit(0);
}
process.stderr.write(${JSON.stringify(stderr)});
process.exit(1);
`);
    const input = { ...options("grok"), parent: "codex" as const };
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(70);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.error?.evidence).toStartWith("likely cause: Codex parent sandbox has network disabled");
    expect(result.receipt.error?.evidence?.length).toBe(4_000);
    expect(readFileSync(streamPath(result.receipt.stderrPath), "utf8")).toBe(stderr);
  });

  for (const scenario of ["api-error", "cancelled"]) {
    it(`preserves provider-reported ${scenario} ahead of any sandbox hint`, async () => {
      process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
      const reason = scenario === "api-error" ? "API unavailable" : "User cancelled the execution";
      const terminal = JSON.stringify({
        type: "result",
        subtype: scenario === "api-error" ? "api_error" : "error_during_execution",
        is_error: true,
        stop_reason: scenario === "api-error" ? "end_turn" : "cancelled",
        errors: [reason],
      });
      writeFileSync(join(bin, "grok"), `#!/usr/bin/env bun
if (process.argv[2] === "models") {
  console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.6 (default)");
  process.exit(0);
}
console.log(${JSON.stringify(terminal)});
console.error("startup warning".repeat(500));
process.exit(1);
`);
      const result = await runLane(laneOf({ ...options("grok"), parent: "codex" }));
      expect(result.exitCode).toBe(scenario === "api-error" ? 70 : 130);
      expect(result.receipt.status).toBe(scenario === "api-error" ? "child-failed" : "cancelled");
      expect(result.receipt.error?.message).toBe(reason);
      expect(result.receipt.error?.evidence).toStartWith(reason);
      expect(result.receipt.error?.evidence).not.toContain("Codex parent sandbox");
    });
  }

  for (const provider of ["claude", "grok"] as const) {
    it(`leaves successful ${provider} lanes unchanged with the marker`, async () => {
      process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
      const result = await runLane(laneOf({ ...options(provider), parent: "codex" }));
      expect(result.exitCode).toBe(0);
      expect(result.receipt.status).toBe("complete");
      expect(result.receipt.error).toBeNull();
    });
  }

  for (const status of ["unavailable-model", "unauthenticated", "timed-out"] as const) {
    it(`does not enrich ${status} with a sandbox hint`, async () => {
      process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
      const input = { ...options("grok"), parent: "codex" as const,
        timeoutMs: status === "timed-out" ? 150 : null };
      if (status === "unavailable-model") process.env.GROK_FAKE_INVALID_MODEL = "1";
      if (status === "unauthenticated") process.env.GROK_FAKE_GROK_UNAUTH = "1";
      if (status === "timed-out") process.env.GROK_FAKE_TIMEOUT = "1";
      const result = await runLane(laneOf(input));
      expect(result.receipt.status).toBe(status);
      expect(result.receipt.error?.message).not.toContain("Codex parent sandbox");
      expect(result.receipt.error?.evidence).not.toContain("Codex parent sandbox");
    }, 10_000);
  }
});

describe("issue78 terminal results", () => {
  for (const { auth, scenario } of ["subscription", "api-key"].flatMap((auth) =>
    ["cancel-zero", "cancel-nonzero", "api-error", "api-error-nonzero", "success-streams"]
      .map((scenario) => ({ auth, scenario }))
  )) {
    it(`issue78 ${scenario} (${auth})`, async () => {
      const input = options("grok");
      const reason = scenario.startsWith("api-error")
        ? "API unavailable"
        : "User cancelled the execution for tool run_terminal_command";
      const terminal = {
        type: "result",
        subtype: scenario.startsWith("api-error") ? "api_error"
          : scenario === "success-streams" ? "success" : "error_during_execution",
        is_error: scenario !== "success-streams",
        stop_reason: scenario.startsWith("cancel") ? "cancelled" : "end_turn",
        errors: [reason],
        result: "GROK_OK",
        session_id: "terminal-session",
        usage: { input_tokens: 30, output_tokens: 4 },
        total_cost_usd: 0.02,
        modelUsage: { "grok-4.6-build": {} },
      };
      const stdout = JSON.stringify(terminal) + "\n";
      const stderr = "startup warning\n".repeat(400) + "\n";
      const authentication = auth === "api-key" ? "You are using XAI_API_KEY."
        : "You are logged in with grok.com.";
      writeFileSync(join(bin, "grok"), `#!/usr/bin/env bun
if (process.argv[2] === "models") {
  console.log(${JSON.stringify(`${authentication}\nAvailable models:\n  * grok-4.6 (default)`)});
  process.exit(0);
}
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${scenario.endsWith("nonzero") ? 1 : 0});
`);
      const result = await runLane(laneOf(input));
      const saved = JSON.parse(readFileSync(input.receiptPath, "utf8"));
      expect(saved.status).toBe(scenario === "success-streams" ? "complete"
        : scenario.startsWith("api-error") ? "child-failed" : "cancelled");
      expect(result.exitCode).toBe(scenario === "success-streams" ? 0
        : scenario.startsWith("api-error") ? 70 : 130);
      expect(saved.exitCode).toBe(scenario.endsWith("nonzero") ? 1 : 0);
      expect(saved.reportedModel).toBe("grok-4.6-build");
      expect(saved.modelVerified).toBe(true);
      expect(saved.modelEvidence).toBe("provider-report");
      expect(saved.sessionId).toBe("terminal-session");
      expect(saved.usage).toEqual({ inputTokens: 30, outputTokens: 4 });
      expect(saved.costUsd).toBe(0.02);
      if (scenario !== "success-streams") {
        expect(saved.error.message).toBe(reason);
        expect(saved.error.evidence.startsWith(reason)).toBe(true);
        expect(saved.error.evidence.length).toBeLessThanOrEqual(4_000);
        expect(existsSync(input.outputPath)).toBe(false);
      }
      expect(saved.stdoutPath).toBe(`${input.receiptPath}.stdout`);
      expect(saved.stderrPath).toBe(`${input.receiptPath}.stderr`);
      expect(readFileSync(streamPath(saved.stdoutPath))).toEqual(Buffer.from(stdout));
      expect(readFileSync(streamPath(saved.stderrPath))).toEqual(Buffer.from(stderr));
      expect(statSync(streamPath(saved.stderrPath)).size).toBe(6_401);
      expect(saved.schemaVersion).toBe(1);
      for (const path of [saved.stdoutPath, saved.stderrPath, input.receiptPath]) {
        expect(statSync(streamPath(path)).mode & 0o777).toBe(0o600);
      }
    });
  }

  for (const stream of ["stdout", "stderr"]) {
    it(`rolls back reservations without overwriting an existing ${stream} sidecar`, async () => {
      const input = options("grok");
      const conflict = `${input.receiptPath}.${stream}`;
      writeFileSync(conflict, "operator evidence");
      await expect(runLane(laneOf(input))).rejects.toThrow();
      expect(readFileSync(conflict, "utf8")).toBe("operator evidence");
      for (const path of [input.outputPath, input.receiptPath,
        `${input.receiptPath}.${stream === "stdout" ? "stderr" : "stdout"}`]) {
        expect(existsSync(path)).toBe(false);
      }
    });

    it(`rejects a ${stream} sidecar colliding with the prompt or output`, async () => {
      const input = options("grok");
      const conflict = `${input.receiptPath}.${stream}`;
      writeFileSync(conflict, "operator prompt");
      await expect(runLane(laneOf({ ...input, promptPath: conflict }))).rejects.toThrow("must be distinct");
      expect(readFileSync(conflict, "utf8")).toBe("operator prompt");
      rmSync(conflict);
      await expect(runLane(laneOf({ ...input, outputPath: conflict }))).rejects.toThrow("must be distinct");
      for (const path of [input.outputPath, input.receiptPath,
        `${input.receiptPath}.stdout`, `${input.receiptPath}.stderr`]) {
        expect(existsSync(path)).toBe(false);
      }
    });
  }

  it("retains complete streams when writes are partial", async () => {
    const input = options("grok");
    const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false,
      result: "GROK_OK", modelUsage: { "grok-4.6-build": {} } }) + "\n";
    const stderr = "complete stderr despite partial writes\n";
    writeFileSync(join(bin, "grok"), fake.replace("const modelIndex =",
      `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(0);\nconst modelIndex =`));
    const originalWrite = fs.writeSync;
    let partialWrites = 0;
    const write = spyOn(fs, "writeSync").mockImplementation((descriptor, data, offset, length) => {
      if (typeof data === "string") return originalWrite(descriptor, data, offset);
      partialWrites++;
      return originalWrite(descriptor, data, offset,
        Math.min(typeof length === "number" ? length : data.byteLength, 7));
    });
    try {
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      expect(partialWrites).toBeGreaterThan(1);
      expect(readFileSync(streamPath(result.receipt.stdoutPath))).toEqual(Buffer.from(stdout));
      expect(readFileSync(streamPath(result.receipt.stderrPath))).toEqual(Buffer.from(stderr));
    } finally {
      write.mockRestore();
    }
  });

  it("terminalizes a sidecar write failure without waiting for the child", async () => {
    const input = options("grok");
    writeFileSync(join(bin, "grok"), fake.replace("const modelIndex =",
      'process.stdout.write("stream data"); await Bun.sleep(10_000);\nconst modelIndex ='));
    const originalWrite = fs.writeSync;
    const write = spyOn(fs, "writeSync").mockImplementation((descriptor, data, offset, length) => {
      if (typeof data === "string") return originalWrite(descriptor, data, offset);
      throw new Error("sidecar storage unavailable");
    });
    try {
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(70);
      expect(result.receipt.status).toBe("child-failed");
      expect(result.receipt.error?.evidence).toContain("sidecar storage unavailable");
      expect(existsSync(input.outputPath)).toBe(false);
      expect(existsSync(streamPath(result.receipt.stdoutPath))).toBe(true);
      expect(existsSync(streamPath(result.receipt.stderrPath))).toBe(true);
    } finally {
      write.mockRestore();
    }
  });

  it("retains undecodable stderr bytes rather than re-encoding captured text", async () => {
    const input = options("grok");
    const bytes = Buffer.from([0, 255, 195, 169, 13, 10]);
    writeFileSync(join(bin, "grok"), fake.replace("const modelIndex =",
      `process.stderr.write(Buffer.from(${JSON.stringify([...bytes])}));\nconst modelIndex =`));
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    expect(readFileSync(streamPath(result.receipt.stderrPath))).toEqual(bytes);
  });

  for (const exitCode of [0, 1]) {
    it(`keeps malformed terminal data distinct after child exit ${exitCode}`, async () => {
      const input = options("grok");
      const stdout = '{"type":"result","is_error":true}\n';
      writeFileSync(join(bin, "grok"), fake.replace(
        'console.log(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,stop_reason:"cancelled",errors:["cancelled"]}));',
        `process.stdout.write(${JSON.stringify(stdout)}); process.exit(${exitCode});`));
      process.env.GROK_FAKE_GROK_ERROR_RESULT = "1";
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode === 0 ? 65 : 70);
      expect(result.receipt).toMatchObject({
        status: exitCode === 0 ? "malformed-output" : "child-failed",
        exitCode, reportedModel: null, modelVerified: false,
        sessionId: null, error: { message: exitCode === 0
          ? "grok result did not contain a valid terminal status" : "child exited with status 1" },
      });
      expect(readFileSync(streamPath(result.receipt.stdoutPath), "utf8")).toEndWith(stdout);
      expect(existsSync(input.outputPath)).toBe(false);
    });
  }

  it("does not read authentication from malformed terminal data after a nonzero exit", async () => {
    const input = options("grok");
    writeFileSync(join(bin, "grok"), fake.replace("const modelIndex =",
      'process.stdout.write(\'{"type":"result","is_error":true}\\n\'); console.error("Not logged in. Run grok auth login."); process.exit(1);\nconst modelIndex ='));
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(70);
    expect(result.receipt).toMatchObject({
      status: "child-failed", exitCode: 1, error: { message: "child exited with status 1" },
    });
    expect(result.receipt.error?.evidence).toContain("Not logged in.");
  });

  for (const stdout of ['{"type":"system","subtype":"init"}\n', "startup failed\n"]) {
    for (const exitCode of [0, 1]) {
      it(`handles missing Grok terminal output ${JSON.stringify(stdout)} after exit ${exitCode}`, async () => {
        const input = options("grok");
        const stderr = "sandbox startup refused\n";
        writeFileSync(join(bin, "grok"), fake.replace("const modelIndex =",
          `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${exitCode});\nconst modelIndex =`));
        const result = await runLane(laneOf(input));
        expect(result.exitCode).toBe(exitCode === 0 ? 65 : 70);
        expect(result.receipt).toMatchObject({
          status: exitCode === 0 ? "malformed-output" : "child-failed",
          exitCode, reportedModel: null, sessionId: null,
        });
        expect(readFileSync(streamPath(result.receipt.stdoutPath), "utf8")).toBe(stdout);
        expect(readFileSync(streamPath(result.receipt.stderrPath), "utf8")).toBe(stderr);
        expect(existsSync(input.outputPath)).toBe(false);
      });
    }
  }

  it("does not invent metadata for a valid provider failure", async () => {
    const input = options("grok");
    writeFileSync(join(bin, "grok"), fake.replace(
      'console.log(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,stop_reason:"cancelled",errors:["cancelled"]}));',
      'console.log(JSON.stringify({type:"result",subtype:"api_error",is_error:true,errors:["API unavailable"]})); process.exit(1);'));
    process.env.GROK_FAKE_GROK_ERROR_RESULT = "1";
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(70);
    expect(result.receipt).toMatchObject({
      status: "child-failed", exitCode: 1, reportedModel: null, modelVerified: false,
      modelEvidence: null, sessionId: null, usage: null, costUsd: null,
      error: { message: "API unavailable" },
    });
    expect(readFileSync(streamPath(result.receipt.stdoutPath), "utf8")).toContain("api_error");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("retains strict model verification for successful Grok results", async () => {
    const input = options("grok");
    writeFileSync(join(bin, "grok"), fake.replace('[model + "-build"]', '["grok-unexpected"]'));
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(65);
    expect(result.receipt).toMatchObject({ status: "malformed-output", modelVerified: false });
    expect(result.receipt.error?.message).toBe("requested model grok-4.6 was not reported by grok");
    expect(readFileSync(streamPath(result.receipt.stdoutPath), "utf8")).toContain("grok-unexpected");
    expect(existsSync(input.outputPath)).toBe(false);
  });
});

describe("runLane", () => {
  for (const startup of ["dotenv", "bunfig", "bun-options", "node-options", "combined", "hostile-path", "bare-name"]) {
    it(`shipped launcher startup isolation: ${startup}`, async () => {
      const input = options("codex", startup);
      writeFileSync(input.promptPath, "Return the marker.\n".repeat(100_000));
      const captured = join(scratch, "provider-env.txt");
      const capturedPrompt = join(scratch, "provider-prompt.txt");
      const bunPreload = join(scratch, "bun-preload.ran");
      const nodePreload = join(scratch, "node-preload.ran");
      const env: Record<string, string> = {
        PATH: process.env.PATH!,
        PSTACK_ENV_CAPTURE: captured,
        PSTACK_PROMPT_CAPTURE: capturedPrompt,
        PSTACK_INHERITED_ENV_SENTINEL: "inherited-from-parent",
      };
      if (startup === "dotenv" || startup === "combined") {
        writeFileSync(join(scratch, ".env"), "PSTACK_PROJECT_ENV_SENTINEL=loaded-from-project-dotenv\n");
        writeFileSync(join(scratch, ".env.local"), "PSTACK_LOCAL_ENV_SENTINEL=loaded-from-project-local-dotenv\n");
      }
      if (startup === "bunfig" || startup === "combined") {
        writeFileSync(join(scratch, "bunfig.toml"), 'preload = ["./project-preload.ts"]\n');
        writeFileSync(join(scratch, "project-preload.ts"),
          `await Bun.write(${JSON.stringify(bunPreload)}, "project preload ran");\n`);
      }
      if (startup === "bun-options" || startup === "combined") {
        writeFileSync(join(scratch, "startup.env"), "PSTACK_PROJECT_ENV_SENTINEL=loaded-from-bun-options\n");
        env.BUN_OPTIONS = "--env-file=./startup.env";
      }
      if (startup === "node-options" || startup === "combined") {
        writeFileSync(join(scratch, "project-preload.cjs"),
          `require("node:fs").writeFileSync(${JSON.stringify(nodePreload)}, "node preload ran");\n`);
        env.NODE_OPTIONS = "--require=./project-preload.cjs";
      }
      writeFileSync(join(bin, "codex"), `#!/bin/sh
if [ "$1" = "login" ]; then
  printf '%s\\n' 'Logged in using ChatGPT'
  exit 0
fi
cat > "$PSTACK_PROMPT_CAPTURE"
printf '%s\\n' "\${PSTACK_PROJECT_ENV_SENTINEL-unset}" "\${PSTACK_LOCAL_ENV_SENTINEL-unset}" "\${PSTACK_INHERITED_ENV_SENTINEL-unset}" "\${BUN_OPTIONS-unset}" "\${NODE_OPTIONS-unset}" > "$PSTACK_ENV_CAPTURE"
printf '%s\\n' '{"type":"thread.started","thread_id":"isolated"}' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_OK"}}' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
`);
      chmodSync(join(bin, "codex"), 0o755);
      const helperSentinel = join(scratch, "helper.ran");
      if (startup === "hostile-path") {
        for (const name of ["env", "dirname", "readlink"]) {
          writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' '${name}' > "${helperSentinel}"\nexit 1\n`);
          chmodSync(join(bin, name), 0o755);
        }
      }
      const runner = Bun.spawn(startup === "bare-name"
        ? ["/bin/sh", "pstack-runner", ...runnerArgs(input).slice(1)]
        : runnerArgs(input), {
        cwd: startup === "bare-name" ? import.meta.dir : scratch,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = new Response(runner.stdout).text();
      const stderr = new Response(runner.stderr).text();
      const exitCode = await exitWithin(runner, 3_000);
      const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
      expect(exitCode, JSON.stringify({
        stdout: stdoutText,
        stderr: stderrText,
        receipt: existsSync(input.receiptPath) ? receipt(input.receiptPath) : null,
      })).toBe(0);
      expect(readFileSync(capturedPrompt, "utf8")).toBe(readFileSync(input.promptPath, "utf8"));
      expect(readFileSync(captured, "utf8")).toBe("unset\nunset\ninherited-from-parent\nunset\nunset\n");
      expect(existsSync(bunPreload)).toBe(false);
      expect(existsSync(nodePreload)).toBe(false);
      expect(existsSync(helperSentinel)).toBe(false);
      expect(readFileSync(input.outputPath, "utf8")).toContain("CODEX_OK");
      expect(receipt(input.receiptPath)).toMatchObject({ status: "complete" });
    });
  }

  for (const provider of ["claude", "codex", "grok"] as const) {
    it(`executes and receipts the ${provider} external lane`, async () => {
      const input = options(provider);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      expect(readFileSync(input.outputPath, "utf8")).toContain(
        provider.toUpperCase()
      );
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "complete",
        provider,
        model: input.model,
        modelVerified: provider !== "codex",
        modelEvidence: provider === "codex" ? "pinned-argv" : "provider-report",
        preflight: { status: "passed" },
      });
      const saved = receipt(input.receiptPath);
      expect(readFileSync(streamPath(saved.stdoutPath), "utf8")).toContain(provider.toUpperCase());
      expect(readFileSync(streamPath(saved.stderrPath))).toEqual(Buffer.alloc(0));
      for (const path of [saved.stdoutPath, saved.stderrPath]) {
        expect(statSync(streamPath(path)).mode & 0o777).toBe(0o600);
      }
      if (provider === "claude") {
        expect(receipt(input.receiptPath).reportedModel).toBe("claude-fable-9-9");
      }
    });
  }

  it("records the writer sandbox the lane ran with: none for a reader, bounded by default, and full access on opt-in", async () => {
    const lanes = [
      [options("codex", "sandbox-reader"), null, "read-only"],
      [{ ...options("codex", "sandbox-bounded"), mode: "isolated-write" }, "bounded", "workspace-write"],
      [{ ...options("codex", "sandbox-full"), mode: "isolated-write", writerSandbox: "full-access" }, "full-access", "danger-full-access"],
    ] as const;
    for (const [input, writerSandbox, sandbox] of lanes) {
      expect((await runLane(laneOf(input))).exitCode).toBe(0);
      const saved = receipt(input.receiptPath);
      expect([saved.status, saved.writerSandbox]).toEqual(["complete", writerSandbox]);
      expect(saved.argv.slice(saved.argv.indexOf("--sandbox"), saved.argv.indexOf("--sandbox") + 2)).toEqual(["--sandbox", sandbox]);
    }
  });

  it("records the opted-in writer sandbox on a failure receipt", async () => {
    process.env.PATH = join(scratch, "empty-bin");
    mkdirSync(process.env.PATH);
    const input = { ...options("codex", "sandbox-missing-cli"), mode: "isolated-write", writerSandbox: "full-access" };
    expect((await runLane(laneOf(input))).exitCode).toBe(69);
    expect(receipt(input.receiptPath)).toMatchObject({ status: "unavailable-cli", writerSandbox: "full-access" });
  });

  it("records Codex's exact argv without fabricating a reported model", async () => {
    const input = options("codex");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      model: "gpt-5.6-sol",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
    });
  });

  it("keeps Grok's terminal cancellation reason in bounded evidence", async () => {
    process.env.GROK_FAKE_GROK_ERROR_RESULT = "1";
    const input = options("grok", "grok-error-result");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(130);
    expect(existsSync(input.outputPath)).toBe(false);
    const recorded = receipt(input.receiptPath);
    expect(recorded).toMatchObject({
      status: "cancelled",
      exitCode: 0,
      error: { message: "cancelled" },
    });
    expect(recorded.error?.evidence).toStartWith("cancelled");
    expect(recorded.error?.evidence.length).toBeLessThanOrEqual(4_000);
  });

  it("classifies an unavailable model without falling back", async () => {
    process.env.GROK_FAKE_INVALID_MODEL = "1";
    const input = options("codex");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(69);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "unavailable-model",
      model: "gpt-5.6-sol",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
    });
  });

  for (const text of [
    "reviewing the authentication middleware",
    "not logged in",
    "unauthenticated",
    "sign in",
    "login required",
  ]) {
    for (const stream of ["stdout", "stderr"] as const) {
      it(`classifies a failed model call mentioning "${text}" on ${stream} as child-failed`, async () => {
        writeFileSync(join(bin, "codex"), `#!/usr/bin/env bun
if (process.argv[2] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
console.${stream === "stdout" ? "log" : "error"}(${JSON.stringify(text)});
process.exit(1);
`);
        const input = options("codex");
        const result = await runLane(laneOf(input));
        expect(result.exitCode).toBe(70);
        expect(result.receipt).toMatchObject({
          status: "child-failed",
          exitCode: 1,
          preflight: { status: "passed" },
          error: { message: "child exited with status 1" },
        });
        expect(result.receipt.error?.evidence).toContain(text);
      });
    }
  }

  it("executes Grok after one API-key-authenticated exact-model preflight", async () => {
    process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT = "You are using XAI_API_KEY.\nAvailable models:\n  * [grok-4.6] (default)";
    const preflightLog = join(scratch, "grok-api-key.log");
    const modelStarted = join(scratch, "grok-api-key.started");
    process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-api-key");
    const result = await runLane(laneOf(input));

    expect(result.exitCode).toBe(0);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(existsSync(modelStarted)).toBe(true);
    expect(readFileSync(input.outputPath, "utf8")).toBe("GROK_OK");
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete", model: "grok-4.6", reportedModel: "grok-4.6-build",
      modelVerified: true, modelEvidence: "provider-report",
      preflight: { status: "passed", evidence: "authenticated; model grok-4.6 available" },
    });
  }, 10_000);

  for (const auth of ["You are using XAI_API_KEY.", "You are logged in."]) {
    it(`rejects an explicitly unsupported Grok model despite ${auth}`, async () => {
      process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT = `${auth}\nAvailable models:\n  * grok-4.6`;
      process.env.GROK_FAKE_GROK_PREFLIGHT_ERROR = "model grok-4.6 is not supported";
      const preflightLog = join(scratch, "grok-unsupported.log");
      const modelStarted = join(scratch, "grok-unsupported.started");
      process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
      process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
      const input = options("grok", "grok-unsupported");
      const result = await runLane(laneOf(input));

      expect(result.exitCode).toBe(69);
      expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
      expect(existsSync(modelStarted)).toBe(false);
      expect(existsSync(input.outputPath)).toBe(false);
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "unavailable-model", model: "grok-4.6", preflight: { status: "failed" },
      });
      expect(receipt(input.receiptPath).preflight.evidence).toContain("not supported");
    });
  }

  for (const failure of ["unauthenticated", "You are not authenticated."]) {
    it(`fails closed on contradictory Grok API-key authentication: ${failure}`, async () => {
      process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT = "You are using XAI_API_KEY.\nYou are logged in.\nAvailable models:\n  * grok-4.6";
      process.env.GROK_FAKE_GROK_PREFLIGHT_ERROR = failure;
      const preflightLog = join(scratch, "grok-api-key-unauth.log");
      const modelStarted = join(scratch, "grok-api-key-unauth.started");
      process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
      process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
      const input = options("grok", "grok-api-key-unauth");
      const result = await runLane(laneOf(input));

      expect(result.exitCode).toBe(77);
      expect(readFileSync(preflightLog, "utf8")).toBe("attempt\nattempt\n");
      expect(existsSync(modelStarted)).toBe(false);
      expect(existsSync(input.outputPath)).toBe(false);
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "unauthenticated", preflight: { status: "failed" },
      });
      expect(receipt(input.receiptPath).preflight.evidence).toContain("attempt 2 failed");
    }, 10_000);
  }

  for (const listed of ["grok-4.60", "xgrok-4.6", "grok-4.6-build", "grok-4x6"]) {
    it(`does not accept neighboring Grok model token ${listed}`, async () => {
      process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT = `You are logged in.\nAvailable models:\n  * ${listed}`;
      const preflightLog = join(scratch, "grok-neighbor.log");
      const modelStarted = join(scratch, "grok-neighbor.started");
      process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
      process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
      const input = options("grok", "grok-neighbor");
      const result = await runLane(laneOf(input));

      expect(result.exitCode).toBe(69);
      expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
      expect(existsSync(modelStarted)).toBe(false);
      expect(existsSync(input.outputPath)).toBe(false);
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "unavailable-model", preflight: { status: "failed" },
      });
    });
  }

  for (const { name, output, passes } of [
    {
      name: "a deployment-key login",
      output: "You are authenticated via deployment key.\nAvailable models:\n  * grok-4.7 (default)",
      passes: true,
    },
    {
      name: "an unlisted default model",
      output: "You are logged in with grok.com.\nDefault model: grok-4.7 (not in the list below)\n"
        + "Available models:\n  * grok-4.6",
      passes: false,
    },
    {
      name: "a model named only on the default line",
      output: "You are logged in.\nDefault model: grok-4.7\nAvailable models:\n  * grok-4.5 (default)",
      passes: false,
    },
    {
      name: "a neighbouring listed slug",
      output: "You are logged in.\nAvailable models:\n  * grok-4.7-mini (default)",
      passes: false,
    },
    { name: "a missing models header", output: "You are logged in.\n  * grok-4.7", passes: false },
  ]) {
    it(`${passes ? "accepts" : "rejects"} a Grok preflight with ${name}`, async () => {
      process.env.GROK_FAKE_GROK_PREFLIGHT_OUTPUT = output;
      const preflightLog = join(scratch, "grok-listing.log");
      const modelStarted = join(scratch, "grok-listing.started");
      process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
      process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
      const input = { ...options("grok", "grok-listing"), model: "grok-4.7" };
      const result = await runLane(laneOf(input));

      expect(result.exitCode).toBe(passes ? 0 : 69);
      expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
      expect(existsSync(modelStarted)).toBe(passes);
      expect(receipt(input.receiptPath)).toMatchObject(passes
        ? { status: "complete", reportedModel: "grok-4.7-build", preflight: { status: "passed" } }
        : { status: "unavailable-model", preflight: { status: "failed" } });
    });
  }

  for (const mode of ["read-only", "isolated-write"] as const) {
    it(`gives the Grok preflight and model call only allowlisted variables (${mode})`, async () => {
      const captured = join(scratch, "grok-env");
      writeFileSync(join(bin, "grok"), fake.replace("const startedPath =",
        `appendFileSync(${JSON.stringify(captured)}, stage + " " + Object.keys(process.env)
  .filter((name) => name.includes("PSTACK_CANARY")).sort().join(",") + "\\n");
const startedPath =`));
      process.env.PSTACK_CANARY = "do-not-leak";
      process.env.GROK_PSTACK_CANARY = "kept";
      try {
        const input = { ...options("grok", `grok-env-${mode}`), mode };
        const result = await runLane(laneOf(input));
        expect(result.exitCode).toBe(0);
        expect(readFileSync(captured, "utf8")).toBe(
          "preflight GROK_PSTACK_CANARY\nmodel GROK_PSTACK_CANARY\n"
        );
      } finally {
        delete process.env.PSTACK_CANARY;
        delete process.env.GROK_PSTACK_CANARY;
      }
    });
  }

  it("retries a contradictory Grok authentication preflight before running the model", async () => {
    const transientMarker = join(scratch, "grok-transient-unauth.seen");
    const preflightLog = join(scratch, "grok-transient-unauth.log");
    process.env.GROK_FAKE_GROK_TRANSIENT_UNAUTH_PATH = transientMarker;
    process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-transient-model.started");
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-transient-unauth");
    const result = await runLane(laneOf(input));

    expect(result.exitCode).toBe(0);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\nattempt\n");
    expect(existsSync(modelStarted)).toBe(true);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      preflight: { status: "passed" },
    });
    expect(receipt(input.receiptPath).preflight.evidence).toContain(
      "You are not authenticated."
    );
    expect(receipt(input.receiptPath).preflight.evidence).toContain(
      "attempt 2 passed"
    );
  }, 10_000);

  it("classifies Grok authentication failure after two consecutive preflights", async () => {
    process.env.GROK_FAKE_GROK_UNAUTH = "1";
    const preflightLog = join(scratch, "grok-unauthenticated.log");
    process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-model.started");
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-unauthenticated");
    const result = await runLane(laneOf(input));

    expect(result.exitCode).toBe(77);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\nattempt\n");
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "unauthenticated",
      preflight: { status: "failed" },
    });
    expect(receipt(input.receiptPath).preflight.evidence).toContain(
      "attempt 2 failed"
    );
  }, 10_000);

  it("counts the Grok retry delay against the wrapper deadline", async () => {
    const transientMarker = join(scratch, "grok-deadline-unauth.seen");
    const preflightLog = join(scratch, "grok-deadline-unauth.log");
    process.env.GROK_FAKE_GROK_TRANSIENT_UNAUTH_PATH = transientMarker;
    process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-deadline-model.started");
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = {
      ...options("grok", "grok-preflight-retry-deadline"),
      timeoutMs: 700,
    };
    const result = await runLane(laneOf(input));
    const recorded = receipt(input.receiptPath);

    expect(result.exitCode).toBe(124);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(existsSync(modelStarted)).toBe(false);
    expect(recorded).toMatchObject({
      status: "timed-out",
      preflight: { status: "timed-out" },
    });
    expect(recorded.preflight.evidence).toContain("You are not authenticated.");
    expect(recorded.elapsedMs).toBeLessThan(1_200);
  });

  it("cancels during the Grok retry delay without starting another preflight", async () => {
    const transientMarker = join(scratch, "grok-cancel-unauth.pid");
    const preflightLog = join(scratch, "grok-cancel-unauth.log");
    const input = options("grok", "grok-preflight-retry-cancelled");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_GROK_TRANSIENT_UNAUTH_PATH: transientMarker,
        GROK_FAKE_GROK_PREFLIGHT_LOG_PATH: preflightLog,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(transientMarker);
    await waitForExit(Number(readFileSync(transientMarker, "utf8")));
    await Bun.sleep(200);
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 2_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      preflight: { status: "cancelled" },
      error: {
        message: "launcher received SIGTERM during authentication preflight retry delay",
      },
    });
  });

  it("does not retry a Grok preflight with a missing model", async () => {
    process.env.GROK_FAKE_GROK_MISSING_MODEL = "1";
    const preflightLog = join(scratch, "grok-missing-model.log");
    process.env.GROK_FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-missing-model.started");
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-missing-model");
    const result = await runLane(laneOf(input));

    expect(result.exitCode).toBe(69);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "unavailable-model",
      preflight: { status: "failed" },
    });
  });

  it("kills a timed-out child and preserves a failure receipt", async () => {
    process.env.GROK_FAKE_TIMEOUT = "1";
    const input = { ...options("claude"), timeoutMs: 30 };
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(124);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath).status).toBe("timed-out");
  });

  it("does not spawn the model when preflight exhausts the wrapper deadline", async () => {
    const modelStarted = join(scratch, "deadline-model.started");
    const input = { ...options("claude", "preflight-deadline"), timeoutMs: 300 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_PREFLIGHT_DELAY_MS: "1000",
        GROK_FAKE_MODEL_STARTED_PATH: modelStarted,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      signal: "SIGTERM",
      preflight: { status: "timed-out" },
    });
  });

  it("lets a delayed wrapper lane finish when timeout is omitted", async () => {
    const input = options("claude", "unbounded-default");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env, GROK_FAKE_MODEL_DELAY_MS: "400" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 3_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      signal: null,
    });
    expect(receipt(input.receiptPath).elapsedMs).toBeGreaterThanOrEqual(400);
  });

  it("keeps a very long explicit deadline without timer overflow", async () => {
    const input = {
      ...options("claude", "long-runtime-deadline"),
      timeoutMs: 2_147_483_648,
    };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env, GROK_FAKE_MODEL_DELAY_MS: "100" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      signal: null,
      exitCode: 0,
    });
  });

  it("counts wrapper import and parsing time against an explicit deadline", async () => {
    const preflightStarted = join(scratch, "expired-preflight.started");
    const modelStarted = join(scratch, "expired-model.started");
    process.env.GROK_FAKE_PREFLIGHT_STARTED_PATH = preflightStarted;
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = { ...options("claude", "expired-at-entry"), timeoutMs: 100 };
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await main(
      runnerArgs(input).slice(1),
      Date.now() - 1_000,
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      }
    );

    expect(exitCode).toBe(124);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain('"status":"timed-out"');
    expect(existsSync(preflightStarted)).toBe(false);
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      preflight: { status: "timed-out" },
    });
  });

  it("spends one explicit deadline across preflight and model execution", async () => {
    process.env.GROK_FAKE_PREFLIGHT_DELAY_MS = "1200";
    process.env.GROK_FAKE_MODEL_DELAY_MS = "1200";
    const input = { ...options("claude"), timeoutMs: 1_500 };
    const result = await runLane(laneOf(input));
    const recorded = receipt(input.receiptPath);

    expect(result.exitCode).toBe(124);
    expect(recorded.status).toBe("timed-out");
    expect(recorded.preflight.status).toBe("passed");
    expect(recorded.elapsedMs).toBeLessThan(2_100);
  });

  it("bounds a descendant-held pipe by the explicit deadline without fabricating a signal", async () => {
    const descendantPidPath = join(scratch, "deadline-descendant.pid");
    const input = { ...options("claude", "deadline-drain"), timeoutMs: 700 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        GROK_FAKE_DESCENDANT_PID_PATH: descendantPidPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    const recorded = receipt(input.receiptPath);
    expect(recorded).toMatchObject({
      status: "timed-out",
      exitCode: 0,
      signal: null,
      preflight: { status: "passed" },
    });
    expect(recorded.elapsedMs).toBeLessThan(1_500);

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("does not claim a signal was sent to an already signal-reaped child", async () => {
    const descendantPidPath = join(scratch, "signalled-descendant.pid");
    const input = { ...options("claude", "signalled-drain"), timeoutMs: 700 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        GROK_FAKE_DESCENDANT_PID_PATH: descendantPidPath,
        GROK_FAKE_SELF_SIGNAL: "SIGTERM",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      exitCode: 143,
      signal: null,
      preflight: { status: "passed" },
    });

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("lets manual cancellation end a post-exit pipe drain without a default timeout", async () => {
    const descendantPidPath = join(scratch, "cancel-descendant.pid");
    const modelExiting = join(scratch, "cancel-model.exiting");
    const input = options("claude", "cancel-drain");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        GROK_FAKE_DESCENDANT_PID_PATH: descendantPidPath,
        GROK_FAKE_MODEL_EXITING_PATH: modelExiting,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(modelExiting);
    await waitForExit(Number(readFileSync(modelExiting, "utf8")));
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 2_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      exitCode: 0,
      signal: null,
      preflight: { status: "passed" },
      error: { message: "launcher received SIGTERM after child exited" },
    });

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("clears a losing long-deadline timer when the shipped wrapper succeeds", async () => {
    const input = { ...options("claude", "long-deadline"), timeoutMs: 60_000 };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 3_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath).status).toBe("complete");
  });

  it("cancels a preflight with SIGINT and writes a terminal receipt", async () => {
    const input = options("claude", "preflight-cancelled");
    const started = join(scratch, "preflight-child.started");
    const terminated = join(scratch, "preflight-child.terminated");
    const isolatedRunner = join(scratch, "isolated-runner");
    cpSync(import.meta.dir, isolatedRunner, { recursive: true });
    const runner = Bun.spawn([
      join(isolatedRunner, "pstack-runner"),
      ...runnerArgs(input).slice(1),
    ], {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_CANCEL_STAGE: "preflight",
        GROK_FAKE_STARTED_PATH: started,
        GROK_FAKE_TERMINATED_PATH: terminated,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    runner.kill("SIGINT");

    expect(await exitWithin(runner, 3_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGINT");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGINT",
      preflight: { status: "cancelled" },
    });
  });

  it("reaps the child and exits after repeated cancellation with a long deadline", async () => {
    const input = { ...options("codex", "repeated-cancel"), timeoutMs: 60_000 };
    const started = join(scratch, "repeated-child.started");
    const terminated = join(scratch, "repeated-child.terminated");
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_CANCEL: "1",
        GROK_FAKE_IGNORE_SIGNAL: "1",
        GROK_FAKE_STARTED_PATH: started,
        GROK_FAKE_TERMINATED_PATH: terminated,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    const childPid = Number(readFileSync(started, "utf8"));
    runner.kill("SIGTERM");
    await Bun.sleep(100);
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 4_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGTERM");
    expect(processIsAlive(childPid)).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGTERM",
    });
  });

  it("forwards cancellation, preserves its receipt, and permits a new attempt", async () => {
    const input = options("codex", "cancelled");
    const started = join(scratch, "cancelled-child.started");
    const terminated = join(scratch, "cancelled-child.terminated");
    const env = {
      ...process.env,
      GROK_FAKE_CANCEL: "1",
      GROK_FAKE_STARTED_PATH: started,
      GROK_FAKE_TERMINATED_PATH: terminated,
    };
    const runner = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    runner.kill("SIGTERM");

    expect(await runner.exited).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGTERM");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGTERM",
      exitCode: 0,
      error: { message: "launcher received SIGTERM; signal was sent to child" },
    });

    const samePaths = Bun.spawn(runnerArgs(input), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sameStdout = new Response(samePaths.stdout).text();
    const sameStderr = new Response(samePaths.stderr).text();
    expect(await samePaths.exited).toBe(64);
    await Promise.all([sameStdout, sameStderr]);
    expect(receipt(input.receiptPath).status).toBe("cancelled");

    const retry = options("codex", "cancelled-retry");
    const result = await runLane(laneOf(retry));
    expect(result.exitCode).toBe(0);
    expect(receipt(retry.receiptPath).status).toBe("complete");
  });

  it("reports a missing CLI without fabricating output", async () => {
    process.env.PATH = join(scratch, "empty-bin");
    mkdirSync(process.env.PATH);
    const input = options("grok");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(69);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath).status).toBe("unavailable-cli");
  });

  it("runs simultaneous same-provider lanes only into their unique paths", async () => {
    const first = options("grok", "first");
    const second = options("grok", "second");
    const results = await Promise.all([runLane(laneOf(first)), runLane(laneOf(second))]);
    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(first.outputPath).not.toBe(second.outputPath);
    expect(receipt(first.receiptPath).sessionId).toBe("g1");
    expect(receipt(second.receiptPath).sessionId).toBe("g1");
  });

  it("refuses a second writer for an already-reserved path", async () => {
    const input = options("claude");
    writeFileSync(input.outputPath, "owned");
    await expect(runLane(laneOf(input))).rejects.toThrow();
    expect(readFileSync(input.outputPath, "utf8")).toBe("owned");
    expect(existsSync(input.receiptPath)).toBe(false);
  });

  it("terminalizes catchable failures after reserving output paths", async () => {
    const unreadable = options("claude", "unreadable-prompt");
    chmodSync(unreadable.promptPath, 0o000);
    const unreadableRunner = Bun.spawn(runnerArgs(unreadable), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const unreadableStdout = new Response(unreadableRunner.stdout).text();
    const unreadableStderr = new Response(unreadableRunner.stderr).text();
    expect(await unreadableRunner.exited).toBe(70);
    await Promise.all([unreadableStdout, unreadableStderr]);
    chmodSync(unreadable.promptPath, 0o600);

    const preservedReceipt = readFileSync(unreadable.receiptPath, "utf8");
    expect(statSync(unreadable.receiptPath).size).toBeGreaterThan(0);
    expect(existsSync(unreadable.outputPath)).toBe(false);
    expect(receipt(unreadable.receiptPath)).toMatchObject({
      status: "child-failed",
      preflight: { status: "not-run" },
      error: { message: "launcher failed after reserving output paths" },
    });

    const samePaths = Bun.spawn(runnerArgs(unreadable), {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sameStdout = new Response(samePaths.stdout).text();
    const sameStderr = new Response(samePaths.stderr).text();
    expect(await samePaths.exited).toBe(64);
    await Promise.all([sameStdout, sameStderr]);
    expect(readFileSync(unreadable.receiptPath, "utf8")).toBe(preservedReceipt);

    const spawnFailure = options("claude", "spawn-failure");
    const modelStarted = join(scratch, "spawn-failure-model.started");
    const spawnRunner = Bun.spawn(runnerArgs(spawnFailure), {
      cwd: scratch,
      env: {
        ...process.env,
        GROK_FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT: "1",
        GROK_FAKE_MODEL_STARTED_PATH: modelStarted,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const spawnStdout = new Response(spawnRunner.stdout).text();
    const spawnStderr = new Response(spawnRunner.stderr).text();
    expect(await spawnRunner.exited).toBe(70);
    await Promise.all([spawnStdout, spawnStderr]);
    expect(existsSync(modelStarted)).toBe(false);
    expect(existsSync(spawnFailure.outputPath)).toBe(false);
    expect(receipt(spawnFailure.receiptPath)).toMatchObject({
      status: "child-failed",
      preflight: { status: "passed" },
    });

    makeExecutable("claude");
    const retry = options("claude", "post-reservation-retry");
    expect((await runLane(laneOf(retry))).exitCode).toBe(0);
    expect(receipt(retry.receiptPath).status).toBe("complete");
  });

  it("records a shared git refusal like a preflight failure and starts no provider", async () => {
    const shared = join(scratch, "repo[1]");
    const lane = join(scratch, "lane");
    gitRepository(gitEnv(), shared);
    git(gitEnv(), "-C", shared, "worktree", "add", "-q", "-b", "lane", lane);
    const preflightStarted = join(scratch, "refused-preflight.started");
    const modelStarted = join(scratch, "refused-model.started");
    process.env.GROK_FAKE_PREFLIGHT_STARTED_PATH = preflightStarted;
    process.env.GROK_FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = { ...options("claude"), mode: "isolated-write" as const, cwd: lane };
    const exitCode = await main(runnerArgs(input).slice(1), Date.now(), {
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(70);
    const refused = receipt(input.receiptPath);
    expect(refused.status).toBe("child-failed");
    expect(refused.preflight.status).toBe("not-run");
    expect(refused.error?.message).toContain("contains a glob or control character");
    expect(existsSync(preflightStarted)).toBe(false);
    expect(existsSync(modelStarted)).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("rejects same-provider recursion", () => {
    const input = { ...options("claude"), parent: "claude" as const };
    expect(() => laneOf(input)).toThrow("native to parent");
  });

  it("rejects a versioned Claude family before it can stay pinned", () => {
    const input = { ...options("claude"), model: "claude-fable-9-9" };
    expect(() => laneOf(input)).toThrow(
      "normalize it to fable before invoking the runner"
    );
    expect(existsSync(input.outputPath)).toBe(false);
    expect(existsSync(input.receiptPath)).toBe(false);
  });
});

describe("devin lanes", () => {
  const LOGGED_IN = "Logged in (via Devin).\n\nUser: <redacted>";
  const DEVIN_VARIABLES = ["DEVIN_PERMISSION_MODE", "DEVIN_SANDBOX", "DEVIN_MODEL", "DEVIN_REFUSAL_FALLBACK"];

  function fakeDevin(status: string, turn: string): void {
    writeFileSync(join(bin, "devin"), `#!/usr/bin/env bun
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(${JSON.stringify(status)});
  process.exit(0);
}
const at = (flag) => args[args.indexOf(flag) + 1];
const exportPath = at("--export"), config = at("--config");
${turn}
`);
    chmodSync(join(bin, "devin"), 0o755);
  }

  const OBSERVE = `const observed = {
  model: at("--model"),
  exportAbsent: !existsSync(exportPath),
  dirMode: (statSync(dirname(config)).mode & 0o777).toString(8),
  configMode: (statSync(config).mode & 0o777).toString(8),
  subagents: JSON.parse(readFileSync(config, "utf8")).subagents_enabled,
  devinVariables: Object.keys(process.env).filter((key) => key.startsWith("DEVIN_")),
};
console.log("Welcome to Devin CLI!\\nSTDOUT_IS_NOT_THE_REPLY");
writeFileSync(exportPath, JSON.stringify({
  session_id: "d1",
  steps: [{ source: "agent", message: JSON.stringify(observed), extra: { generation_model: at("--model") } }],
  final_metrics: { total_prompt_tokens: 5, total_completion_tokens: 2 },
}));`;

  function devinOptions(suffix: string, overrides: Partial<LaneRequest> = {}): LaneRequest {
    return { ...options("grok", suffix), provider: "devin", model: "swe-2", effort: "max", ...overrides };
  }

  beforeEach(() => {
    for (const name of DEVIN_VARIABLES) process.env[name] = `${name}-value`;
  });
  afterEach(() => {
    for (const name of DEVIN_VARIABLES) delete process.env[name];
  });

  for (const [model, effort, cliModel] of [["swe-2", "max", "swe-2-max"], ["swe-1.6", "default", "swe-1-6"]] as const) {
    it(`runs devin:${model}@${effort} as ${cliModel}, with the reply and proof from the export`, async () => {
      fakeDevin(LOGGED_IN, OBSERVE);
      const input = devinOptions(`devin-${model}`, { model, effort });
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      const saved = receipt(input.receiptPath);
      expect(saved).toMatchObject({
        status: "complete",
        provider: "devin",
        model,
        effort,
        mode: "read-only",
        reportedModel: cliModel,
        modelVerified: true,
        modelEvidence: "provider-report",
        sessionId: "d1",
        usage: { inputTokens: 5, outputTokens: 2 },
        preflight: { status: "passed", evidence: "authenticated" },
      });
      const dir = `${input.receiptPath}.provider`;
      expect(saved.argv.slice(1)).toEqual([
        "-p", "--prompt-file", input.promptPath, "--model", cliModel, "--permission-mode", "auto",
        "--respect-workspace-trust", "false", "--export", join(dir, "export.json"), "--config", join(dir, "lockdown.json"),
      ]);
      expect(JSON.parse(readFileSync(input.outputPath, "utf8"))).toEqual({
        model: cliModel,
        exportAbsent: true,
        dirMode: "700",
        configMode: "600",
        subagents: false,
        devinVariables: [],
      });
      expect(readFileSync(streamPath(saved.stdoutPath), "utf8")).toContain("STDOUT_IS_NOT_THE_REPLY");
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    });
  }

  it("refuses an export whose generation model is not the CLI model ID", async () => {
    fakeDevin(LOGGED_IN, `writeFileSync(exportPath, JSON.stringify({ steps: [{ source: "agent", message: "OK", extra: { generation_model: "swe-2" } }] }));`);
    const input = devinOptions("devin-mismatch");
    expect((await runLane(laneOf(input))).exitCode).toBe(65);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "malformed-output",
      error: { message: "requested model swe-2 was not reported by devin" },
    });
    expect(existsSync(input.outputPath)).toBe(false);
  });

  for (const [name, status, exitCode, message] of [
    ["logged out at exit 0", "Not logged in.\n  Credentials path: /home/fixture/.local/share/devin/credentials.toml", 77, "authentication or model preflight failed"],
    ["an unknown status", "Welcome to Devin CLI!", 70, "authentication preflight output was inconclusive"],
  ] as const) {
    it(`classifies ${name} before any model call`, async () => {
      const started = join(scratch, "devin-model.started");
      fakeDevin(status, `writeFileSync(${JSON.stringify(started)}, "started");`);
      const input = devinOptions(`devin-preflight-${exitCode}`);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode);
      expect(result.receipt).toMatchObject({
        status: exitCode === 77 ? "unauthenticated" : "child-failed",
        preflight: { status: "failed" },
        error: { message },
      });
      expect(existsSync(started)).toBe(false);
    });
  }

  it("classifies an unknown model, a rejected tool and SIGTERM from the captured shapes", async () => {
    fakeDevin(LOGGED_IN, `console.error("Error: Unknown model: 'swe-2-max'\\nAvailable: adaptive, swe-2, swe-1.6");
process.exit(1);`);
    const unknown = devinOptions("devin-unknown-model");
    expect((await runLane(laneOf(unknown))).receipt).toMatchObject({ status: "unavailable-model", exitCode: 1 });

    fakeDevin(LOGGED_IN, `console.error("warning: rejected a tool call that requires confirmation.");
writeFileSync(exportPath, JSON.stringify({ steps: [{ source: "agent", message: "", extra: { generation_model: at("--model") } }] }));`);
    const rejected = devinOptions("devin-rejected");
    const rejectedResult = await runLane(laneOf(rejected));
    expect(rejectedResult.exitCode).toBe(70);
    expect(rejectedResult.receipt).toMatchObject({
      status: "child-failed",
      exitCode: 0,
      error: { message: "devin ended with an empty final message" },
    });
    expect(rejectedResult.receipt.error?.evidence).toContain("rejected a tool call");
    expect(existsSync(rejected.outputPath)).toBe(false);

    fakeDevin(LOGGED_IN, `process.stdout.write("partial reply");
process.kill(process.pid, "SIGTERM");
await Bun.sleep(5_000);`);
    const terminated = devinOptions("devin-sigterm");
    const terminatedResult = await runLane(laneOf(terminated));
    expect(terminatedResult.exitCode).toBe(130);
    expect(terminatedResult.receipt).toMatchObject({ status: "cancelled", exitCode: 143, signal: null });
    expect(existsSync(terminated.outputPath)).toBe(false);
  });

  it("refuses a lane whose provider directory already exists and rolls back its reservations", async () => {
    fakeDevin(LOGGED_IN, OBSERVE);
    const input = devinOptions("devin-taken");
    mkdirSync(`${input.receiptPath}.provider`);
    await expect(runLane(laneOf(input))).rejects.toThrow();
    for (const path of [input.outputPath, input.receiptPath, `${input.receiptPath}.stdout`, `${input.receiptPath}.stderr`]) {
      expect([path, existsSync(path)]).toEqual([path, false]);
    }
  });

  it("runs a Devin lane in a repository that holds .devin/", async () => {
    fakeDevin(LOGGED_IN, OBSERVE);
    const repo = join(scratch, "repo");
    fs.mkdirSync(join(repo, ".git"), { recursive: true });
    fs.mkdirSync(join(repo, ".devin"));
    const input = devinOptions("devin-repo-config", { cwd: repo });
    expect((await runLane(laneOf(input))).receipt).toMatchObject({ status: "complete", exitCode: 0 });
  });
});

const STAND_IN_CONFIG = ".agents/agents/lane.md";
const STAND_IN: ProviderAdapter = {
  ...devin,
  executable: "standin",
  effortIn: "config",
  preflight: {
    argv: () => ["preflight"],
    retryAfterUnauthenticatedMs: null,
    classify: (run) => run.exitCode === 0 ? { kind: "passed", evidence: run.stdout.trim() } : { kind: "inconclusive" },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: STAND_IN_CONFIG, content: (lane) => `effort: ${lane.effort}\n` } },
    supports: ["read-only"],
    stdinEnvelope: (prompt) => `${JSON.stringify({ event: "user", message: { role: "user", content: prompt } })}\n`,
    needsSharedGitDir: () => false,
    argv: () => ["run"],
  },
  parse: (run) => ({
    kind: "complete",
    text: run.stdout,
    metadata: { reportedModel: null, sessionId: null, usage: null, costUsd: null },
  }),
  proof: { report: "absent", matches: () => false },
  environment: (_access, sidecarDir) => ({
    kind: "allowlist",
    names: BASE_ALLOWLIST,
    prefixes: BASE_PREFIXES,
    set: { XDG_CONFIG_HOME: `${sidecarDir}`, STAND_IN_CONFIG: `${sidecarDir}/${STAND_IN_CONFIG}`, CODEX_THREAD_ID: "restored" },
  }),
};

function standInLane(suffix: string, overrides: Partial<LaneRequest> = {}): Lane {
  return { ...laneOf({ ...options("grok", suffix), provider: "devin", model: "swe-2", effort: "max", ...overrides }), adapter: STAND_IN };
}

describe("stand-in provider contract", () => {
  let inherited: string | undefined;
  beforeEach(() => {
    writeFileSync(join(bin, "standin"), `#!/usr/bin/env bun
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
const mode = (path) => (statSync(path).mode & 0o777).toString(8);
if (process.argv[2] === "preflight") {
  const config = process.env.STAND_IN_CONFIG;
  console.log(JSON.stringify({
    xdg: process.env.XDG_CONFIG_HOME,
    codexThread: process.env.CODEX_THREAD_ID ?? null,
    config: readFileSync(config, "utf8"),
    modes: [mode(dirname(dirname(config))), mode(dirname(config)), mode(config)],
  }));
  process.exit(0);
}
process.stdout.write(await Bun.stdin.text());
`);
    chmodSync(join(bin, "standin"), 0o755);
    inherited = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/inherited/config";
  });
  afterEach(() => {
    if (inherited === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = inherited;
  });

  it("creates the nested config before the preflight, which sees the set environment, and sends the envelope", async () => {
    const lane = standInLane("stand-in");
    writeFileSync(lane.promptPath, "Return \"the\" marker.\n");
    const result = await runLane(lane);
    expect(result.exitCode).toBe(0);
    const dir = `${lane.receiptPath}.provider`;
    expect(result.receipt).toMatchObject({
      status: "complete",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
      preflight: { status: "passed" },
    });
    expect(JSON.parse(result.receipt.preflight.evidence)).toEqual({
      xdg: dir,
      codexThread: null,
      config: "effort: max\n",
      modes: ["700", "700", "600"],
    });
    expect(readFileSync(lane.outputPath, "utf8"))
      .toBe(`${JSON.stringify({ event: "user", message: { role: "user", content: "Return \"the\" marker.\n" } })}\n`);
  });
});

describe("childEnvironment", () => {
  it("applies an adapter's set values after filtering and drops the parent identity markers last", () => {
    const lane = standInLane("stand-in-env");
    const source = { PATH: "/bin", XDG_CONFIG_HOME: "/inherited", XDG_DATA_HOME: "/data", CODEX_THREAD_ID: "parent", GITHUB_TOKEN: "t" };
    const dir = `${lane.receiptPath}.provider`;
    expect(childEnvironment(lane, source)).toEqual({
      PATH: "/bin",
      XDG_CONFIG_HOME: dir,
      XDG_DATA_HOME: "/data",
      STAND_IN_CONFIG: `${dir}/${STAND_IN_CONFIG}`,
    });
  });

  it("removes only inherited runtime identity needed to avoid nested detection", () => {
    const source = {
      PATH: "/bin",
      CODEX_THREAD_ID: "codex",
      CODEX_CI: "1",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      KEEP_ME: "yes",
    };
    expect(childEnvironment(laneOf({ ...options("claude"), mode: "read-only" }), source)).toEqual({
      PATH: "/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      KEEP_ME: "yes",
    });
    expect(childEnvironment(laneOf({ ...options("codex"), mode: "read-only" }), source)).toEqual({
      PATH: "/bin",
      CODEX_THREAD_ID: "codex",
      CODEX_CI: "1",
      KEEP_ME: "yes",
    });
  });

  it("passes a Grok lane only allowlisted variables in both modes", () => {
    const cases: [name: string, kept: boolean][] = [
      ["PATH", true],
      ["TZ", true],
      ["LC_ALL", true],
      ["XDG_CONFIG_HOME", true],
      ["GROK_HOME", true],
      ["XAI_API_KEY", true],
      ["HTTPS_PROXY", true],
      ["https_proxy", true],
      ["NODE_EXTRA_CA_CERTS", true],
      ["GITHUB_TOKEN", false],
      ["ANTHROPIC_API_KEY", false],
      ["XAIX_KEY", false],
      ["PATHS", false],
      ["CODEX_THREAD_ID", false],
      ["CLAUDECODE", false],
    ];
    const source = Object.fromEntries(cases.map(([name]) => [name, `${name}-value`]));
    const kept = Object.fromEntries(
      cases.filter(([, keep]) => keep).map(([name]) => [name, `${name}-value`])
    );
    for (const mode of ["read-only", "isolated-write"] as const) {
      expect(childEnvironment(laneOf({ ...options("grok"), mode }), source)).toEqual(kept);
    }
    const { CODEX_THREAD_ID: _codex, ...withoutCodex } = source;
    const { CLAUDECODE: _claude, ...withoutClaude } = source;
    for (const mode of ["read-only", "isolated-write"] as const) {
      expect(childEnvironment(laneOf({ ...options("claude"), mode }), source)).toEqual(withoutCodex);
      expect(childEnvironment(laneOf({ ...options("codex"), mode }), source)).toEqual(withoutClaude);
    }
  });

  it("passes a Devin lane the shared base allowlist without any DEVIN_* or Grok variable", () => {
    const cases: [name: string, kept: boolean][] = [
      ["PATH", true],
      ["HOME", true],
      ["TZ", true],
      ["LC_ALL", true],
      ["XDG_DATA_HOME", true],
      ["HTTPS_PROXY", true],
      ["NODE_EXTRA_CA_CERTS", true],
      ["DEVIN_PERMISSION_MODE", false],
      ["DEVIN_SANDBOX", false],
      ["DEVIN_MODEL", false],
      ["DEVIN_REFUSAL_FALLBACK", false],
      ["GROK_HOME", false],
      ["XAI_API_KEY", false],
      ["GITHUB_TOKEN", false],
      ["CLAUDECODE", false],
      ["CODEX_THREAD_ID", false],
    ];
    const source = Object.fromEntries(cases.map(([name]) => [name, `${name}-value`]));
    const kept = Object.fromEntries(cases.filter(([, keep]) => keep).map(([name]) => [name, `${name}-value`]));
    const devin = laneOf({ ...options("grok"), provider: "devin", model: "swe-2", effort: "max" });
    expect(childEnvironment(devin, source)).toEqual(kept);
    const grokOnly = ["GROK_HOME", "XAI_API_KEY"];
    expect(Object.keys(childEnvironment(laneOf(options("grok")), source)).sort())
      .toEqual([...Object.keys(kept), ...grokOnly].sort());
  });

  it("passes each allowlist adapter only its own provider credentials in every mode it supports", () => {
    const source = {
      GROK_API_KEY: "grok",
      XAI_API_KEY: "xai",
      AMP_API_KEY: "amp",
      CURSOR_API_KEY: "cursor",
      CURSOR_AUTH_TOKEN: "cursor-token",
      DEEPSEEK_API_KEY: "deepseek",
      OPENAI_API_KEY: "openai",
      ANTHROPIC_API_KEY: "anthropic",
      OPENROUTER_API_KEY: "openrouter",
      GEMINI_API_KEY: "gemini",
      UNRELATED_SECRET: "unrelated",
    };
    const expected: Record<string, Partial<Record<AccessKind, readonly string[]>>> = {
      grok: { "read-only": ["GROK_API_KEY", "XAI_API_KEY"], "isolated-write": ["GROK_API_KEY", "XAI_API_KEY"] },
      devin: { "read-only": [], "isolated-write": [], "isolated-write-full-access": [] },
      opencode: { "read-only": [], "isolated-write-full-access": [] },
      dsh: { "read-only": ["DEEPSEEK_API_KEY"], "isolated-write": ["DEEPSEEK_API_KEY"] },
      amp: { "read-only": ["AMP_API_KEY"] },
      agy: { "read-only": [], "isolated-write-full-access": [] },
      cursor: { "read-only": ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"], "isolated-write-full-access": ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"] },
      muse: { "read-only": [], "isolated-write-full-access": [] },
    };
    const allowlisted = REGISTRY.adapters
      .filter((adapter) => adapter.environment(access("read-only"), "/sidecar").kind === "allowlist");
    expect(allowlisted.map((adapter) => adapter.id).sort()).toEqual(Object.keys(expected).sort());
    for (const adapter of allowlisted) {
      const family = REGISTRY.families.find((entry) => entry.provider === adapter.id);
      expect(Object.keys(expected[adapter.id]!)).toEqual([...adapter.launch.supports]);
      for (const kind of adapter.launch.supports) {
        const lane = laneOf({
          ...options("grok", `allowlist-${adapter.id}-${kind}`),
          provider: adapter.id,
          model: family?.model ?? "unregistered-model",
          effort: family?.defaultEffort ?? "default",
          mode: kind === "read-only" ? "read-only" : "isolated-write",
          ...(kind === "isolated-write-full-access" ? { writerSandbox: "full-access" } : {}),
        });
        const inherited = Object.keys(childEnvironment(lane, source)).filter((name) => name in source);
        expect({ [`${adapter.id} ${kind}`]: inherited.sort() })
          .toEqual({ [`${adapter.id} ${kind}`]: [...expected[adapter.id]![kind]!] });
      }
    }
  });

  it("drops GIT_* only for a Claude writer", () => {
    const source = { PATH: "/bin", GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere" };
    expect(childEnvironment(laneOf({ ...options("claude"), mode: "isolated-write" }), source)).toEqual({ PATH: "/bin" });
    expect(childEnvironment(laneOf({ ...options("claude"), mode: "read-only" }), source)).toEqual(source);
    expect(childEnvironment(laneOf({ ...options("codex"), mode: "isolated-write" }), source)).toEqual(source);
  });
});

describe("discoverSharedGitDir", () => {
  const cancellation = { promise: new Promise<never>(() => {}), signal: null, dispose() {} };

  it("uses git's answer and refuses what it cannot deny literally", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pstack-shared-git-")));
    const env = gitEnv(dirname(root));
    const discover = (cwd: string) => discoverSharedGitDir(cwd, env, null, cancellation);
    try {
      const main = join(root, "main");
      const linked = join(root, "linked");
      const shared = { kind: "found", sharedGitDir: join(main, ".git") } as const;
      const none = { kind: "found", sharedGitDir: null } as const;
      gitRepository(env, main);
      git(env, "-C", main, "worktree", "add", "-q", "-b", "lane", linked);
      mkdirSync(join(linked, "sub"));

      expect(await discover(linked)).toEqual(shared);
      expect(await discover(join(linked, "sub"))).toEqual(shared);
      expect(await discover(main)).toEqual(none);
      expect(await discover(root)).toEqual(none);

      // An empty .git directory is not a repository to git, which keeps searching upward.
      mkdirSync(join(linked, "sub", ".git"));
      expect(await discover(join(linked, "sub"))).toEqual(shared);

      symlinkSync(main, join(root, "alias"));
      const aliased = join(root, "alias", ".git", "worktrees", "linked");
      writeFileSync(join(linked, ".git"), `gitdir: ${aliased}\n`);
      expect(await discover(linked)).toEqual(shared);

      const bare = join(root, "bare.git");
      git(env, "clone", "-q", "--bare", main, bare);
      git(env, "-C", bare, "worktree", "add", "-q", join(bare, "nested"));
      expect(await discover(join(bare, "nested"))).toMatchObject({
        kind: "refused",
        status: "child-failed",
        message: expect.stringContaining("is inside its shared git directory"),
      });

      const bracketed = join(root, "repo[1]");
      gitRepository(env, bracketed);
      const bracketedLane = join(root, "bracketed-lane");
      git(env, "-C", bracketed, "worktree", "add", "-q", "-b", "lane", bracketedLane);
      expect(await discover(bracketedLane)).toMatchObject({
        kind: "refused",
        status: "child-failed",
        message: expect.stringContaining("contains a glob or control character"),
      });

      writeFileSync(join(linked, ".git"), `gitdir: ${join(root, "missing")}\n`);
      expect(await discover(linked)).toMatchObject({ kind: "refused", status: "child-failed" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("opencode lanes", () => {
  const MODEL = "opencode/deepseek-v4.1-flash-free";
  const LISTED = `opencode/big-pickle\n${MODEL}\nopencode/nemotron-3-ultra-free`;
  const INHERITED = ["OPENCODE_PERMISSION", "OPENCODE_CONFIG_CONTENT", "OPENROUTER_API_KEY"];
  const event = (type: string, part: Record<string, unknown> = {}) => ({ type, timestamp: 1, sessionID: "ses_fixture", part });

  function fakeOpencode(models: string, turn: string): void {
    writeFileSync(join(bin, "opencode"), `#!/usr/bin/env bun
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const call = (kind) => {
  appendFileSync(join(dirname(process.argv[1]), "opencode.calls"), kind + "\\n");
  const context = { cwd: process.cwd(), env: process.env, config: readFileSync(process.env.OPENCODE_CONFIG, "utf8") };
  appendFileSync(join(dirname(process.argv[1]), "opencode.contexts"), JSON.stringify(context) + "\\n");
};
if (args[0] === "models") {
call("preflight");
${models}
}
call("model");
const prompt = await Bun.stdin.text();
const emit = (value) => console.log(JSON.stringify(value));
${turn}
`);
    chmodSync(join(bin, "opencode"), 0o755);
  }

  const LIST = `console.log(${JSON.stringify(LISTED)}); process.exit(0);`;
  const OBSERVE = `const config = process.env.OPENCODE_CONFIG;
const observed = {
  args,
  prompt,
  xdg: process.env.XDG_CONFIG_HOME === dirname(config),
  modes: [(statSync(dirname(config)).mode & 0o777).toString(8), (statSync(config).mode & 0o777).toString(8)],
  permission: JSON.parse(readFileSync(config, "utf8")).permission["*"],
  opencode: Object.keys(process.env).filter((key) => key.startsWith("OPENCODE_") || key.endsWith("_API_KEY")).sort(),
};
emit(${JSON.stringify(event("step_start"))});
emit(${JSON.stringify(event("step_finish", { reason: "tool-calls", tokens: { total: 10, input: 6, output: 3, reasoning: 1, cache: { read: 2, write: 0 } }, cost: 0.5 }))});
emit(${JSON.stringify(event("step_start"))});
emit({ type: "text", timestamp: 2, sessionID: "ses_fixture", part: { type: "text", text: JSON.stringify(observed) } });
emit(${JSON.stringify(event("step_finish", { reason: "stop", tokens: { total: 5, input: 4, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.25 }))});`;

  function opencodeOptions(suffix: string, overrides: Partial<LaneRequest> = {}): LaneRequest {
    return { ...options("grok", suffix), provider: "opencode", model: MODEL, effort: "max", ...overrides };
  }

  beforeEach(() => {
    for (const name of INHERITED) process.env[name] = `${name}-value`;
  });
  afterEach(() => {
    for (const name of INHERITED) delete process.env[name];
  });

  it("runs a read-only lane with the run-owned config, the prompt on stdin and the reply from the last step", async () => {
    fakeOpencode(LIST, OBSERVE);
    const input = opencodeOptions("opencode-complete");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    const saved = receipt(input.receiptPath);
    expect(saved).toMatchObject({
      status: "complete",
      provider: "opencode",
      model: MODEL,
      effort: "max",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
      sessionId: "ses_fixture",
      usage: { inputTokens: 10, cachedInputTokens: 2, cacheCreationInputTokens: 0, outputTokens: 4, reasoningTokens: 1, totalTokens: 15 },
      costUsd: 0.75,
      preflight: { status: "passed", evidence: `model ${MODEL} listed` },
    });
    const args = ["run", "--pure", "--agent", "build", "--format", "json", "--title", "pstack-lane", "--print-logs", "--log-level", "ERROR", "-m", MODEL, "--variant", "max"];
    expect(saved.argv.slice(1)).toEqual(args);
    expect(saved.preflight.argv.slice(1)).toEqual(["models", "opencode"]);
    expect(JSON.parse(readFileSync(input.outputPath, "utf8"))).toEqual({
      args,
      prompt: "Return the marker.",
      xdg: true,
      modes: ["700", "600"],
      permission: "deny",
      opencode: [
        "OPENCODE_CONFIG",
        "OPENCODE_DISABLE_AUTOUPDATE",
        "OPENCODE_DISABLE_CLAUDE_CODE",
        "OPENCODE_DISABLE_EXTERNAL_SKILLS",
        "OPENCODE_DISABLE_PROJECT_CONFIG",
        "OPENCODE_TEST_HOME",
      ],
    });
  });

  it("runs the preflight and the model with one config, environment and cwd", async () => {
    fakeOpencode(LIST, OBSERVE);
    const input = opencodeOptions("opencode-one-context");
    expect((await runLane(laneOf(input))).receipt.status).toBe("complete");
    expect(readFileSync(join(bin, "opencode.calls"), "utf8")).toBe("preflight\nmodel\n");
    const contexts = readFileSync(join(bin, "opencode.contexts"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(contexts).toHaveLength(2);
    expect(JSON.parse(contexts[0].config).permission["*"]).toBe("deny");
    expect(contexts[1]).toEqual(contexts[0]);
  });

  for (const [name, model, models, status, exitCode] of [
    ["a provider with no login", "openrouter/deepseek/deepseek-v4-pro", `console.error("\\u001b[91m\\u001b[1mError: \\u001b[0mProvider not found: openrouter"); process.exit(1);`, "unauthenticated", 77],
    ["an unlisted model", "opencode/deepseek-v4.1-flash", LIST, "unavailable-model", 69],
  ] as const) {
    it(`classifies ${name} before any model call`, async () => {
      const started = join(scratch, "opencode-model.started");
      fakeOpencode(models, `writeFileSync(${JSON.stringify(started)}, "started");`);
      const input = opencodeOptions(`opencode-preflight-${exitCode}`, { model, effort: "default" });
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode);
      expect(result.receipt).toMatchObject({ status, preflight: { status: "failed" }, error: { message: "authentication or model preflight failed" } });
      expect(existsSync(started)).toBe(false);
    });
  }

  it("classifies a rejected tool call, an error event and SIGTERM from the captured shapes", async () => {
    fakeOpencode(LIST, `console.error("! permission requested: edit (created.txt); auto-rejecting");
emit(${JSON.stringify(event("step_start"))});
emit(${JSON.stringify(event("step_finish", { reason: "tool-calls" }))});`);
    const rejected = opencodeOptions("opencode-rejected");
    const rejectedResult = await runLane(laneOf(rejected));
    expect(rejectedResult.exitCode).toBe(70);
    expect(rejectedResult.receipt).toMatchObject({ status: "child-failed", exitCode: 0, error: { message: "opencode ended on a rejected tool call" } });
    expect(rejectedResult.receipt.error?.evidence).toContain("auto-rejecting");
    expect(existsSync(rejected.outputPath)).toBe(false);

    fakeOpencode(LIST, `console.error('level=ERROR message=failed error="ProviderModelNotFoundError: Model not found"');
emit({ type: "error", timestamp: 1, sessionID: "ses_fixture", error: { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details." } } });
process.exit(1);`);
    const failed = opencodeOptions("opencode-error");
    const failedResult = await runLane(laneOf(failed));
    expect(failedResult.exitCode).toBe(70);
    expect(failedResult.receipt).toMatchObject({ status: "child-failed", exitCode: 1, error: { message: "opencode reported UnknownError: Unexpected server error. Check server logs for details." } });
    expect(failedResult.receipt.error?.evidence).toContain("ProviderModelNotFoundError");

    fakeOpencode(LIST, `emit(${JSON.stringify(event("step_start"))});
process.kill(process.pid, "SIGTERM");
await Bun.sleep(5_000);`);
    const terminated = opencodeOptions("opencode-sigterm");
    const terminatedResult = await runLane(laneOf(terminated));
    expect(terminatedResult.exitCode).toBe(130);
    expect(terminatedResult.receipt).toMatchObject({ status: "cancelled", exitCode: 143, signal: null });
    expect(existsSync(terminated.outputPath)).toBe(false);
  });

  it("runs in a repository holding .opencode/ and an opencode.json, which the environment turns off", async () => {
    fakeOpencode(LIST, OBSERVE);
    const repo = join(scratch, "repo"), nested = join(repo, "src");
    mkdirSync(join(repo, ".opencode", "plugins"), { recursive: true });
    mkdirSync(nested);
    writeFileSync(join(repo, "opencode.json"), "{\"permission\":{\"bash\":\"allow\"}}\n");
    const input = opencodeOptions("opencode-project-config", { cwd: nested });
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    expect(result.receipt).toMatchObject({ status: "complete", preflight: { status: "passed" } });
    expect(JSON.parse(readFileSync(input.outputPath, "utf8")).permission).toBe("deny");
  });

  it("refuses an isolated-write OpenCode lane before launch", () => {
    const input = opencodeOptions("opencode-writer", { mode: "isolated-write" });
    expect(() => laneOf(input)).toThrow("provider opencode does not support isolated-write");
    expect(existsSync(input.receiptPath)).toBe(false);
  });
});

describe("dsh lanes", () => {
  const DSH_VARIABLES = ["DSH_PERMISSION_MODE", "DSH_HOME", "DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY"];
  const TRANSPORT = `{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"DeepSeek Messages transport failed","code":"TRANSPORT"}}}`;
  const MISSING = `{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"llm-deepseek: no API key","code":"MISSING_CREDENTIAL"}}}`;

  function fakeDsh(status: string, turn: string, version = "0.2.1-rc.2"): void {
    writeFileSync(join(bin, "dsh"), `#!/usr/bin/env bun
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const call = (kind) => appendFileSync(join(dirname(process.argv[1]), "dsh.calls"), kind + "\\n");
if (args[0] === "--version") {
  call("version");
  console.log(${JSON.stringify(version)});
  process.exit(0);
}
const patch = args[args.indexOf("--patch") + 1];
const emit = (event) => console.log(JSON.stringify(event));
if (args.at(-1) === "preflight") {
  call("preflight");
  console.log(${JSON.stringify(status)});
  process.exit(1);
}
call("model");
const prompt = await Bun.stdin.text();
emit({ type: "session", sessionId: "session-fixture", cwd: process.cwd() });
${turn}
`);
    chmodSync(join(bin, "dsh"), 0o755);
  }

  const OBSERVE = `const observed = {
  prompt,
  patch: [["- id: sandbox-policy", 4], ["- id: credentials", 4], ["- id: agent-default-model", 5]].flatMap(([row, count]) => {
    const lines = readFileSync(patch, "utf8").split("\\n");
    return lines.slice(lines.indexOf(row), lines.indexOf(row) + count);
  }),
  home: process.env.DSH_HOME,
  dirMode: (statSync(dirname(patch)).mode & 0o777).toString(8),
  patchMode: (statSync(patch).mode & 0o777).toString(8),
  variables: Object.keys(process.env).filter((key) => /^(DSH_|DEEPSEEK_)/.test(key)).sort(),
};
emit({ type: "status", phase: "step_end", turn: 1, step: 1, usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 3, totalTokens: 10 } });
emit({ type: "status", phase: "turn_end", turn: 1, reason: { kind: "completed" } });
emit({ type: "final", text: JSON.stringify(observed) });`;

  function dshOptions(suffix: string, overrides: Partial<LaneRequest> = {}): LaneRequest {
    return { ...options("grok", suffix), provider: "dsh", model: "deepseek-flash", effort: "high", ...overrides };
  }

  beforeEach(() => {
    for (const name of DSH_VARIABLES) process.env[name] = `${name}-value`;
  });
  afterEach(() => {
    for (const name of DSH_VARIABLES) delete process.env[name];
  });

  it("runs a read-only lane with the run-owned patch, the prompt on stdin and the pinned-argv proof", async () => {
    fakeDsh(TRANSPORT, OBSERVE);
    const input = dshOptions("dsh-complete");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(0);
    const saved = receipt(input.receiptPath);
    expect(saved).toMatchObject({
      status: "complete",
      provider: "dsh",
      model: "deepseek-flash",
      effort: "high",
      mode: "read-only",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
      sessionId: "session-fixture",
      usage: { inputTokens: 5, outputTokens: 2, cachedInputTokens: 3, totalTokens: 10 },
      preflight: { status: "passed", evidence: "credential present; not validated" },
    });
    const dir = `${input.receiptPath}.provider`;
    expect(saved.argv.slice(1)).toEqual(["--profile", "headless", "--patch", join(dir, "patch.yml"), "--json", "-"]);
    expect(saved.preflight.argv.slice(1, 5)).toEqual(["--profile", "headless", "--patch", join(dir, "patch.yml")]);
    expect(saved.preflight.argv.at(-1)).toBe("preflight");
    expect(JSON.parse(readFileSync(input.outputPath, "utf8"))).toEqual({
      prompt: "Return the marker.",
      patch: [
        "- id: sandbox-policy",
        "  config:",
        "    mode: read-only",
        `    workspaceRoot: ${JSON.stringify(scratch)}`,
        "- id: credentials",
        "  disabled: false",
        "  config:",
        `    path: ${JSON.stringify(join(resolve("DSH_HOME-value"), ".credentials.yaml"))}`,
        "- id: agent-default-model",
        "  config:",
        "    provider: deepseek-official",
        "    model: \"deepseek-flash\"",
        "    reasoningEffort: \"high\"",
      ],
      dirMode: "700",
      patchMode: "600",
      home: dir,
      variables: ["DEEPSEEK_API_KEY", "DSH_HOME"],
    });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  for (const [name, status, exitCode, message] of [
    ["a missing credential", MISSING, 77, "authentication or model preflight failed"],
    ["an unknown status", "Welcome to dsh", 70, "authentication preflight output was inconclusive"],
  ] as const) {
    it(`classifies ${name} before any model call`, async () => {
      const started = join(scratch, "dsh-model.started");
      fakeDsh(status, `writeFileSync(${JSON.stringify(started)}, "started");`);
      const input = dshOptions(`dsh-preflight-${exitCode}`);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode);
      expect(result.receipt).toMatchObject({
        status: exitCode === 77 ? "unauthenticated" : "child-failed",
        preflight: { status: "failed" },
        error: { message },
      });
      expect(existsSync(started)).toBe(false);
    });
  }

  it("never completes SIGTERM's exit 0 with a partial final", async () => {
    fakeDsh(TRANSPORT, `emit({ type: "status", phase: "turn_start", turn: 1 });
emit({ type: "final", text: "partial reply" });`);
    const input = dshOptions("dsh-sigterm-shape");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(65);
    expect(result.receipt).toMatchObject({ status: "malformed-output", exitCode: 0, error: { message: "dsh ended without a completed turn" } });
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("classifies a turn error, an unknown model and exit 130 from the captured shapes", async () => {
    fakeDsh(TRANSPORT, `emit({ type: "status", phase: "turn_end", turn: 1, reason: { kind: "error", error: { message: "rate limited", code: "RATE_LIMIT" } } });
emit({ type: "final", text: "" });
console.error("dsh: RATE_LIMIT: rate limited");
process.exit(1);`);
    const failed = dshOptions("dsh-turn-error");
    expect((await runLane(laneOf(failed))).receipt).toMatchObject({
      status: "child-failed",
      exitCode: 1,
      sessionId: "session-fixture",
      error: { message: "dsh turn failed: RATE_LIMIT: rate limited" },
    });

    fakeDsh(TRANSPORT, `emit({ type: "status", phase: "turn_end", turn: 1, reason: { kind: "error", error: { message: "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-next.", code: "INVALID_REQUEST", status: 400 } } });
console.error("dsh: INVALID_REQUEST: The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-next.");
process.exit(1);`);
    const unknown = dshOptions("dsh-unknown-model", { model: "deepseek-next" });
    const unknownResult = await runLane(laneOf(unknown));
    expect(unknownResult.exitCode).toBe(69);
    expect(unknownResult.receipt).toMatchObject({ status: "unavailable-model", exitCode: 1 });

    fakeDsh(TRANSPORT, `emit({ type: "final", text: "partial reply" });
process.exit(130);`);
    const interrupted = dshOptions("dsh-sigint");
    expect((await runLane(laneOf(interrupted))).receipt).toMatchObject({ status: "cancelled", exitCode: 130, signal: null });
    expect(existsSync(interrupted.outputPath)).toBe(false);
  });

  it("refuses a dsh other than the measured version before the preflight", async () => {
    fakeDsh(TRANSPORT, OBSERVE, "0.3.0");
    const input = dshOptions("dsh-version");
    const result = await runLane(laneOf(input));
    expect(result.exitCode).toBe(69);
    expect(result.receipt).toMatchObject({
      status: "unavailable-cli",
      preflight: { status: "not-run" },
      error: {
        message: "dsh 0.3.0 is not the measured 0.2.1-rc.2; the adapter must be re-measured before it runs this version",
        evidence: "0.3.0",
      },
    });
    expect(readFileSync(join(bin, "dsh.calls"), "utf8")).toBe("version\n");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("checks the measured version, then runs the preflight and the model", async () => {
    fakeDsh(TRANSPORT, OBSERVE);
    const input = dshOptions("dsh-version-match");
    expect((await runLane(laneOf(input))).receipt.status).toBe("complete");
    expect(readFileSync(join(bin, "dsh.calls"), "utf8")).toBe("version\npreflight\nmodel\n");
  });

  it("runs a dsh lane whose cwd holds .env", async () => {
    fakeDsh(TRANSPORT, OBSERVE);
    const cwd = join(scratch, "env-repo");
    fs.mkdirSync(join(cwd, ".git"), { recursive: true });
    writeFileSync(join(cwd, ".env"), "PSTACK_FIXTURE=1\n");
    const input = dshOptions("dsh-cwd-env", { cwd });
    expect((await runLane(laneOf(input))).receipt).toMatchObject({ status: "complete", exitCode: 0 });
  });
});

describe("amp lanes", () => {
  const SIGNED_IN = "Signed in as <EMAIL>\n**Individual credits:** $<CREDITS> remaining";
  const MISSING_KEY = "Error: Invalid or missing API key. Run 'amp login' to authenticate.";
  const AMP_VARIABLES = ["AMP_API_KEY", "AMP_SETTINGS_FILE", "AMP_EXECUTOR", "AMP_INITIAL_AGENT_MODE_KEY", "AMP_URL"];

  function fakeAmp(usage: string, turn: string, usageExit = 0): void {
    writeFileSync(join(bin, "amp"), `#!/usr/bin/env bun
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "usage") {
  (${usageExit} === 0 ? console.log : console.error)(${JSON.stringify(usage)});
  process.exit(${usageExit});
}
const at = (flag) => args[args.indexOf(flag) + 1];
const settings = at("--settings-file");
const prompt = await Bun.stdin.text();
const emit = (event) => console.log(JSON.stringify({ ...event, session_id: "T-fixture" }));
${turn}
`);
    chmodSync(join(bin, "amp"), 0o755);
  }

  const OBSERVE = `const observed = {
  prompt,
  mode: at("-m"),
  dirMode: (statSync(dirname(settings)).mode & 0o777).toString(8),
  settingsMode: (statSync(settings).mode & 0o777).toString(8),
  tools: JSON.parse(readFileSync(settings, "utf8"))["amp.tools.enable"],
  ampVariables: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("AMP_"))),
};
emit({ type: "system", subtype: "init", tools: ["Read"], agent_mode: "medium" });
emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "x" }], usage: { input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 1 } } });
emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "y" }], usage: { input_tokens: 2, output_tokens: 5 } } });
emit({ type: "result", subtype: "success", is_error: false, num_turns: 2, result: JSON.stringify(observed) });`;

  function ampOptions(suffix: string, overrides: Partial<LaneRequest> = {}): LaneRequest {
    return { ...options("grok", suffix), provider: "amp", model: "deepseek-v4.1-flash", effort: "default", ...overrides };
  }

  beforeEach(() => {
    for (const name of AMP_VARIABLES) process.env[name] = `${name}-value`;
  });
  afterEach(() => {
    for (const name of AMP_VARIABLES) delete process.env[name];
  });

  for (const parent of ["claude", "codex"] as const) {
    it(`runs amp:deepseek-v4.1-flash from a ${parent} parent with the pinned mode, lockdown settings and prompt on stdin`, async () => {
      fakeAmp(SIGNED_IN, OBSERVE);
      const input = ampOptions(`amp-${parent}`, { parent });
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      const saved = receipt(input.receiptPath);
      expect(saved).toMatchObject({
        status: "complete",
        parent,
        provider: "amp",
        model: "deepseek-v4.1-flash",
        effort: "default",
        mode: "read-only",
        reportedModel: null,
        modelVerified: false,
        modelEvidence: "pinned-argv",
        sessionId: "T-fixture",
        usage: { inputTokens: 5, cachedInputTokens: 4, outputTokens: 6 },
        costUsd: null,
        preflight: { status: "passed", evidence: "authenticated" },
      });
      const dir = `${input.receiptPath}.provider`;
      expect(saved.argv.slice(1)).toEqual([
        "-x", "--stream-json", "-m", "deepseek-v4.1-flash", "--settings-file", join(dir, "settings.json"),
        "--visibility", "private", "--no-ide", "--no-notifications", "-l", "pstack-runner",
      ]);
      expect(saved.preflight.argv.slice(1)).toEqual(["usage"]);
      expect(JSON.parse(readFileSync(input.outputPath, "utf8"))).toEqual({
        prompt: "Return the marker.",
        mode: "deepseek-v4.1-flash",
        dirMode: "700",
        settingsMode: "600",
        tools: ["Read"],
        ampVariables: { AMP_API_KEY: "AMP_API_KEY-value", AMP_IGNORE_GUIDANCE_FILES: "*" },
      });
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    });
  }

  for (const [name, usage, usageExit, exitCode, message] of [
    ["a missing key", MISSING_KEY, 1, 77, "authentication or model preflight failed"],
    ["a login prompt", "Would you like to log in to Amp? [(y)es, (n)o]", 0, 70, "authentication preflight output was inconclusive"],
  ] as const) {
    it(`classifies ${name} before any model call`, async () => {
      const started = join(scratch, "amp-model.started");
      fakeAmp(usage, `writeFileSync(${JSON.stringify(started)}, "started");`, usageExit);
      const input = ampOptions(`amp-preflight-${exitCode}`);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode);
      expect(result.receipt).toMatchObject({
        status: exitCode === 77 ? "unauthenticated" : "child-failed",
        preflight: { status: "failed" },
        error: { message },
      });
      expect(existsSync(started)).toBe(false);
    });
  }

  it("reads exit-0 error and cancellation results, and an unknown mode's exit 1, as failures", async () => {
    fakeAmp(SIGNED_IN, `emit({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, error: "Claude Usage is set to Subscription Only." });`);
    const subscription = ampOptions("amp-subscription");
    const subscriptionResult = await runLane(laneOf(subscription));
    expect(subscriptionResult.exitCode).toBe(70);
    expect(subscriptionResult.receipt).toMatchObject({
      status: "child-failed",
      exitCode: 0,
      sessionId: "T-fixture",
      error: { message: "Claude Usage is set to Subscription Only." },
    });
    expect(existsSync(subscription.outputPath)).toBe(false);

    fakeAmp(SIGNED_IN, `emit({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, error: "User cancelled (SIGINT/SIGTERM)" });`);
    const cancelled = ampOptions("amp-cancelled");
    const cancelledResult = await runLane(laneOf(cancelled));
    expect(cancelledResult.exitCode).toBe(130);
    expect(cancelledResult.receipt).toMatchObject({ status: "cancelled", exitCode: 0, signal: null });
    expect(existsSync(cancelled.outputPath)).toBe(false);

    fakeAmp(SIGNED_IN, `console.error("Error: Unexpected error inside Amp CLI. Run with AMP_DEBUG=1 to see detailed logs.");
process.exit(1);`);
    const unknown = ampOptions("amp-unknown-mode", { model: "nonexistent-mode-xyz" });
    expect((await runLane(laneOf(unknown))).receipt).toMatchObject({ status: "child-failed", exitCode: 1 });
  });

  it("runs an Amp lane whose workspace holds .amp", async () => {
    fakeAmp(SIGNED_IN, OBSERVE);
    const repo = join(scratch, "repo"), nested = join(repo, "src");
    fs.mkdirSync(join(repo, ".amp/plugins"), { recursive: true });
    fs.writeFileSync(join(repo, ".amp/settings.json"), "{}\n");
    fs.mkdirSync(nested);
    const input = ampOptions("amp-project-config", { cwd: nested });
    expect((await runLane(laneOf(input))).exitCode).toBe(0);
    expect(receipt(input.receiptPath)).toMatchObject({ status: "complete", preflight: { status: "passed" } });
  });

  it("refuses an isolated-write Amp lane before launch", () => {
    const input = ampOptions("amp-writer", { mode: "isolated-write" });
    expect(() => laneOf(input)).toThrow("provider amp does not support isolated-write");
    expect(existsSync(input.receiptPath)).toBe(false);
  });
});


describe("agy lanes", () => {
  const MODELS = "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n";
  const SIGN_IN = "Fetching available models...\nError: Please sign in to view available models. Launch the CLI without arguments to sign in.";

  function fakeAgy(turn: string, models = MODELS, signIn = false): void {
    writeFileSync(join(bin, "agy"), `#!/usr/bin/env bun
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "models") {
  if (${signIn}) {
    console.error(${JSON.stringify(SIGN_IN)});
    process.exit(1);
  }
  process.stdout.write(${JSON.stringify(models)});
  process.exit(0);
}
const at = (flag) => args[args.indexOf(flag) + 1];
const stdin = await Bun.stdin.text();
const result = (body) => console.log(JSON.stringify({ event: "result", result: { conversation_id: "a1", status: "SUCCESS", response: "", usage: { input_tokens: 5, output_tokens: 2, thinking_tokens: 1, cache_read_tokens: 0, total_tokens: 7 }, ...body } }));
${turn}
`);
    chmodSync(join(bin, "agy"), 0o755);
  }

  const OBSERVE = `const agent = join(at("--add-dir"), ".agents/agents", at("--agent") + ".md");
if (!existsSync(agent)) {
  console.error('error: unknown agent "' + at("--agent") + '"');
  process.exit(1);
}
const mode = (path) => (statSync(path).mode & 0o777).toString(8);
const observed = {
  model: at("--model"),
  stdin: JSON.parse(stdin),
  stdinLines: stdin.split("\\n").length - 1,
  tools: readFileSync(agent, "utf8").split("tools:\\n")[1].split("\\n")[0],
  modes: [mode(at("--add-dir")), mode(agent)],
  geminiVariables: Object.keys(process.env).filter((key) => key.startsWith("GEMINI_")),
};
console.log(JSON.stringify({ event: "init", init: { model: at("--model") } }));
result({ response: JSON.stringify(observed) + "\\n" });`;

  function agyOptions(suffix: string, overrides: Partial<LaneRequest> = {}): LaneRequest {
    return { ...options("grok", suffix), provider: "agy", model: "gemini-3.8-flash", effort: "high", ...overrides };
  }

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "GEMINI_API_KEY-value";
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  for (const effort of ["low", "medium", "high"] as const) {
    it(`runs agy:gemini-3.8-flash@${effort} with the envelope on stdin and the run-owned agent, on pinned argv`, async () => {
      fakeAgy(OBSERVE);
      const input = agyOptions(`agy-${effort}`, { effort });
      writeFileSync(input.promptPath, "Read \"marker.txt\".\nReply with its contents.\n");
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      const saved = receipt(input.receiptPath);
      const cliModel = `gemini-3.8-flash-${effort}`;
      expect(saved).toMatchObject({
        status: "complete",
        provider: "agy",
        model: "gemini-3.8-flash",
        effort,
        mode: "read-only",
        reportedModel: null,
        modelVerified: false,
        modelEvidence: "pinned-argv",
        sessionId: "a1",
        usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 1, totalTokens: 7 },
        preflight: { argv: [saved.executable, "models"], status: "passed", evidence: `model ${cliModel} listed` },
      });
      const dir = `${input.receiptPath}.provider`;
      expect(saved.argv.slice(1)).toEqual([
        "--input-format", "stream-json", "--output-format", "stream-json", "--model", cliModel,
        "--add-dir", dir, "--agent", "pstack-lane",
      ]);
      expect(JSON.parse(readFileSync(input.outputPath, "utf8"))).toEqual({
        model: cliModel,
        stdin: { event: "user", message: { role: "user", content: "Read \"marker.txt\".\nReply with its contents.\n" } },
        stdinLines: 1,
        tools: "  - view_file",
        modes: ["700", "600"],
        geminiVariables: [],
      });
    });
  }

  for (const [name, signIn, models, status, exitCode] of [
    ["a sign-in failure", true, MODELS, "unauthenticated", 77],
    ["an unlisted variant", false, "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n", "unavailable-model", 69],
  ] as const) {
    it(`classifies ${name} before any model call`, async () => {
      const started = join(scratch, "agy-model.started");
      fakeAgy(`writeFileSync(${JSON.stringify(started)}, "started");`, models, signIn);
      const input = agyOptions(`agy-preflight-${exitCode}`);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode);
      expect(result.receipt).toMatchObject({ status, preflight: { status: "failed" } });
      expect(existsSync(started)).toBe(false);
    });
  }

  it("classifies an exit-0 denial, an unknown model, an interruption and a missing agent from the captured shapes", async () => {
    fakeAgy(`console.error('jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.');
result({ denied_actions: [{ action: "command", display_name: "RunCommand" }] });`);
    const denied = agyOptions("agy-denied");
    const deniedResult = await runLane(laneOf(denied));
    expect(deniedResult.exitCode).toBe(70);
    expect(deniedResult.receipt).toMatchObject({
      status: "child-failed",
      exitCode: 0,
      sessionId: "a1",
      error: { message: "agy denied a tool that needed approval" },
    });
    expect(deniedResult.receipt.error?.evidence).toContain("auto-denied");
    expect(existsSync(denied.outputPath)).toBe(false);

    fakeAgy(`console.error('error: invalid model selection (--model "' + at("--model") + '" --effort ""): model is not recognized as a known model');
result({ conversation_id: "", status: "ERROR", error: 'invalid model selection (--model "' + at("--model") + '")' });
process.exit(1);`);
    const unknown = agyOptions("agy-unknown-model");
    expect((await runLane(laneOf(unknown))).receipt).toMatchObject({ status: "unavailable-model", exitCode: 1, sessionId: null });

    fakeAgy(`console.error("error: interrupted");
result({ status: "ERROR", error: "interrupted" });
process.exit(1);`);
    const interrupted = agyOptions("agy-interrupted");
    const interruptedResult = await runLane(laneOf(interrupted));
    expect(interruptedResult.exitCode).toBe(130);
    expect(interruptedResult.receipt).toMatchObject({ status: "cancelled", exitCode: 1, error: { message: "agy reported the turn was interrupted" } });

    fakeAgy(`import { rmSync } from "node:fs";
rmSync(join(at("--add-dir"), ".agents"), { recursive: true });
${OBSERVE}`);
    const missing = agyOptions("agy-missing-agent");
    expect((await runLane(laneOf(missing))).receipt).toMatchObject({ status: "child-failed", exitCode: 1 });
    expect(existsSync(missing.outputPath)).toBe(false);
  });

  it("runs an agy lane in a repository that holds .agents/", async () => {
    fakeAgy(OBSERVE);
    const repo = join(scratch, "repo");
    fs.mkdirSync(join(repo, ".git"), { recursive: true });
    fs.mkdirSync(join(repo, ".agents"));
    const input = agyOptions("agy-repo-config", { cwd: repo });
    expect((await runLane(laneOf(input))).receipt).toMatchObject({ status: "complete", exitCode: 0 });
  });

  it("refuses an isolated-write agy lane before launch", () => {
    const input = agyOptions("agy-writer", { mode: "isolated-write" });
    expect(() => laneOf(input)).toThrow("provider agy does not support isolated-write");
    expect(existsSync(input.receiptPath)).toBe(false);
  });
});

describe("cursor lanes", () => {
  const MODELS = "Available models\n\nauto - Auto (current, default)\ncomposer-2.5 - Composer 2.5\ngemini-3.7-flash-high - Gemini 3.7 Flash\n";
  const AUTH_REQUIRED = "Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.";
  const CURSOR_VARIABLES = ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN", "CURSOR_API_ENDPOINT", "CURSOR_SANDBOX_POLICY_DIR", "CURSOR_CONFIG_DIR"];

  function fakeCursor(turn: string, models = MODELS, loggedOut = false): void {
    writeFileSync(join(bin, "cursor-agent"), `#!/usr/bin/env bun
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "models") {
  if (${loggedOut}) {
    console.error(${JSON.stringify(AUTH_REQUIRED)});
    process.exit(1);
  }
  process.stdout.write(${JSON.stringify(models)});
  process.exit(0);
}
const at = (flag) => args[args.indexOf(flag) + 1];
const prompt = await Bun.stdin.text();
const emit = (event) => console.log(JSON.stringify({ ...event, session_id: "c1" }));
${turn}
`);
    chmodSync(join(bin, "cursor-agent"), 0o755);
  }

  const OBSERVE = `const dir = process.env.CURSOR_CONFIG_DIR;
const config = join(dir, "cli-config.json");
const observed = {
  prompt,
  model: at("--model"),
  modes: [(statSync(dir).mode & 0o777).toString(8), (statSync(config).mode & 0o777).toString(8)],
  deny: JSON.parse(readFileSync(config, "utf8")).permissions.deny,
  cursorVariables: Object.keys(process.env).filter((key) => key.startsWith("CURSOR_")).sort(),
};
emit({ type: "system", subtype: "init", model: "Composer 2.5" });
emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reading the file.\\n" }] } });
emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(observed) }] } });
emit({ type: "result", subtype: "success", is_error: false, result: "Reading the file.\\n" + JSON.stringify(observed), usage: { inputTokens: 6, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 3 } });`;

  function cursorOptions(suffix: string, overrides: Partial<LaneRequest> = {}): LaneRequest {
    return { ...options("grok", suffix), provider: "cursor", model: "composer-2.5", effort: "default", ...overrides };
  }

  beforeEach(() => {
    for (const name of CURSOR_VARIABLES) process.env[name] = `${name}-value`;
  });
  afterEach(() => {
    for (const name of CURSOR_VARIABLES) delete process.env[name];
  });

  for (const [parent, model, effort, cliModel] of [
    ["claude", "composer-2.5", "default", "composer-2.5"],
    ["codex", "gemini-3.7-flash", "high", "gemini-3.7-flash-high"],
  ] as const) {
    it(`runs cursor:${model}@${effort} from a ${parent} parent in the run-owned config directory, on pinned argv`, async () => {
      fakeCursor(OBSERVE);
      const input = cursorOptions(`cursor-${parent}`, { parent, model, effort });
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(0);
      const saved = receipt(input.receiptPath);
      expect(saved).toMatchObject({
        status: "complete",
        parent,
        provider: "cursor",
        model,
        effort,
        mode: "read-only",
        reportedModel: null,
        modelVerified: false,
        modelEvidence: "pinned-argv",
        sessionId: "c1",
        usage: { inputTokens: 6, cachedInputTokens: 4, cacheCreationInputTokens: 3, outputTokens: 2 },
        costUsd: null,
        preflight: { argv: [saved.executable, "models"], status: "passed", evidence: `model ${cliModel} listed` },
      });
      expect(saved.argv.slice(1)).toEqual([
        "-p", "--output-format", "stream-json", "--model", cliModel, "--mode", "ask", "--sandbox", "enabled", "--trust",
      ]);
      expect(JSON.parse(readFileSync(input.outputPath, "utf8"))).toEqual({
        prompt: "Return the marker.",
        model: cliModel,
        modes: ["700", "600"],
        deny: ["Write(**)", "Shell(*)", "Mcp(*:*)"],
        cursorVariables: ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN", "CURSOR_CONFIG_DIR"],
      });
    });
  }

  it("points CURSOR_CONFIG_DIR at the lane's provider directory, replacing an inherited value", async () => {
    fakeCursor(`emit({ type: "assistant", message: { content: [{ type: "text", text: process.env.CURSOR_CONFIG_DIR }] } });
emit({ type: "result", subtype: "success", is_error: false });`);
    const input = cursorOptions("cursor-config-dir");
    await runLane(laneOf(input));
    expect(readFileSync(input.outputPath, "utf8")).toBe(`${input.receiptPath}.provider`);
  });

  for (const [name, loggedOut, models, status, exitCode] of [
    ["an authentication failure", true, MODELS, "unauthenticated", 77],
    ["an unlisted model", false, "Available models\n\ncomposer-2.5-fast - Composer 2.5 Fast\n", "unavailable-model", 69],
    ["empty model-list output", false, "", "child-failed", 70],
  ] as const) {
    it(`classifies ${name} before any model call`, async () => {
      const started = join(scratch, "cursor-model.started");
      fakeCursor(`writeFileSync(${JSON.stringify(started)}, "started");`, models, loggedOut);
      const input = cursorOptions(`cursor-preflight-${exitCode}`);
      const result = await runLane(laneOf(input));
      expect(result.exitCode).toBe(exitCode);
      expect(result.receipt).toMatchObject({ status, preflight: { status: "failed" } });
      expect(existsSync(started)).toBe(false);
    });
  }

  it("reads an exit-0 error result, an unknown model and a signal exit as failures", async () => {
    fakeCursor(`emit({ type: "result", subtype: "error", is_error: true, result: "Usage limit reached." });`);
    const failed = cursorOptions("cursor-error-result");
    const failedResult = await runLane(laneOf(failed));
    expect(failedResult.exitCode).toBe(70);
    expect(failedResult.receipt).toMatchObject({ status: "child-failed", exitCode: 0, sessionId: "c1", error: { message: "Usage limit reached." } });
    expect(existsSync(failed.outputPath)).toBe(false);

    fakeCursor(`console.error("Cannot use this model: " + at("--model") + ". Available models: auto, composer-2.5");
process.exit(1);`, `${MODELS}claude-opus-9-9-max - Listed, then refused by the turn\n`);
    const unknown = cursorOptions("cursor-unknown-model", { model: "claude-opus-9-9-max" });
    expect((await runLane(laneOf(unknown))).receipt).toMatchObject({ status: "unavailable-model", exitCode: 1 });

    fakeCursor(`emit({ type: "system", subtype: "init", model: "Composer 2.5" });
console.error("\\nAborting operation...");
process.exit(130);`);
    const interrupted = cursorOptions("cursor-sigint");
    expect((await runLane(laneOf(interrupted))).receipt).toMatchObject({ status: "child-failed", exitCode: 130 });
    expect(existsSync(interrupted.outputPath)).toBe(false);
  });

  it("runs a Cursor lane in a workspace holding .cursor/ and .claude settings files", async () => {
    const repo = join(scratch, "repo"), nested = join(repo, "src");
    mkdirSync(join(repo, ".cursor"), { recursive: true });
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude/settings.json"), "{}");
    writeFileSync(join(repo, ".claude/settings.local.json"), "{}");
    mkdirSync(nested);
    fakeCursor(OBSERVE);
    const input = cursorOptions("cursor-project-config", { cwd: nested });
    expect((await runLane(laneOf(input))).exitCode).toBe(0);
    expect(receipt(input.receiptPath)).toMatchObject({ status: "complete", preflight: { status: "passed" } });
  });

  it("refuses an isolated-write Cursor lane before launch", () => {
    const input = cursorOptions("cursor-writer", { mode: "isolated-write" });
    expect(() => laneOf(input)).toThrow("provider cursor does not support isolated-write");
    expect(existsSync(input.receiptPath)).toBe(false);
  });
});
