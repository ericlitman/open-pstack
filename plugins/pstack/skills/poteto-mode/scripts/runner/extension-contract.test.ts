import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EFFORTS, PARENTS, PROVIDERS } from "./types.ts";

const reference = readFileSync(
  new URL("../../references/provider-dispatch.md", import.meta.url),
  "utf8"
);

test("the documented extension example supplies each lane's complete argv and receipt contract", () => {
  const section = reference.split("## Optional dispatch extensions")[1].split("## Read-time normalization")[0];
  const example = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)![1]);
  expect(example.schemaVersion).toBe(1);
  expect(example.families).toHaveLength(1);
  const family = example.families[0];
  expect(PROVIDERS).not.toContain(family.provider);
  expect(family.receiptSchema).toBe("pstack-runner-v1");
  expect(new Set(family.selectableEfforts).size).toBe(family.selectableEfforts.length);
  expect(family.selectableEfforts).toContain(family.defaultEffort);
  for (const effort of family.selectableEfforts) expect(EFFORTS).toContain(effort);
  expect(Object.keys(family.launcherArgv).sort()).toEqual([...PARENTS].sort());
  const values: Record<string, string> = {
    parent: "codex", provider: family.provider, model: family.model, effort: "medium",
    mode: "read-only", promptPath: "/tmp/prompt with spaces.md", cwd: "/tmp/work with spaces",
    outputPath: "/tmp/output.txt", receiptPath: "/tmp/receipt.json",
  };
  for (const parent of PARENTS) {
    const argv: string[] = family.launcherArgv[parent];
    expect(argv[0].startsWith("/")).toBe(true);
    const placeholders = argv.filter((arg) => arg.startsWith("{"));
    expect(placeholders.sort()).toEqual(Object.keys(values).map((key) => `{${key}}`).sort());
    const substituted = argv.map((arg) => arg.startsWith("{") ? values[arg.slice(1, -1)] : arg);
    expect(substituted[argv.indexOf("{promptPath}")]).toBe(values.promptPath);
    expect(substituted[argv.indexOf("{cwd}")]).toBe(values.cwd);
    expect(substituted).toHaveLength(argv.length);
  }
});

test("setup requires an independent provider before any probe or write", () => {
  const setup = readFileSync(new URL("../../../setup-pstack/SKILL.md", import.meta.url), "utf8");
  const step2 = setup.split("### 2. Load current state")[1].split("### 3.")[0];
  expect(step2).toContain("at least two distinct providers");
  expect(step2).toContain("before probing or writing");
  expect(setup).not.toContain("Require at least one selected family");
  expect(setup.split("### 9. Behavioral smoke")[1]).toContain("independent cross-judge");
});
