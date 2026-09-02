import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT, checkPlan, extractSkeleton } from "./check-plan.mjs";

const SCRIPT = join(import.meta.dir, "check-plan.mjs");
const PLAYBOOK = join(import.meta.dir, "../playbooks/multi-phase-plan.md");
const directories: string[] = [];

const FORBIDDEN_FENCE = [
  "/goal",
  "/loop",
  "control-ui",
  "control-cli",
  "git show origin/main:",
  "grok-4.6-fast-xhigh",
  "~/.claude",
  "../references/",
  "/tmp",
  "her explicit go",
  "On her go",
];

const INTRO =
  "<Under ten lines. What changes, for whom, the rule the program enforces, and the PR ids in order.>";

function replaceOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first === -1) {
    throw new Error(`missing mutation target: ${JSON.stringify(target)}`);
  }
  const second = source.indexOf(target, first + target.length);
  if (second !== -1) {
    throw new Error(`duplicated mutation target: ${JSON.stringify(target)}`);
  }
  return (
    source.slice(0, first) + replacement + source.slice(first + target.length)
  );
}

function removePhrase(source: string, phrase: string): string {
  if (!source.includes(phrase)) {
    throw new Error(`missing contract phrase: ${JSON.stringify(phrase)}`);
  }
  return source.split(phrase).join("");
}

function introLines(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `Intro line ${index + 1} states the change.`,
  ).join("\n");
}

function contractPhrases(): string[] {
  const phrases: string[] = [
    CONTRACT.rule,
    CONTRACT.laneSentence,
    CONTRACT.howToRead,
    CONTRACT.program,
    CONTRACT.close,
    ...CONTRACT.appendices,
    ...CONTRACT.programSections,
    ...CONTRACT.howToReadMarkers,
    ...CONTRACT.programMarkers,
    ...CONTRACT.prBlocks.map((block) => block.name),
  ];
  for (const block of CONTRACT.prBlocks) {
    if (block.leads) phrases.push(...block.leads.map((item) => item.lead));
    if (block.save) phrases.push(block.save);
    if (block.passWhen) phrases.push(block.passWhen);
    if (block.gatedRest) phrases.push(block.gatedRest);
    if (block.gatedStarts) phrases.push(...block.gatedStarts);
    if (block.shape === "lanes") {
      for (let i = 1; i <= CONTRACT.laneCount; i++) {
        phrases.push(`Lane ${i}.`);
      }
    }
  }
  return [...new Set(phrases)];
}

function problemsOf(source: string, file = "plan.md"): string[] {
  return checkPlan(source, file).problems;
}

function runNode(args: readonly string[], script = SCRIPT): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = Bun.spawnSync(["node", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function writePlan(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "check-plan-"));
  directories.push(directory);
  const file = join(directory, "plan.md");
  await writeFile(file, source);
  return file;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const playbook = await readFile(PLAYBOOK, "utf8");
const skeleton = extractSkeleton(playbook);

describe("check-plan", () => {
  it("accepts the extracted playbook skeleton", () => {
    const result = checkPlan(skeleton, "skeleton.md");
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.prCount).toBe(1);
    expect(result.report[0]).toContain("verify-live=10");
    expect(result.report[0]).toContain("verify-perf=4");
  });

  it("rejects the playbook file as checker input", () => {
    const result = checkPlan(playbook, "multi-phase-plan.md");
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("no H1 title"))).toBe(true);
  });

  it("keeps the copied fence free of harness-private strings", () => {
    for (const item of FORBIDDEN_FENCE) {
      expect(skeleton.includes(item), item).toBe(false);
    }
    expect(skeleton).toContain("30-minute");
    expect(skeleton).toContain(CONTRACT.laneSentence);
  });

  it("makes every contract phrase load-bearing", () => {
    for (const phrase of contractPhrases()) {
      expect(skeleton.includes(phrase), phrase).toBe(true);
      const mutated = removePhrase(skeleton, phrase);
      expect(problemsOf(mutated).length, phrase).toBeGreaterThan(0);
    }
  });

  it("accepts an ungated review block", () => {
    const ungated = replaceOnce(
      skeleton,
      `**Review gate.** The operator reviews before merge.

- [ ] Copy lane <n> screenshots into \`<media path>/<pr-id>-review-<slug>.png\`.
- [ ] Record a 30 to 60 second video of the change on a live lane. Save it as \`<media path>/<pr-id>-review.mp4\`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.`,
      "**Review gate.** None. PR1 is not review-gated.",
    );
    const result = checkPlan(ungated, "ungated.md");
    expect(result.problems).toEqual([]);
  });

  it("accepts a nine-line intro", () => {
    const mutated = replaceOnce(skeleton, INTRO, introLines(CONTRACT.introMaxNonBlank));
    expect(problemsOf(mutated)).toEqual([]);
  });

  it("accepts nested sub-boxes under live and perf", () => {
    const withLaneNest = replaceOnce(
      skeleton,
      "- [ ] Lane 3. <Scenario.> Save `<slug>.png`. Pass when <predicate>.\n",
      "- [ ] Lane 3. <Scenario.> Save `<slug>.png`. Pass when <predicate>.\n  - [ ] Reset cookies first.\n",
    );
    const mutated = replaceOnce(
      withLaneNest,
      "- [ ] Probe. <The command or procedure, run at trunk and at the head, interleaved. Both sides must produce the metric.>\n",
      "- [ ] Probe. <The command or procedure, run at trunk and at the head, interleaved. Both sides must produce the metric.>\n  - [ ] Warm the cache first.\n",
    );
    expect(problemsOf(mutated)).toEqual([]);
  });

  it("accepts capital-X checked boxes", () => {
    const mutated = replaceOnce(
      skeleton,
      "- [ ] Lane 1. Regression lane against trunk. Run <the same load-bearing scenario> at trunk and head. If trunk lacks the feature, record that and gate <the behavior the diff adds plus the end state the user waits for>. Save `<slug>.png`. Pass when <predicate>.",
      "- [X] Lane 1. Regression lane against trunk. Run <the same load-bearing scenario> at trunk and head. If trunk lacks the feature, record that and gate <the behavior the diff adds plus the end state the user waits for>. Save `<slug>.png`. Pass when <predicate>.",
    );
    expect(problemsOf(mutated)).toEqual([]);
  });

  it("reports a missing screenshot and an empty pass predicate independently", () => {
    const mutated = replaceOnce(
      skeleton,
      "Lane 5. <Scenario.> Save `<slug>.png`. Pass when <predicate>.",
      "Lane 5. <Scenario.>",
    );
    const problems = problemsOf(mutated).join("\n");
    expect(problems).toContain("lane 5 names no screenshot");
    expect(problems).toContain("lane 5 has no pass predicate");
  });

  const rejections: ReadonlyArray<readonly [string, string, string]> = [
    [
      "a missing Program checklist",
      replaceOnce(skeleton, "## Program checklist", "## Program list"),
      "no \"## Program checklist\" section",
    ],
    [
      "a missing How to read this heading",
      replaceOnce(skeleton, "## How to read this", "## How to parse this"),
      "no \"## How to read this\" section",
    ],
    [
      "a missing Close the program heading",
      replaceOnce(skeleton, "## Close the program", "## Shut the program"),
      "no \"## Close the program\" section",
    ],
    [
      "reordered program and PR headings",
      replaceOnce(
        replaceOnce(
          replaceOnce(skeleton, "## Program checklist", "## TMP heading"),
          "## <Task as a verb phrase> (<PR id>)",
          "## Program checklist",
        ),
        "## TMP heading",
        "## <Task as a verb phrase> (<PR id>)",
      ),
      "no PR sections between Program checklist and Close the program",
    ],
    [
      "reordered PR blocks",
      replaceOnce(
        replaceOnce(
          replaceOnce(skeleton, "**Build.**", "**TMP.**"),
          "**You see.**",
          "**Build.**",
        ),
        "**TMP.**",
        "**You see.**",
      ),
      "sub-blocks are",
    ],
    [
      "empty Depends on rest",
      replaceOnce(skeleton, "**Depends on.** <PR id, or None.>", "**Depends on.**"),
      "Depends on names nothing",
    ],
    [
      "Depends on with a box",
      replaceOnce(
        skeleton,
        "**Depends on.** <PR id, or None.>\n",
        "**Depends on.** <PR id, or None.>\n\n- [ ] Merge PR0 first.\n",
      ),
      "Depends on. has a box",
    ],
    [
      "Files with no box",
      replaceOnce(
        skeleton,
        `**Files.**

- [ ] Edit \`<path>\`.
- [ ] Create \`<path>\`.
- [ ] Delete \`<path>\`.`,
        "**Files.**",
      ),
      "Files. has no box",
    ],
    [
      "a dropped live lane",
      replaceOnce(
        skeleton,
        "- [ ] Lane 10. <Scenario.> Save `<slug>.png`. Pass when <predicate>.\n",
        "",
      ),
      "expected 1 to 10",
    ],
    [
      "reordered live lanes",
      replaceOnce(
        replaceOnce(
          replaceOnce(skeleton, "Lane 9.", "Lane TMP."),
          "Lane 10.",
          "Lane 9.",
        ),
        "Lane TMP.",
        "Lane 10.",
      ),
      "lanes are [1,2,3,4,5,6,7,8,10,9]",
    ],
    [
      "a lane with no screenshot",
      replaceOnce(
        skeleton,
        "Lane 4. <Scenario.> Save `<slug>.png`. Pass when <predicate>.",
        "Lane 4. <Scenario.> Pass when <predicate>.",
      ),
      "lane 4 names no screenshot",
    ],
    [
      "a fake screenshot path",
      replaceOnce(
        skeleton,
        "Lane 4. <Scenario.> Save `<slug>.png`. Pass when <predicate>.",
        "Lane 4. <Scenario.> Save `notes.txt`. Pass when <predicate>.",
      ),
      "lane 4 names no screenshot",
    ],
    [
      "a lane with no pass predicate",
      replaceOnce(
        skeleton,
        "Lane 7. <Scenario.> Save `<slug>.png`. Pass when <predicate>.",
        "Lane 7. <Scenario.> Save `<slug>.png`.",
      ),
      "lane 7 has no pass predicate",
    ],
    [
      "an empty pass predicate",
      replaceOnce(
        skeleton,
        "Lane 7. <Scenario.> Save `<slug>.png`. Pass when <predicate>.",
        "Lane 7. <Scenario.> Save `<slug>.png`. Pass when.",
      ),
      "lane 7 has no pass predicate",
    ],
    [
      "a live box that is not a lane",
      replaceOnce(
        skeleton,
        "Lane 2. <Scenario.> Save `<slug>.png`. Pass when <predicate>.",
        "Extra. Save `<slug>.png`. Pass when <predicate>.",
      ),
      "live box is not a lane",
    ],
    [
      "a hard-coded Cursor Grok string",
      replaceOnce(
        skeleton,
        CONTRACT.laneSentence,
        "Ten lanes on `grok-4.6-fast-xhigh` at the PR head",
      ),
      `Verify, live lacks "${CONTRACT.laneSentence}"`,
    ],
    [
      "incomplete perf evidence",
      replaceOnce(skeleton, "- [ ] Rule. <Head against trunk, with the number that fails, such as 20. If the scenarios differ, add absolute budgets for the diff-added work and the user-visible end state instead of an invalid ratio.>\n", ""),
      "perf boxes are",
    ],
    [
      "swapped perf leads",
      replaceOnce(
        replaceOnce(
          replaceOnce(skeleton, "Baseline.", "TMP."),
          "Probe.",
          "Baseline.",
        ),
        "TMP.",
        "Probe.",
      ),
      "expected [Metric., Probe., Baseline., Rule.]",
    ],
    [
      "an empty Metric payload",
      replaceOnce(
        skeleton,
        "- [ ] Metric. <What is measured at both trunk and head. If trunk lacks the feature, also name the diff-added work and the end-to-end state the user waits for.>",
        "- [ ] Metric.",
      ),
      "Metric. has no payload",
    ],
    [
      "an empty Probe payload",
      replaceOnce(
        skeleton,
        "- [ ] Probe. <The command or procedure, run at trunk and at the head, interleaved. Both sides must produce the metric.>",
        "- [ ] Probe.",
      ),
      "Probe. has no payload",
    ],
    [
      "a Baseline without trunk-first wording",
      replaceOnce(
        skeleton,
        "- [ ] Baseline. Record the trunk <value> first.",
        "- [ ] Baseline. Record the <value>.",
      ),
      "Baseline. names no trunk-first baseline",
    ],
    [
      "a Rule without a numeric threshold",
      replaceOnce(
        skeleton,
        "- [ ] Rule. <Head against trunk, with the number that fails, such as 20. If the scenarios differ, add absolute budgets for the diff-added work and the user-visible end state instead of an invalid ratio.>",
        "- [ ] Rule. Head against trunk.",
      ),
      "Rule. names no numeric failure threshold",
    ],
    [
      "a None review gate that keeps boxes",
      replaceOnce(
        skeleton,
        "**Review gate.** The operator reviews before merge.",
        "**Review gate.** None. PR1 is not review-gated.",
      ),
      "Review gate says None but has boxes",
    ],
    [
      "a malformed None review gate",
      replaceOnce(
        skeleton,
        `**Review gate.** The operator reviews before merge.

- [ ] Copy lane <n> screenshots into \`<media path>/<pr-id>-review-<slug>.png\`.
- [ ] Record a 30 to 60 second video of the change on a live lane. Save it as \`<media path>/<pr-id>-review.mp4\`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.`,
        "**Review gate.** None.",
      ),
      "Review gate is not the gated evidence flow or \"None. <PR id> is not review-gated.\"",
    ],
    [
      "a keyword-soup review gate",
      replaceOnce(
        skeleton,
        `**Review gate.** The operator reviews before merge.

- [ ] Copy lane <n> screenshots into \`<media path>/<pr-id>-review-<slug>.png\`.
- [ ] Record a 30 to 60 second video of the change on a live lane. Save it as \`<media path>/<pr-id>-review.mp4\`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.`,
        "**Review gate.** screenshot video operator",
      ),
      "Review gate is not the gated evidence flow or \"None. <PR id> is not review-gated.\"",
    ],
    [
      "a gated review missing video",
      replaceOnce(
        skeleton,
        `**Review gate.** The operator reviews before merge.

- [ ] Copy lane <n> screenshots into \`<media path>/<pr-id>-review-<slug>.png\`.
- [ ] Record a 30 to 60 second video of the change on a live lane. Save it as \`<media path>/<pr-id>-review.mp4\`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.`,
        `**Review gate.** The operator reviews before merge.

- [ ] Copy lane <n> screenshots into \`<media path>/<pr-id>-review-<slug>.png\`.
- [ ] Record a 30 to 60 second clip of the change on a live lane. Save it as \`<media path>/<pr-id>-review.mp4\`.
- [ ] Post the screenshots in chat. Stop at merge-ready. Wait for the operator's click.`,
      ),
      "expected [Copy lane, Record a 30 to 60 second video, Post the screenshots and the video in chat]",
    ],
    [
      "a non-appendix tail heading",
      replaceOnce(
        skeleton,
        "## Appendix A. Prototype evidence",
        "## Extra notes\n\n## Appendix A. Prototype evidence",
      ),
      "appendices are [Extra notes, Appendix A. Prototype evidence, Appendix B. Alternatives rejected, Appendix C. Risks, Appendix D. Links and reading list], expected [Appendix A. Prototype evidence, Appendix B. Alternatives rejected, Appendix C. Risks, Appendix D. Links and reading list]",
    ],
    [
      "reordered appendices",
      replaceOnce(
        replaceOnce(
          replaceOnce(skeleton, "## Appendix A. Prototype evidence", "## Appendix TMP"),
          "## Appendix B. Alternatives rejected",
          "## Appendix A. Prototype evidence",
        ),
        "## Appendix TMP",
        "## Appendix B. Alternatives rejected",
      ),
      "expected [Appendix A. Prototype evidence, Appendix B. Alternatives rejected, Appendix C. Risks, Appendix D. Links and reading list]",
    ],
    [
      "a missing prototype appendix",
      replaceOnce(
        skeleton,
        "## Appendix A. Prototype evidence",
        "## Appendix A. Other evidence",
      ),
      "expected [Appendix A. Prototype evidence, Appendix B. Alternatives rejected, Appendix C. Risks, Appendix D. Links and reading list]",
    ],
    [
      "an unknown heading before Close the program",
      replaceOnce(
        skeleton,
        "## Close the program",
        "## Extra notes\n\n## Close the program",
      ),
      "\"## Extra notes\" is not a PR title",
    ],
    [
      "an unexpected H3 inside a PR",
      replaceOnce(
        skeleton,
        "**Depends on.** <PR id, or None.>",
        "### Hidden work\n\n**Depends on.** <PR id, or None.>",
      ),
      '"### Hidden work" is an unexpected heading',
    ],
    [
      "a second H1",
      replaceOnce(
        skeleton,
        "## How to read this",
        "# Extra program\n\n## How to read this",
      ),
      "found 2 H1 titles, exactly one required",
    ],
    [
      "a malformed PR heading",
      replaceOnce(
        skeleton,
        "## <Task as a verb phrase> (<PR id>)",
        "## Task without an id",
      ),
      "\"## Task without an id\" is not a PR title",
    ],
    [
      "an extra program H3",
      replaceOnce(
        skeleton,
        "### Spawn owners",
        "### Extra owners\n\n### Spawn owners",
      ),
      "Program checklist H3s are",
    ],
    [
      "a ten-line intro",
      replaceOnce(skeleton, INTRO, introLines(CONTRACT.introMaxNonBlank + 1)),
      "intro is 10 lines, under ten required",
    ],
    [
      "a long dash",
      replaceOnce(skeleton, "One box is one unit of work", "One box is one unit of work\u2014"),
      "long dash",
    ],
    [
      "a curly quote",
      replaceOnce(skeleton, "One box is one unit of work", "One box is one unit of work\u2019"),
      "curly quote",
    ],
    [
      "a mid-sentence colon",
      replaceOnce(skeleton, "The body is a how-to.", "The body is a how-to: now."),
      "mid-sentence colon",
    ],
    [
      "a verify block without the rule",
      replaceOnce(
        skeleton,
        "**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.",
        "**Verify, unit.** Skip the rule.",
      ),
      "Verify, unit. does not open with the rule",
    ],
  ];

  it.each(rejections)("rejects %s", (_name, mutated, expected) => {
    expect(problemsOf(mutated).join("\n")).toContain(expected);
  });

  it("CLI exits 0 on the extracted skeleton", async () => {
    const file = await writePlan(skeleton);
    const result = runNode([file]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 PR sections, 0 problems");
    expect(result.stderr).toBe("");
  });

  it("CLI exits 1 and prints the problem", async () => {
    const file = await writePlan(replaceOnce(skeleton, "- [ ] Baseline.", "- [ ] Base."));
    const result = runNode([file]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("perf boxes are");
    expect(result.stdout).toContain("1 PR sections,");
  });

  it("CLI exits 2 when the plan path is missing", () => {
    const result = runNode([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: node check-plan.mjs <plan.md>");
  });

  it("CLI exits 2 when extra arguments are present", async () => {
    const file = await writePlan(skeleton);
    const result = runNode([file, "extra"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: node check-plan.mjs <plan.md>");
    expect(result.stdout).toBe("");
  });

  it("CLI exits 2 when the plan file cannot be read", () => {
    const result = runNode([join(tmpdir(), "check-plan-missing.md")]);
    expect(result.status).toBe(2);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).not.toContain("Usage: node check-plan.mjs <plan.md>");
  });

  it("CLI runs through a symlinked install path", async () => {
    const file = await writePlan(skeleton);
    const directory = await mkdtemp(join(tmpdir(), "check-plan-link-"));
    directories.push(directory);
    const link = join(directory, "check-plan.mjs");
    await symlink(SCRIPT, link);
    const result = runNode([file], link);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 PR sections, 0 problems");
    expect(result.stderr).toBe("");
  });
});
