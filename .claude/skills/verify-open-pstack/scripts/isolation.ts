import { lstat, mkdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

function codexAuth(): string {
  return resolve(process.env.CODEX_HOME ?? join(process.env.HOME!, '.codex'), 'auth.json');
}

async function codexDirectory(home: string): Promise<string> {
  if (!isAbsolute(home) || await realpath(home) !== home) throw new Error('Codex state must be a canonical run-owned directory');
  const directory = join(home, '.codex');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Codex state directory redirected');
  return directory;
}

export async function linkCodexAuth(home: string): Promise<void> {
  const source = codexAuth();
  const info = await stat(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!info?.isFile()) throw new Error('Codex verification requires existing file-based authentication (auth.json); keyring-only authentication is not supported');
  await mkdir(join(home, '.codex'), { recursive: true, mode: 0o700 });
  await symlink(source, join(await codexDirectory(home), 'auth.json'));
}

export async function linkMuseConfig(home: string): Promise<void> {
  const source = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME!, '.config'), 'muse');
  const target = join(home, '.config/muse');
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const name of ['settings.json', 'auth.json']) {
    if (await stat(join(source, name)).catch(() => undefined)) await symlink(join(source, name), join(target, name));
  }
}

export async function assertCodexAuth(home: string): Promise<void> {
  const path = join(await codexDirectory(home), 'auth.json');
  const info = await lstat(path);
  if (!info.isSymbolicLink() || await readlink(path) !== codexAuth()) {
    throw new Error('Codex replaced or redirected auth.json instead of writing through its symlink; stop and report before publication');
  }
}

export async function removeCodexHome(home: string): Promise<void> {
  await assertCodexAuth(home);
  await rm(await codexDirectory(home), { recursive: true });
}

export type SetupSnapshot = { path: string; bytes?: Buffer; mode?: number; link?: string; target?: string }[];

async function setupFile(path: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`Setup restoration requires a regular file: ${path}`);
  return info;
}

export async function snapshotSetup(): Promise<SetupSnapshot> {
  const directories = new Set([join(process.env.HOME!, '.claude'), join(process.env.HOME!, '.codex'),
    process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((directory): directory is string => !!directory).map(directory => resolve(directory)));
  const snapshot: SetupSnapshot = [];
  for (const directory of directories) {
    for (const name of ['pstack-models.md', 'CLAUDE.md', 'AGENTS.md']) {
      const path = join(directory, name);
      const link = (await lstat(path).catch(() => undefined))?.isSymbolicLink() ? await readlink(path) : undefined;
      const target = link === undefined ? path : await realpath(path);
      if (link !== undefined) snapshot.push({ path, link, target });
      const info = await setupFile(target);
      snapshot.push(info ? { path: target, bytes: await readFile(target), mode: info.mode & 0o777 } : { path: target });
    }
  }
  return snapshot;
}

export async function restoreSetup(snapshot: SetupSnapshot): Promise<void> {
  for (const { path, link } of snapshot) {
    if (link === undefined) continue;
    if (!(await lstat(path).catch(() => undefined))?.isSymbolicLink() || await readlink(path) !== link) {
      await rm(path, { force: true, recursive: true });
      await symlink(link, path);
    }
  }
  for (const { path, bytes, mode, link } of snapshot) {
    if (link !== undefined) continue;
    await setupFile(path);
    if (bytes === undefined) await rm(path, { force: true });
    else await writeFile(path, bytes, { mode });
  }
  for (const { path, bytes, link, target } of snapshot) {
    if (link !== undefined) {
      if (await readlink(path).catch(() => undefined) !== link || await realpath(path).catch(() => undefined) !== target) throw new Error(`Setup restoration verification failed: ${path}`);
      continue;
    }
    const info = await setupFile(path);
    if (bytes === undefined ? info !== undefined : !info || !(await readFile(path)).equals(bytes)) {
      throw new Error(`Setup restoration verification failed: ${path}`);
    }
  }
}
