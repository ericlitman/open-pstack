import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import data from '../features/registry.json';
import { requiredFeatures, requiredHarnesses, validateRegistry } from './core.ts';
import { parseChangedFiles, Publisher } from './github.ts';
import { command, sha256, type Command } from './io.ts';
import { MacDriver } from './harness.ts';
import { evidence, Refused, SESSION_LIMIT, verify } from './verify.ts';
import { HARNESSES, REPO, type ChangedFile, type Driver, type GitHub, type Pull, type Receipt } from './types.ts';

const SHA = 'a'.repeat(40), BASE = 'b'.repeat(40), NEXT = 'c'.repeat(40), HASH = 'd'.repeat(64), REVISION = 'e'.repeat(40);
const URL = `https://github.com/${REPO}/pull/123#issuecomment-1`;
const roots: string[] = [];
function temporary(): string { const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-publish-test-'))); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(runtime = false, selfTest = false) {
  const root = temporary();
  writeFileSync(join(root, 'retained.log'), 'reviewed transcript');
  writeFileSync(join(root, 'fixture.json'), 'reviewed artifact');
  const calls: string[] = [], saved: Receipt[] = [], comments: string[] = [];
  const pull: Pull = { number: 123, head: { sha: SHA }, base: { sha: BASE }, state: 'open', headRepo: REPO };
  let hook: (call: string) => void = () => {};
  const mark = (call: string) => { calls.push(call); hook(call); };
  const github: GitHub = {
    async pull() { mark('pull'); return structuredClone(pull); },
    async files(base, head) { expect(base).toBe(BASE); expect(head).toBe(SHA); mark('files'); return [{ filename: runtime ? 'plugins/pstack/skills/architect/SKILL.md' : 'README.md' }]; },
    async comment(_pr, body) { mark('comment'); comments.push(body); expect(body).toContain(SHA); return URL; },
    async status(sha, state, target) { mark(`status:${state}:${sha}`); expect(target).toBe(state === 'success' || comments.length ? URL : `https://github.com/${REPO}/pull/123`); },
  };
  const driver: Driver = {
    async preflight() { mark('preflight'); },
    async prepare(r) { mark('prepare'); return requiredHarnesses(r).map(harness => ({ harness, sha: r.sha, cliVersion: 'test', pluginVersion: '1.5.0', treeHash: HASH, location: `/isolated/${harness}/plugin`, home: `/isolated/${harness}` })); },
    async exercise(r) { mark('exercise'); return requiredHarnesses(r).flatMap(harness => requiredFeatures(r, harness).map(feature => ({ harness, feature, surface: 'native surface', action: 'invoke', observed: 'fixture changed', reviewer: 'recipe' as const, assertions: ['invoke:skill-loaded'], transcript: 'retained.log', transcriptHash: sha256('reviewed transcript'), artifacts: [{ path: 'fixture.json', sha256: sha256('reviewed artifact') }] }))); },
  };
  const options = { pr: 123, root, selfTest, features: runtime ? ['claude:skill-invocation:architect'] : [], wide: undefined as string | undefined, publisherRevision: REVISION, registry: validateRegistry(data), github, driver, persist: async (r: Receipt) => { saved.push(structuredClone(r)); } };
  return { options, calls, saved, comments, pull, hook: (fn: typeof hook) => { hook = fn; } };
}

describe('exact-head evidence publication', () => {
  test('docs-only publishes one no-runtime comment and exact-SHA live-gate without harnesses or PR mutation', async () => {
    const f = fixture(), receipt = await verify(f.options);
    expect(receipt.status).toBe('success'); expect(receipt.sha).toBe(SHA); expect(receipt.publisherRevision).toBe(REVISION);
    expect(f.calls).not.toContain('preflight'); expect(f.calls).not.toContain('prepare'); expect(f.calls).not.toContain('exercise');
    expect(f.calls.filter(call => call === 'comment')).toHaveLength(1);
    expect(f.calls).toContain(`status:success:${SHA}`);
    expect(f.comments[0]).toContain('PASSED — no runtime change'); expect(f.comments[0]).toContain(REVISION);
    expect(Object.keys(receipt)).not.toContain('proposedTemplate'); expect(Object.keys(receipt)).not.toContain('madeReady'); expect(Object.keys(receipt)).not.toContain('compensation');
  });

  test('a runtime change runs only the named features, plus project-skill in both harnesses under self-test', async () => {
    const f = fixture(true, true), receipt = await verify(f.options);
    expect(receipt.selection.features).toEqual(['claude:skill-invocation:architect', 'codex:skill-invocation:architect', 'grok:dispatch', 'grok:setup']);
    expect(receipt.runFeatures).toEqual(['claude:skill-invocation:architect']);
    expect(receipt.installations.map(record => record.harness).sort()).toEqual([...HARNESSES]);
    expect(receipt.observations.map(record => `${record.harness}/${record.feature}`).sort()).toEqual(['claude/project-skill', 'claude/skill-invocation:architect', 'codex/project-skill']);
    expect(f.comments).toHaveLength(1); expect(f.comments[0]).toContain('PASSED — named features verified');
    expect(f.calls.indexOf('preflight')).toBeLessThan(f.calls.indexOf('prepare'));
    const plain = await verify(fixture(true).options);
    expect(plain.installations.map(record => record.harness)).toEqual(['claude']);
    expect(plain.observations.map(record => `${record.harness}/${record.feature}`)).toEqual(['claude/skill-invocation:architect']);
  });

  test('a runtime change without --feature fails before any install or GitHub write', async () => {
    const f = fixture(true); f.options.features = [];
    await expect(verify(f.options)).rejects.toThrow('requires at least one --feature');
    expect(f.calls.some(call => ['prepare', 'exercise', 'comment'].includes(call) || call.startsWith('status:'))).toBe(false);
  });

  test('a logged-out Claude stops the real driver before any install or GitHub write', async () => {
    const f = fixture(true), calls: string[][] = [];
    const run: Command = async args => {
      calls.push(args);
      if (args.join(' ') === 'claude auth status') return command([process.execPath, '-e', 'console.log(JSON.stringify({ loggedIn: false })); process.exit(1)']);
      return args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path';
    };
    f.options.driver = new MacDriver(run, async () => { throw new Error('no session expected'); });
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
    try { await expect(verify(f.options)).rejects.toThrow('Claude login check failed: `claude auth status` did not report "loggedIn": true; run `claude auth login` from a shell on this Mac, not over SSH'); }
    finally { Object.defineProperty(process, 'platform', platform); }
    expect(f.calls.some(call => call === 'comment' || call.startsWith('status:'))).toBe(false);
    expect(calls.some(args => args.join(' ').startsWith('git clone') || args.join(' ').startsWith('codex plugin ') && !args.includes('--help'))).toBe(false);
    expect(calls).toContainEqual(['claude', 'auth', 'status']);
  });

  test('self-test alone runs project proof in both harnesses', async () => {
    const receipt = await verify(fixture(false, true).options);
    expect(receipt.selection.noRuntime).toBe(true);
    expect(receipt.observations.map(record => `${record.harness}/${record.feature}`).sort()).toEqual(['claude/project-skill', 'codex/project-skill']);
  });

  test('verifier changes require the candidate publisher before any driver call or GitHub write', async () => {
    for (const revision of [REVISION, SHA]) {
      const f = fixture(true); f.options.publisherRevision = revision;
      f.options.github.files = async () => [{ filename: '.claude/skills/verify-open-pstack/scripts/verify.ts' }, { filename: 'plugins/pstack/skills/architect/SKILL.md' }];
      f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
      if (revision !== SHA) {
        await expect(verify(f.options)).rejects.toThrow('rerun from that checkout');
        expect(f.calls.some(call => ['prepare', 'exercise', 'cleanup', 'comment'].includes(call) || call.startsWith('status:'))).toBe(false);
      } else {
        const receipt = await verify(f.options);
        expect(receipt.status).toBe('success');
        expect(f.calls).toContain('prepare'); expect(f.calls).toContain('exercise');
        expect(receipt.observations.map(record => `${record.harness}/${record.feature}`).sort()).toEqual(['claude/project-skill', 'claude/skill-invocation:architect', 'codex/project-skill']);
      }
    }
  });

  test('non-verifier changes do not require a candidate publisher revision', async () => {
    const f = fixture(true);
    expect((await verify(f.options)).status).toBe('success');
    expect(f.calls).toContain('prepare');
  });
  test('a shared recipe change runs only the named recipe and project proof from the candidate publisher', async () => {
    const selected = 'codex:skill-invocation:principle-never-block-on-the-human';
    for (const revision of [REVISION, SHA]) {
      const f = fixture(true);
      f.options.publisherRevision = revision;
      f.options.features = [selected];
      f.options.github.files = async () => [{ filename: '.claude/skills/verify-open-pstack/features/recipes.ts' }];
      if (revision !== SHA) {
        await expect(verify(f.options)).rejects.toThrow('rerun from that checkout');
        expect(f.calls.some(call => ['preflight', 'prepare', 'exercise', 'comment'].includes(call) || call.startsWith('status:'))).toBe(false);
      } else {
        const receipt = await verify(f.options);
        expect(receipt.status).toBe('success');
        expect(receipt.runFeatures).toEqual([selected, 'claude:project-skill', 'codex:project-skill']);
        expect(receipt.selection.features.length).toBeGreaterThan(receipt.runFeatures.length);
        expect(receipt.sessions).toBe(3);
        expect(receipt.observations.map(record => `${record.harness}/${record.feature}`).sort()).toEqual([
          'claude/project-skill', 'codex/project-skill', 'codex/skill-invocation:principle-never-block-on-the-human',
        ]);
      }
    }
  });

  test('successful verification restores setup and removes Codex run state before any publication', async () => {
    const f = fixture(true); f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
    const receipt = await verify(f.options);
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(1);
    expect(f.calls.indexOf('exercise')).toBeLessThan(f.calls.indexOf('cleanup'));
    expect(f.calls.indexOf('cleanup')).toBeLessThan(f.calls.indexOf('comment'));
    expect(receipt.cleanup).toContain('removed');
  });

  test('persistent cleanup failure prevents every public write and remains private', async () => {
    const f = fixture(true); f.options.driver.cleanup = async () => { f.calls.push('cleanup'); throw new Error('RAW_CREDENTIAL_CLEANUP_EXCEPTION'); };
    await expect(verify(f.options)).rejects.toThrow('RAW_CREDENTIAL_CLEANUP_EXCEPTION');
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(2);
    expect(f.calls).not.toContain('comment'); expect(f.calls.some(call => call.startsWith('status:'))).toBe(false);
    expect(f.saved.at(-1)?.failure).toContain('RAW_CREDENTIAL_CLEANUP_EXCEPTION');
  });

  test('failed setup restoration forbids publication even if cleanup retry succeeds', async () => {
    const f = fixture(true); let attempts = 0;
    f.options.driver.cleanup = async () => { f.calls.push('cleanup'); if (++attempts === 1) throw new Error('Setup restoration failed'); };
    await expect(verify(f.options)).rejects.toThrow('Setup restoration failed');
    expect(f.calls.filter(call => call === 'cleanup')).toHaveLength(2);
    expect(f.comments).toHaveLength(0);
    expect(f.calls.some(call => call.startsWith('status:'))).toBe(false);
    expect(f.saved.at(-1)?.failure).toContain('Setup restoration failed');
  });

  test('failure publication is structured and excludes raw exceptions, transcripts, and artifact paths', async () => {
    const f = fixture(true);
    f.options.driver.exercise = async () => { f.calls.push('exercise'); throw new Error('RAW_PROVIDER_EXCEPTION secret detail'); };
    f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
    await expect(verify(f.options)).rejects.toThrow('RAW_PROVIDER_EXCEPTION');
    expect(f.comments).toHaveLength(1);
    const body = f.comments[0]!;
    expect(body).toContain('## Live evidence: Open Pstack'); expect(body).toContain(`Candidate SHA: \`${SHA}\``);
    for (const forbidden of ['RAW_PROVIDER_EXCEPTION', 'secret detail', 'reviewed transcript', 'retained.log', 'fixture.json']) expect(body).not.toContain(forbidden);
    expect(f.saved.at(-1)?.failure).toContain('RAW_PROVIDER_EXCEPTION secret detail');
  });

  test('an ambiguous comment response is never retried', async () => {
    const f = fixture(true); f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
    f.hook(call => { if (call === 'comment') throw new Error('response lost'); });
    await expect(verify(f.options)).rejects.toThrow('response lost');
    expect(f.calls.filter(call => call === 'comment')).toHaveLength(1);
    expect(f.calls).toContain(`status:failure:${SHA}`); expect(f.calls).not.toContain(`status:success:${SHA}`);
  });

  test('transcript or artifact overwrite at publication boundaries revokes or blocks exact-SHA success', async () => {
    for (const file of ['retained.log', 'fixture.json']) for (const boundary of ['comment', `status:success:${SHA}`]) {
      const f = fixture(true); f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
      f.hook(call => { if (call === boundary) writeFileSync(join(f.options.root, file), 'overwritten'); });
      await expect(verify(f.options)).rejects.toThrow('changed after acceptance');
      expect(f.comments).toHaveLength(1); expect(f.calls).toContain(`status:failure:${SHA}`);
      if (boundary === 'comment') expect(f.calls).not.toContain(`status:success:${SHA}`);
    }
  });

  test('head/base races never publish success and failure gate stays on the pinned candidate', async () => {
    for (const boundary of ['files', 'prepare', 'exercise', 'comment', `status:success:${SHA}`]) {
      const f = fixture(true); f.options.driver.cleanup = async () => { f.calls.push('cleanup'); };
      f.hook(call => { if (call === boundary) f.pull.head.sha = NEXT; });
      await expect(verify(f.options)).rejects.toThrow('changed');
      if (boundary !== `status:success:${SHA}`) expect(f.calls).not.toContain(`status:success:${SHA}`);
      expect(f.calls).toContain(`status:failure:${SHA}`); expect(f.calls.join()).not.toContain(`status:failure:${NEXT}`);
      expect(f.comments.length).toBeLessThanOrEqual(1);
    }
  });

  const RELEASE: ChangedFile[] = [{ filename: '.claude-plugin/marketplace.json', versionOnly: true }, { filename: 'CHANGES.md' }, { filename: 'README.md' }, { filename: 'UPSTREAM.md' },
    { filename: 'docs/reference.md' }, { filename: 'plugins/pstack/.claude-plugin/plugin.json', versionOnly: true }, { filename: 'plugins/pstack/.codex-plugin/plugin.json', versionOnly: true }];
  const noWrites = (calls: string[]) => expect(calls.some(call => ['preflight', 'prepare', 'exercise', 'comment'].includes(call) || call.startsWith('status:'))).toBe(false);

  test('a named feature outside the classified reach is refused before preflight or any GitHub write', async () => {
    const f = fixture(true); f.options.github.files = async () => { f.calls.push('files'); return RELEASE; };
    f.options.features = ['claude:hook:startup', 'codex:hook:startup', 'claude:catalog', 'codex:catalog', 'claude:setup', 'codex:setup', 'claude:runner', 'codex:runner'];
    const error = await verify(f.options).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(Refused);
    expect((error as Error).message).toBe("Outside this PR's classified reach: claude:catalog, codex:catalog, claude:setup, codex:setup, claude:runner, codex:runner. Reachable: claude:hook:startup, codex:hook:startup");
    noWrites(f.calls);
    const docs = fixture(); docs.options.features = ['claude:skill-invocation:architect'];
    await expect(verify(docs.options)).rejects.toThrow("Outside this PR's classified reach: claude:skill-invocation:architect. Reachable: none");
    noWrites(docs.calls);
  });

  test('the release runs its two startup sessions', async () => {
    const f = fixture(true); f.options.github.files = async () => RELEASE;
    f.options.features = ['claude:hook:startup', 'codex:hook:startup'];
    const receipt = await verify(f.options);
    expect(receipt.status).toBe('success'); expect(receipt.sessions).toBe(2);
    expect(f.comments[0]).toContain(`- Planned sessions: 2 (limit ${SESSION_LIMIT})`); expect(f.comments[0]).not.toContain('Wide run reason');
  });

  test('more than the session limit is refused before preflight unless --wide gives a reason', async () => {
    const limited = (...extra: string[]) => {
      const f = fixture(true); f.options.github.files = async () => [{ filename: 'plugins/pstack/skills/poteto-mode/references/codex-tools.md' }];
      f.options.features = ['claude:setup', 'claude:runner', 'claude:hook:startup', ...extra];
      return f;
    };
    expect(SESSION_LIMIT).toBe(12);
    const exact = limited();
    expect((await verify(exact.options)).sessions).toBe(12);
    const over = limited('codex:hook:startup');
    await expect(verify(over.options)).rejects.toThrow('13 planned sessions exceed the limit of 12; name fewer features or pass --wide "<reason>"');
    noWrites(over.calls);
    const wide = limited('codex:hook:startup'); wide.options.wide = 'Setup and runner changed together in #196';
    const receipt = await verify(wide.options);
    expect(receipt.status).toBe('success'); expect(receipt.sessions).toBe(13); expect(receipt.wide).toBe(wide.options.wide);
    expect(wide.calls.indexOf('preflight')).toBeGreaterThan(-1);
    expect(wide.comments[0]).toContain('- Planned sessions: 13 (limit 12)');
    expect(wide.comments[0]).toContain('- Wide run reason: Setup and runner changed together in #196');
    const failed = limited('codex:hook:startup'); failed.options.wide = 'Broad shared change';
    failed.options.driver.exercise = async () => { throw new Error('session failed'); };
    failed.options.driver.cleanup = async () => {};
    await expect(verify(failed.options)).rejects.toThrow('session failed');
    expect(failed.comments[0]).toContain('FAILED'); expect(failed.comments[0]).toContain('- Wide run reason: Broad shared change');
  });

  test('an unsupported recipe fails before preflight', async () => {
    const f = fixture(true); f.options.github.files = async () => [{ filename: 'plugins/pstack/assets/logo.png' }];
    f.options.features = ['codex:assets:codex'];
    await expect(verify(f.options)).rejects.toThrow('unsupported-native-consumer:assets:codex');
    noWrites(f.calls);
  });

  test('closed or foreign PR never enters publication', async () => {
    for (const field of ['state', 'headRepo'] as const) {
      const f = fixture(); f.pull[field] = 'other';
      await expect(verify(f.options)).rejects.toThrow('open same-repository'); expect(f.calls).toEqual(['pull']);
    }
  });

  test('large evidence remains bounded and exposes no raw transcript content', async () => {
    const receipt = await verify(fixture(true).options), observation = receipt.observations[0]!;
    receipt.observations = Array.from({ length: 400 }, (_, index) => ({ ...observation, feature: `skill:${index}`, action: 'a'.repeat(3000), observed: 'r'.repeat(3000), artifacts: Array.from({ length: 20 }, (_, n) => ({ path: `artifact-${n}`, sha256: HASH })) }));
    const comment = evidence(receipt);
    expect(comment.length).toBeLessThan(60000); expect(comment).toContain('Additional observations'); expect(comment).toContain('Evidence-set SHA-256');
    expect(comment).not.toContain('reviewed transcript'); expect(comment).not.toContain('retained.log');
    receipt.failure = 'RAW '.repeat(10000); expect(evidence(receipt).length).toBeLessThan(60000); expect(evidence(receipt)).not.toContain('RAW');
  });
});

describe('publisher request boundaries', () => {
  test('NUL diff parser preserves rename provenance and rejects malformed results', () => {
    expect(parseChangedFiles('R100\0plugins/pstack/skills/architect/SKILL.md\0docs/new.md\0M\0README.md\0')).toEqual([{ filename: 'docs/new.md', previous_filename: 'plugins/pstack/skills/architect/SKILL.md' }, { filename: 'README.md' }]);
    expect(parseChangedFiles('')).toEqual([]);
    for (const output of ['M\0README.md', 'R100\0old\0', 'M\0same\0M\0same\0', 'X\0file\0']) expect(() => parseChangedFiles(output)).toThrow();
  });

  test('fresh local git diff uses immutable base/head even when a source branch moves', async () => {
    const repository = temporary(), env = { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, env, encoding: 'utf8' }).trim();
    git('init', '-q'); writeFileSync(join(repository, 'README.md'), 'base'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repository, 'runtime')); writeFileSync(join(repository, 'runtime', 'skill.md'), 'immutable runtime'); git('add', '.'); git('commit', '-qm', 'runtime'); const head = git('rev-parse', 'HEAD');
    git('rm', '-q', 'runtime/skill.md'); git('commit', '-qm', 'later docs-only branch');
    const calls: string[][] = [];
    const publisher = new Publisher(async (args, options) => { calls.push(args); if (args[0] === 'git' && args[1] === 'fetch') args = args.map(arg => arg === `https://github.com/${REPO}.git` ? repository : arg); return command(args, options); });
    expect(await publisher.files(base, head)).toEqual([{ filename: 'runtime/skill.md' }]);
    expect(calls.some(args => args[0] === 'gh')).toBe(false); expect(calls).toContainEqual(expect.arrayContaining([`${base}...${head}`]));
    await expect(publisher.files('main', head)).rejects.toThrow('Invalid diff SHA');
  });

  test('a manifest is version-only when only its version strings changed since the merge base', async () => {
    const repository = temporary(), env = { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, env, encoding: 'utf8' }).trim();
    const CLAUDE = 'plugins/pstack/.claude-plugin/plugin.json', CODEX = 'plugins/pstack/.codex-plugin/plugin.json', MARKET = '.claude-plugin/marketplace.json';
    const write = (path: string, value: unknown, indent = 2) => { mkdirSync(join(repository, path, '..'), { recursive: true }); writeFileSync(join(repository, path), JSON.stringify(value, null, indent) + '\n'); };
    const manifests = (version: string, extra = {}) => {
      write(CLAUDE, { name: 'pstack', version, description: 'd' });
      write(CODEX, { version, name: 'pstack', interface: { logo: './assets/logo.png' } });
      write(MARKET, { name: 'open-pstack', plugins: [{ name: 'pstack', version, source: './plugins/pstack' }], ...extra });
    };
    const commit = (message: string) => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
    git('init', '-q', '-b', 'main'); manifests('1.0.0'); const mergeBase = commit('base');
    manifests('1.0.0', { owner: 'later' }); const base = commit('main moved');
    git('checkout', '-q', '-b', 'release', mergeBase);
    write(CLAUDE, { version: '1.1.0', description: 'd', name: 'pstack' }, 4);
    write(CODEX, { version: '1.1.0', name: 'pstack', interface: { logo: './assets/logo.png' } });
    write(MARKET, { name: 'open-pstack', plugins: [{ name: 'pstack', version: '1.1.0', source: './plugins/pstack' }] });
    const release = commit('release');
    git('checkout', '-q', '-b', 'edited', mergeBase);
    write(CLAUDE, { name: 'pstack', version: '1.1.0', description: 'changed' });
    write(CODEX, { version: '1.0.0', name: 'pstack', interface: { logo: './assets/logo.png' } }, 4);
    write(MARKET, { name: 'open-pstack', plugins: [{ name: 'pstack', source: './plugins/pstack' }] });
    const edited = commit('extra field, unchanged version, removed version');
    git('checkout', '-q', '-b', 'moved', mergeBase);
    renameSync(join(repository, CLAUDE), join(repository, 'plugins/pstack/.claude-plugin/old.json'));
    rmSync(join(repository, CODEX));
    write(MARKET, { name: 'open-pstack', plugins: [{ name: 'pstack', version: '1.1.0', source: './plugins/pstack' }] }); chmodSync(join(repository, MARKET), 0o755);
    const moved = commit('rename, deletion, mode change');
    const publisher = new Publisher(async (args, options) => command(args[0] === 'git' && args[1] === 'fetch' ? args.map(arg => arg === `https://github.com/${REPO}.git` ? repository : arg) : args, options));
    const flagged = async (head: string) => (await publisher.files(base, head)).filter(f => f.versionOnly).map(f => f.filename).sort();
    expect(await flagged(release)).toEqual([MARKET, CLAUDE, CODEX].sort());
    expect((await publisher.files(base, edited)).map(f => f.filename).sort()).toEqual([MARKET, CLAUDE, CODEX].sort());
    expect(await flagged(edited)).toEqual([]);
    expect((await publisher.files(base, moved)).length).toBe(3);
    expect(await flagged(moved)).toEqual([]);
  });

  test('interruption blocks ordinary status writes but permits a pinned failure gate', () => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const script = `
        import { command, interruptCommands } from ${JSON.stringify(new globalThis.URL('./io.ts', import.meta.url).pathname)};
        import { Publisher } from ${JSON.stringify(new globalThis.URL('./github.ts', import.meta.url).pathname)};
        await interruptCommands(${JSON.stringify(signal)});
        const executed = [];
        const publisher = new Publisher(async (args, options) => { const output = await command([process.execPath, '-e', 'console.log("{}")'], options); executed.push(args); return output; });
        try { await publisher.status(${JSON.stringify(SHA)}, 'success', ${JSON.stringify(URL)}, 'passed'); throw new Error('ordinary write escaped interruption'); }
        catch (error) { if (!String(error).includes('Interrupted by')) throw error; }
        await publisher.status(${JSON.stringify(SHA)}, 'failure', ${JSON.stringify(URL)}, 'failed');
        console.log(JSON.stringify(executed));
      `;
      const calls = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim()) as string[][];
      expect(calls).toHaveLength(1); expect(calls[0]).toContain('state=failure');
    }
  });

  test('status targets the supplied exact SHA and evidence URL, never a branch', async () => {
    const calls: string[][] = [], publisher = new Publisher(async args => { calls.push(args); return '{}'; });
    await publisher.status(SHA, 'success', URL, 'passed');
    expect(calls[0]).toContain(`repos/${REPO}/statuses/${SHA}`); expect(calls[0]).toContain('context=live-gate'); expect(calls[0]).toContain(`target_url=${URL}`);
    await expect(publisher.status('main', 'success', URL, 'passed')).rejects.toThrow('Invalid status SHA');
  });
});
