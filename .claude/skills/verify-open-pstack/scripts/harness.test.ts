import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from './doctor.ts';
import { codexInstallation, launch, MacDriver, verifyCodexEnabled, verifyProjectDoctor } from './harness.ts';
import { newReceipt } from './core.ts';
import { MAC_TESTS } from './verify.ts';
import { command, freshRoot, isolatedEnv, redact, retainedFile, treeHash, type Command } from './io.ts';
const roots: string[] = [];
async function fixture(): Promise<string> { const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-test-'))); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('isolated harness boundaries', () => {
  test('candidate environment never carries publisher credentials or daily config', () => {
    process.env.GH_TOKEN = 'test-publisher-token'; process.env.CODEX_HOME = '/daily/codex';
    process.env.CLAUDE_CONFIG_DIR = '/daily/claude';
    const oldAnthropic = process.env.ANTHROPIC_API_KEY, oldOpenai = process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'daily-anthropic'; process.env.OPENAI_API_KEY = 'daily-openai';
    try {
      for (const harness of ['claude', 'codex'] as const) {
        const env = isolatedEnv('/run/home', harness);
        expect(env.GH_TOKEN).toBeUndefined(); expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined();
        expect(env.HOME).toBe('/run/home'); expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
        expect(env.TMPDIR).toBe('/run/home/tmp');
        expect(env.CLAUDE_CONFIG_DIR).toBe('/run/home/.claude');
        expect(env.CODEX_HOME).toBe('/run/home/.codex');
        expect(env.GH_CONFIG_DIR).toBe('/run/home/.config/gh');
        expect(JSON.stringify(env)).not.toContain('/daily/');
      }
      expect(launch('claude', '/run/home', '/candidate')).toEqual(['claude', '--plugin-dir', '/candidate/plugins/pstack', '--settings', '/run/home/settings.json', '--setting-sources', 'project']);
      expect(launch('codex', '/run/home', '/candidate')).toEqual(['codex']);
    } finally {
      delete process.env.GH_TOKEN; delete process.env.CODEX_HOME; delete process.env.CLAUDE_CONFIG_DIR;
      if (oldAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldAnthropic;
      if (oldOpenai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenai;
    }
  });
  test('candidate environment preserves real account names without inventing an account', () => {
    const previous = { USER: process.env.USER, LOGNAME: process.env.LOGNAME };
    process.env.USER = 'operator-user'; process.env.LOGNAME = 'operator-login';
    try {
      for (const harness of ['claude', 'codex'] as const) {
        const env = isolatedEnv('/run/home', harness);
        expect(env.USER).toBe('operator-user'); expect(env.LOGNAME).toBe('operator-login');
        expect(env.HOME).toBe('/run/home');
      }
      delete process.env.USER; delete process.env.LOGNAME;
      const env = isolatedEnv('/run/home', 'claude');
      expect(env.USER).toBeUndefined(); expect(env.LOGNAME).toBeUndefined();
    } finally {
      for (const name of ['USER', 'LOGNAME'] as const) {
        if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
      }
    }
  });
  test('doctor blocks non-Mac and missing isolation interfaces, retaining reasons', async () => {
    const root = await fixture();
    const run: Command = async args => args.includes('--version') ? 'version' : '';
    await expect(doctor(root, run, 'linux')).rejects.toThrow('operator Mac');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('blocked');
    await expect(doctor(root, run, 'darwin')).rejects.toThrow('isolation missing');
  });
  test('doctor probes without installing or reading daily authentication', async () => {
    const calls: string[][] = [], root = await fixture();
    const run: Command = async args => { calls.push(args); return args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path'; };
    await doctor(root, run, 'darwin');
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
    expect(calls.every(c => c.includes('--help') || c.includes('--version'))).toBe(true);
  });
  test('project self-test accepts real doctor output through canonical workspace paths', async () => {
    const root = await fixture(), workspace = join(root, 'workspace');
    const skill = await realpath(join(import.meta.dir, '..'));
    await mkdir(join(workspace, '.claude/skills'), { recursive: true });
    await symlink(skill, join(workspace, '.claude/skills/verify-open-pstack'));
    const alias = join(root, 'workspace-alias'); await symlink(workspace, alias);
    const run: Command = async args => args.includes('--version') ? 'version' : '--plugin-dir --settings --setting-sources --json local path';
    await doctor(root, run, 'darwin');
    const parentText = await readFile(join(root, 'doctor.json'), 'utf8');
    await expect(verifyProjectDoctor([parentText], workspace)).rejects.toThrow('passing child doctor');
    await doctor(root, run, 'darwin', true);
    const text = await readFile(join(root, 'doctor.json'), 'utf8');
    expect(JSON.parse(text).skill).toBe(skill);
    await verifyProjectDoctor(['not JSON', text], workspace);
    await verifyProjectDoctor([text], alias);
    const other = join(root, 'other-workspace');
    await mkdir(join(other, '.claude/skills/verify-open-pstack'), { recursive: true });
    await expect(verifyProjectDoctor([text], other)).rejects.toThrow('passing child doctor');
    await expect(verifyProjectDoctor(['{}'], workspace)).rejects.toThrow('passing child doctor');
    await expect(verifyProjectDoctor([JSON.stringify({ ...JSON.parse(text), result: 'blocked' })], workspace)).rejects.toThrow('passing child doctor');
  });
  test.each([false, true, 'proof', 'review'])('prepare gates disposable credentials on pinned proof (failure=%s)', async failure => {
    const failInstall = failure === true;
    const root = await fixture(), repository = join(root, 'repository'), calls: string[][] = [];
    const accounts = { claude: 'claude@example.com', codex: 'codex@example.com' };
    const caam = join(root, 'caam'), vault = join(caam, 'data/vault');
    const credentials = { claude: JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-claude' } }), codex: JSON.stringify({ tokens: { access_token: 'fixture-codex' } }) };
    for (const tool of ['claude', 'codex'] as const) {
      const dir = join(vault, tool, accounts[tool]); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, tool === 'claude' ? '.credentials.json' : 'auth.json'), credentials[tool]);
    }
    for (const manifest of ['.claude-plugin', '.codex-plugin']) {
      const dir = join(repository, 'plugins/pstack', manifest); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'plugin.json'), JSON.stringify({ version: 'test' }));
    }
    await mkdir(join(repository, '.claude/skills/verify-open-pstack'), { recursive: true });
    await writeFile(join(repository, '.claude/skills/verify-open-pstack/SKILL.md'), 'pinned project skill');
    await mkdir(join(repository, '.agents/skills'), { recursive: true });
    await symlink('../../.claude/skills/verify-open-pstack', join(repository, '.agents/skills/verify-open-pstack'));
    await command(['git', 'init', repository]);
    await command(['git', 'add', '.'], { cwd: repository });
    await command(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: repository });
    const sha = (await command(['git', 'rev-parse', 'HEAD'], { cwd: repository })).trim();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!, previousCaam = process.env.CAAM_HOME;
    const run: Command = async (wrapped, options = {}) => {
      const args = wrapped[0] === '/usr/bin/sandbox-exec' ? wrapped.slice(3) : wrapped;
      calls.push(args);
      if (args[0] === '/bin/sh') {
        expect(options.cwd).toBe(join(root, 'source-home/workspace/.claude/skills/verify-open-pstack'));
        expect(options.env!.PSTACK_OPERATOR_SENTINELS).toBe('1'); expect(process.env.HOME).toBe(options.env!.HOME);
        expect(args[2]).toContain('--timeout 0'); expect(options.env!.GH_TOKEN).toBeUndefined();
        for (const harness of ['claude', 'codex']) await expect(stat(join(root, 'state', harness))).rejects.toThrow('ENOENT');
        // Fake adapter output only; actual OS proof is required on the operator Mac.
        return `${MAC_TESTS.map(name => `(pass) ${name} [1ms]`).join('\n')}\n 2 pass\n 0 fail\nPSTACK_MAC_TEST_EXIT=${failure === 'proof' ? '1' : '0'}\n`;
      }
      if (args[0] === 'caam') {
        expect(wrapped.slice(0, 2)).toEqual(['/usr/bin/sandbox-exec', '-p']);
        expect(wrapped[2]).toContain('(deny file-write*)');
        expect(options.env!.CAAM_HOME).toBe(caam);
        return JSON.stringify({ profiles: ['claude', 'codex'].map(tool => ({ tool, name: accounts[tool as keyof typeof accounts], identity: { email: accounts[tool as keyof typeof accounts] } })) });
      }
      const env = options.env!, candidate = env.HOME!.startsWith(join(root, 'state') + '/');
      if (candidate) {
        expect(wrapped.slice(0, 2)).toEqual(['/usr/bin/sandbox-exec', '-f']);
        const baseProfile = `${env.HOME!}.unit-test.sb`;
        expect([baseProfile, `${baseProfile}.exercise.sb`]).toContain(wrapped[2]!);
        for (const dir of [env.HOME!, env.TMPDIR!, env.CLAUDE_CONFIG_DIR!, env.CODEX_HOME!, env.GH_CONFIG_DIR!]) {
          const info = await stat(dir);
          expect(info.isDirectory()).toBe(true); expect(info.mode & 0o777).toBe(0o700);
        }
        expect(env.CLAUDE_CONFIG_DIR).toBe(join(env.HOME!, '.claude'));
        expect(env.CODEX_HOME).toBe(join(env.HOME!, '.codex'));
        expect(env.GH_TOKEN).toBeUndefined(); expect(env.CAAM_HOME).toBeUndefined();
        const settings = join(env.HOME!, 'settings.json');
        expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
        expect((await stat(settings)).mode & 0o777).toBe(0o600);
      }
      if (options.cwd) expect((await stat(options.cwd)).isDirectory()).toBe(true);
      if (args[0] === '/bin/rm') return command(args, options);
      if (args[0] === '/usr/bin/true') return '';
      if (args[0] === '/usr/bin/script') {
        expect(wrapped[2]).toBe(`${env.HOME!}.unit-test.sb.exercise.sb`);
        expect(wrapped[2]!.startsWith(env.HOME! + '/')).toBe(false);
        const policy = await readFile(wrapped[2]!, 'utf8');
        const workspace = join(env.HOME!, 'workspace');
        expect(policy).toContain(`(deny file-write* (require-all (subpath ${JSON.stringify(workspace)})`);
        expect(policy).toContain(`(subpath ${JSON.stringify(join(workspace, '.claude/skills/verify-open-pstack/node_modules'))})`);
        expect(policy).toContain(`(subpath ${JSON.stringify(join(workspace, 'plugins/pstack/skills/poteto-mode/scripts/node_modules'))})`);
        if (args.includes('codex')) expect(policy).toContain(`(deny file-write* (require-all (subpath ${JSON.stringify(join(env.CODEX_HOME!, 'plugins/pstack'))})`);
        expect(options.interactive).toBe(true);
        throw new Error('fixture protected native surface reached');
      }
      if (args[0] === 'git') {
        const local = [...args];
        if (args[1] === 'clone') local[local.length - 2] = repository;
        return command(local, options);
      }
      if (args.includes('--version')) return 'version';
      if (args.includes('--help')) return '--plugin-dir --settings --setting-sources --json local path';
      if (args[0] === 'codex' && args[1] === 'plugin') {
        for (const tool of ['claude', 'codex'] as const) {
          const file = join(env[tool === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']!, tool === 'claude' ? '.credentials.json' : 'auth.json');
          expect(await readFile(file, 'utf8')).toBe(credentials[tool]);
          expect((await stat(file)).mode & 0o777).toBe(0o600);
        }
        if (failInstall) throw new Error('fixture installation failed');
        if (args[2] === 'marketplace') return '{}';
        if (args[2] === 'add') {
          const installedPath = join(env.CODEX_HOME!, 'plugins/pstack');
          await cp(join(env.HOME!, 'workspace/plugins/pstack'), installedPath, { recursive: true });
          return JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath });
        }
        if (args[2] === 'list') return JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: true }] });
      }
      throw new Error(`Unexpected fixture command: ${args.join(' ')}`);
    };
    // Unit adapter only: this wrapper does not enforce an OS boundary. The
    // independent macOS isolation.test.ts lane executes real sandbox-exec.
    const boundary = async (home: string): Promise<string> => {
      const profile = `${home}.unit-test.sb`; await writeFile(profile, 'unit adapter'); return profile;
    };
    const review = async () => failure === 'review' ? 'REJECT' : 'PASS MAC ISOLATION';
    const driver = new MacDriver(run, review, accounts, boundary);
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' }); process.env.CAAM_HOME = caam;
      const preparedReceipt = newReceipt(111, sha, sha, true, root);
      const preparation = driver.prepare(preparedReceipt);
      if (failure === 'proof') await expect(preparation).rejects.toThrow('Both pinned Mac');
      else if (failure === 'review') await expect(preparation).rejects.toThrow('Operator rejected Mac');
      else if (failInstall) await expect(preparation).rejects.toThrow('fixture installation failed');
      else {
        const installs = await preparation;
        expect(installs.map(i => i.harness)).toEqual(['claude', 'codex']);
        expect(installs.map(i => i.account)).toEqual([accounts.claude, accounts.codex]);
        expect(installs.every(i => i.sha === sha)).toBe(true);
        expect(installs.every(i => /^[a-f0-9]{64}$/.test(i.sourceHash!))).toBe(true);
        expect(installs[0]!.sourceHash).toBe(installs[1]!.sourceHash);
        expect(calls.some(c => c.join(' ') === 'codex plugin add pstack@open-pstack --json')).toBe(true);
        for (const installation of installs) {
          const receipt = newReceipt(111, sha, sha, true, root);
          receipt.installations = [installation]; receipt.macProof = preparedReceipt.macProof;
          expect(receipt.macProof!.sha).toBe(sha); expect(receipt.macProof!.noKeychainDialog).toBe(true);
          expect(receipt.macProof!.tests.sha256).toMatch(/^[a-f0-9]{64}$/);
          await expect(driver.exercise(receipt)).rejects.toThrow('fixture protected native surface reached');
        }
        expect(calls.filter(c => c[0] === '/usr/bin/script')).toHaveLength(2);
      }
    } finally {
      await driver.cleanup(); await driver.cleanup();
      Object.defineProperty(process, 'platform', platform);
      if (previousCaam === undefined) delete process.env.CAAM_HOME; else process.env.CAAM_HOME = previousCaam;
    }
    for (const harness of ['claude', 'codex']) {
      for (const tool of ['claude', 'codex'] as const) {
        const filename = tool === 'claude' ? '.credentials.json' : 'auth.json';
        await expect(stat(join(root, 'state', harness, '.' + tool, filename))).rejects.toThrow('ENOENT');
        expect(await readFile(join(vault, tool, accounts[tool], filename), 'utf8')).toBe(credentials[tool]);
      }
    }
    expect(JSON.parse(await readFile(join(root, 'doctor.json'), 'utf8')).result).toBe('pass');
  });
  test('Codex exact installed tree and enabled listing are required', async () => {
    const root = await fixture(), plugin = join(root, 'config/plugins/pstack');
    await mkdir(plugin, { recursive: true }); await writeFile(join(plugin, 'SKILL.md'), 'candidate');
    const hash = await treeHash(plugin), receipt = JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath: plugin });
    expect(await codexInstallation(receipt, root, hash)).toBe(plugin);
    await expect(codexInstallation(receipt, root, 'bad')).rejects.toThrow('differs');
    await expect(codexInstallation('{}', root, hash)).rejects.toThrow('Unrecognized');
    expect(() => verifyCodexEnabled(JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: true }] }))).not.toThrow();
    expect(() => verifyCodexEnabled(JSON.stringify({ installed: [{ name: 'pstack', marketplaceName: 'open-pstack', installed: true, enabled: false }] }))).toThrow('enabled');
    const outside = await fixture(); await writeFile(join(outside, 'SKILL.md'), 'candidate');
    await expect(codexInstallation(JSON.stringify({ name: 'pstack', marketplaceName: 'open-pstack', installedPath: outside }), root, hash)).rejects.toThrow('escaped');
  });
  test('plugin symlinks and evidence outside retained root are rejected', async () => {
    const root = await fixture(), outside = await fixture();
    await writeFile(join(outside, 'secret'), 'outside'); await symlink(join(outside, 'secret'), join(root, 'escape'));
    await expect(treeHash(root)).rejects.toThrow('symlink');
    await expect(retainedFile(root, 'escape')).rejects.toThrow('within output');
    await writeFile(join(root, 'reviewed.txt'), 'native surface');
    expect((await retainedFile(root, 'reviewed.txt')).sha256).toMatch(/^[a-f0-9]{64}$/);
    await mkdir(join(root, 'state')); await writeFile(join(root, 'state/raw'), 'raw');
    await expect(retainedFile(root, 'state/raw')).rejects.toThrow('outside isolated state');
  });
  test('output must be fresh and outside the repository', async () => {
    const root = await fixture(), repo = join(root, 'repo'); await mkdir(repo);
    await expect(freshRoot(join(repo, 'output'), repo)).rejects.toThrow('outside');
    await expect(freshRoot(root, repo)).rejects.toThrow();
    expect(await freshRoot(join(root, 'output'), repo)).toBe(join(root, 'output'));
    expect(redact('ghp_testsecret sk-providersecret Bearer abc')).toBe('[REDACTED] [REDACTED] [REDACTED]');
  });
});
