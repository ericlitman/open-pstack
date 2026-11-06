import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelRun } from "../registry/contract.ts";
import type { LaneRequest } from "../registry/index.ts";
import { adapterSuite, testFacts, testLane } from "./adapter-suite.ts";
import { agy } from "./agy.ts";

adapterSuite(agy);

const fixture = (name: string): string => readFileSync(join(import.meta.dir, "fixtures/agy", name), "utf8");

const lane = (request: Partial<LaneRequest> = {}) => testLane({ provider: "agy", model: "gemini-3.8-flash", effort: "medium", ...request });
const run = (overrides: Partial<ModelRun>): ModelRun => ({ exitCode: 0, stdout: "", stderr: "", sidecar: null, ...overrides });
const preflight = (exitCode: number, stdout: string, stderr = "", request: Partial<LaneRequest> = {}) =>
  agy.preflight.classify({ exitCode, stdout, stderr }, lane(request));

describe("agy launch", () => {
  it("runs the effort's variant ID in stream-json with the run-owned agent and no mode, sandbox or effort flag", () => {
    expect(agy.launch.argv(lane({ effort: "high" }), testFacts(agy))).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      "gemini-3.8-flash-high",
      "--add-dir",
      "/tmp/receipt.json.provider",
      "--agent",
      "pstack-lane",
    ]);
    for (const flag of ["-p", "--mode", "--sandbox", "--effort", "--dangerously-skip-permissions"]) {
      expect(agy.launch.argv(lane(), testFacts(agy))).not.toContain(flag);
    }
  });

  it("runs an opted-in writer with permissions skipped, and refuses a bounded writer, efforts 3.8 Flash does not list, and 3.7 Flash", () => {
    expect(agy.launch.argv(lane({ mode: "isolated-write", writerSandbox: "full-access" }), testFacts(agy)).slice(-3))
      .toEqual(["--agent", "pstack-lane", "--dangerously-skip-permissions"]);
    expect(() => lane({ mode: "isolated-write" }))
      .toThrow("provider agy does not support isolated-write; it supports only: read-only, isolated-write-full-access");
    expect(() => lane({ effort: "max" })).toThrow("effort max is not offered for agy:gemini-3.8-flash; choose one of: low, medium, high");
    const unregistered = lane({ model: "gemini-3.7-flash", effort: "default" });
    expect([unregistered.family, unregistered.cliModel]).toEqual([null, "gemini-3.7-flash"]);
  });

  it("wraps the prompt in one stream-json user line", () => {
    const line = agy.launch.stdinEnvelope!("Read \"marker.txt\".\nReply exactly.\n");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ event: "user", message: { role: "user", content: "Read \"marker.txt\".\nReply exactly.\n" } });
  });

  it("writes a run-owned agent with view_file only for a reader, the edit and command tools for a writer, and no MCP servers or skills", () => {
    const config = agy.launch.sidecar!.config!;
    expect(agy.launch.sidecar!.output).toBeNull();
    expect(config.name).toBe(".agents/agents/pstack-lane.md");
    const tools = (request: Partial<LaneRequest>) => config.content(lane(request)).split("tools:\n")[1]!.split("mainAgent")[0];
    expect(tools({ mode: "isolated-write", writerSandbox: "full-access" }))
      .toBe("  - view_file\n  - write_to_file\n  - replace_file_content\n  - run_command\n  - command_status\n");
    const front = config.content(lane()).split("---\n")[1];
    expect(front).toBe([
      "name: pstack-lane",
      "description: pstack lane with a fixed tool list.",
      "tools:",
      "  - view_file",
      "mainAgent: true",
      "subagent: false",
      "mcpServers: []",
      "skills: []",
      "",
    ].join("\n"));
  });
});

describe("agy preflight", () => {
  it("passes only when the lane's variant ID is a listed model, with fixed evidence", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(preflight(0, fixture("models-logged-in.txt"), "Fetching available models...\n", { effort }))
        .toEqual({ kind: "passed", evidence: `model gemini-3.8-flash-${effort} listed` });
    }
  });

  it("reads exit 0 without the variant as an unavailable model", () => {
    expect(preflight(0, fixture("models-logged-in.txt"), "", { model: "gemini-3.7-flash", effort: "default" }))
      .toEqual({ kind: "unavailable-model" });
    expect(preflight(0, "gemini-3.8-flash-medium-preview\tGemini\nother\tgemini-3.8-flash-medium\n")).toEqual({ kind: "unavailable-model" });
    expect(preflight(0, "")).toEqual({ kind: "unavailable-model" });
  });

  it("reads exit 1 with the sign-in message as unauthenticated and anything else as inconclusive", () => {
    expect(preflight(1, "", fixture("models-logged-out.stderr.txt"))).toEqual({ kind: "unauthenticated" });
    expect(preflight(2, "", fixture("models-logged-out.stderr.txt"))).toEqual({ kind: "inconclusive" });
    expect(preflight(1, "", "Error: network unreachable")).toEqual({ kind: "inconclusive" });
    expect(preflight(1, fixture("models-logged-in.txt"))).toEqual({ kind: "inconclusive" });
  });
});

describe("agy parse", () => {
  it("takes the reply from the result event, without its trailing newline, with session and usage", () => {
    expect(agy.parse(run({ stdout: fixture("stream-complete.jsonl") }), lane())).toEqual({
      kind: "complete",
      text: "00000000-0000-0000-0000-000000000000",
      metadata: {
        reportedModel: null,
        sessionId: "00000000-0000-0000-0000-000000000000",
        usage: { inputTokens: 25048, cachedInputTokens: 0, outputTokens: 310, reasoningTokens: 221, totalTokens: 25358 },
        costUsd: null,
      },
    });
    expect(agy.proof).toMatchObject({ report: "absent" });
    expect(agy.proof.matches(lane(), "gemini-3.8-flash-medium")).toBe(false);
  });

  it("reads an exit-0 denial as a failure, with or without a preamble", () => {
    expect(agy.parse(run({ stdout: fixture("stream-denied-shell.jsonl"), stderr: fixture("stream-denied-shell.stderr.txt") }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: "agy denied a tool that needed approval", metadata: { usage: { outputTokens: 215 } } });
    const result = (body: object) => `${JSON.stringify({ event: "result", result: body })}\n`;
    expect(agy.parse(run({ stdout: result({ response: "Let me check.\n", denied_actions: [{ action: "command" }] }) }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "child-failed", message: "agy denied a tool that needed approval" });
  });

  it("reads the interrupted result as cancelled", () => {
    expect(agy.parse(run({ exitCode: 1, stdout: fixture("stream-sigint.jsonl"), stderr: "error: interrupted\n" }), lane()))
      .toMatchObject({ kind: "provider-failure", status: "cancelled", message: "agy reported the turn was interrupted" });
  });

  it("leaves an error result, an empty response and unreadable output to the runner", () => {
    expect(agy.parse(run({ exitCode: 1, stdout: fixture("stream-unknown-model.jsonl"), stderr: fixture("stream-unknown-model.stderr.txt") }), lane()))
      .toEqual({ kind: "malformed", message: "agy result reported an error" });
    const result = (body: object) => `${JSON.stringify({ event: "result", result: body })}\n`;
    expect(agy.parse(run({ stdout: result({ status: "SUCCESS", response: "\n" }) }), lane()))
      .toEqual({ kind: "malformed", message: "agy result has an empty response" });
    expect(agy.parse(run({ stdout: "" }), lane())).toEqual({ kind: "malformed", message: "agy wrote no result event" });
    expect(agy.parse(run({ stdout: "PINEAPPLE\n" }), lane())).toEqual({ kind: "malformed", message: "agy emitted a non-JSON event" });
  });
});
