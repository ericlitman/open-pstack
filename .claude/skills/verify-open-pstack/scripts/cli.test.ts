import { expect, test } from 'bun:test';
import { bindPublisher, parse, publisherCode } from './cli.ts';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import { command, type Command } from './io.ts';
import type { GitHub, Pull } from './types.ts';
import { REPO } from './types.ts';
import { verify } from './verify.ts';
import { validateRegistry } from './core.ts';
import registry from '../features/registry.json';
const accounts = ['--claude-account', 'eric@litman.org', '--codex-account', 'eric@healthspanners.com'];
async function publisherFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-publisher-binding-')));
  const project = join(root, '.claude/skills/verify-open-pstack');
  await mkdir(join(project, 'scripts'), { recursive: true });
  await mkdir(join(project, 'features')); await mkdir(join(root, 'plugins/pstack'), { recursive: true });
  await mkdir(join(root, '.agents/skills'), { recursive: true });
  await symlink('../../.claude/skills/verify-open-pstack', join(root, '.agents/skills/verify-open-pstack'));
  await writeFile(join(root, 'plugins/pstack/plugin.json'), '{}\n');
  for (const path of ['scripts/cli.ts', 'scripts/github.ts', 'scripts/verify.sh', 'features/registry.json']) await writeFile(join(project, path), 'pinned publisher source\n');
  for (const args of [
    ['git', 'init', '--quiet'], ['git', 'config', 'user.name', 'Publisher Test'],
    ['git', 'config', 'user.email', 'publisher@example.invalid'], ['git', 'add', '.'],
    ['git', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'pinned publisher'],
  ]) await command(args, { cwd: root });
  const sha = (await command(['git', 'rev-parse', 'HEAD'], { cwd: root })).trim();
  const calls: string[] = [], url = `https://github.com/${REPO}/pull/111#issuecomment-1`;
  const pull: Pull = { number: 111, head: { sha }, base: { sha }, state: 'open', draft: false, headRepo: REPO, body: '' };
  const github: GitHub = {
    async pull() { calls.push('pull'); return structuredClone(pull); },
    async files() { calls.push('files'); return [{ filename: 'README.md' }]; },
    async comment() { calls.push('comment'); return url; },
    async status(_sha, state) { calls.push(`status:${state}`); },
    async ready() { calls.push('ready'); },
  };
  return { root, project, sha, github, calls, pull, url, loadedCode: publisherCode(root) };
}
test('already-loaded publisher A cannot bind checkout B after asynchronous startup', async () => {
  const f = await publisherFixture();
  try {
    await cp(import.meta.dir, join(f.project, 'scripts'), { recursive: true });
    const cli = join(f.project, 'scripts/cli.ts');
    const source = await readFile(cli, 'utf8');
    await writeFile(cli, source + '\nexport const loadedRevision = "A";\n');
    await command(['git', 'add', '.'], { cwd: f.root });
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'publisher A'], { cwd: f.root });
    const loaded = await import(cli) as typeof import('./cli.ts') & { loadedRevision: string };
    // Model freshRoot yielding after imports while another process advances the checkout.
    await writeFile(cli, source + '\nexport const loadedRevision = "B";\n');
    await command(['git', 'add', '.'], { cwd: f.root });
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'publisher B'], { cwd: f.root });
    f.pull.head.sha = f.pull.base.sha = (await command(['git', 'rev-parse', 'HEAD'], { cwd: f.root })).trim();
    expect(loaded.loadedRevision).toBe('A');
    await expect(loaded.bindPublisher(f.root, 111, f.github)).rejects.toThrow('Publisher source changed while binding');
    expect(f.calls).toEqual(['pull']);
    const current = await import(cli + '?head=B') as typeof import('./cli.ts') & { loadedRevision: string };
    expect(current.loadedRevision).toBe('B');
    const bound = await current.bindPublisher(f.root, 111, f.github);
    await bound.files(f.pull.base.sha, f.pull.head.sha);
    expect(f.calls).toEqual(['pull', 'pull', 'files']);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('publisher pin rejects an older local checkout before classification or publication', async () => {
  const f = await publisherFixture();
  try {
    f.pull.head.sha = 'a'.repeat(40);
    await expect(bindPublisher(f.root, 111, f.github, f.loadedCode)).rejects.toThrow('HEAD differs from pinned SHA');
    expect(f.calls).toEqual(['pull']);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('publisher pin rejects modified registry, wrapper and code, plus untracked project source', async () => {
  const f = await publisherFixture();
  try {
    for (const path of ['features/registry.json', 'scripts/verify.sh', 'scripts/cli.ts', 'scripts/github.ts']) {
      await writeFile(join(f.project, path), 'unapproved publisher logic\n');
      await expect(bindPublisher(f.root, 111, f.github, f.loadedCode)).rejects.toThrow('Source differs from pinned Git tree');
      await writeFile(join(f.project, path), 'pinned publisher source\n');
    }
    await writeFile(join(f.project, 'scripts/untracked.ts'), 'untracked logic\n');
    await expect(bindPublisher(f.root, 111, f.github, f.loadedCode)).rejects.toThrow('Source differs from pinned Git tree');
    expect(f.calls.every(call => call === 'pull')).toBe(true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('publisher source rechecks protect every success boundary but retain failure compensation', async () => {
  const f = await publisherFixture();
  try {
    const bound = await bindPublisher(f.root, 111, f.github, f.loadedCode);
    await writeFile(join(f.project, 'scripts/github.ts'), 'changed after binding\n');
    for (const operation of [
      () => bound.files(f.sha, f.sha),
      () => bound.comment(111, 'evidence'), () => bound.status(f.sha, 'success', f.url, 'verified'), () => bound.ready(111),
    ]) await expect(operation()).rejects.toThrow('Source differs from pinned Git tree');
    expect(f.calls).toEqual(['pull']);
    await bound.status(f.sha, 'failure', f.url, 'withdraw success');
    expect(f.calls).toEqual(['pull', 'status:failure']);
    expect('body' in bound).toBe(false); expect('draft' in bound).toBe(false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('publisher pin also gates docs-only classification and success with no harness fallback', async () => {
  const f = await publisherFixture();
  try {
    const github = await bindPublisher(f.root, 111, f.github, f.loadedCode);
    const output = join(f.root, 'output'); await mkdir(output);
    const receipt = await verify({ pr: 111, selfTest: false, root: output, registry: validateRegistry(registry), github,
      driver: { async prepare() { throw new Error('Docs must not prepare harnesses'); }, async exercise() { throw new Error('Docs must not exercise harnesses'); } }, persist: async () => {} });
    expect(receipt.selection.noRuntime).toBe(true); expect(receipt.status).toBe('success'); expect(f.calls).toContain('status:success');
    await expect(github.files(f.sha, 'a'.repeat(40))).rejects.toThrow('classification SHAs');
    await expect(github.status('a'.repeat(40), 'success', f.url, 'wrong head')).rejects.toThrow('pinned SHA');
    await expect(github.comment(112, 'wrong PR')).rejects.toThrow('one PR');
    await writeFile(join(f.root, 'README.md'), 'new docs head\n');
    await command(['git', 'add', 'README.md'], { cwd: f.root });
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'new docs head'], { cwd: f.root });
    await expect(github.files(f.sha, f.sha)).rejects.toThrow('HEAD differs from pinned SHA');
    await expect(github.status(f.sha, 'success', f.url, 'stale checkout')).rejects.toThrow('HEAD differs from pinned SHA');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('candidate mode is an explicit doctor-only flag', () => {
  expect(parse(['doctor', '--candidate', '--output', '/fresh/probe'])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: true });
  expect(() => parse(['doctor', '--candidate', '--candidate', '--output', '/fresh/probe'])).toThrow('Duplicate option');
  expect(() => parse(['run', '--candidate', '--pr', '111', '--output', '/fresh/run', ...accounts])).toThrow('Unknown option');
});
test('candidate doctor probes only help and versions with private roots already present', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-doctor-'))), calls: string[][] = [];
  const run: Command = async (args, options = {}) => {
    calls.push(args);
    const env = options.env!;
    for (const key of ['HOME', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'GH_CONFIG_DIR']) {
      expect(env[key]!.startsWith(root + '/probe-home')).toBe(true);
      const info = await stat(env[key]!);
      expect(info.isDirectory()).toBe(true);
      expect(info.mode & 0o777).toBe(0o700);
    }
    return args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path';
  };
  try {
    await doctor(root, run, 'darwin', true);
    const report = JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8'));
    expect(report.candidate).toBe(true); expect(report.result).toBe('pass');
    expect(Object.keys(report.checks)).toEqual(['bun', 'git', 'claude', 'codex', 'claudeHelp', 'codex plugin marketplace add --help', 'codex plugin add --help']);
    expect(calls.every(args => args.includes('--version') || args.includes('--help'))).toBe(true);
    expect(calls.some(args => ['gh', 'caam', '/usr/bin/sandbox-exec'].includes(args[0]!))).toBe(false);
    expect(calls.some(args => args.includes('auth') || args.includes('login'))).toBe(false);
    await doctor(root, run, 'darwin');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).candidate).toBe(false);
    expect(calls.some(args => args[0] === 'gh' && args[1] === '--version')).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('CLI strictly validates run inputs and permits read-only child doctor', () => {
  expect(parse(['doctor', '--output', '/fresh/probe'])).toEqual({ mode: 'doctor', output: '/fresh/probe', pr: 0, selfTest: false, candidate: false });
  expect(parse(['run', '--pr', '123', '--self-test', '--output', '/fresh/run', ...accounts])).toEqual({ mode: 'run', output: '/fresh/run', pr: 123, selfTest: true, claudeAccount: 'eric@litman.org', codexAccount: 'eric@healthspanners.com' });
  for (const args of [[], ['wat'], ['run', '--pr', '0', '--output', '/tmp/a', ...accounts], ['run', '--pr', '1.5', '--output', '/tmp/a', ...accounts], ['doctor', '--pr', '1', '--output', '/tmp/a'], ['doctor', '--output', '/tmp/a', '--output', '/tmp/b'], ['run', '--pr', '1', ...accounts], ['doctor', '--output', '--self-test'], ['doctor', '--output', '/tmp/a', '--publish']]) expect(() => parse(args)).toThrow();
});
test('run requires both explicit account choices without defaults or doctor account options', () => {
  const run = ['run', '--pr', '111', '--output', '/fresh/run'];
  expect(() => parse(run)).toThrow('Run requires --claude-account and --codex-account');
  expect(() => parse([...run, ...accounts.slice(0, 2)])).toThrow('Run requires');
  expect(() => parse([...run, ...accounts.slice(2)])).toThrow('Run requires');
  for (const option of ['--claude-account', '--codex-account']) {
    expect(() => parse(['doctor', '--output', '/fresh/probe', option, 'eric@litman.org'])).toThrow('Unknown option');
    expect(() => parse([...run, ...accounts, option, 'eric@mobilyze.com'])).toThrow('Duplicate option');
    expect(() => parse([...run, option])).toThrow('Missing value');
    expect(() => parse([...run, option, '--self-test'])).toThrow('Missing value');
  }
});
test('account choices are bounded emails rather than vault paths or arbitrary strings', () => {
  for (const option of ['--claude-account', '--codex-account']) {
    const other = option === '--claude-account' ? '--codex-account' : '--claude-account';
    const args = ['run', '--pr', '111', '--output', '/fresh/run', other, 'eric@litman.org', option];
    for (const account of ['../eric@litman.org', 'claude/eric@litman.org', 'eric\\@litman.org', 'eric@../litman.org', 'eric@litman..org', 'eric', ' eric@litman.org', 'eric@litman.org\n', '@litman.org', 'eric@litman', 'x'.repeat(65) + '@litman.org', 'x@' + 'a.'.repeat(127) + 'org']) expect(() => parse([...args, account])).toThrow('Account must be a safe email');
    const result = parse([...args, 'eric+verification@litman.org']);
    expect(result.mode).toBe('run');
    if (result.mode === 'run') expect(option === '--claude-account' ? result.claudeAccount : result.codexAccount).toBe('eric+verification@litman.org');
  }
});
