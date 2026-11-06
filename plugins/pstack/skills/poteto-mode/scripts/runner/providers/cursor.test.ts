import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { modelFailureStatus } from "../types.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { cursor } from "./cursor.ts";

adapterSuite(cursor);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/cursor", name), "utf8");

const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "cursor", model: "composer-2.5", effort: "default", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (exitCode: number, stdout: string, stderr = "", request: Partial<LaneRequest> = {}) =>
  cursor.preflight.classify({ exitCode, stdout, stderr }, lane(request));

describe("cursor launch", () => {
  it("runs ask mode in the sandbox with the effort's model ID and no bypass flag", () => {
    expect(cursor.launch.argv(lane({ model: "gemini-3.7-flash", effort: "high" }), testFacts(cursor))).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      "gemini-3.7-flash-high",
      "--mode",
      "ask",
      "--sandbox",
      "enabled",
      "--trust",
    ]);
    for (const flag of ["--force", "-f", "--yolo", "--approve-mcps"]) {
      expect(cursor.launch.argv(lane(), testFacts(cursor))).not.toContain(flag);
    }
    expect(cursor.executable).toBe("cursor-agent");
  });

  it("maps each Gemini 3.7 Flash effort to its listed model ID", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(lane({ model: "gemini-3.7-flash", effort }).cliModel).toBe(`gemini-3.7-flash-${effort}`);
    }
  });

  it("runs an opted-in writer in agent mode with the sandbox on and writes allowed, and refuses a bounded writer and efforts a family does not list", () => {
    const writer = lane({ mode: "isolated-write", writerSandbox: "full-access" });
    const argv = cursor.launch.argv(writer, testFacts(cursor));
    expect([argv.includes("--mode"), argv.slice(argv.indexOf("--sandbox"), argv.indexOf("--sandbox") + 2)]).toEqual([false, ["--sandbox", "enabled"]]);
    const config = JSON.parse(cursor.launch.sidecar!.config!.content(writer));
    expect([config.permissions, config.sandbox]).toEqual([{ allow: ["Write(**)", "Shell(*)"], deny: ["Mcp(*:*)"] }, { mode: "enabled" }]);
    expect(() => lane({ mode: "isolated-write" }))
      .toThrow("provider cursor does not support isolated-write; it supports only: read-only, isolated-write-full-access");
    expect(() => lane({ model: "gemini-3.7-flash", effort: "max" })).toThrow("choose one of: low, medium, high");
  });

  it("writes the lockdown config into the run-owned CURSOR_CONFIG_DIR and passes only the two login names", () => {
    const config = cursor.launch.sidecar!.config!;
    expect(cursor.launch.sidecar!.output).toBeNull();
    expect(config.name).toBe("cli-config.json");
    expect(JSON.parse(config.content(lane()))).toEqual({
      version: 1,
      permissions: { allow: [], deny: ["Write(**)", "Shell(*)", "Mcp(*:*)"] },
      approvalMode: "allowlist",
      sandbox: { mode: "enabled" },
      autoAcceptWebSearch: false,
      webFetchDomainAllowlist: [],
    });
    const policy = cursor.environment(lane().access, "/tmp/receipt.json.provider");
    expect(policy).toMatchObject({ kind: "allowlist", set: { CURSOR_CONFIG_DIR: "/tmp/receipt.json.provider" } });
    if (policy.kind !== "allowlist") throw new Error("expected an allowlist");
    expect(policy.names.filter((name) => name.startsWith("CURSOR_"))).toEqual(["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"]);
    expect(policy.prefixes.some((prefix) => "CURSOR_API_ENDPOINT".startsWith(prefix))).toBe(false);
  });
});

describe("cursor preflight", () => {
  it("passes only when the lane's model ID starts a listed line, with fixed evidence", () => {
    expect(preflight(0, fixture("models-logged-in.txt"))).toEqual({ kind: "passed", evidence: "model composer-2.5 listed" });
    expect(preflight(0, fixture("models-logged-in.txt"), "", { model: "gemini-3.7-flash", effort: "high" }))
      .toEqual({ kind: "passed", evidence: "model gemini-3.7-flash-high listed" });
  });

  it("reads a model list without the ID as an unavailable model", () => {
    expect(preflight(0, fixture("models-logged-in.txt"), "", { model: "claude-opus-9-9-max" })).toEqual({ kind: "unavailable-model" });
    expect(preflight(0, "Available models\n\ncomposer-2.5-fast - Composer 2.5 Fast\nauto - composer-2.5 - x\n"))
      .toEqual({ kind: "unavailable-model" });
  });

  it("reads exit 1 with Authentication required as unauthenticated and never reads empty output as logged out", () => {
    expect(preflight(1, "", fixture("models-logged-out.stderr.txt"))).toEqual({ kind: "unauthenticated" });
    expect(preflight(1, "", fixture("models-stored-login-unusable.stderr.txt"))).toEqual({ kind: "unauthenticated" });
    for (const [exitCode, stdout, stderr] of [
      [0, "", ""],
      [2, "", ""],
      [1, "", ""],
      [2, "", fixture("models-logged-out.stderr.txt")],
      [1, "", "Error: network unreachable"],
      [0, "Logged in as <EMAIL>", ""],
    ] as const) {
      expect([exitCode, stdout, stderr, preflight(exitCode, stdout, stderr)]).toEqual([exitCode, stdout, stderr, { kind: "inconclusive" }]);
    }
  });
});

describe("cursor parse", () => {
  it("takes the reply from the last assistant event, with session and usage", () => {
    expect(cursor.parse(run({ stdout: fixture("stream-complete-readonly.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "00000000-0000-0000-0000-000000000009",
      metadata: {
        reportedModel: null,
        sessionId: "00000000-0000-0000-0000-000000000007",
        usage: { inputTokens: 6, cachedInputTokens: 30872, cacheCreationInputTokens: 11610, outputTokens: 112 },
        costUsd: null,
      },
    });
    expect(cursor.proof).toMatchObject({ report: "absent" });
    expect(cursor.proof.matches(lane(), "composer-2.5")).toBe(false);
  });

  it("completes a turn whose tool was refused, with the last segment and not the joined result", () => {
    const parsed = cursor.parse(run({ stdout: fixture("refused-shell-ask-sandbox.jsonl") }), lane());
    expect(parsed).toMatchObject({ kind: "complete", metadata: { sessionId: "00000000-0000-0000-0000-000000000005" } });
    if (parsed.kind !== "complete") throw new Error("expected complete");
    expect(parsed.text.startsWith("The shell command did not run.")).toBe(true);
    expect(parsed.text).not.toContain("Running the requested shell command once.");
  });

  it("reads an error result as child-failed with its text", () => {
    const stdout = `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } })}\n`
      + `${JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "rate limited", session_id: "s" })}\n`;
    expect(cursor.parse(run({ stdout }), lane())).toMatchObject({ kind: "provider-failure", status: "child-failed", message: "rate limited", metadata: { sessionId: "s" } });
  });

  it("leaves a signal exit, an unknown model and unreadable output to the runner", () => {
    expect(cursor.parse(run({ exitCode: 130, stdout: fixture("cancel-sigint.jsonl"), stderr: fixture("cancel-sigint.stderr.txt") }), lane()))
      .toEqual({ kind: "malformed", message: "cursor stream did not contain a result event" });
    expect(cursor.parse(run({ exitCode: 143, stdout: fixture("cancel-sigterm.jsonl") }), lane()))
      .toEqual({ kind: "malformed", message: "cursor stream did not contain a result event" });
    expect(cursor.parse(run({ exitCode: 1, stderr: fixture("unknown-model.stderr.txt") }), lane()))
      .toEqual({ kind: "malformed", message: "cursor stream did not contain a result event" });
    expect(modelFailureStatus(fixture("unknown-model.stderr.txt"))).toBe("unavailable-model");
    expect(cursor.parse(run({ stdout: "PINEAPPLE\n" }), lane())).toEqual({ kind: "malformed", message: "cursor emitted a non-JSON event" });
    const result = `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "joined" })}\n`;
    expect(cursor.parse(run({ stdout: result }), lane())).toEqual({ kind: "malformed", message: "cursor stream did not contain an assistant reply" });
  });
});
