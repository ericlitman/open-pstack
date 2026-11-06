import { copyFile, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CLAUDE_TOOLS, recipe, type Fixture } from '../features/recipes.ts';
import { requiredFeatures, requiredHarnesses } from './core.ts';
import { command, isolatedEnv, retainedFile, save, session, treeHash, type Command, type Session } from './io.ts';
import { doctor } from './doctor.ts';
import { assertCodexAuth, linkCodexAuth, linkMuseConfig, removeCodexHome, restoreSetup, snapshotSetup, type SetupSnapshot } from './isolation.ts';
import { sourceDigest, sourceHash } from './provenance.ts';
import { publishable } from './verify.ts';
import { REPO, type Driver, type Harness, type Installation, type Observation, type Receipt, type SessionRecord } from './types.ts';

const setupFeature = (feature: string): boolean => feature === 'setup' || feature === 'skill-invocation:setup-pstack';
export function launch(harness: Harness, workspace: string, options: { cwd: string; addDirs: string[]; codexSandbox?: 'danger-full-access'; claudePermission?: 'bypassPermissions' }): string[] {
  const addDirs = options.addDirs.flatMap(dir => ['--add-dir', dir]);
  return harness === 'claude'
    ? ['claude', '-p', '--input-format', 'stream-json', '--replay-user-messages', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--plugin-dir', join(workspace, 'plugins/pstack'), '--settings', '{"enabledPlugins":{"pstack@open-pstack":false}}',
      '--permission-mode', options.claudePermission ?? 'dontAsk', ...options.claudePermission ? ['--strict-mcp-config'] : [], ...addDirs, '--allowedTools', CLAUDE_TOOLS]
    : ['codex', 'exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '-c', 'approval_policy="never"',
      '--sandbox', options.codexSandbox ?? 'workspace-write', '--cd', options.cwd, ...addDirs, '-'];
}
/** Claude reads its prompt as one stream-json user message so the replayed message shows the slash expansion. */
export function sessionInput(harness: Harness, prompt: string): string {
  return harness === 'claude' ? JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n' : prompt;
}
type Event = Record<string, any>;
function resultText(blocks: Event[], id: string): string | undefined {
  const content = blocks.find(b => b.type === 'tool_result' && b.tool_use_id === id)?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: Event) => String(c.text ?? '')).join('') : undefined;
}
export function parseSession(harness: Harness, text: string, exitCode: number, started: number, rollout = ''): SessionRecord {
  if (exitCode !== 0) throw new Error(`exit:${exitCode}`);
  const stream: Event[] = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  if (harness === 'claude') {
    const blocks = stream.filter(e => e.type === 'assistant' || e.type === 'user').flatMap(e => Array.isArray(e.message?.content) ? e.message.content as Event[] : []);
    const failed = new Set(blocks.filter(b => b.type === 'tool_result' && b.is_error).map(b => b.tool_use_id));
    const uses = blocks.filter(b => b.type === 'tool_use' && !failed.has(b.id));
    const commands = stream.filter(e => e.type === 'user' && e.isReplay && typeof e.message?.content === 'string')
      .flatMap(e => [...(e.message.content as string).matchAll(/<command-name>\/([^<\s]+)<\/command-name>/g)].map(m => m[1]!));
    const context = stream.filter(e => e.type === 'system' && e.subtype === 'hook_response' && e.hook_event === 'SessionStart' &&
      e.exit_code === 0 && e.outcome === 'success' && typeof e.stdout === 'string').map(e => e.stdout as string);
    return { harness, exitCode, started, context,
      skills: [...commands, ...uses.filter(u => u.name === 'Skill' && typeof u.input?.skill === 'string').map(u => u.input.skill as string)],
      commands: uses.filter(u => u.name === 'Bash' && typeof u.input?.command === 'string').map(u => u.input.command as string),
      tools: stream.filter(e => e.type === 'assistant' && Array.isArray(e.message?.content)).flatMap(e => (e.message.content as Event[]).filter(b => b.type === 'tool_use')
        .map(b => ({ name: String(b.name), id: String(b.id), input: b.input ?? {}, parent: e.parent_tool_use_id ?? null, failed: failed.has(b.id), result: resultText(blocks, b.id) }))) };
  }
  const items = stream.filter(e => e.type === 'item.completed' && e.item && typeof e.item === 'object').map(e => e.item as Event);
  const commands = items.filter(i => i.type === 'command_execution' && i.exit_code === 0 && typeof i.command === 'string').map(i => i.command as string);
  // Codex's JSON stream omits skill resolution; its rollout records each injected skill's name and SKILL.md path.
  const messages = rollout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Event)
    .filter(e => e.type === 'response_item' && Array.isArray(e.payload?.content));
  const contents = (e: Event) => (e.payload.content as Event[]).map(c => String(c.text ?? ''));
  const texts = messages.flatMap(contents);
  // Codex adds SessionStart hook output to the model input as a developer message.
  const context = messages.filter(e => e.payload.role === 'developer').flatMap(contents);
  const skills = texts.flatMap(text => [...text.matchAll(/<skill>\n<name>([^<]+)<\/name>\n<path>([^<]+)<\/path>/g)])
    .map(([, name, path]) => path!.includes('/plugins/cache/open-pstack/pstack/') ? name! : path!);
  const tools = items.filter(i => i.type === 'command_execution' && typeof i.command === 'string').map(i => ({ name: 'command', id: String(i.id),
    input: { command: i.command as string }, result: typeof i.aggregated_output === 'string' ? i.aggregated_output : undefined, parent: null, failed: i.exit_code !== 0 }));
  return { harness, exitCode, started, skills, commands, tools, context };
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
export class MacDriver implements Driver {
  private codexHomes: string[] = [];
  private setup?: SetupSnapshot;
  private restorationFailed = false;
  constructor(private run: Command = command, private record: Session = session, private routes: string[] = []) {}
  async cleanup(): Promise<void> {
    if (this.setup) await restoreSetup(this.setup);
    if (this.restorationFailed) throw new Error('Setup restoration failed; publication forbidden');
    for (const home of this.codexHomes) await removeCodexHome(home);
    this.codexHomes = [];
  }
  private candidate(home: string): Command {
    return (args, options = {}) => this.run(args, { ...options, env: isolatedEnv(home) });
  }
  async preflight(receipt: Receipt): Promise<void> {
    await doctor(receipt.artifactRoot, this.run, process.platform, false, requiredHarnesses(receipt));
  }
  async prepare(receipt: Receipt): Promise<Installation[]> {
    const root = receipt.artifactRoot;
    const referenceHome = join(root, 'source-home'), reference = join(referenceHome, 'workspace');
    await mkdir(join(referenceHome, 'tmp'), { recursive: true, mode: 0o700 });
    const trustedRun: Command = (args, options = {}) => this.run(args, { ...options, env: isolatedEnv(referenceHome) });
    await trustedRun(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, reference]);
    await trustedRun(['git', 'fetch', 'origin', receipt.sha], { cwd: reference });
    await trustedRun(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', receipt.sha], { cwd: reference });
    const pinnedSource = await sourceHash(reference, receipt.sha, trustedRun);
    if (process.platform !== 'darwin') throw new Error('Live proof requires the operator Mac');
    const installs: Installation[] = [];
    for (const harness of requiredHarnesses(receipt)) {
      const home = join(root, 'state', harness), workspace = join(home, 'workspace');
      await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
      for (const dir of ['.codex', '.config/gh', '.cache']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 });
      const env = isolatedEnv(home, harness);
      const candidateRun = this.candidate(home);
      await candidateRun(['git', 'clone', '--no-checkout', '--', `https://github.com/${REPO}.git`, workspace], { env });
      await candidateRun(['git', 'fetch', 'origin', receipt.sha], { cwd: workspace, env });
      await candidateRun(['git', 'checkout', '--detach', receipt.sha], { cwd: workspace, env });
      if ((await candidateRun(['git', 'rev-parse', 'HEAD'], { cwd: workspace, env })).trim() !== receipt.sha) throw new Error('Candidate checkout SHA mismatch');
      const candidate = join(workspace, 'plugins/pstack'), expected = await treeHash(candidate, ['skills/poteto-mode/scripts/node_modules']);
      if (await sourceDigest(workspace) !== pinnedSource) throw new Error('Candidate files differ from trusted pinned source');
      let location = candidate;
      await linkCodexAuth(home);
      this.codexHomes.push(home);
      await linkMuseConfig(home);
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
      installs.push({ harness, sha: receipt.sha, home, location, treeHash: expected, sourceHash: pinnedSource, pluginVersion: manifest.version,
        cliVersion: (await candidateRun([harness, '--version'], { env })).trim() });
    }
    return installs;
  }
  private async rollout(codexHome: string, stream: string, copy: string): Promise<string> {
    const thread = JSON.parse(stream.split('\n')[0] || '{}').thread_id;
    if (typeof thread !== 'string') return '';
    const sessions = join(codexHome, 'sessions');
    const name = (await readdir(sessions, { recursive: true })).find(path => path.endsWith(`-${thread}.jsonl`));
    if (!name) return '';
    await copyFile(join(sessions, name), copy);
    return readFile(copy, 'utf8');
  }
  async exercise(receipt: Receipt): Promise<Observation[]> {
    const plans = receipt.installations.map(installation => ({ installation,
      features: requiredFeatures(receipt, installation.harness).sort((a, b) => Number(setupFeature(a)) - Number(setupFeature(b)))
        .map(feature => ({ feature, cases: recipe(feature, installation.harness, this.routes) })) }));
    const observations: Observation[] = [];
    for (const { installation, features } of plans) {
      const { harness, home } = installation, workspace = join(home, 'workspace');
      if (await sourceDigest(workspace) !== installation.sourceHash) throw new Error('Pinned source changed before exercise');
      const env = isolatedEnv(home, harness);
      for (const { feature, cases } of features) {
        const slug = feature.replace(/[^a-z0-9-]/g, '-'), dir = join(home, 'fixtures', slug), records = join(receipt.artifactRoot, 'sessions', harness, slug);
        for (const path of [dir, records]) await mkdir(path, { recursive: true, mode: 0o700 });
        const fixture: Fixture = { harness, dir, workspace, location: installation.location, run: this.candidate(home),
          configHome: harness === 'claude' ? env.CLAUDE_CONFIG_DIR ?? join(env.HOME!, '.claude') : env.CODEX_HOME! };
        const assertions: string[] = [], evidence: string[] = [];
        if (setupFeature(feature)) this.setup = await snapshotSetup();
        try {
          for (const c of cases) {
            await c.prepare?.(fixture);
            const stdout = join(records, `${c.id}.jsonl`), stderr = join(records, `${c.id}.stderr`), cwd = c.cwd === 'workspace' ? workspace : dir;
            const started = Date.now();
            const exitCode = await this.record(launch(harness, workspace, { cwd, addDirs: cwd === dir ? [] : [dir], codexSandbox: c.codexSandbox, claudePermission: c.claudePermission }),
              { cwd, env, input: sessionInput(harness, c.prompt(fixture)), stdout, stderr });
            evidence.push(stdout, ...(await stat(stderr)).size ? [stderr] : []);
            let record: SessionRecord, result;
            try {
              const text = await readFile(stdout, 'utf8');
              const rollout = harness === 'codex' ? await this.rollout(env.CODEX_HOME!, text, join(records, `${c.id}.rollout.jsonl`)) : '';
              if (rollout) evidence.push(join(records, `${c.id}.rollout.jsonl`));
              record = parseSession(harness, text, exitCode, started, rollout);
              result = await c.assert(record, fixture);
            } catch (error) { throw new Error(`${harness}/${feature}/${c.id}: ${error instanceof Error ? error.message : String(error)}`); }
            assertions.push(...['exit-0', ...result.assertions].map(id => `${c.id}:${id}`));
            for (const file of result.files) {
              const copy = join(records, `${c.id}.${basename(file)}`);
              await copyFile(file, copy); evidence.push(copy);
            }
          }
        } finally {
          if (this.setup) {
            try { await restoreSetup(this.setup); this.setup = undefined; }
            catch (error) { this.restorationFailed = true; throw error; }
          }
        }
        const [transcript, ...artifacts] = await Promise.all(evidence.map(path => retainedFile(receipt.artifactRoot, path)));
        const passed = `passed: ${assertions.join(' ')}`;
        observations.push({ harness, feature, reviewer: 'recipe', assertions,
          surface: harness === 'claude' ? 'claude -p stream-json with the candidate plugin-dir' : 'codex exec --json with the run-owned candidate installation',
          action: `recipe ${feature}: ${cases.map(c => c.id).join(', ')}`,
          observed: publishable(passed) ? passed : `passed ${assertions.length} assertions; ids retained privately`,
          transcript: transcript!.path, transcriptHash: transcript!.sha256, artifacts });
      }
      if (harness === 'codex') await assertCodexAuth(home);
      if (await treeHash(installation.location, ['skills/poteto-mode/scripts/node_modules']) !== installation.treeHash) throw new Error('Installed tree changed during exercise');
      if (await sourceDigest(workspace) !== installation.sourceHash) throw new Error('Pinned project/plugin source changed during exercise');
    }
    return observations;
  }
}
