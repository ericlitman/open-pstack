import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { command, isolatedEnv, redact, retainedFile } from './io.ts';
import { copyCredentials, createSandbox, protectSources, registerSessionCredentials, removeCredentials, resolveAppleGit, sandboxed, sandboxProfile, selectedAccounts } from './isolation.ts';
import type { Accounts } from './types.ts';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-isolation-')));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const accounts: Accounts = { claude: 'claude@example.com', codex: 'codex@example.com' };
function profiles(claude = accounts.claude, codex = accounts.codex): string {
  return JSON.stringify({ profiles: [
    { tool: 'claude', name: accounts.claude, identity: { email: claude } },
    { tool: 'codex', name: accounts.codex, identity: { email: codex } },
  ] });
}
async function vault(root: string): Promise<string> {
  const base = join(root, 'vault');
  for (const tool of ['claude', 'codex'] as const) {
    const path = join(base, tool, accounts[tool]);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(join(path, tool === 'claude' ? '.credentials.json' : 'auth.json'), JSON.stringify(
      tool === 'claude' ? { claudeAiOauth: { accessToken: 'selected-claude-token' } } : { tokens: { access_token: 'selected-codex-token' } },
    ), { mode: 0o600 });
  }
  return base;
}

describe('disposable credential boundary', () => {
  test('both provider config roots stay in the candidate home, including external-provider children', () => {
    const home = '/run/private-candidate';
    for (const tool of ['claude', 'codex'] as const) {
      const env = isolatedEnv(home, tool);
      expect(env.HOME).toBe(home);
      expect(env.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude'));
      expect(env.CODEX_HOME).toBe(join(home, '.codex'));
      expect(env.GH_CONFIG_DIR).toBe(join(home, '.config/gh'));
      expect(env.TMPDIR).toBe(join(home, 'tmp'));
      expect(env.GIT_CONFIG_VALUE_0).toBe('');
      expect(env.CAAM_HOME).toBeUndefined();
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(process.env.USER).toBe(env.USER);
      expect(process.env.LOGNAME).toBe(env.LOGNAME);
    }
  });
  test('explicit vault profile identity must match each selected account', () => {
    expect(selectedAccounts(profiles(), accounts)).toEqual(accounts);
    expect(() => selectedAccounts(profiles('other@example.com'), accounts)).toThrow();
    expect(() => selectedAccounts(profiles(accounts.claude, 'other@example.com'), accounts)).toThrow();
    expect(() => selectedAccounts('{"profiles":[]}', accounts)).toThrow();
    expect(() => selectedAccounts('{}', accounts)).toThrow();
    expect(() => selectedAccounts('not JSON', accounts)).toThrow();
    expect(() => selectedAccounts(profiles(), { ...accounts, claude: '../escape@example.com' })).toThrow();
    const duplicate = JSON.parse(profiles()); duplicate.profiles.push(duplicate.profiles[0]);
    expect(() => selectedAccounts(JSON.stringify(duplicate), accounts)).toThrow();
  });
  test('real credential files are private copied files, never vault links, and cleanup preserves the vault', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate');
    const copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    expect(copied).toHaveLength(2);
    const originals = [join(base, 'claude', accounts.claude, '.credentials.json'), join(base, 'codex', accounts.codex, 'auth.json')];
    for (let i = 0; i < copied.length; i++) {
      expect((await lstat(copied[i]!)).isSymbolicLink()).toBe(false);
      expect((await stat(copied[i]!)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(copied[i]!))).mode & 0o777).toBe(0o700);
      expect(await readFile(copied[i]!, 'utf8')).toBe(await readFile(originals[i]!, 'utf8'));
    }
    const preserved = await Promise.all(originals.map(path => readFile(path, 'utf8')));
    await writeFile(copied[0]!, '{"refreshed":"candidate-only"}');
    expect(await readFile(originals[0]!, 'utf8')).toBe(preserved[0]);
    await removeCredentials(copied);
    await removeCredentials(copied);
    for (const path of copied) expect(await Bun.file(path).exists()).toBe(false);
    expect(await Promise.all(originals.map(path => readFile(path, 'utf8')))).toEqual(preserved);
  });
  test('copy registers opaque OAuth access, refresh and ID tokens before candidate processing', async () => {
    const root = await fixture(), base = await vault(root), copied: string[] = [];
    const tokens = ['opaque.alpha.access.987', 'opaque-refresh-654', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmaXh0dXJlIn0.sig', 'opaque.codex.access.321', 'opaque-codex-refresh-123'];
    await writeFile(join(base, 'claude', accounts.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: tokens[0], refreshToken: tokens[1] } }));
    await writeFile(join(base, 'codex', accounts.codex, 'auth.json'), JSON.stringify({ tokens: { id_token: tokens[2], access_token: tokens[3], refresh_token: tokens[4] } }));
    await copyCredentials(join(root, 'candidate'), base, accounts, copied);
    expect(redact(tokens.join(' '))).toBe(tokens.map(() => '[REDACTED]').join(' '));
    await removeCredentials(copied);
  });
  test('real provider refreshes register opaque and JWT credentials before accepting evidence or cleanup', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    const original = await Promise.all(copied.map(path => readFile(path, 'utf8')));
    const tokens = ['refreshed-claude-access.opaque', 'refreshed-claude-refresh.opaque', 'refreshed-codex-access.opaque', 'refreshed-codex-refresh.opaque', 'eyJhbGciOiJSUzI1NiJ9.refresh.fixtureSignature'];
    await writeFile(copied[0]!, JSON.stringify({ claudeAiOauth: { accessToken: tokens[0], refreshToken: tokens[1] } }));
    await writeFile(copied[1]!, JSON.stringify({ tokens: { access_token: tokens[2], refresh_token: tokens[3], id_token: tokens[4] } }));
    await registerSessionCredentials(home);
    expect(redact(tokens.join(' '))).toBe(tokens.map(() => '[REDACTED]').join(' '));
    for (const [i, token] of tokens.entries()) {
      const evidence = join(root, `refreshed-artifact-${i}`);
      await writeFile(evidence, Buffer.concat([Buffer.from([255, 0]), Buffer.from(token), Buffer.from([128, 0])]));
      await expect(retainedFile(root, evidence)).rejects.toThrow('Evidence contains credentials');
      expect(await Bun.file(evidence).exists()).toBe(false);
    }
    await removeCredentials(copied);
    await registerSessionCredentials(home);
    expect(await Bun.file(home).exists()).toBe(false);
    expect(original).toEqual(await Promise.all([
      readFile(join(base, 'claude', accounts.claude, '.credentials.json'), 'utf8'),
      readFile(join(base, 'codex', accounts.codex, 'auth.json'), 'utf8'),
    ]));
  });
  test('session credential discovery refuses redirected directories and credential files', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    const external = join(root, 'external');
    await mkdir(external);
    await writeFile(join(external, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"outside-fixture"}}');
    await rm(join(home, '.claude'), { recursive: true });
    await symlink(external, join(home, '.claude'));
    await expect(registerSessionCredentials(home)).rejects.toThrow('redirected');
    await rm(join(home, '.claude'));
    await mkdir(join(home, '.claude'));
    await symlink(join(external, '.credentials.json'), copied[0]!);
    await expect(registerSessionCredentials(home)).rejects.toThrow('regular files');
    expect(await readFile(join(external, '.credentials.json'), 'utf8')).toContain('outside-fixture');
    await removeCredentials(copied);
  });
  test('cleanup removes relocated and refreshed credentials anywhere in candidate state while preserving external evidence', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    const relocated = join(home, 'workspace/cache/relocated-oauth.json');
    await mkdir(dirname(relocated), { recursive: true });
    await writeFile(relocated, await readFile(copied[0]!));
    await writeFile(join(home, 'refreshed-token'), 'refreshed-disposable-token');
    await rm(copied[0]!);
    const evidence = join(root, 'transcript.txt'); await writeFile(evidence, 'retained external evidence');
    const before = await readFile(join(base, 'claude', accounts.claude, '.credentials.json'), 'utf8');
    await removeCredentials(copied);
    expect(await Bun.file(relocated).exists()).toBe(false);
    expect(await Bun.file(join(home, 'refreshed-token')).exists()).toBe(false);
    expect(await readFile(evidence, 'utf8')).toBe('retained external evidence');
    expect(await readFile(join(base, 'claude', accounts.claude, '.credentials.json'), 'utf8')).toBe(before);
  });
  test('partial copy can be cleaned on failure without changing any vault file', async () => {
    const root = await fixture(), base = await vault(root), copied: string[] = [];
    const bad = join(base, 'codex', accounts.codex, 'auth.json');
    await writeFile(bad, '{"unknown":true}');
    await expect(copyCredentials(join(root, 'candidate'), base, accounts, copied)).rejects.toThrow('unknown format');
    expect(copied).toHaveLength(1);
    await removeCredentials(copied);
    expect(await Bun.file(copied[0]!).exists()).toBe(false);
    expect(await readFile(bad, 'utf8')).toBe('{"unknown":true}');
  });
  test('vault symlinks and paths escaping the vault are not copied', async () => {
    const root = await fixture(), base = await vault(root), copied: string[] = [];
    const credential = join(base, 'claude', accounts.claude, '.credentials.json');
    const outside = join(root, 'outside-auth');
    await writeFile(outside, '{"claudeAiOauth":{"accessToken":"other-account"}}');
    await rm(credential); await symlink(outside, credential);
    await expect(copyCredentials(join(root, 'candidate'), base, accounts, copied)).rejects.toThrow('contained regular file');
    expect(copied).toEqual([]);
  });
  test('credential cleanup removes disposable state without following external configuration redirects', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await copyCredentials(home, base, accounts, copied);
    const outside = join(root, 'external'), sentinel = join(outside, '.credentials.json');
    await mkdir(outside); await writeFile(sentinel, 'external-credential-sentinel');
    await rm(join(home, '.claude'), { recursive: true }); await symlink(outside, join(home, '.claude'));
    const invoked: string[][] = [];
    await removeCredentials(copied, new Map([[home, join(root, 'candidate.sb')]]), async args => { invoked.push(args); return ''; });
    expect(invoked).toEqual([['/usr/bin/sandbox-exec', '-f', join(root, 'candidate.sb'), '/bin/rm', '-rf', '--', home]]);
    await expect(removeCredentials(copied, new Map())).rejects.toThrow('original candidate sandbox');
    await removeCredentials(copied);
    expect(await Bun.file(join(home, '.codex/auth.json')).exists()).toBe(false);
    expect(await readFile(sentinel, 'utf8')).toBe('external-credential-sentinel');
  });
  test('cleanup removes leaf symlinks without following them and copy records destinations before a failed write', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    await mkdir(join(home, '.claude'), { recursive: true });
    const target = join(home, '.claude/.credentials.json'), sentinel = join(root, 'external-credential');
    await writeFile(sentinel, 'preserve'); await symlink(sentinel, target);
    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow();
    expect(copied).toEqual([target]);
    await removeCredentials(copied);
    expect(await Bun.file(target).exists()).toBe(false);
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
  });
  test('selected vault tool and profile directories cannot redirect to another account', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), copied: string[] = [];
    const original = join(base, 'claude', accounts.claude), other = join(base, 'claude/other@example.com');
    await mkdir(other); await writeFile(join(other, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"wrong-account"}}');
    await rm(original, { recursive: true }); await symlink(other, original);
    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow('not symlinked');
    expect(copied).toEqual([]);
    await rm(original); await rm(other, { recursive: true });
    const redirected = join(root, 'redirected-tool');
    await mkdir(join(redirected, accounts.claude), { recursive: true });
    await writeFile(join(redirected, accounts.claude, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"wrong-account"}}');
    await rm(join(base, 'claude'), { recursive: true }); await symlink(redirected, join(base, 'claude'));
    await expect(copyCredentials(home, base, accounts, copied)).rejects.toThrow('not symlinked');
    expect(copied).toEqual([]);
  });
  test('the canonical vault deny overrides allowlisted files and candidate state cannot overlap it', async () => {
    const root = await fixture(), base = await vault(root), home = join(root, 'candidate'), alias = join(root, 'vault-alias');
    await mkdir(home); await symlink(base, alias);
    const text = sandboxProfile(home, '/Users/operator', [join(base, 'claude', accounts.claude, '.credentials.json')], alias);
    expect(text).toContain(`(deny file-read* file-write* (subpath ${JSON.stringify(base)}))`);
    expect(text).not.toContain(`(subpath ${JSON.stringify(alias)})`);
    await mkdir(join(base, 'nested'));
    expect(() => sandboxProfile(join(base, 'nested'), '/Users/operator', [], base)).toThrow('must not overlap');
    expect(() => sandboxProfile(base, '/Users/operator', [], base)).toThrow('must not overlap');
    expect(() => sandboxProfile(root, '/Users/operator', [], base)).toThrow('must not overlap');
  });
  test('DNS permits only the macOS resolver socket after the general Unix-socket denial', () => {
    const text = sandboxProfile('/private/run/candidate', '/Users/operator', []);
    const exception = '(allow network-outbound (remote unix-socket (path "/private/var/run/mDNSResponder")))';
    expect(text).toContain(exception);
    expect(text.indexOf(exception)).toBeGreaterThan(text.indexOf('(deny network-outbound (remote unix-socket'));
    expect(text.indexOf(exception)).toBeLessThan(text.indexOf('(deny network-outbound (remote ip "localhost:*"))'));
    expect(text).not.toContain('(allow network-outbound (remote unix-socket (path-regex');
  });
  test('Apple Git resolves beyond the shim and allows only its selected runtime', async () => {
    const root = await fixture(), executable = join(root, 'Xcode.app/Contents/Developer/usr/bin/git');
    await mkdir(dirname(executable), { recursive: true }); await writeFile(executable, 'native-git-fixture');
    const calls: string[][] = [];
    const selected = await resolveAppleGit('/usr/bin/git', async args => { calls.push(args); return executable + '\n'; });
    expect(calls).toEqual([['/usr/bin/xcrun', '--find', 'git']]);
    expect(selected).toEqual({ executable, runtime: dirname(dirname(executable)) });
    const text = sandboxProfile('/private/run/candidate', '/Users/operator', [selected.executable], undefined, [selected.runtime!]);
    expect(text.match(new RegExp('subpath ' + JSON.stringify(selected.runtime!).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2);
    expect(text).not.toContain('(subpath "/Applications")');
    await expect(resolveAppleGit('/usr/bin/git', async () => '/usr/bin/git')).rejects.toThrow('beyond');
    await expect(resolveAppleGit('/usr/bin/git', async () => 'relative/git')).rejects.toThrow('absolute');
    expect(await resolveAppleGit(executable, async () => { throw new Error('Non-shim must not use xcrun'); })).toEqual({ executable });
  });
  test('root-read exception is the final Seatbelt rule after all read denials', () => {
    const text = sandboxProfile('/private/run/candidate', '/Users/operator', ['/opt/homebrew/bin/bun']);
    const rules = text.trim().split('\n').filter(line => !line.startsWith(';'));
    expect(rules.at(-1)).toBe('(allow file-read* (literal "/"))');
    expect(text.lastIndexOf('(allow file-read* (literal "/"))')).toBeGreaterThan(text.lastIndexOf('(deny file-read*'));
    expect(text.lastIndexOf('(allow file-read* (literal "/"))')).toBeGreaterThan(text.lastIndexOf('(deny network-outbound (remote ip "localhost:*"))'));
  });
  test('Seatbelt contract denies daily files, Keychain IPC, security execution, and arbitrary writes', () => {
    const text = sandboxProfile('/private/run/candidate', '/Users/operator', ['/opt/homebrew/bin/bun']);
    expect(text).toContain('(deny file-read* file-write* (subpath "/Users/operator"))');
    expect(text).toContain('(deny file-read* (require-not (require-any');
    expect(text).toContain('(deny file-write* (require-not (require-any');
    expect(text).toContain('(deny mach-lookup (require-not (require-any');
    expect(text).not.toContain('(global-name "com.apple.securityd")');
    expect(text).not.toContain('(global-name "com.apple.SecurityServer")');
    expect(text).not.toContain('(global-name "com.apple.SecurityAgent")');
    expect(text).toContain('(deny process-exec (literal "/usr/bin/security"))');
    expect(text).toContain('(deny process-info*');
    expect(() => sandboxProfile('/Users/operator/run', '/Users/operator', [])).toThrow('outside the operator home');
    expect(() => sandboxProfile('/Users/operator', '/Users/operator', [])).toThrow();
    expect(() => sandboxProfile('relative', '/Users/operator', [])).toThrow();
  });
});

describe('exercise source protection', () => {
  test('exercise policy stays outside candidate state with only three generated dependency exceptions', async () => {
    const root = await fixture(), home = join(root, 'candidate'), workspace = join(home, 'workspace'), plugin = join(home, '.codex/plugins/pstack');
    await mkdir(workspace, { recursive: true }); await mkdir(plugin, { recursive: true });
    const profile = join(root, 'candidate.sb');
    await writeFile(profile, sandboxProfile(home, '/Users/operator', []), { mode: 0o600 });
    const original = await readFile(profile, 'utf8');
    const exercise = await protectSources(profile, home, [workspace, plugin], async () => '');
    const text = await readFile(exercise, 'utf8');
    expect(exercise.startsWith(home + '/')).toBe(false);
    expect((await stat(exercise)).mode & 0o777).toBe(0o600);
    expect(await readFile(profile, 'utf8')).toBe(original);
    for (const path of [join(workspace, '.claude/skills/verify-open-pstack/node_modules'), join(workspace, 'plugins/pstack/skills/poteto-mode/scripts/node_modules'), join(plugin, 'skills/poteto-mode/scripts/node_modules')]) {
      expect((await stat(path)).isDirectory()).toBe(true);
      expect(text).toContain(`(subpath ${JSON.stringify(path)})`);
    }
    expect(text).toContain(`(deny file-write* (require-all (subpath ${JSON.stringify(workspace)})`);
    expect(text).toContain(`(deny file-write* (require-all (subpath ${JSON.stringify(plugin)})`);
    expect(text).toContain(`(literal ${JSON.stringify(join(home, '.codex'))})`);
    await expect(protectSources(profile, home, [workspace], async () => '')).rejects.toThrow();
  });
  test('root, ancestor, dependency redirects, outside sources, and writable policies fail closed', async () => {
    const root = await fixture(), home = join(root, 'candidate'), outside = join(root, 'outside');
    await mkdir(home); await mkdir(outside);
    const profile = join(root, 'candidate.sb'); await writeFile(profile, 'trusted-policy');
    const alias = join(home, 'alias'); await symlink(outside, alias);
    await expect(protectSources(profile, home, [alias], async () => '')).rejects.toThrow('Redirected source');
    await mkdir(join(outside, 'child')); await expect(protectSources(profile, home, [join(alias, 'child')], async () => '')).rejects.toThrow('Redirected source');
    await expect(protectSources(profile, home, [outside], async () => '')).rejects.toThrow('contained');
    await expect(protectSources(profile, home, [], async () => '')).rejects.toThrow('requires pinned');
    const workspace = join(home, 'workspace'); await mkdir(workspace);
    await symlink(outside, join(workspace, '.claude'));
    await expect(protectSources(profile, home, [workspace], async () => '')).rejects.toThrow('Redirected source');
    const writablePolicy = join(home, 'policy.sb'); await writeFile(writablePolicy, 'candidate-policy');
    await expect(protectSources(writablePolicy, home, [workspace], async () => '')).rejects.toThrow('outside candidate');
    const policyAlias = join(root, 'alias.sb'); await symlink(profile, policyAlias);
    await expect(protectSources(policyAlias, home, [workspace], async () => '')).rejects.toThrow('regular trusted');
    expect(await readFile(profile, 'utf8')).toBe('trusted-policy');
  });
});

// This is intentionally not a mocked-command test. Linux cannot prove Seatbelt
// enforcement; the operator must run this exact suite on the Mac before live proof.
const macTest = process.platform === 'darwin' ? test : test.skip;
macTest('real Mac sandbox denies daily-home and vault sentinels, writes, aliases, grandchildren, and Keychain IPC', async () => {
  const root = await fixture(), daily = join(root, 'daily'), home = join(root, 'candidate');
  await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
  const locations = [
    join(daily, 'home-sentinel'), join(daily, '.config/gh/hosts.yml'), join(daily, '.ssh/id_ed25519'),
    join(daily, '.claude/.credentials.json'), join(daily, '.codex/auth.json'),
    join(daily, 'Library/Keychains/login.keychain-db'), join(root, 'other-account-vault/auth.json'),
  ];
  for (const path of locations) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, 'operator-sentinel-must-remain-private', { mode: 0o600 });
  }
  const previousHome = process.env.HOME;
  let profile: string;
  const deniedVault = join(root, 'other-account-vault');
  try { process.env.HOME = daily; profile = await createSandbox(home, command, deniedVault); }
  finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  }
  const options = { cwd: home, env: isolatedEnv(home) };
  expect(await command(sandboxed(profile, ['git', '--version']), options)).toContain('git version');
  const allowed = join(home, 'candidate-sentinel');
  await writeFile(allowed, 'candidate-state-allowed');
  expect(await command(sandboxed(profile, ['/bin/cat', allowed]), options)).toBe('candidate-state-allowed');
  expect(profile.startsWith(home + '/')).toBe(false);
  expect((await stat(profile)).mode & 0o777).toBe(0o600);
  const originalPolicy = await readFile(profile, 'utf8');
  expect(originalPolicy).toContain(`(deny file-read* file-write* (subpath ${JSON.stringify(deniedVault)}))`);
  await expect(command(sandboxed(profile, ['/bin/sh', '-c', 'printf replacement > "$1"', 'policy', profile]), options)).rejects.toThrow();
  expect(await readFile(profile, 'utf8')).toBe(originalPolicy);
  // This deliberately allowlists a vault file, then proves the final explicit
  // vault denial overrides that allowance rather than relying on deny-default.
  const overrideProfile = join(root, 'override.sb'), vaultSentinel = join(deniedVault, 'auth.json');
  await writeFile(overrideProfile, sandboxProfile(home, daily, [vaultSentinel], deniedVault), { mode: 0o600 });
  await expect(command(sandboxed(overrideProfile, ['/bin/cat', vaultSentinel]), options)).rejects.toThrow();
  await expect(command(sandboxed(overrideProfile, ['/bin/sh', '-c', 'printf overwritten > "$1"', 'vault', vaultSentinel]), options)).rejects.toThrow();
  expect(await readFile(vaultSentinel, 'utf8')).toBe('operator-sentinel-must-remain-private');
  // Production cleanup inherits the same policy even if candidates replace
  // a configuration parent with a symlink to a vault credential directory.
  const redirectedCredential = join(home, '.claude/.credentials.json');
  await writeFile(join(deniedVault, '.credentials.json'), 'preserve-external-credential');
  await symlink(deniedVault, join(home, '.claude'));
  // Full-state cleanup runs after all probes below; it must not follow this
  // redirect or leave tokens relocated outside their original config path.
  await writeFile(join(home, 'relocated-token'), 'disposable-token');
  expect(await readFile(join(deniedVault, '.credentials.json'), 'utf8')).toBe('preserve-external-credential');
  const proof = { platform: process.platform, denied: [] as string[], keychainServices: {} as Record<string, { unsandboxed: number; sandboxed: number }> };
  for (const [i, path] of locations.entries()) {
    await expect(command(sandboxed(profile, ['/bin/cat', path]), options)).rejects.toThrow('failed');
    const alias = join(home, `alias-${i}`); await symlink(path, alias);
    await expect(command(sandboxed(profile, ['/bin/cat', alias]), options)).rejects.toThrow('failed');
    // A shell's child inherits the OS policy even without a provider-specific env.
    await expect(command(sandboxed(profile, ['/bin/sh', '-c', 'exec /bin/cat "$1"', 'child', path]), options)).rejects.toThrow('failed');
    await expect(command(sandboxed(profile, ['/bin/sh', '-c', 'printf overwritten > "$1"', 'setup', path]), options)).rejects.toThrow('failed');
    expect(await readFile(path, 'utf8')).toBe('operator-sentinel-must-remain-private');
    proof.denied.push(path);
  }
  await expect(command(sandboxed(profile, ['/usr/bin/security', 'list-keychains']), options)).rejects.toThrow();
  // Exercise actual Mach lookup, not just a security CLI deny rule. Compilation
  // happens in the trusted test parent; candidate execution inherits Seatbelt.
  const source = join(home, 'keychain-probe.c'), binary = join(home, 'keychain-probe');
  await writeFile(source, '#include <stdio.h>\n#include <servers/bootstrap.h>\nint main(int n,char **v){mach_port_t p=0; kern_return_t r=bootstrap_look_up(bootstrap_port,v[1],&p); printf("%d\\n",r); return 0;}\n');
  await command(['/usr/bin/clang', source, '-o', binary], { cwd: home });
  let reachable = 0;
  for (const service of ['com.apple.securityd.xpc', 'com.apple.securityd', 'com.apple.SecurityServer', 'com.apple.SecurityAgent']) {
    // A missing service is not denial proof. Look up the exact same service
    // first from the unsandboxed trusted parent without accessing any Keychain.
    const unsandboxed = Number((await command([binary, service], { cwd: home })).trim());
    expect(Number.isFinite(unsandboxed)).toBe(true);
    if (unsandboxed === 0) reachable++;
    const result = Number((await command(sandboxed(profile, [binary, service]), options)).trim());
    expect(Number.isFinite(result)).toBe(true); expect(result).not.toBe(0);
    proof.keychainServices[service] = { unsandboxed, sandboxed: result };
  }
  expect(reachable).toBeGreaterThan(0);
  await removeCredentials([redirectedCredential], new Map([[home, profile]]));
  expect(await Bun.file(join(home, 'relocated-token')).exists()).toBe(false);
  expect(await readFile(join(deniedVault, '.credentials.json'), 'utf8')).toBe('preserve-external-credential');
  console.log('Mac filesystem/Keychain denial proof:', JSON.stringify(proof));
}, 0);

// Explicit opt-in is required before planting new, randomized non-secret files
// in the operator's real HOME. Existing auth/SSH/Keychain files are never touched.
const operatorMacTest = process.platform === 'darwin' && process.env.PSTACK_OPERATOR_SENTINELS === '1' ? test : test.skip;
operatorMacTest('actual operator HOME denial and immutable exercise sources with writable dependency leaves', async () => {
  const daily = await realpath(process.env.HOME!), root = await fixture(), home = join(root, 'candidate');
  const directories = [daily, join(daily, '.config/gh'), join(daily, '.ssh'), join(daily, '.claude'), join(daily, '.codex'), join(daily, 'Library/Keychains')];
  const createdDirectories: string[] = [], sentinels: string[] = [], proof: Record<string, unknown> = { platform: process.platform, daily, denied: [] };
  async function ensureDirectory(path: string): Promise<void> {
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error(`Refuse redirected daily sentinel directory: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await ensureDirectory(dirname(path));
      await mkdir(path, { mode: 0o700 }); createdDirectories.push(path);
    }
  }
  try {
    for (const directory of directories) {
      await ensureDirectory(directory);
      const path = join(directory, `.pstack-denial-${randomUUID()}`);
      await writeFile(path, 'non-secret-operator-denial-sentinel', { flag: 'wx', mode: 0o600 }); sentinels.push(path);
    }
    console.log('Operator sentinel cleanup paths:', JSON.stringify(sentinels));
    await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
    const workspace = join(home, 'workspace'), plugin = join(home, '.codex/plugins/pstack');
    await mkdir(workspace); await mkdir(plugin, { recursive: true });
    const source = join(workspace, 'source.ts'), installed = join(plugin, 'SKILL.md');
    await writeFile(source, 'pinned-workspace-source'); await writeFile(installed, 'pinned-plugin-source');
    const profile = await createSandbox(home), exercise = await protectSources(profile, home, [workspace, plugin]);
    const options = { cwd: home, env: isolatedEnv(home) };
    for (const [index, path] of sentinels.entries()) {
      // Positive controls prove the file exists and is readable outside Seatbelt.
      expect(await command(['/bin/cat', path])).toBe('non-secret-operator-denial-sentinel');
      await expect(command(sandboxed(exercise, ['/bin/cat', path]), options)).rejects.toThrow();
      const alias = join(home, `daily-alias-${index}`); await symlink(path, alias);
      await expect(command(sandboxed(exercise, ['/bin/cat', alias]), options)).rejects.toThrow();
      await expect(command(sandboxed(exercise, ['/bin/sh', '-c', 'exec /bin/sh -c \'exec /bin/cat "$1"\' child "$1"', 'grandchild', path]), options)).rejects.toThrow();
      await expect(command(sandboxed(exercise, ['/bin/sh', '-c', 'printf overwritten > "$1"', 'write', path]), options)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('non-secret-operator-denial-sentinel');
    }
    proof.denied = [...sentinels];
    for (const path of [source, installed]) {
      const original = await readFile(path, 'utf8');
      expect(await command(sandboxed(exercise, ['/bin/cat', path]), options)).toBe(original);
      await expect(command(sandboxed(exercise, ['/bin/sh', '-c', 'printf altered > "$1"', 'write', path]), options)).rejects.toThrow();
      await expect(command(sandboxed(exercise, ['/bin/mv', path, join(home, 'relocated-source')]), options)).rejects.toThrow();
      await expect(command(sandboxed(exercise, ['/bin/rm', path]), options)).rejects.toThrow();
      await expect(command(sandboxed(exercise, ['/bin/ln', path, join(home, 'source-hardlink')]), options)).rejects.toThrow();
      const alias = join(home, `source-alias-${randomUUID()}`); await symlink(path, alias);
      await expect(command(sandboxed(exercise, ['/bin/sh', '-c', 'printf altered > "$1"', 'write', alias]), options)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe(original);
    }
    for (const path of [workspace, dirname(plugin), plugin]) {
      await expect(command(sandboxed(exercise, ['/bin/mv', path, join(home, `moved-${randomUUID()}`)]), options)).rejects.toThrow();
    }
    for (const path of [join(workspace, '.claude/skills/verify-open-pstack/node_modules'), join(workspace, 'plugins/pstack/skills/poteto-mode/scripts/node_modules'), join(plugin, 'skills/poteto-mode/scripts/node_modules')]) {
      const dependency = join(path, 'generated');
      await command(sandboxed(exercise, ['/bin/sh', '-c', 'printf generated > "$1"', 'bootstrap', dependency]), options);
      expect(await readFile(dependency, 'utf8')).toBe('generated');
    }
    await expect(command(sandboxed(exercise, ['/bin/sh', '-c', 'printf changed > "$1"', 'policy', exercise]), options)).rejects.toThrow();
    await expect(command(sandboxed(exercise, ['/usr/bin/security', 'list-keychains']), options)).rejects.toThrow();
    const probeSource = join(home, 'keychain-probe.c'), binary = join(home, 'keychain-probe');
    await writeFile(probeSource, '#include <stdio.h>\n#include <servers/bootstrap.h>\nint main(int n,char **v){mach_port_t p=0; kern_return_t r=bootstrap_look_up(bootstrap_port,v[1],&p); printf("%d\\n",r); return 0;}\n');
    await command(['/usr/bin/clang', probeSource, '-o', binary], { cwd: home });
    const services: Record<string, { unsandboxed: number; sandboxed: number }> = {}; let reachable = 0;
    for (const service of ['com.apple.securityd.xpc', 'com.apple.securityd', 'com.apple.SecurityServer', 'com.apple.SecurityAgent']) {
      const unsandboxed = Number((await command([binary, service], { cwd: home })).trim());
      const result = Number((await command(sandboxed(exercise, [binary, service]), options)).trim());
      expect(Number.isFinite(unsandboxed)).toBe(true); expect(Number.isFinite(result)).toBe(true); expect(result).not.toBe(0);
      if (unsandboxed === 0) reachable++;
      services[service] = { unsandboxed, sandboxed: result };
    }
    expect(reachable).toBeGreaterThan(0); proof.keychainServices = services;
    proof.sourcesProtected = [workspace, plugin];
  } finally {
    for (const path of sentinels) await rm(path);
    // Remove only directories created by this test, and only if still empty.
    for (const path of createdDirectories.reverse()) await rmdir(path);
  }
  console.log('Actual operator HOME/source denial proof:', JSON.stringify({ ...proof, sentinelsRemoved: true }));
}, 0);
