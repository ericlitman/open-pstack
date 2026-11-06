import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { devin } from "./devin.ts";

adapterSuite(devin);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/devin", name), "utf8");

const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "devin", model: "swe-2", effort: "medium", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (stdout: string, exitCode = 0) => devin.preflight.classify({ exitCode, stdout, stderr: "" }, lane());

describe("devin launch", () => {
  it("runs the effort's full variant ID read-only with the run-owned export and lockdown config", () => {
    expect(devin.launch.argv(lane({ effort: "max" }), testFacts(devin))).toEqual([
      "-p",
      "--prompt-file",
      "/tmp/prompt.md",
      "--model",
      "swe-2-max",
      "--permission-mode",
      "auto",
      "--respect-workspace-trust",
      "false",
      "--export",
      "/tmp/receipt.json.provider/export.json",
      "--config",
      "/tmp/receipt.json.provider/lockdown.json",
    ]);
    const swe16 = lane({ model: "swe-1.6", effort: "default" });
    expect([swe16.model, swe16.cliModel]).toEqual(["swe-1.6", "swe-1-6"]);
    expect(devin.launch.argv(swe16, testFacts(devin))).toEqual(expect.arrayContaining(["--model", "swe-1-6"]));
    expect(devin.launch.argv(lane(), testFacts(devin))).not.toContain("--sandbox");
  });

  it("runs a bounded writer in Devin's sandbox and an opted-in writer in dangerous mode, and refuses efforts SWE-2 does not list", () => {
    const flags = (request: Partial<LaneRequest>) => devin.launch.argv(lane({ effort: "max", ...request }), testFacts(devin)).slice(5, -6);
    expect(flags({ mode: "isolated-write" })).toEqual(["--sandbox"]);
    expect(flags({ mode: "isolated-write", writerSandbox: "full-access" })).toEqual(["--permission-mode", "dangerous"]);
    expect(() => lane({ effort: "low" })).toThrow("effort low is not offered for devin:swe-2; choose one of: medium, high, max");
    expect(() => lane({ model: "swe-1.6", effort: "max" })).toThrow("choose one of: default");
  });

  it("writes a lockdown config that turns off subagents, every rule source, MCP, web search and fetch", () => {
    const config = devin.launch.sidecar!.config!;
    expect(config.name).toBe("lockdown.json");
    expect(JSON.parse(config.content(lane()))).toEqual({
      version: 1,
      subagents_enabled: false,
      read_config_from: {
        agents_standard: false,
        cursor: false,
        windsurf: false,
        claude: false,
        copilot: false,
        opencode: false,
        zed: false,
      },
      permissions: {
        deny: ["mcp__*", "web_search", "webfetch", "run_subagent", "Fetch(https://*)", "Fetch(http://*)"],
      },
    });
    expect(devin.launch.sidecar!.output).toBe("export.json");
  });
});

describe("devin preflight", () => {
  it("passes only a logged-in status and records a fixed summary", () => {
    expect(preflight(fixture("auth-logged-in.txt"))).toEqual({ kind: "passed", evidence: "authenticated" });
    expect(preflight(fixture("auth-logged-in.txt"), 1)).toEqual({ kind: "inconclusive" });
  });

  it("reads a logged-out status at exit 0 as unauthenticated", () => {
    expect(preflight(fixture("auth-logged-out.txt"))).toEqual({ kind: "unauthenticated" });
  });

  it("reads any other status as inconclusive", () => {
    for (const stdout of ["", "Welcome to Devin CLI!\nLogged in (via Devin).", "logged in", "Error: network unreachable"]) {
      expect([stdout, preflight(stdout)]).toEqual([stdout, { kind: "inconclusive" }]);
    }
  });
});

describe("devin parse", () => {
  it("takes the reply and proof from the export, not stdout", () => {
    const parsed = devin.parse(run({
      stdout: "\u001b[1mWelcome to Devin CLI!\u001b[0m\n\nbanner text\n",
      sidecar: fixture("export-swe-2-medium.json"),
    }), lane());
    expect(parsed).toEqual({
      kind: "complete",
      text: "MARK-fixture",
      metadata: {
        reportedModel: "swe-2-medium",
        sessionId: "fixture-session",
        usage: { inputTokens: 47019, cachedInputTokens: 31618, outputTokens: 100 },
        costUsd: null,
      },
    });
    expect(devin.proof.matches(lane(), "swe-2-medium")).toBe(true);
    for (const reported of ["swe-2", "SWE-2 Medium", "swe-2-max", "swe-2-medium-1"]) {
      expect([reported, devin.proof.matches(lane(), reported)]).toEqual([reported, false]);
    }
    const swe16 = lane({ model: "swe-1.6", effort: "default" });
    const parsed16 = devin.parse(run({ sidecar: fixture("export-swe-1-6.json") }), swe16);
    expect(parsed16).toMatchObject({ kind: "complete", metadata: { reportedModel: "swe-1-6" } });
    expect(devin.proof.matches(swe16, "swe-1-6")).toBe(true);
  });

  it("reads a rejected tool call's empty final message as a failure", () => {
    expect(devin.parse(run({ stderr: fixture("rejected-tool.stderr.txt"), sidecar: fixture("export-rejected-tool.json") }), lane()))
      .toEqual({
        kind: "provider-failure",
        status: "child-failed",
        message: "devin ended with an empty final message",
        metadata: {
          reportedModel: "swe-2-medium",
          sessionId: "fixture-session",
          usage: { inputTokens: 23455, cachedInputTokens: 0, outputTokens: 87 },
          costUsd: null,
        },
      });
  });

  it("reads an agent reply with the interruption text as a reply, not a cancellation", () => {
    const sidecar = JSON.stringify({ session_id: "s", steps: [{ source: "agent", message: "[Response interrupted by user]", extra: { generation_model: "swe-2-medium" } }] });
    expect(devin.parse(run({ sidecar }), lane())).toMatchObject({ kind: "complete", text: "[Response interrupted by user]" });
  });

  it("reads SIGINT's interrupted export and SIGTERM's exit 143 as cancelled", () => {
    expect(devin.parse(run({ exitCode: 1, stdout: "The history of rivers is,", stderr: "Error: Operation canceled by user\n", sidecar: fixture("export-sigint.json") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "cancelled", message: "devin reported the response was interrupted", metadata: { reportedModel: null, sessionId: "fixture-session" } });
    expect(devin.parse(run({ exitCode: 143, stdout: "The History of Rivers\n\nRivers are" }), lane()))
      .toEqual({
        kind: "provider-failure",
        status: "cancelled",
        message: "devin exited with status 143 after SIGTERM",
        metadata: { reportedModel: null, sessionId: null, usage: null, costUsd: null },
      });
  });

  it("never returns stdout when the export is missing or unreadable", () => {
    expect(devin.parse(run({ stdout: "MARK-fixture\n" }), lane())).toEqual({ kind: "malformed", message: "devin wrote no export" });
    expect(devin.parse(run({ exitCode: 1, stderr: fixture("unknown-model.stderr.txt") }), lane()))
      .toEqual({ kind: "malformed", message: "devin wrote no export" });
    expect(devin.parse(run({ sidecar: "{" }), lane())).toEqual({ kind: "malformed", message: "devin export is not valid JSON" });
    expect(devin.parse(run({ sidecar: "{\"steps\":[]}" }), lane())).toEqual({ kind: "malformed", message: "devin export has no steps" });
    const userLast = JSON.stringify({ steps: [{ source: "user", message: "hello" }] });
    expect(devin.parse(run({ sidecar: userLast }), lane()))
      .toEqual({ kind: "malformed", message: "devin export did not end with an agent step" });
  });
});
