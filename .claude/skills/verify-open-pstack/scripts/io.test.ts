import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact, registerSecrets, retainedFile, save, treeHash } from './io.ts';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-io-')));
  roots.push(root);
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('retained JSON and file boundaries', () => {
  test('redacts string values before serialization without corrupting JSON punctuation or escapes', async () => {
    const root = await fixture(), path = join(root, 'receipt.json');
    await save(path, { path: '/tmp/Bearer token', nested: ['Bearer secret",}', 'github_pat_sensitive'], text: 'Bearer secret, next\nquoted "value"', count: 2 });
    const json = await readFile(path, 'utf8');
    expect(JSON.parse(json)).toEqual({ path: '/tmp/Bearer token', nested: ['[REDACTED]",}', '[REDACTED]'], text: '[REDACTED], next\nquoted "value"', count: 2 });
    expect(json).not.toContain('secret');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(redact('Bearer token, next')).toBe('[REDACTED], next');
  });

  test('registered opaque access, refresh, and ID tokens cannot survive text or structured evidence', async () => {
    const tokens = ['opaque-access.+/value', 'opaque-refresh:"quoted"', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signature'];
    registerSecrets(tokens);
    registerSecrets(['']);
    for (const token of tokens) {
      expect(redact(`prefix ${token} suffix ${token}`)).toBe('prefix [REDACTED] suffix [REDACTED]');
    }
    const root = await fixture(), path = join(root, 'receipt.json');
    await save(path, { text: tokens.join('\n'), nested: tokens, path: `/tmp/${tokens[0]}/live` });
    const json = await readFile(path, 'utf8');
    for (const token of tokens) expect(json).not.toContain(token);
    expect(JSON.parse(json)).toEqual({ text: tokens.map(() => '[REDACTED]').join('\n'), nested: tokens.map(() => '[REDACTED]'), path: '/tmp/[REDACTED]/live' });
  });

  test('canonical structural paths retain token-like components without exempting free text', async () => {
    const root = await fixture(), path = join(root, 'doctor.json'), canonical = '/tmp/sk-review/live';
    const evidence = { skill: `${canonical}/.claude/skills/verify-open-pstack`, workspace: canonical,
      home: canonical, location: canonical, artifactRoot: canonical, featureMap: canonical,
      transcript: `${canonical}/transcript.txt`, artifacts: [{ path: `${canonical}/artifact.txt` }],
      selection: { paths: ['sk-review/SKILL.md', 'github_pat_reference.md'] }, checks: { explanation: 'sk-private' } };
    await save(path, evidence);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ...evidence, checks: { explanation: '[REDACTED]' } });
  });

  test.each(['text', 'binary'])('rejects and removes retained %s artifacts containing copied credentials', async kind => {
    const root = await fixture(), path = join(root, 'artifact');
    const token = `known-copied-${kind}-opaque-credential`;
    registerSecrets([token]);
    await writeFile(path, kind === 'binary' ? Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from(token), Buffer.from([0, 254])]) : `reviewed result ${token}`);
    await expect(retainedFile(root, path)).rejects.toThrow('Evidence contains credentials');
    expect(await Bun.file(path).exists()).toBe(false);
    await writeFile(path, kind === 'binary' ? Buffer.from([0, 255, 128, 0, 254]) : 'reviewed sanitized result');
    expect((await retainedFile(root, path)).path).toBe('artifact');
  });

  test('permits evidence below an ancestor named state and canonicalizes output aliases', async () => {
    const root = await fixture(), output = join(root, 'state', 'run'), alias = join(root, 'alias');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'transcript.txt'), 'native surface evidence');
    await symlink(output, alias);
    expect(await retainedFile(output, 'transcript.txt')).toEqual(await retainedFile(alias, 'transcript.txt'));
    expect((await retainedFile(alias, 'transcript.txt')).path).toBe('transcript.txt');
  });

  test('rejects this run state and aliases into it, but not another directory named state', async () => {
    const root = await fixture();
    await mkdir(join(root, 'state'));
    await mkdir(join(root, 'artifacts', 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'secret.txt'), 'isolated authentication');
    await writeFile(join(root, 'artifacts', 'state', 'result.txt'), 'retained result');
    await symlink(join(root, 'state', 'secret.txt'), join(root, 'transcript.txt'));
    await expect(retainedFile(root, 'state')).rejects.toThrow('outside isolated state');
    await expect(retainedFile(root, 'state/secret.txt')).rejects.toThrow('outside isolated state');
    await expect(retainedFile(root, 'transcript.txt')).rejects.toThrow('outside isolated state');
    expect((await retainedFile(root, 'artifacts/state/result.txt')).path).toBe('artifacts/state/result.txt');
  });
});

describe('candidate tree digests', () => {
  test('dependency bootstrap is excluded only at explicitly supplied generated directories', async () => {
    const root = await fixture(), scripts = join(root, 'skills', 'poteto-mode', 'scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'bootstrap.ts'), 'export const candidate = 1;');
    const exclusions = ['skills/poteto-mode/scripts/node_modules'];
    const pinned = await treeHash(root, exclusions);
    const dependencies = join(scripts, 'node_modules');
    await mkdir(dependencies);
    await writeFile(join(dependencies, 'generated.js'), 'generated dependency');
    await symlink(join(dependencies, 'generated.js'), join(dependencies, 'package'));
    expect(await treeHash(root, exclusions)).toBe(pinned);
    await expect(treeHash(root)).rejects.toThrow('symlink refused');
    await writeFile(join(scripts, 'bootstrap.ts'), 'export const candidate = 2;');
    expect(await treeHash(root, exclusions)).not.toBe(pinned);
    await expect(treeHash(root, ['skills/poteto-mode/scripts'])).rejects.toThrow('Only explicit generated');
    await expect(treeHash(root, ['**/node_modules'])).rejects.toThrow('Only explicit generated');
  });

  test('source executable permissions affect the hash and non-excluded symlinks are rejected', async () => {
    const root = await fixture(), source = join(root, 'verify.sh');
    await writeFile(source, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const pinned = await treeHash(root);
    await chmod(source, 0o755);
    expect(await treeHash(root)).not.toBe(pinned);
    await symlink(source, join(root, 'alias.sh'));
    await expect(treeHash(root)).rejects.toThrow('symlink refused');
    const alias = join(await fixture(), 'tree');
    await symlink(root, alias);
    await expect(treeHash(alias)).rejects.toThrow('real directory');
  });
});

describe('coordinated process interruption', () => {
  test.each(['SIGINT', 'SIGTERM'] as const)('%s kills real process groups and permits only explicit cleanup commands', async signal => {
    const root = await fixture(), home = join(root, 'candidate'), credential = join(home, '.claude/.credentials.json');
    const vault = join(root, 'vault.json'), report = join(root, 'report.json'), heartbeat = join(root, 'heartbeat'), ready = join(root, 'ready.json');
    await mkdir(join(home, '.claude'), { recursive: true, mode: 0o700 });
    await writeFile(credential, 'disposable token', { mode: 0o600 });
    await writeFile(vault, 'original vault sentinel', { mode: 0o600 });
    const grandchild = join(root, 'grandchild.ts'), dummy = join(root, 'dummy.ts'), worker = join(root, 'worker.ts');
    await writeFile(grandchild, `let counter = 0; await Bun.write(${JSON.stringify(heartbeat)}, String(counter));\nsetInterval(() => Bun.write(${JSON.stringify(heartbeat)}, String(++counter)), 10);\n`);
    await writeFile(dummy, `const child = Bun.spawn([process.execPath, ${JSON.stringify(grandchild)}], { stdout: 'ignore', stderr: 'ignore' });\nwhile (!(await Bun.file(${JSON.stringify(heartbeat)}).exists())) await Bun.sleep(5);\nawait Bun.write(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, grandchild: child.pid }));\nsetInterval(() => {}, 1000);\n`);
    await writeFile(worker, `import { command, interruption, interruptCommands, save } from ${JSON.stringify(join(import.meta.dir, 'io.ts'))};
process.on('SIGINT', () => { void interruptCommands('SIGINT'); });
process.on('SIGTERM', () => { void interruptCommands('SIGTERM'); });
let failure = '', rejected = false;
try { await command([process.execPath, ${JSON.stringify(dummy)}]); }
catch (error) {
  failure = String(error);
  try { await command(['/bin/true']); } catch { rejected = true; }
} finally {
  await command(['/bin/rm', '-f', '--', ${JSON.stringify(credential)}], { allowInterrupted: true });
  await save(${JSON.stringify(report)}, { failure, rejected, aborted: interruption.signal.aborted });
  process.exitCode = 1;
}
`);
    const child = Bun.spawn([process.execPath, worker], { stdout: 'pipe', stderr: 'pipe' });
    const stderr = new Response(child.stderr).text(), stdout = new Response(child.stdout).text();
    try {
      for (let attempt = 0; attempt < 500 && !(await Bun.file(ready).exists()); attempt++) await Bun.sleep(5);
      expect(await Bun.file(ready).exists()).toBe(true);
      child.kill(signal);
      expect(await child.exited).toBe(1);
      expect(await stderr).toBe(''); expect(await stdout).toBe('');
      expect(JSON.parse(await readFile(report, 'utf8'))).toEqual({ failure: `Error: Interrupted by ${signal}`, rejected: true, aborted: true });
      await expect(stat(credential)).rejects.toThrow('ENOENT');
      expect(await readFile(vault, 'utf8')).toBe('original vault sentinel');
      const stopped = await readFile(heartbeat, 'utf8');
      await Bun.sleep(100);
      expect(await readFile(heartbeat, 'utf8')).toBe(stopped);
    } finally {
      child.kill('SIGKILL');
      if (await Bun.file(ready).exists()) {
        const { pid } = JSON.parse(await readFile(ready, 'utf8'));
        try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
      await child.exited;
    }
  }, 10000);
});
