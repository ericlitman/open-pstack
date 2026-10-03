import { realpathSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { command, isolatedEnv, registerSecrets, type Command } from './io.ts';
import { HARNESSES, type Accounts } from './types.ts';

export function vaultRoot(): string {
  if (process.env.CAAM_HOME) return join(process.env.CAAM_HOME, 'data/vault');
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'caam/vault');
  if (!process.env.HOME || !isAbsolute(process.env.HOME)) throw new Error('Trusted parent requires an absolute operator HOME');
  return join(process.env.HOME, '.local/share/caam/vault');
}
export function selectedAccounts(text: string, accounts: Accounts): Accounts {
  const result = JSON.parse(text);
  if (!Array.isArray(result.profiles)) throw new Error('Unknown caam list schema; expected profiles');
  for (const tool of HARNESSES) {
    const name = accounts[tool];
    if (!/^[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(name) || name.length > 254) throw new Error(`Explicit safe ${tool} account email required`);
    const matching = result.profiles.filter((p: Record<string, unknown>) => p.tool === tool && p.name === name);
    if (matching.length !== 1 || matching[0].identity?.email !== name) throw new Error(`caam ${tool}/${name} identity mismatch or missing; inspect caam list --json (never activate or repair automatically)`);
  }
  return accounts;
}
export async function copyCredentials(home: string, vault: string, accounts: Accounts, copied: string[]): Promise<void> {
  const base = await realpath(vault);
  for (const tool of HARNESSES) {
    const file = tool === 'claude' ? '.credentials.json' : 'auth.json';
    const profile = join(base, tool, accounts[tool]), source = join(profile, file);
    for (const dir of [join(base, tool), profile]) {
      const info = await lstat(dir);
      if (!dir.startsWith(base + '/') || !info.isDirectory() || info.isSymbolicLink() || await realpath(dir) !== dir) throw new Error('Selected vault directories must be canonical, not symlinked');
    }
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(source) !== source) throw new Error('Vault credentials must be a contained regular file');
    const bytes = await readFile(source);
    const auth = JSON.parse(bytes.toString());
    if (tool === 'claude' ? typeof auth.claudeAiOauth?.accessToken !== 'string' : typeof auth.tokens?.access_token !== 'string') throw new Error(`${tool} vault requires file-backed OAuth credentials; unknown format blocks`);
    const tokens = tool === 'claude' ? auth.claudeAiOauth : auth.tokens;
    registerSecrets(Object.entries(tokens).flatMap(([key, value]) => /token/i.test(key) && typeof value === 'string' ? [value] : []));
    const dir = join(home, tool === 'claude' ? '.claude' : '.codex');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, file);
    copied.push(target);
    await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
  }
}
export async function registerSessionCredentials(home: string): Promise<void> {
  const root = await realpath(home).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (root === undefined) return;
  if (root !== home) throw new Error('Session credentials require canonical candidate state');
  for (const tool of HARNESSES) {
    const dir = join(home, tool === 'claude' ? '.claude' : '.codex');
    if (await realpath(dir) !== dir) throw new Error('Session credential directory redirected');
    const file = join(dir, tool === 'claude' ? '.credentials.json' : 'auth.json');
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Session credentials must be regular files');
    const auth = JSON.parse(await readFile(file, 'utf8'));
    const tokens = tool === 'claude' ? auth.claudeAiOauth : auth.tokens;
    if (!tokens || typeof tokens !== 'object') throw new Error('Unknown session OAuth credential format');
    registerSecrets(Object.entries(tokens).flatMap(([key, value]) => /token/i.test(key) && typeof value === 'string' ? [value] : []));
  }
}
export async function removeCredentials(paths: string[], profiles?: Map<string, string>, run: Command = command): Promise<void> {
  for (const home of new Set(paths.map(path => dirname(dirname(path))))) {
    await sourceDirectory(dirname(home));
    if (!isAbsolute(home) || resolve(home) !== home) throw new Error('Credential cleanup requires canonical candidate state');
    const info = await lstat(home).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) continue;
    if (profiles) {
      const profile = profiles.get(home);
      if (!profile) throw new Error('Credential cleanup requires the original candidate sandbox');
      // Remove all disposable state, including renamed or refreshed tokens.
      // Exercise-only write protection must not prevent contained cleanup.
      const cleanupProfile = profile.endsWith('.exercise.sb') ? profile.slice(0, -'.exercise.sb'.length) : profile;
      await run(sandboxed(cleanupProfile, ['/bin/rm', '-rf', '--', home]), { env: isolatedEnv(home), cwd: dirname(home), allowInterrupted: true });
    } else {
      // Trusted fixtures only; production deletion remains OS-contained.
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Credential cleanup refuses redirected candidate state');
      await rm(home, { recursive: true, force: true });
    }
  }
}
const quote = (value: string): string => JSON.stringify(value);
export function sandboxProfile(home: string, daily: string, executables: string[], deniedVaultRoot?: string, runtimes: string[] = []): string {
  if (!isAbsolute(home) || !isAbsolute(daily) || home === daily || home.startsWith(daily + '/')) throw new Error('Sandbox state must be outside the operator home');
  const vault = deniedVaultRoot === undefined ? undefined : realpathSync(deniedVaultRoot);
  if (vault) {
    const candidate = realpathSync(home);
    if (candidate === vault || candidate.startsWith(vault + '/') || vault.startsWith(candidate + '/')) throw new Error('Candidate state and caam vault must not overlap');
  }
  // File reads are allowlisted, not merely denied through HOME aliases. Mach
  // services are allowlisted too: no securityd, SecurityAgent, or Keychain IPC.
  return `(version 1)
(deny default)
(allow process-exec process-fork)
(allow pseudo-tty)
(allow file-ioctl (literal "/dev/ptmx") (regex #"^/dev/ttys"))
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (subpath ${quote(home)})
  (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin")
  (subpath "/opt/homebrew") (subpath "/Library/Apple") (subpath "/dev")
  (subpath "/private/etc") (subpath "/private/var/db/dyld")
  ${executables.map(path => `(literal ${quote(path)})`).join('\n  ')}
  ${runtimes.map(path => `(subpath ${quote(path)})`).join('\n  ')})
(allow file-write* (subpath ${quote(home)}) (subpath "/dev"))
(allow network-outbound (remote ip "*:*"))
(allow mach-lookup
  (global-name "com.apple.trustd") (global-name "com.apple.trustd.agent")
  (global-name "com.apple.mDNSResponder") (global-name "com.apple.system.notification_center")
  (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.bsd.dirhelper"))
(deny file-read* (require-not (require-any
  (subpath ${quote(home)})
  (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin")
  (subpath "/opt/homebrew") (subpath "/Library/Apple") (subpath "/dev")
  (subpath "/private/etc") (subpath "/private/var/db/dyld")
  ${executables.map(path => `(literal ${quote(path)})`).join('\n  ')}
  ${runtimes.map(path => `(subpath ${quote(path)})`).join('\n  ')})))
(deny file-read* file-write* (subpath ${quote(daily)}))
${vault ? `(deny file-read* file-write* (subpath ${quote(vault)}))` : ''}
(deny file-read* file-write* (subpath "/Library/Keychains") (subpath "/System/Library/Keychains"))
(deny file-write* (require-not (require-any (subpath ${quote(home)}) (subpath "/dev"))))
(deny mach-lookup (require-not (require-any
  (global-name "com.apple.trustd") (global-name "com.apple.trustd.agent")
  (global-name "com.apple.mDNSResponder") (global-name "com.apple.system.notification_center")
  (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.bsd.dirhelper"))))
(deny process-info* (require-not (target same-sandbox)))
(deny process-exec (literal "/usr/bin/security"))
(deny network-outbound (remote unix-socket (path-regex #".*")))
(allow network-outbound (remote unix-socket (path "/private/var/run/mDNSResponder")))
(deny network-outbound (remote ip "localhost:*"))
; Keep this rule last: Seatbelt's later read denials otherwise override root traversal.
(allow file-read* (literal "/"))
`;
}
export async function resolveAppleGit(path: string, run: Command = command): Promise<{ executable: string; runtime?: string }> {
  const actual = await realpath(path);
  if (actual !== '/usr/bin/git') return { executable: actual };
  const selected = (await run(['/usr/bin/xcrun', '--find', 'git'])).trim();
  if (!isAbsolute(selected) || basename(selected) !== 'git') throw new Error('Apple Git selection must be an absolute Git executable');
  const executable = await realpath(selected), runtime = dirname(dirname(executable));
  if (executable === actual || basename(dirname(executable)) !== 'bin' || basename(runtime) !== 'usr' || !(await stat(executable)).isFile()) throw new Error('Apple Git must resolve beyond its executable shim');
  return { executable, runtime };
}
export async function createSandbox(home: string, run: Command = command, deniedVaultRoot?: string): Promise<string> {
  const daily = await realpath(process.env.HOME!);
  const vault = deniedVaultRoot === undefined ? undefined : await realpath(deniedVaultRoot);
  const candidate = await realpath(home);
  // Validate boundaries before copying executables or writing the profile.
  sandboxProfile(candidate, daily, [], vault);
  const executables: string[] = [], runtimes: string[] = [];
  for (const name of ['claude', 'codex', 'bun', 'node', 'git']) {
    const path = Bun.which(name);
    if (!path && ['claude', 'codex', 'bun'].includes(name)) throw new Error(`Missing ${name}`);
    if (path) {
      const selected = name === 'git' ? await resolveAppleGit(path, run) : { executable: await realpath(path), runtime: undefined };
      const actual = selected.executable;
      if (selected.runtime) runtimes.push(selected.runtime);
      if (actual.startsWith(daily + '/') || path.startsWith(daily + '/')) {
        // Only standalone native binaries can be relocated without dependencies
        // on daily state. Never grant a home-directory read exception.
        const magic = (await readFile(actual)).subarray(0, 4).toString('hex');
        if (!['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca'].includes(magic)) throw new Error(`Install standalone ${name} outside daily HOME; cannot safely relocate a script package`);
        await mkdir(join(home, 'bin'), { recursive: true, mode: 0o700 });
        const target = join(home, 'bin', name);
        await copyFile(actual, target);
        await chmod(target, (await stat(actual)).mode & 0o777);
        executables.push(target);
      } else {
        executables.push(actual);
        if (selected.runtime) {
          await mkdir(join(home, 'bin'), { recursive: true, mode: 0o700 });
          await symlink(actual, join(home, 'bin/git'));
        }
      }
    }
  }
  // The policy stays outside candidate-writable state; later subprocesses must
  // not load a profile that the candidate can replace between invocations.
  const path = join(dirname(home), `${basename(home)}.sb`);
  await writeFile(path, sandboxProfile(candidate, daily, executables, vault, runtimes), { mode: 0o600, flag: 'wx' });
  await run(['/usr/bin/sandbox-exec', '-f', path, '/usr/bin/true'], { env: isolatedEnv(home), cwd: home });
  return path;
}
async function sourceDirectory(path: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Source paths must be canonical absolute directories');
  let current = path;
  for (;;) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Redirected source directory: ${current}`);
    if (dirname(current) === current) break;
    current = dirname(current);
  }
  if (await realpath(path) !== path) throw new Error(`Redirected source directory: ${path}`);
}
export async function protectSources(profile: string, home: string, sources: string[], run: Command = command): Promise<string> {
  await sourceDirectory(home);
  if (sources.length === 0) throw new Error('Exercise requires pinned source roots');
  await sourceDirectory(dirname(profile));
  if (!isAbsolute(profile) || resolve(profile) !== profile || profile === home || profile.startsWith(home + '/')) throw new Error('Exercise policy must be outside candidate state');
  const info = await lstat(profile);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Exercise policy must be a regular trusted file');
  const rules: string[] = [];
  for (const source of new Set(sources)) {
    await sourceDirectory(source);
    if (!source.startsWith(home + '/')) throw new Error('Sources must be contained in candidate state');
    const workspace = source === join(home, 'workspace');
    const dependencies = workspace
      ? [join(source, '.claude/skills/verify-open-pstack/node_modules'), join(source, 'plugins/pstack/skills/poteto-mode/scripts/node_modules')]
      : [join(source, 'skills/poteto-mode/scripts/node_modules')];
    for (const dependency of dependencies) {
      // Create the allowed leaves before freezing their parents; no redirected
      // source ancestor may be used to create or exempt a dependency directory.
      let ancestor = dirname(dependency);
      for (;;) {
        try { await lstat(ancestor); break; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          ancestor = dirname(ancestor);
        }
      }
      await sourceDirectory(ancestor);
      await mkdir(dependency, { recursive: true, mode: 0o700 });
      await sourceDirectory(dependency);
    }
    rules.push(`(deny file-write* (require-all (subpath ${quote(source)}) (require-not (require-any ${dependencies.map(path => `(subpath ${quote(path)})`).join(' ')}))))`);
    // Pin ancestors too: moving an installed-plugin parent must not relocate
    // protected files outside the path-based policy between hash checks.
    const pinned = new Set<string>();
    for (const path of [source, ...dependencies.map(dirname)]) {
      for (let current = path; current.startsWith(home + '/'); current = dirname(current)) pinned.add(current);
    }
    rules.push(`(deny file-write-unlink ${[...pinned].map(path => `(literal ${quote(path)})`).join(' ')})`);
  }
  const target = `${profile}.exercise.sb`;
  await writeFile(target, (await readFile(profile, 'utf8')) + '\n' + rules.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  await run(sandboxed(target, ['/usr/bin/true']), { env: isolatedEnv(home), cwd: home });
  return target;
}
export function sandboxed(profile: string, args: string[]): string[] {
  return ['/usr/bin/sandbox-exec', '-f', profile, ...args];
}
