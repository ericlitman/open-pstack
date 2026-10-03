import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { requiredFeatures } from './core.ts';
import { command, interruption, isolatedEnv, redact, retainedFile, save, treeHash, type Command } from './io.ts';
import { doctor } from './doctor.ts';
import { copyCredentials, createSandbox, protectSources, registerSessionCredentials, removeCredentials, sandboxed, selectedAccounts, vaultRoot } from './isolation.ts';
import { sourceDigest, sourceHash } from './provenance.ts';
import { validateMacTests } from './verify.ts';
import { HARNESSES, REPO, type Accounts, type Driver, type Harness, type Installation, type Observation, type Receipt } from './types.ts';

export type Ask = (question: string) => Promise<string>;
export const ask: Ask = async question => {
  if (!process.stdin.isTTY) throw new Error('Operator review requires an interactive terminal');
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(question + '\n> ', { signal: interruption.signal })).trim(); } finally { reader.close(); }
};
export function launch(harness: Harness, home: string, workspace: string): string[] {
  return harness === 'claude'
    ? ['claude', '--plugin-dir', join(workspace, 'plugins/pstack'), '--settings', join(home, 'settings.json'), '--setting-sources', 'project']
    : ['codex'];
}
export async function codexInstallation(output: string, home: string, expected: string): Promise<string> {
  const result = JSON.parse(output);
  if (result.name !== 'pstack' || result.marketplaceName !== 'open-pstack' || typeof result.installedPath !== 'string') {
    throw new Error('Unrecognized Codex installation receipt; isolation cannot be established');
  }
  const path = await realpath(result.installedPath);
  if (!path.startsWith(await realpath(home) + '/')) throw new Error('Codex installation escaped isolated home');
  if (await treeHash(path, ['skills/poteto-mode/scripts/node_modules']) !== expected) throw new Error('Codex installed tree differs from pinned candidate');
  return path;
}
export function verifyCodexEnabled(output: string): void {
  const result = JSON.parse(output);
  const plugins = Array.isArray(result.installed) ? result.installed.filter((p: Record<string, unknown>) => p.name === 'pstack' && p.marketplaceName === 'open-pstack') : [];
  if (plugins.length !== 1 || plugins[0].installed !== true || plugins[0].enabled !== true) throw new Error('Isolated Codex plugin is not installed and enabled');
}
export async function verifyProjectDoctor(texts: string[], workspace: string): Promise<void> {
  const expected = await realpath(join(workspace, '.claude/skills/verify-open-pstack'));
  for (const text of texts) {
    try {
      const d = JSON.parse(text);
      if (d.result === 'pass' && d.candidate === true && typeof d.skill === 'string' && await realpath(d.skill) === expected) return;
    } catch { /* Other reviewed artifacts need not be doctor reports. */ }
  }
  throw new Error('Self-test requires the pinned project skill\'s passing child doctor.json');
}
export class MacDriver implements Driver {
  private copied: string[] = [];
  private profiles = new Map<string, string>();
  constructor(private run: Command = command, private review: Ask = ask, private accounts?: Accounts,
    private boundary: typeof createSandbox = createSandbox) {}
  async cleanup(): Promise<void> {
    try {
      for (const home of this.profiles.keys()) await registerSessionCredentials(home);
    } finally {
      await removeCredentials(this.copied, this.profiles, this.run);
    }
  }
  private candidate(home: string): Command {
    const profile = this.profiles.get(home);
    if (!profile) throw new Error('Candidate sandbox not established');
    return async (args, options = {}) => {
      try { return await this.run(sandboxed(profile, args), { ...options, env: isolatedEnv(home) }); }
      finally { await registerSessionCredentials(home); }
    };
  }
  async prepare(receipt: Receipt): Promise<Installation[]> {
    const root = receipt.artifactRoot;
    await doctor(root, this.run);
    if (!this.accounts) throw new Error('Explicit Claude and Codex caam accounts are required');
    // caam pre-run may migrate state. Enforce read-only access even in this
    // trusted metadata operation: listing must never activate or write a vault.
    const parentEnv: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'CAAM_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) if (process.env[key]) parentEnv[key] = process.env[key]!;
    const readOnly = '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "/dev"))';
    const accounts = selectedAccounts(await this.run(['/usr/bin/sandbox-exec', '-p', readOnly, 'caam', 'ls', '--json'], { env: parentEnv }), this.accounts);
    const vault = await realpath(vaultRoot());
    // Fetch the immutable reference outside candidate-readable/writable state.
    const referenceHome = join(root, 'source-home'), reference = join(referenceHome, 'workspace');
    await mkdir(join(referenceHome, 'tmp'), { recursive: true, mode: 0o700 });
    const trustedRun: Command = (args, options = {}) => this.run(args, { ...options, env: isolatedEnv(referenceHome) });
    await trustedRun(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, reference]);
    await trustedRun(['git', 'fetch', 'origin', receipt.sha], { cwd: reference });
    await trustedRun(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', receipt.sha], { cwd: reference });
    const pinnedSource = await sourceHash(reference, receipt.sha, trustedRun);
    if (process.platform !== 'darwin') throw new Error('Live proof requires the operator Mac');
    // Run trusted pinned tests before exposing disposable credentials to candidates.
    const proofOutput = await this.run(['/bin/sh', '-c', 'bun test --timeout 0 scripts/isolation.test.ts 2>&1; result=$?; printf "\\nPSTACK_MAC_TEST_EXIT=%s\\n" "$result"'], {
      cwd: join(reference, '.claude/skills/verify-open-pstack'),
      env: { ...parentEnv, PSTACK_OPERATOR_SENTINELS: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const proofPath = join(root, 'mac-isolation-proof.txt');
    await writeFile(proofPath, `Pinned SHA: ${receipt.sha}\n${redact(proofOutput)}`, { flag: 'wx', mode: 0o600 });
    const tests = await retainedFile(root, proofPath);
    validateMacTests(await readFile(proofPath, 'utf8'), receipt.sha);
    if (await this.review('Review mac-isolation-proof.txt: both Mac tests passed with no skips and no Keychain dialog appeared. Type PASS MAC ISOLATION to confirm:') !== 'PASS MAC ISOLATION') {
      throw new Error('Operator rejected Mac isolation proof');
    }
    receipt.macProof = { sha: receipt.sha, platform: 'darwin', reviewer: 'operator', tests, noKeychainDialog: true, authenticated: [] };
    const installs: Installation[] = [];
    for (const harness of HARNESSES) {
      const home = join(root, 'state', harness), workspace = join(home, 'workspace');
      await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
      for (const dir of ['.claude', '.codex', '.config/gh', '.cache']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 });
      await writeFile(join(home, 'settings.json'), '{}\n', { mode: 0o600 });
      const env = isolatedEnv(home, harness);
      this.profiles.set(home, await this.boundary(home, this.run, vault));
      const candidateRun = this.candidate(home);
      await candidateRun(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, workspace], { env });
      await candidateRun(['git', 'fetch', 'origin', receipt.sha], { cwd: workspace, env });
      await candidateRun(['git', 'checkout', '--detach', receipt.sha], { cwd: workspace, env });
      if ((await candidateRun(['git', 'rev-parse', 'HEAD'], { cwd: workspace, env })).trim() !== receipt.sha) throw new Error('Candidate checkout SHA mismatch');
      const candidate = join(workspace, 'plugins/pstack'), expected = await treeHash(candidate, ['skills/poteto-mode/scripts/node_modules']);
      if (await sourceDigest(workspace) !== pinnedSource) throw new Error('Candidate files differ from trusted pinned source');
      await copyCredentials(home, vault, accounts, this.copied);
      let location = candidate;
      if (harness === 'codex') {
        const added = await candidateRun(['codex', 'plugin', 'marketplace', 'add', workspace, '--json'], { env, cwd: home });
        await save(join(root, 'codex-marketplace.json'), JSON.parse(added));
        const installed = await candidateRun(['codex', 'plugin', 'add', 'pstack@open-pstack', '--json'], { env, cwd: home });
        await save(join(root, 'codex-install.json'), JSON.parse(installed));
        location = await codexInstallation(installed, home, expected);
        const listed = await candidateRun(['codex', 'plugin', 'list', '--marketplace', 'open-pstack', '--json'], { env, cwd: home });
        verifyCodexEnabled(listed);
        await save(join(root, 'codex-plugins.json'), JSON.parse(listed));
      }
      const manifest = JSON.parse(await readFile(join(location, harness === 'claude' ? '.claude-plugin/plugin.json' : '.codex-plugin/plugin.json'), 'utf8'));
      if (await sourceDigest(workspace) !== pinnedSource) throw new Error('Pinned source changed during installation');
      installs.push({ harness, sha: receipt.sha, home, location, treeHash: expected, sourceHash: pinnedSource, account: accounts[harness], pluginVersion: manifest.version,
        cliVersion: (await candidateRun([harness, '--version'], { env })).trim() });
    }
    return installs;
  }
  async exercise(receipt: Receipt): Promise<Observation[]> {
    const observations: Observation[] = [];
    const proof = receipt.macProof;
    if (!proof || proof.sha !== receipt.sha || proof.noKeychainDialog !== true) throw new Error('Required Mac isolation proof missing before native exercise');
    for (const installation of receipt.installations) {
      const { harness, home } = installation, workspace = join(home, 'workspace');
      if (await sourceDigest(workspace) !== installation.sourceHash) throw new Error('Pinned source changed before exercise');
      const profile = this.profiles.get(home);
      if (!profile) throw new Error('Candidate sandbox not established');
      this.profiles.set(home, await protectSources(profile, home, [workspace, installation.location], this.run));
      const env = isolatedEnv(home, harness), candidateRun = this.candidate(home);
      const request = { sha: receipt.sha, harness, workspace, features: requiredFeatures(receipt),
        featureMap: join(workspace, '.claude/skills/verify-open-pstack/features'),
        selfTest: requiredFeatures(receipt).includes('project-skill') ? 'Invoke the project skill natively; run doctor --candidate --output "$HOME/self-test" within sandboxed state. Do not invoke run, vault listing, login, or publication recursively.' : false,
        credentials: { claude: this.accounts?.claude, codex: this.accounts?.codex },
        isolation: 'Disposable file credentials only; no daily-home, Keychain, caam vault or publisher access. Exercise real requests; quota/auth failures fail closed.' };
      await save(join(receipt.artifactRoot, `${harness}-request.json`), request);
      console.log(JSON.stringify(request, null, 2));
      const raw = join(home, 'surface.raw');
      console.log('Exercise every requested feature from the native surface, using the maintained feature map. Exit when done.');
      await candidateRun(['/usr/bin/script', '-q', raw, ...launch(harness, home, workspace)], { cwd: workspace, env, interactive: true });
      if (await treeHash(installation.location, ['skills/poteto-mode/scripts/node_modules']) !== installation.treeHash) throw new Error('Installed tree changed during exercise');
      if (await sourceDigest(workspace) !== installation.sourceHash) throw new Error('Pinned project/plugin source changed during exercise');
      const transcript = await retainedFile(receipt.artifactRoot, await this.review(`Copy/redact ${raw} into output (outside state), review it, and enter the reviewed transcript path:`));
      const text = await readFile(join(receipt.artifactRoot, transcript.path), 'utf8');
      if (redact(text) !== text) throw new Error('Transcript contains recognizable credentials; redact before accepting');
      const authenticated = redact(await this.review(`${harness}: observed authenticated native API request and concrete response in this transcript (not a model self-report)?`));
      if (!authenticated.trim()) throw new Error('Authenticated native request assertion missing');
      if (await this.review(`Type PASS AUTH ${harness} only after reviewing that request and confirming no Keychain dialog appeared during this session:`) !== `PASS AUTH ${harness}`) {
        proof.noKeychainDialog = false;
        throw new Error(`Operator rejected ${harness} authentication/no-Keychain proof`);
      }
      proof.authenticated.push({ harness, observed: authenticated, transcript: transcript.path, transcriptHash: transcript.sha256 });
      for (const feature of requiredFeatures(receipt)) {
        const surface = await this.review(`${harness}/${feature}: native surface/discovery entry point?`);
        const action = await this.review('Concrete action exercised?');
        const observed = await this.review('Observed assertion/result (not the model\'s success claim)?');
        const artifacts = [];
        for (const path of (await this.review('Reviewed artifact paths inside output, one or more separated by commas?')).split(',')) {
          artifacts.push(await retainedFile(receipt.artifactRoot, path.trim()));
        }
        if (feature === 'project-skill') {
          const doctors = await Promise.all(artifacts.map(a => readFile(join(receipt.artifactRoot, a.path), 'utf8')));
          await verifyProjectDoctor(doctors, workspace);
        }
        if (await this.review(`Operator: type PASS ${feature} only after reviewing the native transcript and artifacts; anything else fails.`) !== `PASS ${feature}`) {
          throw new Error(`Operator rejected ${harness}/${feature}`);
        }
        observations.push({ harness, feature, surface: redact(surface), action: redact(action), observed: redact(observed),
          reviewer: 'operator', transcript: transcript.path, transcriptHash: transcript.sha256, artifacts });
      }
    }
    return observations;
  }
}
