import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCodexAuth, linkCodexAuth, linkMuseConfig, removeCodexHome, restoreSetup, snapshotSetup } from './isolation.ts';

const roots: string[] = [];
const environment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, GROK_HOME: process.env.GROK_HOME };
afterEach(async () => {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-isolation-')));
  roots.push(root);
  process.env.HOME = root;
  process.env.CODEX_HOME = join(root, 'daily-codex');
  process.env.CLAUDE_CONFIG_DIR = join(root, 'daily-claude');
  delete process.env.GROK_HOME;
  const home = join(root, 'run');
  for (const directory of [home, process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR]) await mkdir(directory, { mode: 0o700 });
  return { root, home, auth: join(process.env.CODEX_HOME, 'auth.json'), claude: process.env.CLAUDE_CONFIG_DIR };
}

describe('existing native login', () => {
  test('links opaque auth without parsing or copying it and removes only run-owned Codex state', async () => {
    const { home, auth } = await fixture();
    await writeFile(auth, 'opaque non-JSON authentication');
    await linkCodexAuth(home);
    const link = join(home, '.codex/auth.json');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(auth);
    await assertCodexAuth(home);
    await writeFile(join(home, '.codex/state.db'), 'candidate state');
    await writeFile(join(home, 'surface.raw'), 'private evidence');
    await removeCodexHome(home);
    expect(await Bun.file(link).exists()).toBe(false);
    expect(await readFile(auth, 'utf8')).toBe('opaque non-JSON authentication');
    expect(await readFile(join(home, 'surface.raw'), 'utf8')).toBe('private evidence');
  });

  test('defaults to the real HOME Codex login', async () => {
    const { root, home } = await fixture();
    delete process.env.CODEX_HOME;
    await mkdir(join(root, '.codex'));
    await writeFile(join(root, '.codex/auth.json'), 'opaque');
    await linkCodexAuth(home);
    expect(await readlink(join(home, '.codex/auth.json'))).toBe(join(root, '.codex/auth.json'));
  });

  test('missing or non-file source auth refuses keyring-only authentication', async () => {
    const { home, auth } = await fixture();
    await expect(linkCodexAuth(home)).rejects.toThrow('existing file-based authentication');
    await mkdir(auth);
    await expect(linkCodexAuth(home)).rejects.toThrow('keyring-only authentication');
  });

  test('replaced auth blocks cleanup/publication and preserves the operator source', async () => {
    const { home, auth } = await fixture();
    await writeFile(auth, 'operator login');
    await linkCodexAuth(home);
    const link = join(home, '.codex/auth.json');
    await rm(link); await writeFile(link, 'replacement');
    await expect(assertCodexAuth(home)).rejects.toThrow('stop and report before publication');
    await expect(removeCodexHome(home)).rejects.toThrow('Codex replaced or redirected auth.json');
    expect(await readFile(auth, 'utf8')).toBe('operator login');
    expect(await readFile(link, 'utf8')).toBe('replacement');
  });

  test('links existing operator Muse config files into run-owned XDG config without copying', async () => {
    const { root, home } = await fixture();
    process.env.XDG_CONFIG_HOME = join(root, 'daily-config');
    const settings = join(root, 'daily-config/muse/settings.json');
    await mkdir(join(root, 'daily-config/muse'), { recursive: true });
    await writeFile(settings, 'operator transport');
    await linkMuseConfig(home);
    const link = join(home, '.config/muse/settings.json');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(settings);
    expect(await Bun.file(join(home, '.config/muse/auth.json')).exists()).toBe(false);
  });

  test('redirected run-owned Codex directory is refused without touching the source', async () => {
    const { home, auth } = await fixture();
    await writeFile(auth, 'operator login');
    await symlink(process.env.CODEX_HOME!, join(home, '.codex'));
    await expect(linkCodexAuth(home)).rejects.toThrow('Codex state directory redirected');
    expect(await readFile(auth, 'utf8')).toBe('operator login');
  });
});

describe('setup-only snapshot and restoration', () => {
  test('restores both files byte-exact including binary bytes and restores absence', async () => {
    const { claude } = await fixture();
    const models = join(claude, 'pstack-models.md'), instructions = join(claude, 'CLAUDE.md');
    const original = Buffer.from([0, 255, 13, 10, 65]);
    await writeFile(models, original);
    const snapshot = await snapshotSetup();
    await writeFile(models, 'setup mutation'); await writeFile(instructions, 'new setup instructions');
    await restoreSetup(snapshot);
    expect(await readFile(models)).toEqual(original);
    expect(await Bun.file(instructions).exists()).toBe(false);
  });

  test('restores all default and custom setup targets, including absence', async () => {
    const { root, claude } = await fixture();
    const directories = [join(root, '.claude'), join(root, '.codex'), claude, process.env.CODEX_HOME!];
    const original = Buffer.from([0, 255, 13, 10, 65]);
    for (const directory of directories) {
      await mkdir(directory, { recursive: true });
      for (const name of ['pstack-models.md', 'CLAUDE.md']) await writeFile(join(directory, name), original);
    }
    await mkdir(join(root, '.grok/rules'), { recursive: true });
    const snapshot = await snapshotSetup();
    expect(snapshot).toHaveLength(13);
    for (const { path } of snapshot) await writeFile(path, 'setup mutation');
    await restoreSetup(snapshot);
    for (const directory of directories) {
      for (const name of ['pstack-models.md', 'CLAUDE.md']) expect(await readFile(join(directory, name))).toEqual(original);
      expect(await Bun.file(join(directory, 'AGENTS.md')).exists()).toBe(false);
    }
    expect(await Bun.file(join(root, '.grok/rules/pstack-models.md')).exists()).toBe(false);
    process.env.CLAUDE_CONFIG_DIR = directories[0]; process.env.CODEX_HOME = directories[1];
    expect(await snapshotSetup()).toHaveLength(7);
  });

  test('an empty GROK_HOME snapshots the default Grok sheet, as setup resolves it', async () => {
    const { root } = await fixture();
    process.env.GROK_HOME = '';
    const sheet = join(root, '.grok/rules/pstack-models.md');
    await mkdir(join(root, '.grok/rules'), { recursive: true });
    await writeFile(sheet, 'operator sheet');
    const snapshot = await snapshotSetup();
    expect(snapshot.map(entry => entry.path)).toContain(sheet);
    await writeFile(sheet, 'setup mutation');
    await restoreSetup(snapshot);
    expect(await readFile(sheet, 'utf8')).toBe('operator sheet');
  });

  test('restores the Grok sheet under GROK_HOME byte for byte', async () => {
    const { root } = await fixture();
    process.env.GROK_HOME = join(root, 'daily-grok');
    const sheet = join(root, 'daily-grok/rules/pstack-models.md'), original = Buffer.from('# pstack model configuration\r\n\x00');
    await mkdir(join(root, 'daily-grok/rules'), { recursive: true });
    await writeFile(sheet, original, { mode: 0o640 });
    const snapshot = await snapshotSetup();
    await writeFile(sheet, 'setup rewrite');
    await restoreSetup(snapshot);
    expect(await readFile(sheet)).toEqual(original);
    expect((await lstat(sheet)).mode & 0o777).toBe(0o640);
    expect(await Bun.file(join(root, '.grok/rules/pstack-models.md')).exists()).toBe(false);
  });

  test('defaults to HOME/.claude and restores deleted existing files', async () => {
    const { root } = await fixture();
    delete process.env.CLAUDE_CONFIG_DIR;
    const directory = join(root, '.claude'); await mkdir(directory);
    const path = join(directory, 'CLAUDE.md'); await writeFile(path, 'original\r\n');
    const snapshot = await snapshotSetup();
    await rm(path);
    await restoreSetup(snapshot);
    expect(await readFile(path, 'utf8')).toBe('original\r\n');
  });

  test('restores an operator-linked CLAUDE.md as the same link with its target bytes', async () => {
    const { root, claude } = await fixture();
    const path = join(claude, 'CLAUDE.md'), target = join(root, 'config-repo-CLAUDE.md');
    await writeFile(target, 'operator instructions\n');
    await symlink(target, path);
    const snapshot = await snapshotSetup();
    await writeFile(path, 'setup appended an import\n');
    await restoreSetup(snapshot);
    expect(await readlink(path)).toBe(target);
    expect(await readFile(target, 'utf8')).toBe('operator instructions\n');
    await rm(path); await writeFile(path, 'setup replaced the link');
    await restoreSetup(snapshot);
    expect(await readlink(path)).toBe(target);
  });

  test('fails restoration when an intermediate link in the chain was redirected', async () => {
    const { root, claude } = await fixture();
    const current = join(root, 'current'), other = join(root, 'other');
    await mkdir(join(root, 'v1')); await mkdir(other);
    await writeFile(join(root, 'v1/CLAUDE.md'), 'operator instructions\n'); await writeFile(join(other, 'CLAUDE.md'), 'redirected\n');
    await symlink(join(root, 'v1'), current);
    await symlink(join(current, 'CLAUDE.md'), join(claude, 'CLAUDE.md'));
    const snapshot = await snapshotSetup();
    await rm(current); await symlink(other, current);
    await expect(restoreSetup(snapshot)).rejects.toThrow('verification failed');
  });

  test('rejects links that appear during the run without following redirected files', async () => {
    const { root, claude } = await fixture();
    const path = join(claude, 'pstack-models.md'), external = join(root, 'external');
    await writeFile(external, 'untouched');
    await writeFile(path, 'original');
    const snapshot = await snapshotSetup();
    await rm(path); await symlink(external, path);
    await expect(restoreSetup(snapshot)).rejects.toThrow('regular file');
    expect(await readFile(external, 'utf8')).toBe('untouched');
  });

  test('non-file setup mutations fail restoration instead of publishing success', async () => {
    const { claude } = await fixture();
    const snapshot = await snapshotSetup();
    await mkdir(join(claude, 'CLAUDE.md'));
    await expect(restoreSetup(snapshot)).rejects.toThrow('regular file');
  });
});
