import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { command, isolatedEnv, save, type Command } from './io.ts';
import { linkCodexAuth, removeCodexHome } from './isolation.ts';
import { HARNESSES, type Harness } from './types.ts';

export class LoginRequired extends Error {}
const CLAUDE_FIX = 'run `claude auth login` from a shell on this Mac, not over SSH', CODEX_FIX = 'run `codex login` on this Mac', GROK_FIX = 'run `grok login` on this Mac';

export async function t3Binary(): Promise<string> {
  const runtime = join(process.env.HOME ?? '', '.t3/runtime');
  const { activeVersion } = JSON.parse(await readFile(join(runtime, 'service-state.json'), 'utf8'));
  if (typeof activeVersion !== 'string' || !/^\d[\w.-]*$/.test(activeVersion)) throw new Error('T3 service state names no active version');
  return join(runtime, 'versions', activeVersion, 't3');
}

export async function doctor(root: string, run: Command = command, platform = process.platform, candidate = false, harnesses: readonly Harness[] = HARNESSES): Promise<void> {
  const report: Record<string, unknown> = { platform, candidate, date: new Date().toISOString(), skill: await realpath(join(import.meta.dir, '..')), checks: {} };
  const checks = report.checks as Record<string, string>;
  try {
    if (platform !== 'darwin') throw new Error('Live gate requires an operator Mac (Darwin)');
    const home = join(root, 'probe-home');
    for (const dir of ['tmp', '.codex', '.config/gh', '.cache']) await mkdir(join(home, dir), { recursive: true, mode: 0o700 });
    const env = isolatedEnv(home);
    for (const binary of candidate ? ['bun', 'git', 'claude', 'codex'] : ['bun', 'git', 'claude', 'codex', 'gh']) checks[binary] = (await run([binary, '--version'], { env })).trim();
    if (harnesses.includes('t3')) checks.t3 = (await run([await t3Binary(), '--version'], { env })).trim();
    if (harnesses.includes('grok')) {
      checks.grok = (await run(['grok', '--version'], { env })).trim();
      const help = await run(['grok', 'agent', '--help'], { env });
      for (const flag of ['--plugin-dir', '--no-leader', '--model', '--reasoning-effort']) if (!help.includes(flag)) throw new Error(`Grok agent missing ${flag}`);
      checks['grok agent --help'] = help;
    }
    const claude = await run(['claude', '--help'], { env });
    for (const flag of ['--plugin-dir', '--settings']) if (!claude.includes(flag)) throw new Error(`Claude isolation missing ${flag}`);
    checks.claudeHelp = claude;
    for (const args of [['codex', 'plugin', 'marketplace', 'add', '--help'], ['codex', 'plugin', 'add', '--help']]) {
      const help = await run(args, { env });
      if (!help.includes('--json')) throw new Error('Codex local plugin installation interface unavailable');
      if (args.includes('marketplace') && !/local path|local or Git|local marketplace/i.test(help)) throw new Error('Codex local marketplace interface unavailable');
      checks[args.join(' ')] = help;
    }
    if (!candidate && (harnesses.includes('claude') || harnesses.includes('t3'))) {
      let loggedIn: unknown;
      try { loggedIn = JSON.parse(await run(['claude', 'auth', 'status'], { env })).loggedIn; } catch {}
      if (loggedIn !== true) throw new LoginRequired(`Claude login check failed: \`claude auth status\` did not report "loggedIn": true; ${CLAUDE_FIX}`);
      checks['claude login'] = 'logged in';
    }
    if (!candidate && harnesses.includes('grok')) {
      let models = '';
      try { models = await run(['grok', 'models'], { env }); } catch {}
      if (!/^You are logged in\b/m.test(models)) throw new LoginRequired(`Grok login check failed: \`grok models\` did not report a login; ${GROK_FIX}`);
      checks['grok login'] = 'logged in';
    }
    if (!candidate && harnesses.includes('codex')) {
      let linked = false;
      try { await linkCodexAuth(home); linked = true; await run(['codex', 'login', 'status'], { env }); checks['codex login'] = 'logged in'; }
      catch { throw new LoginRequired(`Codex login check failed (file-based auth.json and \`codex login status\` required); ${CODEX_FIX}`); }
      finally { if (linked) await removeCodexHome(home); }
    }
    report.result = 'pass';
  } catch (error) {
    report.result = 'blocked'; report.reason = String(error);
    throw error;
  } finally { await save(join(root, 'doctor.json'), report); }
}
