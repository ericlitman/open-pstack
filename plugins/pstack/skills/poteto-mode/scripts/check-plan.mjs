#!/usr/bin/env node
import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RULE =
  "Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";
const LANE_SENTENCE =
  "Ten lanes on the configured `swarm workers` role at the PR head";
const BOX = /^\s*- \[[ xX]\] (.*)$/;
const TOP_BOX = /^- \[[ xX]\] (.*)$/;

/**
 * @typedef {"none" | "any" | "lanes" | "ordered-leads" | "gate"} BoxShape
 */

/**
 * @typedef {object} PerfLead
 * @property {string} lead
 * @property {"nonempty" | "trunk-first" | "numeric"} payload
 */

/**
 * @typedef {object} PrBlock
 * @property {string} name
 * @property {BoxShape} shape
 * @property {boolean} [opensWithRule]
 * @property {string} [save]
 * @property {string} [passWhen]
 * @property {readonly PerfLead[]} [leads]
 * @property {RegExp} [nonePattern]
 * @property {string} [gatedRest]
 * @property {readonly string[]} [gatedStarts]
 */

/**
 * @typedef {object} PunctuationRule
 * @property {string} message
 * @property {RegExp} pattern
 */

/**
 * @typedef {object} PlanContract
 * @property {string} rule
 * @property {string} laneSentence
 * @property {number} laneCount
 * @property {number} introMaxNonBlank
 * @property {string} howToRead
 * @property {string} program
 * @property {string} close
 * @property {RegExp} prTitle
 * @property {readonly string[]} appendices
 * @property {readonly string[]} screenshotExt
 * @property {readonly PrBlock[]} prBlocks
 * @property {readonly string[]} programSections
 * @property {readonly string[]} programMarkers
 * @property {readonly string[]} howToReadMarkers
 * @property {readonly PunctuationRule[]} punctuation
 */

/**
 * @typedef {object} CheckResult
 * @property {string[]} problems
 * @property {string[]} report
 * @property {number} prCount
 * @property {boolean} ok
 */

/** @type {readonly PrBlock[]} */
const PR_BLOCKS = Object.freeze([
  { name: "Depends on.", shape: "none" },
  { name: "Files.", shape: "any" },
  { name: "Build.", shape: "any" },
  { name: "You see.", shape: "any" },
  { name: "Verify, unit.", shape: "any", opensWithRule: true },
  {
    name: "Verify, live.",
    shape: "lanes",
    opensWithRule: true,
    save: "Save `",
    passWhen: "Pass when",
  },
  {
    name: "Verify, perf.",
    shape: "ordered-leads",
    opensWithRule: true,
    leads: [
      { lead: "Metric.", payload: "nonempty" },
      { lead: "Probe.", payload: "nonempty" },
      { lead: "Baseline.", payload: "trunk-first" },
      { lead: "Rule.", payload: "numeric" },
    ],
  },
  {
    name: "Review gate.",
    shape: "gate",
    nonePattern: /^None\. \S+ is not review-gated\.$/,
    gatedRest: "The operator reviews before merge.",
    gatedStarts: [
      "Copy lane",
      "Record a 30 to 60 second video",
      "Post the screenshots and the video in chat",
    ],
  },
  { name: "Merge.", shape: "any" },
]);

/** @type {PlanContract} */
export const CONTRACT = Object.freeze({
  rule: RULE,
  laneSentence: LANE_SENTENCE,
  laneCount: 10,
  introMaxNonBlank: 9,
  howToRead: "How to read this",
  program: "Program checklist",
  close: "Close the program",
  prTitle: /^.+ \([^)]+\)$/,
  appendices: Object.freeze([
    "Appendix A. Prototype evidence",
    "Appendix B. Alternatives rejected",
    "Appendix C. Risks",
    "Appendix D. Links and reading list",
  ]),
  screenshotExt: Object.freeze([".png", ".jpg", ".jpeg", ".webp"]),
  prBlocks: PR_BLOCKS,
  programSections: Object.freeze([
    "Arm the program",
    "Spawn owners",
    "PR mechanics, for every PR",
    "Verdict and merge, for every PR",
    "Boot recipe, for every live lane",
  ]),
  programMarkers: Object.freeze([
    "the installed plugin",
    "hourly",
    "status message",
  ]),
  howToReadMarkers: Object.freeze([
    "One box is one unit of work",
    "names the evidence",
    "Check a box only when its evidence exists",
    "playbooks/",
    RULE,
  ]),
  punctuation: Object.freeze([
    { message: "long dash", pattern: /[\u2013\u2014]/ },
    {
      message: "curly quote",
      pattern: /[\u2018\u2019\u201c\u201d]/,
    },
    { message: "mid-sentence colon", pattern: /: \S/ },
  ]),
});

const SUB_BLOCKS = CONTRACT.prBlocks.map((block) => block.name);

/**
 * @param {string} raw
 * @returns {{ n: number, text: string, code: boolean }[]}
 */
function toLines(raw) {
  const split = raw.split(/\r?\n/);
  let start = 0;
  if (split[0] === "---") {
    const close = split.indexOf("---", 1);
    start = close === -1 ? 0 : close + 1;
  }
  const lines = [];
  /** @type {{ char: string, length: number } | null} */
  let fence = null;
  for (let i = start; i < split.length; i++) {
    const text = split[i] ?? "";
    const n = i + 1;
    let code = fence !== null;
    if (fence && closesFence(text, fence)) {
      fence = null;
      code = false;
    } else if (!fence) {
      fence = opensFence(text);
      code = fence !== null;
    }
    lines.push({ n, text, code });
  }
  return lines;
}

/**
 * @param {string} text
 * @returns {{ char: string, length: number } | null}
 */
function opensFence(text) {
  const match = text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const marker = match?.[1];
  if (!marker || (marker[0] === "`" && match[2]?.includes("`"))) return null;
  return { char: marker[0] ?? "", length: marker.length };
}

/**
 * @param {string} text
 * @param {{ char: string, length: number }} opening
 */
function closesFence(text, opening) {
  const marker = text.match(/^ {0,3}(`+|~+)[ \t]*$/)?.[1];
  return marker !== undefined && marker[0] === opening.char && marker.length >= opening.length;
}

/**
 * @param {{ n: number, text: string, code: boolean }[]} lines
 * @param {(line: number, message: string) => void} fail
 */
function checkPunctuation(lines, fail) {
  for (const line of lines) {
    if (line.code) continue;
    const prose = line.text
      .replace(/(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)/g, "`")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\]\([^)]*\)/g, "]");
    for (const rule of CONTRACT.punctuation) {
      if (rule.pattern.test(prose)) fail(line.n, rule.message);
    }
  }
}

/**
 * @param {{ n: number, text: string, code: boolean }[]} lines
 * @returns {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]}
 */
function toSections(lines) {
  /** @type {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} */
  const sections = [];
  for (const line of lines) {
    const title =
      !line.code && line.text.startsWith("## ")
        ? line.text.slice(3).trim()
        : null;
    if (title !== null) sections.push({ title, n: line.n, body: [] });
    else if (sections.length > 0) {
      const current = sections[sections.length - 1];
      if (current) current.body.push(line);
    }
  }
  return sections;
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} sections
 * @param {string} title
 */
function findSection(sections, title) {
  return sections.find((section) => section.title === title);
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }} section
 */
function bodyText(section) {
  return section.body.map((line) => line.text).join("\n");
}

/**
 * @param {{ n: number, text: string, code: boolean }[]} lines
 * @param {RegExp} [pattern]
 * @returns {{ n: number, text: string }[]}
 */
function boxes(lines, pattern = BOX) {
  /** @type {{ n: number, text: string }[]} */
  const found = [];
  for (const line of lines) {
    if (line.code) continue;
    const match = line.text.match(pattern);
    if (match && match[1] !== undefined) {
      found.push({ n: line.n, text: match[1] });
    }
  }
  return found;
}

/**
 * @param {{ n: number, text: string, code: boolean }[]} lines
 */
function topBoxes(lines) {
  return boxes(lines, TOP_BOX);
}

/**
 * @param {string} rest
 * @param {PerfLead["payload"]} kind
 */
function hasPayload(rest, kind) {
  switch (kind) {
    case "nonempty":
      return /[A-Za-z0-9<]/.test(rest);
    case "trunk-first":
      return (
        /[A-Za-z0-9<]/.test(rest) &&
        /\btrunk\b/i.test(rest) &&
        /\bfirst\b/i.test(rest)
      );
    case "numeric":
      return /\d/.test(rest);
    default:
      return true;
  }
}

/**
 * @param {string} text
 * @param {string} save
 */
function namedScreenshot(text, save) {
  const start = text.indexOf(save);
  if (start === -1) return false;
  const from = start + save.length;
  const end = text.indexOf("`", from);
  if (end === -1) return false;
  const inner = text.slice(from, end).toLowerCase();
  return CONTRACT.screenshotExt.some((ext) => inner.endsWith(ext));
}

/**
 * @param {string} text
 * @param {string} passWhen
 */
function namedPassPredicate(text, passWhen) {
  const at = text.indexOf(passWhen);
  if (at === -1) return false;
  return /[A-Za-z0-9<]/.test(text.slice(at + passWhen.length));
}

/**
 * @param {{ n: number, text: string, code: boolean }[]} lines
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} sections
 * @param {(line: number, message: string) => void} fail
 */
function checkPreamble(lines, sections, fail) {
  const h1s = lines.filter(
    (line) => !line.code && line.text.startsWith("# "),
  );
  const h1 = h1s[0];
  if (h1s.length === 0) {
    fail(1, "no H1 title");
  } else if (h1s.length !== 1) {
    fail(1, `found ${h1s.length} H1 titles, exactly one required`);
  }
  const howToRead = findSection(sections, CONTRACT.howToRead);
  if (!howToRead) fail(1, `no "## ${CONTRACT.howToRead}" section`);
  if (h1 && howToRead) {
    const intro = lines.filter(
      (line) =>
        line.n > h1.n && line.n < howToRead.n && line.text.trim() !== "",
    );
    if (intro.length > CONTRACT.introMaxNonBlank) {
      fail(h1.n, `intro is ${intro.length} lines, under ten required`);
    }
    const text = bodyText(howToRead);
    for (const marker of CONTRACT.howToReadMarkers) {
      if (!text.includes(marker)) {
        fail(howToRead.n, `${CONTRACT.howToRead} lacks "${marker}"`);
      }
    }
  }
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} sections
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] } | undefined} program
 * @param {(line: number, message: string) => void} fail
 */
function checkLowerHeadings(sections, program, fail) {
  for (const section of sections) {
    for (const line of section.body) {
      if (line.code || !/^#{3,6} /.test(line.text)) continue;
      if (section === program && line.text.startsWith("### ")) continue;
      fail(line.n, `"${line.text.trim()}" is an unexpected heading`);
    }
  }
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} sections
 * @param {(line: number, message: string) => void} fail
 */
function checkUnexpectedHeadings(sections, fail) {
  const how = findSection(sections, CONTRACT.howToRead);
  const program = findSection(sections, CONTRACT.program);
  if (how) {
    for (const section of sections) {
      if (section.n < how.n) {
        fail(section.n, `"## ${section.title}" is an unexpected heading`);
      }
    }
  }
  if (how && program) {
    const howIndex = sections.indexOf(how);
    const programIndex = sections.indexOf(program);
    if (howIndex !== -1 && programIndex !== -1) {
      for (const section of sections.slice(howIndex + 1, programIndex)) {
        fail(section.n, `"## ${section.title}" is an unexpected heading`);
      }
    }
  }
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }} section
 * @param {(line: number, message: string) => void} fail
 */
function checkProgram(section, fail) {
  const h3s = section.body
    .filter((line) => !line.code && line.text.startsWith("### "))
    .map((line) => line.text.slice(4).trim());
  if (h3s.join("|") !== CONTRACT.programSections.join("|")) {
    fail(
      section.n,
      `Program checklist H3s are [${h3s.join(", ")}], expected [${CONTRACT.programSections.join(", ")}]`,
    );
  }
  const text = bodyText(section);
  for (const marker of CONTRACT.programMarkers) {
    if (!text.includes(marker)) {
      fail(section.n, `Program checklist lacks "${marker}"`);
    }
  }
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }} section
 */
function headingsOf(section) {
  /** @type {{ name: string, n: number, rest: string, lines: { n: number, text: string, code: boolean }[] }[]} */
  const heads = [];
  for (const line of section.body) {
    if (line.code) continue;
    const match = line.text.match(/^\*\*([^*]+)\*\*(.*)$/);
    if (match && match[1] !== undefined) {
      heads.push({
        name: match[1],
        n: line.n,
        rest: (match[2] ?? "").trim(),
        lines: [],
      });
    } else if (heads.length > 0) {
      const current = heads[heads.length - 1];
      if (current) current.lines.push(line);
    }
  }
  return heads;
}

/**
 * @param {string} prTitle
 * @param {{ n: number, rest: string, lines: { n: number, text: string, code: boolean }[] }} live
 * @param {PrBlock} spec
 * @param {(line: number, message: string) => void} fail
 */
function checkLanes(prTitle, live, spec, fail) {
  if (!live.rest.includes(CONTRACT.laneSentence)) {
    fail(
      live.n,
      `${prTitle}: Verify, live lacks "${CONTRACT.laneSentence}"`,
    );
  }
  const save = spec.save;
  const passWhen = spec.passWhen;
  if (save === undefined || passWhen === undefined) return;
  const laneBoxes = topBoxes(live.lines);
  const expected = Array.from(
    { length: CONTRACT.laneCount },
    (_, i) => i + 1,
  ).join(",");
  /** @type {number[]} */
  const numbers = [];
  for (const lane of laneBoxes) {
    const match = lane.text.match(/^Lane (\d+)\. /);
    if (!match || match[1] === undefined) {
      fail(lane.n, `${prTitle}: live box is not a lane`);
      continue;
    }
    const laneNo = match[1];
    numbers.push(Number(laneNo));
    if (!namedScreenshot(lane.text, save)) {
      fail(lane.n, `${prTitle}: lane ${laneNo} names no screenshot`);
    }
    if (!namedPassPredicate(lane.text, passWhen)) {
      fail(lane.n, `${prTitle}: lane ${laneNo} has no pass predicate`);
    }
  }
  if (numbers.join(",") !== expected) {
    fail(
      live.n,
      `${prTitle}: lanes are [${numbers.join(",")}], expected 1 to ${CONTRACT.laneCount}`,
    );
  }
}

/**
 * @param {string} prTitle
 * @param {{ n: number, lines: { n: number, text: string, code: boolean }[] }} heading
 * @param {PrBlock} spec
 * @param {(line: number, message: string) => void} fail
 */
function checkOrderedLeads(prTitle, heading, spec, fail) {
  const leads = spec.leads;
  if (!leads) return;
  const items = topBoxes(heading.lines);
  const expected = leads.map((item) => item.lead).join("|");
  const observed = items.map((box) => box.text.split(" ")[0]).join("|");
  if (observed !== expected) {
    fail(
      heading.n,
      `${prTitle}: perf boxes are [${items.map((box) => box.text.split(" ")[0]).join(", ")}], expected [${leads.map((item) => item.lead).join(", ")}]`,
    );
  }
  for (const box of items) {
    const specLead = leads.find((item) => box.text.startsWith(item.lead));
    if (!specLead) continue;
    const rest = box.text.slice(specLead.lead.length).trim();
    if (hasPayload(rest, specLead.payload)) continue;
    const why =
      specLead.payload === "numeric"
        ? "names no numeric failure threshold"
        : specLead.payload === "trunk-first"
          ? "names no trunk-first baseline"
          : "has no payload";
    fail(box.n, `${prTitle}: ${specLead.lead} ${why}`);
  }
}

/**
 * @param {string} prTitle
 * @param {{ n: number, rest: string, lines: { n: number, text: string, code: boolean }[] }} gate
 * @param {PrBlock} spec
 * @param {(line: number, message: string) => void} fail
 */
function checkGate(prTitle, gate, spec, fail) {
  const nonePattern = spec.nonePattern;
  const gatedRest = spec.gatedRest;
  const gatedStarts = spec.gatedStarts;
  if (!nonePattern || gatedRest === undefined || !gatedStarts) return;
  const all = boxes(gate.lines);
  if (nonePattern.test(gate.rest)) {
    if (all.length > 0) {
      fail(gate.n, `${prTitle}: Review gate says None but has boxes`);
    }
    return;
  }
  const texts = topBoxes(gate.lines).map((box) => box.text);
  const restOk = gate.rest === gatedRest;
  const boxesOk =
    texts.length === gatedStarts.length &&
    gatedStarts.every((start, i) => (texts[i] ?? "").startsWith(start));
  if (restOk && boxesOk) return;
  if (restOk) {
    fail(
      gate.n,
      `${prTitle}: Review gate boxes are [${texts.map((text) => text.split(" ")[0]).join(", ")}], expected [${gatedStarts.join(", ")}]`,
    );
    return;
  }
  fail(
    gate.n,
    `${prTitle}: Review gate is not the gated evidence flow or "None. <PR id> is not review-gated."`,
  );
}

/**
 * @param {string} prTitle
 * @param {{ name: string, n: number, rest: string, lines: { n: number, text: string, code: boolean }[] }} heading
 * @param {PrBlock} spec
 * @param {(line: number, message: string) => void} fail
 */
function checkBlock(prTitle, heading, spec, fail) {
  if (spec.opensWithRule && !heading.rest.startsWith(CONTRACT.rule)) {
    fail(heading.n, `${prTitle}: ${spec.name} does not open with the rule`);
  }
  switch (spec.shape) {
    case "none":
      if (heading.rest === "") {
        fail(heading.n, `${prTitle}: Depends on names nothing`);
      }
      if (boxes(heading.lines).length > 0) {
        fail(heading.n, `${prTitle}: Depends on. has a box`);
      }
      break;
    case "any":
      if (boxes(heading.lines).length === 0) {
        fail(heading.n, `${prTitle}: ${spec.name} has no box`);
      }
      break;
    case "lanes":
      checkLanes(prTitle, heading, spec, fail);
      break;
    case "ordered-leads":
      checkOrderedLeads(prTitle, heading, spec, fail);
      break;
    case "gate":
      checkGate(prTitle, heading, spec, fail);
      break;
  }
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }} section
 * @param {{ name: string, lines: { n: number, text: string, code: boolean }[] }[]} heads
 */
function reportLine(section, heads) {
  const counts = Object.fromEntries(
    heads.map((head) => [head.name, boxes(head.lines).length]),
  );
  const total = boxes(section.body).length;
  const cells = SUB_BLOCKS.filter((name) => name !== "Depends on.").map(
    (name) =>
      `${name.replace(/[ ,.]+/g, "-").replace(/-$/, "").toLowerCase()}=${counts[name] ?? 0}`,
  );
  return `${section.title}  boxes=${total}  ${cells.join(" ")}`;
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }} section
 * @param {(line: number, message: string) => void} fail
 */
function checkPrSection(section, fail) {
  const heads = headingsOf(section);
  const names = heads.map((head) => head.name);
  if (names.join("|") !== SUB_BLOCKS.join("|")) {
    fail(
      section.n,
      `${section.title}: sub-blocks are [${names.join(", ")}], expected [${SUB_BLOCKS.join(", ")}]`,
    );
  }
  const byName = Object.fromEntries(heads.map((head) => [head.name, head]));
  for (const spec of CONTRACT.prBlocks) {
    const heading = byName[spec.name];
    if (heading) checkBlock(section.title, heading, spec, fail);
  }
  return reportLine(section, heads);
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} sections
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] } | undefined} program
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] } | undefined} close
 * @param {(line: number, message: string) => void} fail
 */
function collectPrSections(sections, program, close, fail) {
  if (!program || !close) return [];
  const programIndex = sections.indexOf(program);
  const closeIndex = sections.indexOf(close);
  if (programIndex === -1 || closeIndex === -1) return [];
  if (closeIndex <= programIndex) {
    fail(1, "no PR sections between Program checklist and Close the program");
    return [];
  }
  const between = sections.slice(programIndex + 1, closeIndex);
  if (between.length === 0) {
    fail(1, "no PR sections between Program checklist and Close the program");
    return [];
  }
  /** @type {typeof between} */
  const prs = [];
  for (const section of between) {
    if (!CONTRACT.prTitle.test(section.title)) {
      fail(section.n, `"## ${section.title}" is not a PR title`);
      continue;
    }
    prs.push(section);
  }
  if (prs.length === 0) {
    fail(1, "no PR sections between Program checklist and Close the program");
  }
  return prs;
}

/**
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] }[]} sections
 * @param {{ title: string, n: number, body: { n: number, text: string, code: boolean }[] } | undefined} close
 * @param {(line: number, message: string) => void} fail
 */
function checkAppendices(sections, close, fail) {
  if (!close) return;
  const closeIndex = sections.indexOf(close);
  if (closeIndex === -1) return;
  const tail = sections.slice(closeIndex + 1);
  const titles = tail.map((section) => section.title);
  if (titles.join("|") === CONTRACT.appendices.join("|")) return;
  fail(
    close.n,
    `appendices are [${titles.join(", ")}], expected [${CONTRACT.appendices.join(", ")}]`,
  );
}

/**
 * @param {string} raw
 * @param {string} [file]
 * @returns {CheckResult}
 */
export function checkPlan(raw, file = "plan.md") {
  /** @type {string[]} */
  const problems = [];
  /** @param {number} line @param {string} message */
  const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);
  const lines = toLines(raw);
  checkPunctuation(lines, fail);
  const sections = toSections(lines);
  checkPreamble(lines, sections, fail);
  checkUnexpectedHeadings(sections, fail);

  const program = findSection(sections, CONTRACT.program);
  if (!program) fail(1, `no "## ${CONTRACT.program}" section`);
  else checkProgram(program, fail);
  checkLowerHeadings(sections, program, fail);

  const close = findSection(sections, CONTRACT.close);
  if (!close) fail(1, `no "## ${CONTRACT.close}" section`);

  const prSections = collectPrSections(sections, program, close, fail);
  const report = [];
  for (const section of prSections) report.push(checkPrSection(section, fail));
  checkAppendices(sections, close, fail);

  return {
    problems,
    report,
    prCount: prSections.length,
    ok: problems.length === 0,
  };
}

/**
 * @param {string} playbookRaw
 * @returns {string}
 */
export function extractSkeleton(playbookRaw) {
  const lines = playbookRaw.split(/\r?\n/);
  /** @type {number[]} */
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").startsWith("````markdown")) starts.push(i);
  }
  if (starts.length !== 1) {
    throw new Error(
      `expected exactly one fenced skeleton, found ${starts.length}`,
    );
  }
  const start = starts[0] ?? -1;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^````\s*$/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("unclosed skeleton fence");
  return `${lines.slice(start + 1, end).join("\n")}\n`;
}

function isCliEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === fs.realpathSync(resolve(entry));
}

function main() {
  if (process.argv.length !== 3) {
    console.error("Usage: node check-plan.mjs <plan.md>");
    process.exit(2);
  }
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node check-plan.mjs <plan.md>");
    process.exit(2);
  }
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const result = checkPlan(raw, file);
  for (const line of result.report) console.log(line);
  console.log(`${result.prCount} PR sections, ${result.problems.length} problems`);
  for (const problem of result.problems) console.error(problem);
  process.exit(result.problems.length ? 1 : 0);
}

if (isCliEntry()) main();
