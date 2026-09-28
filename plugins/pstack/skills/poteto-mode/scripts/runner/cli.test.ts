import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "./cli.ts";

function argv(extra: readonly string[] = []): string[] {
  return [
    "--parent",
    "claude",
    "--provider",
    "codex",
    "--model",
    "gpt-5.6-sol",
    "--effort",
    "max",
    "--mode",
    "read-only",
    "--prompt",
    join(process.cwd(), "prompt.md"),
    "--cwd",
    process.cwd(),
    "--output",
    join(process.cwd(), "output.md"),
    "--receipt",
    join(process.cwd(), "receipt.json"),
    ...extra,
  ];
}

describe("runner CLI parsing", () => {
  it("does not invent a timeout", () => {
    expect(parseArgs(argv())?.timeoutMs).toBeNull();
  });

  it("honors an explicit positive timeout", () => {
    expect(parseArgs(argv(["--timeout", "5400"]))?.timeoutMs).toBe(5_400_000);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parseArgs(argv(["--timeout", "0"]))).toThrow(
      "greater than zero"
    );
  });

  it("accepts gateway providers", () => {
    const parsed = parseArgs([
      ...argv().map((value, index, all) =>
        all[index - 1] === "--provider"
          ? "minimax"
          : all[index - 1] === "--model"
            ? "MiniMax-M3"
            : value
      ),
    ]);
    expect(parsed?.provider).toBe("minimax");
    expect(parsed?.model).toBe("MiniMax-M3");
  });

  it("names the gateway providers in the provider rejection", () => {
    expect(() =>
      parseArgs(
        argv().map((value, index, all) =>
          all[index - 1] === "--provider" ? "gemini" : value
        )
      )
    ).toThrow("deepseek, minimax");
  });
});
