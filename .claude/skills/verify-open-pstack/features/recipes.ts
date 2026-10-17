import { Database } from 'bun:sqlite';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, type Command } from '../scripts/io.ts';
import type { Harness, SessionRecord } from '../scripts/types.ts';

export interface Fixture {
  harness: Harness;
  dir: string;
  workspace: string;
  location: string;
  configHome: string;
  run: Command;
}
export interface Evidence { assertions: string[]; files: string[] }
export interface Case {
  id: string;
  cwd?: 'workspace';
  /** Codex parents that launch external provider CLIs need network and their CLI state outside the fixture. */
  codexSandbox?: 'danger-full-access';
  /** Claude refuses Write into its own config folder in dontAsk mode even with --add-dir; setup must write there. */
  claudePermission?: 'bypassPermissions';
  prepare?(fixture: Fixture): Promise<void>;
  prompt(fixture: Fixture): string;
  assert(record: SessionRecord, fixture: Fixture): Promise<Evidence>;
}

export const CLAUDE_TOOLS = 'Skill,Read,Glob,Grep,Write,Edit,Bash,Agent,Task,TodoWrite';
export const DEFAULT_ROLES: Record<Harness, string> = { claude: 'bug-fix', codex: 'judgment and prose' };
export const ROUTE = /^([a-z][a-z0-9-]*):([A-Za-z0-9._/-]+)@([a-z]+)$/;
const SETUP_DESCRIPTOR = 'claude:opus@high';
const DESCRIPTOR = /\b[a-z][a-z0-9-]*:[A-Za-z0-9._/-]+@[a-z]+/g;
const SHEET_HEADER = '# pstack model configuration\n\n';
const SETTING = 'codex writer sandbox: ';
const FULL_ACCESS_SETTING = `${SETTING}full-access`, BOUNDED_SETTING = `${SETTING}bounded`;
const WRITER_ROLE = 'feature, refactoring', WRITER_LANE = 'codex:gpt-6.1-sol@max';

export interface Catalog {
  defaults: Map<string, string[]>;
  kept: Map<string, string>;
  route(harness: Harness, descriptor: string): 'native' | 'external';
}

export async function readCatalog(location: string): Promise<Catalog> {
  const text = await readFile(join(location, 'skills/poteto-mode/references/model-catalog.md'), 'utf8');
  const section = (heading: string) => text.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
  const rows = (body: string) => body.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| ---')).map(line => line.slice(2, -2).split(' | '));
  const sheet = /```markdown\n([\s\S]*?)```/.exec(section('Role defaults'))?.[1] ?? '';
  const defaults = new Map(sheet.split('\n').filter(line => /^[a-z][^:]*: \S/.test(line))
    .map((line): [string, string[]] => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2).split(', ')]));
  const kept = new Map(rows(section('Kept predecessors and normalization').split('\nRolling aliases:')[0]!).slice(1)
    .map(([provider, model, , current]): [string, string] => [`${provider}:${model}`, `${provider}:${current}`]));
  const [header = [], ...routes] = rows(section('Routes'));
  const column = { claude: header.indexOf('Claude Code parent'), codex: header.indexOf('Codex parent') };
  if (!defaults.size || column.claude < 0 || column.codex < 0) throw new Error('catalog-unreadable');
  return { defaults, kept, route(harness, descriptor) {
    if (!descriptor.includes(':')) return 'native';
    const cell = routes.find(row => row[0] === descriptor.slice(0, descriptor.indexOf(':')))?.[column[harness]];
    if (cell === undefined) throw new Error(`catalog-route-missing:${descriptor}`);
    return cell.startsWith('native') ? 'native' : 'external';
  } };
}

const sheetText = (lines: [string, string[]][]): string => SHEET_HEADER + lines.map(([role, lanes]) => `${role}: ${lanes.join(', ')}`).join('\n') + '\n';
const roleLines = (text: string): string[] => text.split('\n').filter(line => /^[a-z][^:]*: \S/.test(line) && !line.startsWith(SETTING));
const settingLines = (text: string): string[] => text.split('\n').filter(line => line.startsWith(SETTING));
const sh = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

const rules = (dir: string): string => `Work only inside ${dir}. Do not push, post, open, merge, or modify pull requests, issues, or remote branches, and do not write outside ${dir}. Do not edit any skill, plugin, or configuration file outside ${dir}. Do not ask questions: where the skill would ask, choose its documented default and continue. This is a headless session that ends at your first final reply and stops any background work still running, so run every command and subagent in the foreground, even where the skill says to use the background, and finish all work before you reply.`;

export function invoke(harness: Harness, skill: string, text: string): string {
  if (harness === 'codex') return `$pstack:${skill} ${text}`;
  return skill.startsWith('principle-') ? `Load the skill pstack:${skill} with your Skill tool and follow it. ${text}` : `/pstack:${skill} ${text}`;
}

function loaded(record: SessionRecord, skill: string): string {
  if (!record.skills.includes(skill)) throw new Error(`skill-not-loaded:${skill}`);
  return 'skill-loaded';
}

async function written(record: SessionRecord, path: string): Promise<string> {
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || !info.size || info.mtimeMs < record.started) throw new Error(`fixture-file-missing:${basename(path)}`);
  return `file:${basename(path)}`;
}

async function git(fixture: Fixture, ...args: string[]): Promise<string> {
  return fixture.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: fixture.dir });
}

async function files(dir: string, contents: Record<string, string>): Promise<void> {
  for (const [name, text] of Object.entries(contents)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), text);
  }
}

const TASK = {
  'README.md': '# Fixture\n\nA tiny module used to exercise one pstack skill.\n',
  'TASK.md': 'sum(2, 3) returns -1 instead of 5. Find the cause and propose the smallest fix.\n',
  'sum.mjs': 'export function sum(a, b) {\n  return a - b;\n}\n',
  'sum.test.mjs': "import { sum } from './sum.mjs';\nif (sum(2, 3) !== 5) throw new Error('sum(2, 3) should be 5');\n",
  'ci.sh': '#!/bin/sh\nbun sum.test.mjs\n',
};

async function taskRepository(fixture: Fixture): Promise<void> {
  await files(fixture.dir, TASK);
  await git(fixture, 'init', '-q', '-b', 'main');
  await git(fixture, 'add', '.');
  await git(fixture, 'commit', '-qm', 'Add sum module');
}

function skillCase(skill: string, request: string, check?: (record: SessionRecord, fixture: Fixture) => Promise<Evidence>, prepare: (fixture: Fixture) => Promise<void> = taskRepository): Case {
  return {
    id: 'invoke',
    prepare,
    prompt: f => `${invoke(f.harness, skill, `${request.replaceAll('$DIR', f.dir)} Write the skill's result to ${join(f.dir, 'result.md')}.`)} ${rules(f.dir)}`,
    async assert(record, f) {
      const assertions = [loaded(record, `pstack:${skill}`), await written(record, join(f.dir, 'result.md'))], paths = [join(f.dir, 'result.md')];
      if (check) { const extra = await check(record, f); assertions.push(...extra.assertions); paths.push(...extra.files); }
      return { assertions, files: paths };
    },
  };
}

async function ciFixed(_record: SessionRecord, f: Fixture): Promise<Evidence> {
  if (!/return\s+a\s*\+\s*b/.test(await readFile(join(f.dir, 'sum.mjs'), 'utf8'))) throw new Error('ci-not-fixed:sum.mjs');
  return { assertions: ['fixed:sum.mjs'], files: [join(f.dir, 'sum.mjs')] };
}

const overrides: Record<string, Case> = {
  'fix-ci': skillCase('fix-ci', 'There is no pull request or remote. The failing CI check is the local command `sh ci.sh` in $DIR. Fix it locally and do not push.', ciFixed),
  babysit: skillCase('babysit', 'The pull request is the local `main` branch of the repository at $DIR; there is no remote. Its one failing check is the local command `sh ci.sh`. Do exactly one babysit pass: fix the failing check locally, push nothing, change nothing remote, then stop instead of watching.', ciFixed),
  'make-pr-easy-to-review': skillCase('make-pr-easy-to-review', 'The pull request is the local branch `feature` against `main` in $DIR; there is no remote. Do not rewrite history or push; write reviewer guidance only.', async (_record, f) => {
    if ((await git(f, 'rev-parse', 'feature')).trim() !== (await readFile(`${f.dir}.head`, 'utf8')).trim()) throw new Error('history-rewritten:feature');
    return { assertions: ['history-unchanged'], files: [] };
  }, async f => {
    await taskRepository(f);
    await git(f, 'checkout', '-qb', 'feature');
    await writeFile(join(f.dir, 'sum.mjs'), 'export function sum(a, b) {\n  return a + b;\n}\n'); await git(f, 'commit', '-qam', 'wip');
    await writeFile(join(f.dir, 'README.md'), '# Fixture\n\nA tiny sum module.\n'); await git(f, 'commit', '-qam', 'fix typo');
    await writeFile(`${f.dir}.head`, await git(f, 'rev-parse', 'feature'));
  }),
  'automate-me': {
    id: 'invoke',
    prompt: f => `${invoke(f.harness, 'automate-me', `My handle is fixture. There is no history to mine for this workspace, so skip mining. My answers to your questions: concise replies, and verify with tests before claiming done. Write the drafted skill to ${join(f.dir, '.claude/skills/fixture-mode/SKILL.md')}.`)} ${rules(f.dir)}`,
    async assert(record, f) {
      const path = join(f.dir, '.claude/skills/fixture-mode/SKILL.md'), assertions = [loaded(record, 'pstack:automate-me'), await written(record, path)];
      if (!/name:\s*fixture-mode/.test(await readFile(path, 'utf8'))) throw new Error('mode-skill-unnamed');
      return { assertions: [...assertions, 'mode-skill'], files: [path] };
    },
  },
};

const REFLECT_CHAT = '00000000-1111-2222-3333-444444444444';
const REFLECT_OPENING = 'Reflect on the corrections in this disposable session.';
const REFLECT_UNRELATED = 'An unrelated synthetic opener written for the fixture.';
const RESOLVER = 'skills/poteto-mode/scripts/resolve-codex-transcript';

function parseJson(text: string | undefined): unknown {
  try { return JSON.parse(text ?? ''); } catch { return undefined; }
}

function reflect(harness: Harness): Case[] {
  return [true, false].map(available => {
    const home = (f: Fixture) => join(f.dir, 'transcript-home');
    let nonce = '';
    const transcript = (f: Fixture) => join(home(f), harness === 'codex' ? `sessions/2026/10/11/rollout-${nonce}.jsonl` : 'projects/fixture/known.jsonl');
    const index = (f: Fixture) => join(home(f), 'state_5.sqlite');
    const report = (f: Fixture) => join(f.dir, 'result.json');
    const digest = (f: Fixture) => join(f.dir, 'digest.md');
    const text = available ? REFLECT_OPENING : REFLECT_UNRELATED;
    return {
      id: available ? 'locate-transcript' : 'digest-fallback',
      async prepare(f) {
        nonce = crypto.randomUUID();
        const records = harness === 'codex' ? [
          { type: 'session_meta', payload: { id: REFLECT_CHAT } },
          { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${f.dir}\n\n<INSTRUCTIONS>\nFixture only.\n</INSTRUCTIONS>` }] } },
          { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } },
        ] : [{ type: 'system', subtype: 'fixture_metadata' }, { type: 'user', uuid: nonce, message: { role: 'user', content: [{ type: 'text', text }] } }];
        await files(f.dir, { [transcript(f).slice(f.dir.length + 1)]: records.map(record => JSON.stringify(record)).join('\n') + '\n' });
        if (harness === 'codex') {
          await rm(index(f), { force: true });
          const database = new Database(index(f));
          database.run('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)');
          database.run('INSERT INTO threads VALUES (?, ?)', [REFLECT_CHAT, transcript(f)]);
          database.close();
        }
      },
      prompt(f) {
        const request = `Exercise only step 1 with this disposable synthetic fixture. Do not fan out reviewers, apply edits, or inspect real chats. The conversation's opening prompt to verify is ${JSON.stringify(REFLECT_OPENING)}. `;
        const where = harness === 'codex'
          ? `The fixture's known parent chat ID is ${REFLECT_CHAT}. Run the transcript lookup with CODEX_HOME set to ${home(f)} for that command only. `
          : `For this fixture, the system-named per-project transcript directory is ${join(home(f), 'projects/fixture')}. Write only JSON to ${report(f)}: when a transcript verifies, its status "resolved", path, and opening_user_message with line, characters, sha256, and the uuid of that user record; otherwise status "unresolved", reason "opening_message_mismatch", fallback "session_digest", and uuid, the uuid of the opening user record you inspected. Do not include message text in ${report(f)}. `;
        return `${invoke(harness, 'reflect', `${request}${where}If the transcript cannot be verified, write the session digest, at most 2,000 words and covering only this fixture request, to ${digest(f)}.`)} ${rules(f.dir)}`;
      },
      async assert(record, f) {
        const assertions = [loaded(record, 'pstack:reflect')];
        const paths: string[] = [];
        if (harness === 'codex') {
          const expected = { status: 'resolved', chat_id: REFLECT_CHAT, path: transcript(f),
            opening_user_message: { line: 3, record_type: 'response_item', characters: text.length, sha256: sha256(text) } };
          const installed = [RESOLVER, `${RESOLVER}.ts`].map(path => join(f.location, path));
          const names = [...installed, ...await Promise.all(installed.map(path => realpath(path)))];
          const output = record.tools.find(tool => tool.name === 'command' && !tool.failed && names.some(name => tool.input.command.includes(name)) &&
            Bun.deepEquals(parseJson(tool.result), expected))?.result;
          if (output === undefined) throw new Error('reflect-resolver-not-run');
          const retained = join(f.dir, 'resolver-output.json');
          await writeFile(retained, output);
          paths.push(retained); assertions.push('resolver-ran');
        } else {
          assertions.push(await written(record, report(f)));
          const expected = available
            ? { status: 'resolved', path: transcript(f), opening_user_message: { line: 2, characters: text.length, sha256: sha256(text), uuid: nonce } }
            : { status: 'unresolved', reason: 'opening_message_mismatch', fallback: 'session_digest', uuid: nonce };
          if (!Bun.deepEquals(parseJson(await readFile(report(f), 'utf8')), expected)) {
            throw new Error(available ? 'reflect-opening-mismatch' : 'reflect-fallback-mismatch');
          }
          paths.push(report(f));
        }
        if (available) {
          if (await lstat(digest(f)).catch(() => undefined)) throw new Error('reflect-unneeded-fallback');
          assertions.push('opening-verified');
        } else {
          assertions.push(await written(record, digest(f)));
          const words = (await readFile(digest(f), 'utf8')).trim();
          if (!words) throw new Error('reflect-digest-empty');
          if (words.split(/\s+/).length > 2000) throw new Error('reflect-digest-budget');
          paths.push(digest(f)); assertions.push('digest-fallback');
        }
        return { assertions, files: paths };
      },
    };
  });
}

export async function verifyProjectDoctor(texts: string[], workspace: string): Promise<void> {
  const expected = await realpath(join(workspace, '.claude/skills/verify-open-pstack'));
  for (const text of texts) {
    try {
      const d = JSON.parse(text);
      if (d.result === 'pass' && d.candidate === true && typeof d.skill === 'string' && await realpath(d.skill) === expected) return;
    } catch {}
  }
  throw new Error('Self-test requires the pinned project skill\'s passing child doctor.json');
}

const projectSkill: Case = {
  id: 'doctor',
  cwd: 'workspace',
  prompt: f => `${f.harness === 'claude' ? '/verify-open-pstack' : '$verify-open-pstack'} Run exactly this command and nothing else: ${join(f.workspace, '.claude/skills/verify-open-pstack/scripts/verify.sh')} doctor --candidate --output ${join(f.dir, 'doctor')}. Do not run verify.sh run, log in, or publish anything.`,
  async assert(record, f) {
    const skill = await realpath(join(f.workspace, '.claude/skills/verify-open-pstack/SKILL.md'));
    const found = f.harness === 'claude' ? record.skills.includes('verify-open-pstack')
      : (await Promise.all(record.skills.map(path => realpath(path).catch(() => '')))).includes(skill);
    if (!found) throw new Error('skill-not-loaded:verify-open-pstack');
    if (!record.commands.some(c => c.includes('verify.sh') && c.includes('doctor --candidate'))) throw new Error('doctor-not-run');
    const report = join(f.dir, 'doctor/doctor.json');
    await verifyProjectDoctor([await readFile(report, 'utf8')], f.workspace);
    return { assertions: ['skill-loaded', 'doctor-ran', 'doctor-canonical-pass'], files: [report] };
  },
};

const writer: Case = {
  id: 'linked-worktree-writer',
  codexSandbox: 'danger-full-access',
  async prepare(f) {
    const repo = join(f.dir, 'writer-repo');
    await git(f, 'init', '-q', '-b', 'main', repo);
    await git(f, '-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    await git(f, '-C', repo, 'worktree', 'add', '-q', '-b', 'writer', join(f.dir, 'writer-lane'));
    await writeFile(join(f.dir, 'writer.prompt.md'), 'Create the file WRITTEN.md in the current directory containing the single word PONG, then reply DONE.\n');
  },
  prompt: f => `${invoke(f.harness, 'poteto-mode', `Dispatch exactly one external lane and nothing else. Run the installed launcher ${join(f.location, 'skills/poteto-mode/scripts/runner/pstack-runner')} with these arguments and wait for it to exit: --parent codex --provider claude --model opus --effort max --mode isolated-write --prompt ${join(f.dir, 'writer.prompt.md')} --cwd ${join(f.dir, 'writer-lane')} --output ${join(f.dir, 'writer.output.md')} --receipt ${join(f.dir, 'writer.receipt.json')}`)}. ${rules(f.dir)}`,
  async assert(record, f) {
    if (!record.commands.some(c => c.includes('pstack-runner'))) throw new Error('runner-not-run');
    const receipt = JSON.parse(await readFile(join(f.dir, 'writer.receipt.json'), 'utf8')), lane = join(f.dir, 'writer-lane');
    if (receipt.status !== 'complete') throw new Error(`receipt-status:${receipt.status}`);
    if (receipt.parent !== 'codex' || receipt.provider !== 'claude' || receipt.model !== 'opus' || receipt.effort !== 'max' || receipt.mode !== 'isolated-write' || receipt.cwd !== lane) throw new Error('receipt-route-mismatch');
    if (receipt.outputPath !== join(f.dir, 'writer.output.md') || !(Date.parse(receipt.startedAt) >= record.started)) throw new Error('receipt-not-this-session');
    const settings = parseJson(receipt.argv[receipt.argv.indexOf('--settings') + 1]) as { sandbox?: { filesystem?: { denyWrite?: unknown } } } | undefined;
    if (!Bun.deepEquals(settings?.sandbox?.filesystem?.denyWrite, [await realpath(join(f.dir, 'writer-repo/.git'))])) throw new Error('shared-git-not-denied');
    const effect = await written(record, join(lane, 'WRITTEN.md'));
    if ((await readFile(join(lane, 'WRITTEN.md'), 'utf8')).trim() !== 'PONG') throw new Error('writer-effect-mismatch:WRITTEN.md');
    return { assertions: ['runner-ran', 'receipt-complete', 'shared-git-denied', effect], files: [join(f.dir, 'writer.receipt.json'), join(lane, 'WRITTEN.md')] };
  },
};

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function browser(): Promise<string> {
  if (await lstat(CHROME).catch(() => undefined)) return CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  try {
    for await (const path of new Bun.Glob('chromium-*/*/*.app/Contents/MacOS/*').scan({ cwd: cache })) return join(cache, path);
  } catch {}
  return CHROME;
}

const BOUNDED_WRITER_LANE = 'codex:gpt-6.1-sol@low';
function codexWriter(optIn: boolean): Case {
  const name = optIn ? 'full-access' : 'bounded', descriptor = optIn ? WRITER_LANE : BOUNDED_WRITER_LANE;
  const [sandbox, argvSandbox] = optIn ? ['full-access', 'danger-full-access'] : ['bounded', 'workspace-write'];
  const at = (f: Fixture, file: string) => join(f.dir, `${name}.${file}`), lane = (f: Fixture) => join(f.dir, `${name}-lane`);
  const result = (f: Fixture) => join(lane(f), optIn ? '.agents/result.json' : 'result.json');
  let fileNonce = '', pageNonce = '';
  return {
    id: `${name}-writer`,
    async prepare(f) {
      const installed = await readCatalog(f.location);
      if (installed.route('claude', descriptor) !== 'external') throw new Error(`runner-route-not-external:${descriptor}`);
      fileNonce = crypto.randomUUID(); pageNonce = crypto.randomUUID();
      await mkdir(lane(f));
      await writeFile(at(f, 'sheet.md'), sheetText([...installed.defaults].map(([role, lanes]) => [role, role === WRITER_ROLE ? [descriptor] : lanes])) + (optIn ? `${FULL_ACCESS_SETTING}\n` : ''));
      if (!optIn) {
        await writeFile(at(f, 'prompt.md'), `Create the file result.json in the current directory containing only the JSON {"written":"${fileNonce}"}, and reply DONE.\n`);
        return;
      }
      await writeFile(at(f, 'page.html'), `<!doctype html><html><body><p id="nonce"></p><script>document.getElementById('nonce').textContent = atob('${btoa(pageNonce)}');</script></body></html>\n`);
      await writeFile(at(f, 'prompt.md'), `Run this command and read the text of the element with id "nonce" in the DOM it prints: ${sh(await browser())} --headless --no-first-run ${sh(`--user-data-dir=${at(f, 'browser-profile')}`)} --dump-dom ${sh(pathToFileURL(at(f, 'page.html')).href)}\nThen create the file .agents/result.json in the current directory containing only the JSON {"written":"${fileNonce}","browser":"<the text you read>"}, and reply DONE.\n`);
    },
    prompt: f => `${invoke('claude', 'poteto-mode', `Do no engineering work. For this task the pstack model sheet is ${at(f, 'sheet.md')}; use it in place of any configured sheet. Dispatch exactly one lane and nothing else: the first descriptor of its "${WRITER_ROLE}" role as an isolated-write writer, on the route and with the launcher arguments provider dispatch gives this parent. Use the prompt file ${at(f, 'prompt.md')}, the dedicated directory ${lane(f)} as its cwd, the output ${at(f, 'output.md')} and the receipt ${at(f, 'receipt.json')}, and wait for the lane to exit.`)} ${rules(f.dir)}`,
    async assert(record, f) {
      if (!record.commands.some(c => c.includes('pstack-runner'))) throw new Error('runner-not-run');
      const receipt = JSON.parse(await readFile(at(f, 'receipt.json'), 'utf8')), [, provider, model, effort] = ROUTE.exec(descriptor)!;
      if (receipt.status !== 'complete') throw new Error(`receipt-status:${receipt.status}`);
      if (receipt.parent !== 'claude' || receipt.provider !== provider || receipt.model !== model || receipt.effort !== effort || receipt.mode !== 'isolated-write' || receipt.cwd !== lane(f)) throw new Error('receipt-route-mismatch');
      if (receipt.outputPath !== at(f, 'output.md') || !(Date.parse(receipt.startedAt) >= record.started)) throw new Error('receipt-not-this-session');
      const flag = receipt.argv.indexOf('--sandbox');
      if (receipt.writerSandbox !== sandbox || receipt.argv[flag + 1] !== argvSandbox || (!optIn && receipt.argv.includes('danger-full-access'))) throw new Error(`writer-sandbox:${receipt.writerSandbox}`);
      const effect = await written(record, result(f));
      if (!Bun.deepEquals(parseJson(await readFile(result(f), 'utf8')), optIn ? { written: fileNonce, browser: pageNonce } : { written: fileNonce })) throw new Error(`${name}-effect-mismatch`);
      return { assertions: ['runner-ran', 'receipt-complete', `writer-sandbox:${sandbox}`, effect, ...(optIn ? ['browser-nonce'] : [])], files: [at(f, 'receipt.json'), result(f)] };
    },
  };
}

function runner(harness: Harness, routes: string[]): Case[] {
  const chosen = routes.filter(route => !route.startsWith(`${harness}:`));
  const cases = (chosen.length ? chosen : ['']).map((fixed, index): Case => {
    let route = fixed, provider = '', model = '', effort = '';
    const lane = (f: Fixture, name: string) => join(f.dir, `lane-${index + 1}.${name}`);
    return {
      id: `route-${index + 1}`,
      codexSandbox: 'danger-full-access',
      async prepare(f) {
        const installed = await readCatalog(f.location);
        route ||= installed.defaults.get(DEFAULT_ROLES[harness])?.[0] ?? '';
        const parts = ROUTE.exec(route);
        if (!parts || installed.route(harness, route) !== 'external') throw new Error(`runner-route-not-external:${route || DEFAULT_ROLES[harness]}`);
        [, provider = '', model = '', effort = ''] = parts;
        await writeFile(lane(f, 'prompt.md'), 'Reply with the single word PONG.\n');
      },
      prompt: f => `${invoke(f.harness, 'poteto-mode', `Dispatch exactly one external lane and nothing else. Run the installed launcher ${join(f.location, 'skills/poteto-mode/scripts/runner/pstack-runner')} with these arguments and wait for it to exit: --parent ${harness} --provider ${provider} --model ${model} --effort ${effort} --mode read-only --prompt ${lane(f, 'prompt.md')} --cwd ${f.dir} --output ${lane(f, 'output.md')} --receipt ${lane(f, 'receipt.json')}`)}. ${rules(f.dir)}`,
      async assert(record, f) {
        if (!record.commands.some(c => c.includes('pstack-runner'))) throw new Error('runner-not-run');
        const receipt = JSON.parse(await readFile(lane(f, 'receipt.json'), 'utf8'));
        if (receipt.status !== 'complete') throw new Error(`receipt-status:${receipt.status}`);
        if (receipt.parent !== harness || receipt.provider !== provider || receipt.model !== model || receipt.effort !== effort || receipt.mode !== 'read-only') throw new Error('receipt-route-mismatch');
        if (receipt.outputPath !== lane(f, 'output.md') || !(Date.parse(receipt.startedAt) >= record.started)) throw new Error('receipt-not-this-session');
        return { assertions: ['runner-ran', 'receipt-complete', `route:${route}`, await written(record, lane(f, 'output.md'))], files: [lane(f, 'receipt.json'), lane(f, 'output.md')] };
      },
    };
  });
  return harness === 'codex' ? [...cases, writer] : [...cases, codexWriter(true), codexWriter(false)];
}

const setup: Case[] = [{
  id: 'configure',
  codexSandbox: 'danger-full-access',
  claudePermission: 'bypassPermissions',
  async prepare(f) {
    const sheet = join(f.configHome, 'pstack-models.md'), text = await readFile(sheet, 'utf8').catch(() => undefined);
    if (text !== undefined) await writeFile(sheet, text.split('\n').filter(line => !line.startsWith(SETTING)).join('\n'));
  },
  prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Role assignments: change every role assigned to a model-matrix family to the Opus family, and keep inherit-parent and auto roles unchanged. Opus requested effort: high. When setup asks whether Codex writer lanes should run with full access, answer yes. I confirm every write. Write the setup report to ${join(f.dir, 'result.md')}.`)} Do not push, post, or contact GitHub.`,
  async assert(record, f) {
    const sheet = join(f.configHome, 'pstack-models.md'), assertions = [loaded(record, 'pstack:setup-pstack'), await written(record, sheet)];
    const text = await readFile(sheet, 'utf8'), descriptors = text.match(DESCRIPTOR) ?? [];
    if (!descriptors.length || descriptors.some(d => d !== SETUP_DESCRIPTOR)) throw new Error('sheet-descriptors-mismatch');
    if (!Bun.deepEquals(settingLines(text), [FULL_ACCESS_SETTING])) throw new Error('setting-not-full-access');
    return { assertions: [...assertions, `sheet:${SETUP_DESCRIPTOR}`, `setting:${FULL_ACCESS_SETTING}`], files: [sheet] };
  },
}, {
  id: 'consume',
  prompt: f => `${invoke(f.harness, 'poteto-mode', `Do no engineering work. Read the configured pstack model sheet and write to ${join(f.dir, 'route.txt')} one line naming the descriptor configured for the "judgment and prose" role and the route this parent uses for it.`)} ${rules(f.dir)}`,
  async assert(record, f) {
    const path = join(f.dir, 'route.txt'), assertions = [loaded(record, 'pstack:poteto-mode'), await written(record, path)];
    if (!(await readFile(path, 'utf8')).includes(SETUP_DESCRIPTOR)) throw new Error('consumer-route-mismatch');
    return { assertions: [...assertions, 'consumer-route'], files: [path] };
  },
}, keptPredecessor(), newFamilies(), readOnlyProvider(), writerRefusal(), keepSetting(), {
  id: 'first-run',
  codexSandbox: 'danger-full-access',
  claudePermission: 'bypassPermissions',
  async prepare(f) {
    await rm(join(f.configHome, 'pstack-models.md'), { force: true });
    if (f.harness === 'codex') await rm(join(f.configHome, 'AGENTS.md'), { force: true });
  },
  prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Keep the first-run role assignments and every proposed effort. I confirm every write. Write the setup report to ${join(f.dir, 'result.md')}.`)} Do not push, post, or contact GitHub.`,
  async assert(record, f) {
    const sheet = join(f.configHome, 'pstack-models.md'), assertions = [loaded(record, 'pstack:setup-pstack'), await written(record, sheet)];
    const text = await readFile(sheet, 'utf8');
    if (!Bun.deepEquals(roleLines(text), [...(await readCatalog(f.location)).defaults].map(([role, lanes]) => `${role}: ${lanes.join(', ')}`))) throw new Error('first-run-not-role-defaults');
    bounded(text);
    return { assertions: [...assertions, ...await mirrored(f, sheet), 'sheet:role-defaults', `setting:${BOUNDED_SETTING}`], files: [sheet] };
  },
}];

function bounded(text: string): void {
  if (!Bun.deepEquals(settingLines(text), [BOUNDED_SETTING])) throw new Error('setting-not-bounded');
}

const MIRROR_BEGIN = '<!-- pstack:models:begin -->', MIRROR_END = '<!-- pstack:models:end -->';
export async function mirrored(f: Fixture, sheet: string): Promise<string[]> {
  if (f.harness !== 'codex') return [];
  const agents = await readFile(join(f.configHome, 'AGENTS.md'), 'utf8').catch(() => '');
  const once = (marker: string) => agents.split(marker).length === 2;
  const from = agents.indexOf(MIRROR_BEGIN) + MIRROR_BEGIN.length, to = agents.indexOf(MIRROR_END);
  if (!once(MIRROR_BEGIN) || !once(MIRROR_END) || to < from || agents.slice(from, to) !== `\n${await readFile(sheet, 'utf8')}`) {
    throw new Error('codex-mirror-mismatch');
  }
  return ['codex-mirror'];
}

const KEPT = 'grok:grok-4.6', KEPT_EFFORT = 'high';
function keptPredecessor(): Case {
  const proposal = (f: Fixture) => join(f.dir, 'proposal.json');
  let expected: string[] = [], proposed = '';
  return {
    id: 'keep-predecessor',
    codexSandbox: 'danger-full-access',
    claudePermission: 'bypassPermissions',
    async prepare(f) {
      const installed = await readCatalog(f.location), current = installed.kept.get(KEPT);
      if (!current) throw new Error(`catalog-kept-missing:${KEPT}`);
      proposed = `${current}@${KEPT_EFFORT}`;
      const roles = [...installed.defaults].map(([role, lanes]): [string, string[]] => [role, lanes.map(lane => lane.includes(':') ? `${KEPT}@${KEPT_EFFORT}` : lane)]);
      const omitted = roles.find(([, lanes]) => lanes.every(lane => !lane.includes(':')))?.[0];
      expected = roles.map(([role, lanes]) => `${role}: ${lanes.join(', ')}`).sort();
      await writeFile(join(f.configHome, 'pstack-models.md'), sheetText(roles.filter(([role]) => role !== omitted)));
      if (f.harness === 'codex') await rm(join(f.configHome, 'AGENTS.md'), { force: true });
    },
    prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Keep every role assignment and the requested effort ${KEPT_EFFORT}. When setup proposes replacing ${KEPT}, decline and keep it. I confirm every write. Write to ${proposal(f)} only JSON of the form {"kept":"<descriptor>","proposed":"<descriptor>"} naming the kept descriptor and the replacement setup proposed. Write the setup report to ${join(f.dir, 'result.md')}.`)} Do not push, post, or contact GitHub.`,
    async assert(record, f) {
      const sheet = join(f.configHome, 'pstack-models.md'), assertions = [loaded(record, 'pstack:setup-pstack'), await written(record, sheet), await written(record, proposal(f))];
      const text = await readFile(sheet, 'utf8');
      if (!Bun.deepEquals(roleLines(text).sort(), expected)) throw new Error('kept-sheet-mismatch');
      bounded(text);
      if (!Bun.deepEquals(parseJson(await readFile(proposal(f), 'utf8')), { kept: `${KEPT}@${KEPT_EFFORT}`, proposed })) throw new Error('proposal-mismatch');
      return { assertions: [...assertions, ...await mirrored(f, sheet), `kept:${KEPT}@${KEPT_EFFORT}`, `proposed:${proposed}`, `setting:${BOUNDED_SETTING}`], files: [sheet, proposal(f)] };
    },
  };
}

const NEW_FAMILY_LANES: Record<string, [string, string]> = {
  'swarm workers': ['codex:gpt-6-luna@max', 'codex:gpt-6-luna@max'],
  'hardest tasks': ['claude:claude-opus-5-5@max', 'claude:claude-opus-5-5@max'],
  'how explainer': ['claude:claude-sonnet-5-5@max', 'claude:sonnet@max'],
  'judgment and prose': ['claude:claude-opus-5@max', 'claude:opus@max'],
};
function newFamilies(): Case {
  let expected: string[] = [];
  return {
    id: 'new-families',
    codexSandbox: 'danger-full-access',
    claudePermission: 'bypassPermissions',
    async prepare(f) {
      const roles = [...(await readCatalog(f.location)).defaults];
      const lane = (role: string, index: 0 | 1, lanes: string[]) => role in NEW_FAMILY_LANES ? [NEW_FAMILY_LANES[role]![index]] : lanes;
      for (const role of Object.keys(NEW_FAMILY_LANES)) if (!roles.some(([name]) => name === role)) throw new Error(`catalog-role-missing:${role}`);
      expected = roles.map(([role, lanes]) => `${role}: ${lane(role, 1, lanes).join(', ')}`).sort();
      await writeFile(join(f.configHome, 'pstack-models.md'), sheetText(roles.map(([role, lanes]) => [role, lane(role, 0, lanes)])));
      if (f.harness === 'codex') await rm(join(f.configHome, 'AGENTS.md'), { force: true });
    },
    prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Keep every role assignment and every family's current effort. I confirm every write. Write the setup report to ${join(f.dir, 'result.md')}.`)} Do not push, post, or contact GitHub.`,
    async assert(record, f) {
      const sheet = join(f.configHome, 'pstack-models.md'), assertions = [loaded(record, 'pstack:setup-pstack'), await written(record, sheet)];
      const text = await readFile(sheet, 'utf8');
      if (!Bun.deepEquals(roleLines(text).sort(), expected)) throw new Error('new-families-sheet-mismatch');
      bounded(text);
      return {
        assertions: [...assertions, ...await mirrored(f, sheet), ...Object.values(NEW_FAMILY_LANES).map(([, written]) => `sheet:${written}`), `setting:${BOUNDED_SETTING}`],
        files: [sheet],
      };
    },
  };
}

const READ_ONLY_ROLE = 'how explorer', READ_ONLY_LANE = 'devin:swe-2@max';
function readOnlyProvider(): Case {
  let expected: string[] = [];
  return {
    id: 'read-only-provider',
    codexSandbox: 'danger-full-access',
    claudePermission: 'bypassPermissions',
    async prepare(f) {
      const installed = await readCatalog(f.location), roles = [...installed.defaults];
      if (!roles.some(([role]) => role === READ_ONLY_ROLE)) throw new Error(`catalog-role-missing:${READ_ONLY_ROLE}`);
      if (installed.route(f.harness, READ_ONLY_LANE) !== 'external') throw new Error(`catalog-route-not-external:${READ_ONLY_LANE}`);
      const lines = roles.map(([role, lanes]): [string, string[]] => [role, role === READ_ONLY_ROLE ? [READ_ONLY_LANE] : lanes]);
      expected = lines.map(([role, lanes]) => `${role}: ${lanes.join(', ')}`).sort();
      await writeFile(join(f.configHome, 'pstack-models.md'), sheetText(lines));
      if (f.harness === 'codex') await rm(join(f.configHome, 'AGENTS.md'), { force: true });
    },
    prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Keep every role assignment and every family's current effort. I confirm every write. Write the setup report to ${join(f.dir, 'result.md')}.`)} Do not push, post, or contact GitHub.`,
    async assert(record, f) {
      const sheet = join(f.configHome, 'pstack-models.md'), assertions = [loaded(record, 'pstack:setup-pstack'), await written(record, sheet)];
      const text = await readFile(sheet, 'utf8');
      if (!Bun.deepEquals(roleLines(text).sort(), expected)) throw new Error('read-only-provider-sheet-mismatch');
      bounded(text);
      return { assertions: [...assertions, ...await mirrored(f, sheet), `sheet:${READ_ONLY_LANE}`, `setting:${BOUNDED_SETTING}`], files: [sheet] };
    },
  };
}

const REFUSED_ROLE = 'bug-fix';
function writerRefusal(): Case {
  let prepared = '';
  const refusal = (f: Fixture) => join(f.dir, 'refusal.txt');
  return {
    id: 'writer-refusal',
    codexSandbox: 'danger-full-access',
    claudePermission: 'bypassPermissions',
    async prepare(f) {
      const roles = [...(await readCatalog(f.location)).defaults];
      if (!roles.some(([role]) => role === REFUSED_ROLE)) throw new Error(`catalog-role-missing:${REFUSED_ROLE}`);
      prepared = sheetText(roles.map(([role, lanes]) => [role, role === REFUSED_ROLE ? [READ_ONLY_LANE] : lanes]));
      await writeFile(join(f.configHome, 'pstack-models.md'), prepared);
      if (f.harness === 'codex') await rm(join(f.configHome, 'AGENTS.md'), { force: true });
      await rm(refusal(f), { force: true });
    },
    prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Keep every role assignment and every family's current effort. If setup refuses a role assignment, write only setup's refusal message to ${refusal(f)} and stop without changing any configuration.`)} Do not push, post, or contact GitHub.`,
    async assert(record, f) {
      const assertions = [loaded(record, 'pstack:setup-pstack')];
      if (await readFile(join(f.configHome, 'pstack-models.md'), 'utf8') !== prepared) throw new Error('writer-refusal-sheet-changed');
      if (f.harness === 'codex' && await lstat(join(f.configHome, 'AGENTS.md')).then(() => true, () => false)) throw new Error('writer-refusal-integration-written');
      const text = await readFile(refusal(f), 'utf8').catch(() => '');
      if (!text.includes(REFUSED_ROLE) || !text.toLowerCase().includes('devin')) throw new Error('writer-refusal-missing');
      return { assertions: [...assertions, `refused:${REFUSED_ROLE}:${READ_ONLY_LANE}`], files: [refusal(f)] };
    },
  };
}

function keepSetting(): Case {
  let expected: string[] = [];
  return {
    id: 'keep-setting',
    codexSandbox: 'danger-full-access',
    claudePermission: 'bypassPermissions',
    async prepare(f) {
      const roles = [...(await readCatalog(f.location)).defaults];
      const omitted = roles.find(([, lanes]) => lanes.every(lane => !lane.includes(':')))?.[0];
      expected = roles.map(([role, lanes]) => `${role}: ${lanes.join(', ')}`).sort();
      await writeFile(join(f.configHome, 'pstack-models.md'), sheetText(roles.filter(([role]) => role !== omitted)) + `${FULL_ACCESS_SETTING}\n`);
      if (f.harness === 'codex') await rm(join(f.configHome, 'AGENTS.md'), { force: true });
    },
    prompt: f => `${invoke(f.harness, 'setup-pstack', `Use these answers and ask nothing else. Keep every role assignment and every family's current effort. I confirm every write. Write the setup report to ${join(f.dir, 'result.md')}.`)} Do not push, post, or contact GitHub.`,
    async assert(record, f) {
      const sheet = join(f.configHome, 'pstack-models.md'), assertions = [loaded(record, 'pstack:setup-pstack'), await written(record, sheet)];
      const text = await readFile(sheet, 'utf8');
      if (!Bun.deepEquals(settingLines(text), [FULL_ACCESS_SETTING])) throw new Error('setting-not-kept');
      if (!Bun.deepEquals(roleLines(text).sort(), expected)) throw new Error('keep-setting-sheet-mismatch');
      return { assertions: [...assertions, ...await mirrored(f, sheet), `setting:${FULL_ACCESS_SETTING}`], files: [sheet] };
    },
  };
}

const CONFIGURED_ROLE = 'judgment and prose', MISSING_ROLES = ['arena runners', 'bug-fix'];
const CATALOG_LANES: Record<string, [string, string]> = {
  'swarm workers': ['codex:gpt-6-luna@max', 'codex:gpt-6-luna@max'],
  'hardest tasks': ['claude:claude-opus-5-5@max', 'claude:claude-opus-5-5@max'],
  'how explainer': ['claude:claude-sonnet-5-5@high', 'claude:sonnet@high'],
  'how explorer': ['devin:swe-2@max', 'devin:swe-2@max'],
  'interrogate reviewers': ['opencode:opencode/deepseek-v4.1-flash-free@max', 'opencode:opencode/deepseek-v4.1-flash-free@max'],
  [WRITER_ROLE]: [WRITER_LANE, WRITER_LANE],
};
// Each listed generated agent runs natively: the child reads a fixture nonce and writes it to its own output file.
// The Agent call returns only a launch notice, so the evidence is the child's recorded tool calls and the nonce it wrote.
const NATIVE_AGENTS = ['pstack-sonnet-max', 'pstack-opus-5-5-max', 'pstack-haiku-5-5-max'];
const nativeAgents: Case = {
  id: 'native-agents',
  async prepare(f) {
    for (const agent of NATIVE_AGENTS) await writeFile(join(f.dir, `${agent}.nonce`), `${crypto.randomUUID()}\n`);
  },
  prompt: f => `Do no engineering work. ${NATIVE_AGENTS.map(agent => `Use the Agent tool once with subagent_type pstack:${agent}, and give it exactly this task: "Read ${join(f.dir, `${agent}.nonce`)} and write its exact contents to ${join(f.dir, `${agent}.out`)}. Do nothing else."`).join(' ')} Wait until all output files exist, then reply DONE. ${rules(f.dir)}`,
  async assert(record, f) {
    const assertions: string[] = [];
    for (const agent of NATIVE_AGENTS) {
      const call = record.tools.find(t => t.name === 'Agent' && t.input.subagent_type === `pstack:${agent}` && t.input.model === undefined && !t.failed);
      if (!call) throw new Error(`agent-not-dispatched:pstack:${agent}`);
      if (!record.tools.some(t => t.parent === call.id)) throw new Error(`child-did-not-run:pstack:${agent}`);
      const wrote = await readFile(join(f.dir, `${agent}.out`), 'utf8').catch(() => null);
      if (wrote?.trim() !== (await readFile(join(f.dir, `${agent}.nonce`), 'utf8')).trim()) throw new Error(`nonce-mismatch:pstack:${agent}`);
      assertions.push(`native:${agent}`);
    }
    return { assertions, files: NATIVE_AGENTS.map(agent => join(f.dir, `${agent}.out`)) };
  },
};

function consumeSheet(harness: Harness, optIn: boolean): Case {
  const sheet = (f: Fixture) => join(f.dir, 'pstack-models.md'), report = (f: Fixture) => join(f.dir, 'routes.json');
  let expected: { roles: { role: string; descriptors: string[]; routes: string[] }[]; writerSandbox: 'full-access' | null } = { roles: [], writerSandbox: null };
  return {
    id: optIn ? 'consume-sheet' : 'consume-sheet-bounded',
    async prepare(f) {
      const installed = await readCatalog(f.location), defaults = installed.defaults.get(CONFIGURED_ROLE);
      const configured = [...installed.defaults.values()].flat().find(lane => lane.includes(':') && !defaults?.includes(lane));
      if (!defaults || !configured) throw new Error(`catalog-role-missing:${CONFIGURED_ROLE}`);
      const missing = MISSING_ROLES.map(role => ({ role, descriptors: installed.defaults.get(role) ?? [] }));
      if (missing.some(m => !m.descriptors.length)) throw new Error(`catalog-role-missing:${MISSING_ROLES.join(',')}`);
      for (const role of Object.keys(CATALOG_LANES)) if (!installed.defaults.has(role)) throw new Error(`catalog-role-missing:${role}`);
      await writeFile(sheet(f), sheetText([...installed.defaults].filter(([role]) => !MISSING_ROLES.includes(role))
        .map(([role, lanes]) => [role, role === CONFIGURED_ROLE ? [configured] : role in CATALOG_LANES ? [CATALOG_LANES[role]![0]] : lanes])) + `${optIn ? FULL_ACCESS_SETTING : BOUNDED_SETTING}\n`);
      const added = Object.entries(CATALOG_LANES).map(([role, [, dispatched]]) => ({ role, descriptors: [dispatched] }));
      expected = { roles: [{ role: CONFIGURED_ROLE, descriptors: [configured] }, ...missing, ...added]
        .map(r => ({ ...r, routes: r.descriptors.map(d => installed.route(harness, d)) })),
        writerSandbox: optIn && installed.route(harness, WRITER_LANE) === 'external' ? 'full-access' : null };
    },
    prompt: f => `${invoke(f.harness, 'poteto-mode', `Do no engineering work and launch no lane. For this task the pstack model sheet is ${sheet(f)}; use it in place of any configured sheet. For each of these roles, in this order, find the descriptors this parent would dispatch and the route of each: ${expected.roles.map(r => JSON.stringify(r.role)).join(', ')}. Write to ${report(f)} only JSON of the form {"roles":[{"role":"<role>","descriptors":["<provider:model@effort>"],"routes":["native" or "external"]}],"writerSandbox":"<value>" or null}, one route per descriptor, where "native" is this parent's own subagent primitive and "external" is the external runner. writerSandbox is the --writer-sandbox value this parent would pass when it dispatches the first descriptor of the ${JSON.stringify(WRITER_ROLE)} role as an isolated-write writer, or null if it would pass none.`)} ${rules(f.dir)}`,
    async assert(record, f) {
      const assertions = [loaded(record, 'pstack:poteto-mode'), await written(record, report(f))];
      if (!Bun.deepEquals(parseJson(await readFile(report(f), 'utf8')), expected)) throw new Error('catalog-route-mismatch');
      return { assertions: [...assertions, ...expected.roles.map(r => `role:${r.role.replaceAll(' ', '-')}`)], files: [report(f), sheet(f)] };
    },
  };
}

function catalog(harness: Harness): Case[] {
  return [consumeSheet(harness, true), consumeSheet(harness, false), ...(harness === 'claude' ? [nativeAgents] : [])];
}

const shippedTools: Case = {
  id: 'log',
  prompt: f => `${invoke(f.harness, 'show-me-your-work', `Log exactly one decision to ${join(f.dir, 'decisions.tsv')} by running the installed helper ${join(f.location, 'skills/show-me-your-work/scripts/log.sh')} with phase "fixture", decision "=SUM(1,2)", why "check escaping", evidence "TASK.md", and result "logged". Do not write the file any other way.`)} ${rules(f.dir)}`,
  async assert(record, f) {
    const path = join(f.dir, 'decisions.tsv'), assertions = [loaded(record, 'pstack:show-me-your-work'), await written(record, path)];
    if (!record.commands.some(c => c.includes('log.sh'))) throw new Error('tool-not-run:log.sh');
    const rows = (await readFile(path, 'utf8')).trimEnd().split('\n').map(row => row.split('\t'));
    if (rows.length !== 2 || rows[0]!.join(',') !== 'ts,phase,decision,why,evidence,result' || rows[1]![1] !== 'fixture' || rows[1]![2] !== "'=SUM(1,2)") throw new Error('tsv-row-mismatch');
    return { assertions: [...assertions, 'tool-ran:log.sh', 'tsv-row-escaped'], files: [path] };
  },
};

const PRELOAD_TASK = 'Without invoking Skill or reading any file, reply with the first Core principle named in the preloaded poteto-mode skill.';
const agentPreload: Case = {
  id: 'dispatch',
  prompt: f => `Use the Agent tool exactly once with subagent_type pstack:poteto-agent, and give it exactly this task: "${PRELOAD_TASK}" Then reply with the subagent's reply verbatim. ${rules(f.dir)}`,
  async assert(record, f) {
    const agent = record.tools.find(t => t.name === 'Agent' && t.input.subagent_type === 'pstack:poteto-agent' && !t.failed);
    if (!agent) throw new Error('agent-not-dispatched:pstack:poteto-agent');
    if (record.tools.some(t => t.parent === agent.id)) throw new Error('child-used-tools');
    if (!agent.result?.includes('Laziness Protocol')) throw new Error('principle-missing:Laziness Protocol');
    const reply = join(f.dir, 'child-reply.txt');
    await writeFile(reply, agent.result);
    return { assertions: ['agent-dispatched', 'child-no-tools', 'principle-named'], files: [reply] };
  },
};

const startupHook: Case = {
  id: 'startup',
  prompt: () => 'Reply with the single word OK.',
  async assert(record, f) {
    const expected = (await readFile(join(f.location, 'hooks/session-start-context.md'), 'utf8')).trimEnd();
    const injected = record.context.find(text => text.trimEnd() === expected);
    if (injected === undefined) throw new Error('hook-context-missing');
    const copy = join(f.dir, 'session-context.md');
    await writeFile(copy, injected);
    return { assertions: ['hook-context-injected'], files: [copy] };
  },
};

export function recipe(feature: string, harness: Harness, routes: string[] = []): Case[] {
  if (feature === 'assets:codex') throw new Error('unsupported-native-consumer:assets:codex');
  if (feature === 'project-skill') return [projectSkill];
  if (feature === 'hook:startup') return [startupHook];
  if (feature === 'runner') return runner(harness, routes);
  if (feature === 'setup' || feature === 'skill-invocation:setup-pstack') return setup;
  if (feature === 'catalog') return catalog(harness);
  if (feature === 'shipped-tools') return [shippedTools];
  if (feature === 'agent-preload:poteto-agent' && harness === 'claude') return [agentPreload];
  if (feature === 'skill-invocation:reflect') return reflect(harness);
  const skill = /^skill-invocation:([a-z][a-z0-9-]+)$/.exec(feature)?.[1];
  if (!skill) throw new Error(`missing-recipe:${harness}/${feature}`);
  return [overrides[skill] ?? skillCase(skill, 'Apply it to the task in $DIR/TASK.md.')];
}
