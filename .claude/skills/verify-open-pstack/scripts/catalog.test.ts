import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCatalog, recipe, type Case, type Catalog, type Fixture } from '../features/recipes.ts';
import { command } from './io.ts';
import type { Harness, SessionRecord } from './types.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const workspace = resolve(import.meta.dir, '../../../..'), location = join(workspace, 'plugins/pstack');

async function fixture(harness: Harness): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-catalog-recipe-'))); roots.push(dir);
  return { harness, dir, workspace, location, configHome: dir, run: command };
}
const record = (harness: Harness, skill: string): SessionRecord =>
  ({ harness, exitCode: 0, started: Date.now() - 1000, skills: [skill], commands: [], tools: [], context: [] });
const sheet = async (path: string): Promise<Map<string, string[]>> => new Map((await readFile(path, 'utf8')).split('\n')
  .filter(line => /^[a-z][^:]*: \S/.test(line)).map((line): [string, string[]] => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2).split(', ')]));
const setupCase = (id: string): Case => recipe('setup', 'claude').find(c => c.id === id)!;
const mirror = (f: Fixture, text: string) =>
  writeFile(join(f.dir, 'AGENTS.md'), `notes\n<!-- pstack:models:begin -->\n${text}<!-- pstack:models:end -->\n`);
const BOUNDED = 'codex writer sandbox: bounded\n', FULL_ACCESS = 'codex writer sandbox: full-access\n';
async function rejectsUnbounded(c: Case, f: Fixture, text: string): Promise<void> {
  const path = join(f.dir, 'pstack-models.md');
  for (const wrong of [text.replace(BOUNDED, FULL_ACCESS), text.replace(BOUNDED, '')]) {
    await writeFile(path, wrong);
    await expect(c.assert(record(f.harness, 'pstack:setup-pstack'), f)).rejects.toThrow('setting-not-bounded');
  }
  await writeFile(path, text);
}
const promptRoles = (c: Case, f: Fixture): string[] => JSON.parse(`[${/the route of each: (.*?)\. Write to/.exec(c.prompt(f))![1]}]`);
const dispatched = (d: string) => d.replace(/^claude:claude-sonnet-[0-9-]+@/, 'claude:sonnet@');
const reportRoles = (roles: string[], lines: Map<string, string[]>, installed: Catalog, harness: Harness) => roles.map(role => {
  const descriptors = (lines.get(role) ?? installed.defaults.get(role)!).map(dispatched);
  return { role, descriptors, routes: descriptors.map(d => installed.route(harness, d)) };
});

test('reads role defaults, kept predecessors and routes from the generated catalog', async () => {
  const installed = await readCatalog(location);
  expect([...installed.defaults.keys()]).toContain('arena runners');
  expect(installed.kept.get('grok:grok-4.6')).toMatch(/^grok:/);
  for (const harness of ['claude', 'codex'] as const) {
    expect(installed.route(harness, `${harness}:any@max`)).toBe('native');
    expect(installed.route(harness, 'grok:any@max')).toBe('external');
    expect(installed.route(harness, 'devin:any@max')).toBe('external');
    expect(installed.route(harness, 'inherit-parent')).toBe('native');
  }
  expect(() => installed.route('claude', 'kiro:any@max')).toThrow('catalog-route-missing');
});

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the catalog case accepts the sheet's descriptors and catalog routes, and rejects a wrong route`, async () => {
    const f = await fixture(harness), [c] = recipe('catalog', harness), installed = await readCatalog(location);
    await c!.prepare!(f);
    const lines = await sheet(join(f.dir, 'pstack-models.md'));
    const roles = promptRoles(c!, f);
    expect(roles.length).toBeGreaterThan(0);
    expect(lines.get('codex writer sandbox')).toEqual(['full-access']);
    const report = { roles: reportRoles(roles, lines, installed, harness), writerSandbox: harness === 'claude' ? 'full-access' : null };
    expect(report.roles[0]!.descriptors).not.toEqual(installed.defaults.get(report.roles[0]!.role));
    expect(roles.slice(1, 3)).toEqual(['arena runners', 'bug-fix']);
    for (const role of roles.slice(1, 3)) expect(lines.has(role)).toBe(false);
    expect(roles.slice(3)).toEqual(['swarm workers', 'hardest tasks', 'how explainer', 'how explorer', 'interrogate reviewers', 'feature, refactoring']);
    expect(roles.slice(3).map(role => lines.get(role))).toEqual([
      ['codex:gpt-6-luna@max'], ['claude:claude-opus-5-5@max'], ['claude:claude-sonnet-5-5@high'], ['devin:swe-2@max'],
      ['opencode:opencode/deepseek-v4.1-flash-free@max'], ['codex:gpt-6.1-sol@max'],
    ]);
    expect(report.roles.slice(3).map(r => [r.descriptors, r.routes])).toEqual([
      [['codex:gpt-6-luna@max'], [harness === 'codex' ? 'native' : 'external']],
      [['claude:claude-opus-5-5@max'], [harness === 'claude' ? 'native' : 'external']],
      [['claude:sonnet@high'], [harness === 'claude' ? 'native' : 'external']],
      [['devin:swe-2@max'], ['external']],
      [['opencode:opencode/deepseek-v4.1-flash-free@max'], ['external']],
      [['codex:gpt-6.1-sol@max'], [harness === 'codex' ? 'native' : 'external']],
    ]);
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    expect((await c!.assert(record(harness, 'pstack:poteto-mode'), f)).assertions.slice(0, 2)).toEqual(['skill-loaded', 'file:routes.json']);

    for (const [role, wrong] of [['how explainer', 'claude:claude-sonnet-5-5@high'], ['hardest tasks', 'claude:opus@max'], ['how explorer', installed.defaults.get('how explorer')![0]]]) {
      const changed = { roles: report.roles.map(r => r.role === role ? { ...r, descriptors: [wrong!] } : r) };
      await writeFile(join(f.dir, 'routes.json'), JSON.stringify(changed));
      await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
    }

    await writeFile(join(f.dir, 'routes.json'), JSON.stringify({ ...report, writerSandbox: harness === 'claude' ? null : 'full-access' }));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');

    const nativeDevin = { roles: report.roles.map(r => r.role === 'how explorer' ? { ...r, routes: ['native'] } : r) };
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(nativeDevin));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');

    report.roles[0]!.routes = report.roles[0]!.routes.map(r => r === 'native' ? 'external' : 'native');
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
  });

  test(`${harness}: the bounded consume-sheet case takes the same sheet with the bounded setting line and requires no writer sandbox`, async () => {
    const opted = await fixture(harness), f = await fixture(harness), installed = await readCatalog(location);
    const [optIn, c] = recipe('catalog', harness);
    expect(c!.id).toBe('consume-sheet-bounded');
    await optIn!.prepare!(opted); await c!.prepare!(f);
    const path = join(f.dir, 'pstack-models.md');
    expect(await readFile(path, 'utf8')).toBe((await readFile(join(opted.dir, 'pstack-models.md'), 'utf8')).replace(FULL_ACCESS, BOUNDED));
    const roles = promptRoles(c!, f);
    expect(roles).toEqual(promptRoles(optIn!, opted));
    const report = { roles: reportRoles(roles, await sheet(path), installed, harness), writerSandbox: null };
    await writeFile(join(f.dir, 'routes.json'), JSON.stringify(report));
    expect((await c!.assert(record(harness, 'pstack:poteto-mode'), f)).assertions.slice(0, 2)).toEqual(['skill-loaded', 'file:routes.json']);

    await writeFile(join(f.dir, 'routes.json'), JSON.stringify({ ...report, writerSandbox: 'full-access' }));
    await expect(c!.assert(record(harness, 'pstack:poteto-mode'), f)).rejects.toThrow('catalog-route-mismatch');
  });
}

test('the kept-predecessor case requires every loaded role, the materialized role and the proposed replacement', async () => {
  const f = await fixture('claude'), c = setupCase('keep-predecessor'), installed = await readCatalog(location);
  await c.prepare!(f);
  const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8');
  const omitted = [...installed.defaults.keys()].find(role => !prepared.includes(`\n${role}: `))!;
  expect(installed.defaults.get(omitted)).toEqual(['inherit-parent']);
  const rerun = `${prepared}${omitted}: inherit-parent\n${BOUNDED}`;
  await writeFile(path, rerun);
  await writeFile(join(f.dir, 'proposal.json'), JSON.stringify({ kept: 'grok:grok-4.6@high', proposed: `${installed.kept.get('grok:grok-4.6')}@high` }));
  expect((await c.assert(record('claude', 'pstack:setup-pstack'), f)).assertions).toContain('kept:grok:grok-4.6@high');
  await rejectsUnbounded(c, f, rerun);

  await writeFile(path, rerun.replaceAll('grok:grok-4.6@', `${installed.kept.get('grok:grok-4.6')}@`));
  await expect(c.assert(record('claude', 'pstack:setup-pstack'), f)).rejects.toThrow('kept-sheet-mismatch');

  await writeFile(path, rerun.replace(/\nbug-fix: [^\n]*/, ''));
  await expect(c.assert(record('claude', 'pstack:setup-pstack'), f)).rejects.toThrow('kept-sheet-mismatch');
});

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the new-families case keeps Luna, Sonnet and the pin, and requires the old pin as opus`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'new-families')!, installed = await readCatalog(location);
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    else expect(await readFile(join(f.dir, 'AGENTS.md'), 'utf8')).toBe('mirror\n');
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8'), lines = await sheet(path);
    expect([...lines.keys()]).toEqual([...installed.defaults.keys()]);
    expect(['swarm workers', 'hardest tasks', 'how explainer', 'judgment and prose'].map(role => lines.get(role))).toEqual([
      ['codex:gpt-6-luna@max'], ['claude:claude-opus-5-5@max'], ['claude:claude-sonnet-5-5@max'], ['claude:claude-opus-5@max'],
    ]);
    for (const [role, lanes] of installed.defaults) {
      if (!['swarm workers', 'hardest tasks', 'how explainer', 'judgment and prose'].includes(role)) expect(lines.get(role)).toEqual(lanes);
    }

    const rerun = prepared.replace('judgment and prose: claude:claude-opus-5@max', 'judgment and prose: claude:opus@max')
      .replace('how explainer: claude:claude-sonnet-5-5@max', 'how explainer: claude:sonnet@max') + BOUNDED;
    await writeFile(path, rerun);
    if (harness === 'codex') await mirror(f, rerun);
    expect((await c.assert(record(harness, 'pstack:setup-pstack'), f)).assertions).toEqual([
      'skill-loaded', 'file:pstack-models.md', ...(harness === 'codex' ? ['codex-mirror'] : []),
      'sheet:codex:gpt-6-luna@max', 'sheet:claude:claude-opus-5-5@max', 'sheet:claude:sonnet@max', 'sheet:claude:opus@max',
      'setting:codex writer sandbox: bounded',
    ]);
    await rejectsUnbounded(c, f, rerun);

    for (const wrong of [prepared, rerun.replace('how explainer: claude:sonnet@max', 'how explainer: claude:claude-sonnet-5-5@max'), rerun.replace('claude:claude-opus-5-5@max', 'claude:opus@max'), rerun.replace(/\nbug-fix: [^\n]*/, '')]) {
      await writeFile(path, wrong);
      await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow('new-families-sheet-mismatch');
    }
    await writeFile(path, rerun);

    if (harness === 'codex') {
      for (const agents of [`<!-- pstack:models:begin -->\n${prepared}<!-- pstack:models:end -->\n`,
        `<!-- pstack:models:begin -->\n${rerun.replace(/\n$/, '')}<!-- pstack:models:end -->\n`,
        `<!-- pstack:models:begin -->\n${rerun}<!-- pstack:models:end -->\n<!-- pstack:models:begin -->\nold\n<!-- pstack:models:end -->\n`,
        `<!-- pstack:models:begin -->\n${rerun}<!-- pstack:models:end -->\n<!-- pstack:models:begin -->`]) {
        await writeFile(join(f.dir, 'AGENTS.md'), agents);
        await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow('codex-mirror-mismatch');
      }
    }
  });

  test(`${harness}: the runner recipe's default route is the candidate's role default for this parent`, async () => {
    const f = await fixture(harness), [c] = recipe('runner', harness), installed = await readCatalog(location);
    await c!.prepare!(f);
    const [route] = installed.defaults.get(harness === 'claude' ? 'bug-fix' : 'judgment and prose')!;
    const [provider, rest] = route!.split(':'), [model, effort] = rest!.split('@');
    expect(provider).not.toBe(harness);
    expect(c!.prompt(f)).toContain(`--parent ${harness} --provider ${provider} --model ${model} --effort ${effort} --mode read-only`);
  });
}

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the read-only-provider case requires every role line, with how explorer on Devin`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'read-only-provider')!, installed = await readCatalog(location);
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    else expect(await readFile(join(f.dir, 'AGENTS.md'), 'utf8')).toBe('mirror\n');
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8'), lines = await sheet(path);
    expect([...lines.keys()]).toEqual([...installed.defaults.keys()]);
    for (const [role, lanes] of installed.defaults) expect(lines.get(role)).toEqual(role === 'how explorer' ? ['devin:swe-2@max'] : lanes);

    await writeFile(path, prepared + BOUNDED);
    if (harness === 'codex') await mirror(f, prepared + BOUNDED);
    const probed = record(harness, 'pstack:setup-pstack');
    expect((await c.assert(probed, f)).assertions).toEqual([
      'skill-loaded', 'file:pstack-models.md', ...(harness === 'codex' ? ['codex-mirror'] : []), 'sheet:devin:swe-2@max',
      'setting:codex writer sandbox: bounded',
    ]);
    await rejectsUnbounded(c, f, prepared + BOUNDED);

    for (const wrong of [prepared.replace('how explorer: devin:swe-2@max', `how explorer: ${installed.defaults.get('how explorer')!.join(', ')}`), prepared.replace(/\nbug-fix: [^\n]*/, '')]) {
      await writeFile(path, wrong);
      await expect(c.assert(probed, f)).rejects.toThrow('read-only-provider-sheet-mismatch');
    }
  });

  test(`${harness}: the runner recipe accepts any external provider in the installed catalog and refuses others`, async () => {
    const f = await fixture(harness);
    const [devin, swe16] = recipe('runner', harness, ['devin:swe-2@max', 'devin:swe-1.6@default']);
    await devin!.prepare!(f);
    await swe16!.prepare!(f);
    expect(devin!.prompt(f)).toContain(`--parent ${harness} --provider devin --model swe-2 --effort max --mode read-only`);
    expect(swe16!.prompt(f)).toContain(`--parent ${harness} --provider devin --model swe-1.6 --effort default --mode read-only`);
    const [unknown] = recipe('runner', harness, ['kiro:auto@default']);
    await expect(unknown!.prepare!(f)).rejects.toThrow('catalog-route-missing:kiro:auto@default');
  });
}

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the writer-refusal case needs the sheet unchanged, no new mirror, and a refusal naming the role and provider`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'writer-refusal')!;
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8');
    expect((await sheet(path)).get('bug-fix')).toEqual(['devin:swe-2@max']);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    const done = record(harness, 'pstack:setup-pstack');
    await expect(c.assert(done, f)).rejects.toThrow('writer-refusal-missing');
    await writeFile(join(f.dir, 'refusal.txt'), 'Refusing bug-fix on devin:swe-2@max: Devin runs read-only lanes only.\n');
    expect((await c.assert(done, f)).assertions).toEqual(['skill-loaded', 'refused:bug-fix:devin:swe-2@max']);

    await writeFile(path, prepared.replace('bug-fix: devin:swe-2@max', 'bug-fix: codex:gpt-6.1-sol@max'));
    await expect(c.assert(done, f)).rejects.toThrow('writer-refusal-sheet-changed');
    await writeFile(path, prepared);
    if (harness === 'codex') {
      await mirror(f, prepared);
      await expect(c.assert(done, f)).rejects.toThrow('writer-refusal-integration-written');
    }
  });
}

test('the native-agents case needs each new agent dispatched, its child run, and its own nonce written', async () => {
  const f = await fixture('claude'), c = recipe('catalog', 'claude').find(c => c.id === 'native-agents')!;
  expect(recipe('catalog', 'codex').some(c => c.id === 'native-agents')).toBe(false);
  await c.prepare!(f);
  const agents = ['pstack-sonnet-max', 'pstack-opus-5-5-max', 'pstack-haiku-5-5-max'];
  const tools = (names: string[], children = names) => [
    ...names.map((agent, i) => ({ name: 'Agent', id: `a${i}`, input: { subagent_type: `pstack:${agent}` }, parent: null, failed: false })),
    ...children.map(agent => ({ name: 'Read', id: `r-${agent}`, input: {}, parent: `a${names.indexOf(agent)}`, failed: false })),
  ];
  const run = (names: string[], children?: string[]): SessionRecord => ({ ...record('claude', 'pstack:poteto-mode'), tools: tools(names, children) });
  for (const agent of agents) await writeFile(join(f.dir, `${agent}.out`), await readFile(join(f.dir, `${agent}.nonce`), 'utf8'));
  expect((await c.assert(run(agents), f)).assertions).toEqual(agents.map(agent => `native:${agent}`));

  await expect(c.assert(run(['pstack-sonnet-max', 'pstack-opus-max']), f)).rejects.toThrow('agent-not-dispatched:pstack:pstack-opus-5-5-max');
  await expect(c.assert(run(agents, ['pstack-sonnet-max']), f)).rejects.toThrow('child-did-not-run:pstack:pstack-opus-5-5-max');
  const overridden = run(agents);
  overridden.tools[1]!.input.model = 'opus';
  await expect(c.assert(overridden, f)).rejects.toThrow('agent-not-dispatched:pstack:pstack-opus-5-5-max');
  await writeFile(join(f.dir, 'pstack-sonnet-max.out'), 'guess\n');
  await expect(c.assert(run(agents), f)).rejects.toThrow('nonce-mismatch:pstack:pstack-sonnet-max');
});

test('the first-run case requires a sheet equal to the catalog role defaults', async () => {
  const f = await fixture('codex'), c = setupCase('first-run'), installed = await readCatalog(location);
  const path = join(f.dir, 'pstack-models.md');
  await writeFile(path, 'stale\n'); await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
  await c.prepare!(f);
  await expect(readFile(path)).rejects.toThrow();
  await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
  const lines = [...installed.defaults].map(([role, lanes]) => `${role}: ${lanes.join(', ')}`);
  const written = `# pstack model configuration\n\n${lines.join('\n')}\n${BOUNDED}`;
  await writeFile(path, written);
  await expect(c.assert(record('codex', 'pstack:setup-pstack'), f)).rejects.toThrow('codex-mirror-mismatch');
  await mirror(f, written);
  expect((await c.assert(record('codex', 'pstack:setup-pstack'), f)).assertions).toContain('sheet:role-defaults');
  await rejectsUnbounded(c, f, written);
  await writeFile(path, `# pstack model configuration\n\n${lines.slice(1).join('\n')}\n`);
  await expect(c.assert(record('codex', 'pstack:setup-pstack'), f)).rejects.toThrow('first-run-not-role-defaults');
});

test('the configure case answers yes to full access and requires that setting with only the Opus descriptor', async () => {
  const f = await fixture('claude'), c = setupCase('configure'), installed = await readCatalog(location);
  expect(c.prompt(f)).toContain('whether Codex writer lanes should run with full access, answer yes');
  const path = join(f.dir, 'pstack-models.md');
  const written = `# pstack model configuration\n\n${[...installed.defaults].map(([role, lanes]) =>
    `${role}: ${lanes.map(lane => lane.includes(':') ? 'claude:opus@high' : lane).join(', ')}`).join('\n')}\n${FULL_ACCESS}`;
  await writeFile(path, written);
  expect((await c.assert(record('claude', 'pstack:setup-pstack'), f)).assertions)
    .toEqual(['skill-loaded', 'file:pstack-models.md', 'sheet:claude:opus@high', 'setting:codex writer sandbox: full-access']);

  for (const [wrong, reason] of [[written.replace(FULL_ACCESS, BOUNDED), 'setting-not-full-access'], [written.replace(FULL_ACCESS, ''), 'setting-not-full-access'],
    [written.replace('claude:opus@high', 'claude:opus@max'), 'sheet-descriptors-mismatch']]) {
    await writeFile(path, wrong!);
    await expect(c.assert(record('claude', 'pstack:setup-pstack'), f)).rejects.toThrow(reason);
  }
});

test('the configure case starts from the daily sheet with only its setting line removed, so setup asks', async () => {
  const f = await fixture('claude'), c = setupCase('configure'), path = join(f.dir, 'pstack-models.md');
  await c.prepare!(f);
  await expect(readFile(path)).rejects.toThrow();
  const daily = `# pstack model configuration\n\nbug-fix: codex:gpt-6.1-sol@max\n${FULL_ACCESS}hillclimb: codex:gpt-6.1-sol@max  \n\n`;
  for (const setting of [FULL_ACCESS, BOUNDED]) {
    await writeFile(path, daily.replace(FULL_ACCESS, setting));
    await c.prepare!(f);
    expect(await readFile(path, 'utf8')).toBe(daily.replace(FULL_ACCESS, ''));
  }
});

test('the full-access writer case quotes each browser argument for sh and encodes the page as a file URL', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'pstack-catalog-recipe-'))); roots.push(base);
  const dir = join(base, "x$(touch pwned)'q#r?s\nt");
  await mkdir(dir);
  const f: Fixture = { harness: 'claude', dir, workspace, location, configHome: dir, run: command };
  await recipe('runner', 'claude').find(c => c.id === 'full-access-writer')!.prepare!(f);
  const prompt = await readFile(join(dir, 'full-access.prompt.md'), 'utf8'), lead = 'in the DOM it prints: ';
  const line = prompt.slice(prompt.indexOf(lead) + lead.length, prompt.lastIndexOf('\nThen create the file'));
  const child = Bun.spawn(['sh', '-c', `set -- ${line}; printf '%s\\0' "$@"`], { cwd: base, stdout: 'pipe' });
  const args = (await new Response(child.stdout).text()).split('\0').slice(0, -1);
  expect(await child.exited).toBe(0);
  const page = join(dir, 'full-access.page.html'), url = pathToFileURL(page).href;
  expect(args.slice(1)).toEqual(['--headless', '--no-first-run', `--user-data-dir=${join(dir, 'full-access.browser-profile')}`, '--dump-dom', url]);
  expect(url).toContain('%23'); expect(url).toContain('%3F'); expect(url).toContain('%0A');
  expect(fileURLToPath(url)).toBe(page);
  await expect(readFile(join(base, 'pwned'))).rejects.toThrow();
});

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness}: the keep-setting case requires the setting line and every role line after a rerun`, async () => {
    const f = await fixture(harness), c = recipe('setup', harness).find(c => c.id === 'keep-setting')!, installed = await readCatalog(location);
    await writeFile(join(f.dir, 'AGENTS.md'), 'mirror\n');
    await c.prepare!(f);
    if (harness === 'codex') await expect(readFile(join(f.dir, 'AGENTS.md'))).rejects.toThrow();
    else expect(await readFile(join(f.dir, 'AGENTS.md'), 'utf8')).toBe('mirror\n');
    const path = join(f.dir, 'pstack-models.md'), prepared = await readFile(path, 'utf8');
    expect(prepared).toEndWith('\ncodex writer sandbox: full-access\n');
    const omitted = [...installed.defaults.keys()].find(role => !prepared.includes(`\n${role}: `))!;
    expect(installed.defaults.get(omitted)).toEqual(['inherit-parent']);
    const rerun = prepared.replace('codex writer sandbox: full-access\n', `${omitted}: inherit-parent\ncodex writer sandbox: full-access\n`);
    await writeFile(path, rerun);
    if (harness === 'codex') await mirror(f, rerun);
    expect((await c.assert(record(harness, 'pstack:setup-pstack'), f)).assertions)
      .toEqual(['skill-loaded', 'file:pstack-models.md', ...(harness === 'codex' ? ['codex-mirror'] : []), 'setting:codex writer sandbox: full-access']);

    for (const [wrong, reason] of [
      [rerun.replace('codex writer sandbox: full-access\n', ''), 'setting-not-kept'],
      [rerun.replace('sandbox: full-access', 'sandbox: bounded'), 'setting-not-kept'],
      [rerun.replace(/\nbug-fix: [^\n]*/, ''), 'keep-setting-sheet-mismatch'],
    ]) {
      await writeFile(path, wrong!);
      await expect(c.assert(record(harness, 'pstack:setup-pstack'), f)).rejects.toThrow(reason);
    }
  });
}

const FAKE_CODEX = `#!/bin/sh
if [ "$1" = "login" ]; then echo 'Logged in using ChatGPT'; exit 0; fi
cat > /dev/null
mkdir -p "$(dirname "$FAKE_RESULT_FILE")" && printf '%s' "$FAKE_RESULT" > "$FAKE_RESULT_FILE"
echo '{"type":"item.completed","item":{"type":"agent_message","text":"DONE"}}'
`;

async function launchWriter(f: Fixture, name: string, effort: string, flags: string[], receipt: string, result: object, file: string): Promise<Record<string, unknown>> {
  const bin = join(f.dir, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'codex'), FAKE_CODEX); await chmod(join(bin, 'codex'), 0o755);
  const args = ['--parent', 'claude', '--provider', 'codex', '--model', 'gpt-6.1-sol', '--effort', effort, '--mode', 'isolated-write', ...flags,
    '--prompt', join(f.dir, `${name}.prompt.md`), '--cwd', join(f.dir, `${name}-lane`), '--output', join(f.dir, `${receipt}.md`), '--receipt', join(f.dir, `${receipt}.json`)];
  const child = Bun.spawn([join(location, 'skills/poteto-mode/scripts/runner/pstack-runner'), ...args], { stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RESULT: JSON.stringify(result), FAKE_RESULT_FILE: file } });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code, stderr).toBe(0);
  return JSON.parse(await readFile(join(f.dir, `${receipt}.json`), 'utf8'));
}

test('the full-access writer case requires the opted-in receipt and both nonces in the child result', async () => {
  const f = await fixture('claude'), c = recipe('runner', 'claude').find(c => c.id === 'full-access-writer')!;
  await c.prepare!(f);
  expect(c.prompt(f)).not.toContain('--writer-sandbox');
  const lines = await sheet(join(f.dir, 'full-access.sheet.md'));
  expect([lines.get('feature, refactoring'), lines.get('codex writer sandbox')]).toEqual([['codex:gpt-6.1-sol@max'], ['full-access']]);
  const page = await readFile(join(f.dir, 'full-access.page.html'), 'utf8');
  const pageNonce = atob(/atob\('([^']+)'\)/.exec(page)![1]!), fileNonce = /"written":"([0-9a-f-]+)"/.exec(await readFile(join(f.dir, 'full-access.prompt.md'), 'utf8'))![1]!;
  expect(page).not.toContain(pageNonce);

  const launch = (sandbox: string, name: string) =>
    launchWriter(f, 'full-access', 'max', ['--writer-sandbox', sandbox], name, { written: fileNonce, browser: pageNonce }, '.agents/result.json');
  const run = { ...record('claude', 'pstack:poteto-mode'), commands: ['"$RUNNER/pstack-runner" --provider codex'] };
  const receipt = await launch('full-access', 'full-access.receipt');
  await rm(join(f.dir, 'full-access.receipt.md'));
  await writeFile(join(f.dir, 'full-access.receipt.json'), JSON.stringify({ ...receipt, outputPath: join(f.dir, 'full-access.output.md') }));
  expect((await c.assert(run, f)).assertions).toEqual(['runner-ran', 'receipt-complete', 'writer-sandbox:full-access', 'file:result.json', 'browser-nonce']);

  const bounded = await launch('bounded', 'bounded.receipt');
  await writeFile(join(f.dir, 'full-access.receipt.json'), JSON.stringify({ ...bounded, outputPath: join(f.dir, 'full-access.output.md') }));
  await expect(c.assert(run, f)).rejects.toThrow('writer-sandbox:bounded');
  await writeFile(join(f.dir, 'full-access.receipt.json'), JSON.stringify({ ...receipt, outputPath: join(f.dir, 'full-access.output.md') }));
  await writeFile(join(f.dir, 'full-access-lane/.agents/result.json'), JSON.stringify({ written: fileNonce, browser: 'unrendered' }));
  await expect(c.assert(run, f)).rejects.toThrow('full-access-effect-mismatch');
});

test('the bounded writer case requires a bounded receipt from a sheet without the setting line, and the nonce in a plain file', async () => {
  const f = await fixture('claude'), c = recipe('runner', 'claude').find(c => c.id === 'bounded-writer')!;
  await c.prepare!(f);
  expect(c.prompt(f)).not.toContain('--writer-sandbox');
  const path = join(f.dir, 'bounded.sheet.md');
  expect(await readFile(path, 'utf8')).not.toContain('codex writer sandbox:');
  expect((await sheet(path)).get('feature, refactoring')).toEqual(['codex:gpt-6.1-sol@low']);
  const prompt = await readFile(join(f.dir, 'bounded.prompt.md'), 'utf8'), fileNonce = /"written":"([0-9a-f-]+)"/.exec(prompt)![1]!;
  expect(prompt).not.toContain('.agents/'); expect(prompt).not.toContain('--dump-dom');

  const launch = (flags: string[], name: string) => launchWriter(f, 'bounded', 'low', flags, name, { written: fileNonce }, 'result.json');
  const place = (receipt: Record<string, unknown>) =>
    writeFile(join(f.dir, 'bounded.receipt.json'), JSON.stringify({ ...receipt, outputPath: join(f.dir, 'bounded.output.md') }));
  const run = { ...record('claude', 'pstack:poteto-mode'), commands: ['"$RUNNER/pstack-runner" --provider codex'] };
  const receipt = await launch([], 'bounded.receipt');
  expect([receipt.writerSandbox, (receipt.argv as string[]).includes('workspace-write')]).toEqual(['bounded', true]);
  await place(receipt);
  expect((await c.assert(run, f)).assertions).toEqual(['runner-ran', 'receipt-complete', 'writer-sandbox:bounded', 'file:result.json']);

  await place(await launch(['--writer-sandbox', 'full-access'], 'opted.receipt'));
  await expect(c.assert(run, f)).rejects.toThrow('writer-sandbox:full-access');
  await place({ ...receipt, argv: [...receipt.argv as string[], '--sandbox', 'danger-full-access'] });
  await expect(c.assert(run, f)).rejects.toThrow('writer-sandbox:bounded');
  await place(receipt);
  await writeFile(join(f.dir, 'bounded-lane/result.json'), JSON.stringify({ written: 'guess' }));
  await expect(c.assert(run, f)).rejects.toThrow('bounded-effect-mismatch');
});
