import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, type Command } from './io.ts';
import { REPO, type ChangedFile, type GitHub, type Pull } from './types.ts';

export function parseChangedFiles(output: string): ChangedFile[] {
  if (output === '') return [];
  if (!output.endsWith('\0')) throw new Error('Truncated changed-file diff');
  const fields = output.slice(0, -1).split('\0'), files: ChangedFile[] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!/^(?:[AMDT]|[RC]\d{1,3})$/.test(status)) throw new Error('Invalid changed-file status');
    const previous = /^[RC]/.test(status) ? fields[i++] : undefined, filename = fields[i++];
    if (!filename || previous === '') throw new Error('Incomplete changed-file diff');
    files.push({ filename, ...(previous !== undefined ? { previous_filename: previous } : {}) });
  }
  if (new Set(files.map(f => f.filename)).size !== files.length) throw new Error('Duplicate changed-file diff');
  return files;
}
export class Publisher implements GitHub {
  constructor(private run: Command = command) {}
  private async api(path: string, args: string[] = [], allowInterrupted = false): Promise<unknown> {
    return JSON.parse(await this.run(['gh', 'api', `repos/${REPO}/${path}`, ...args], { allowInterrupted }));
  }
  async pull(pr: number): Promise<Pull> {
    const data = await this.api(`pulls/${pr}`) as { number: number; head: { sha: string; repo?: { full_name: string } }; base: { sha: string }; draft: boolean; state: string; body: string | null };
    if (data.number !== pr || typeof data.draft !== 'boolean' || typeof data.state !== 'string' || data.body !== null && typeof data.body !== 'string') throw new Error('Invalid PR response');
    return { number: pr, head: { sha: data.head.sha }, base: { sha: data.base.sha }, draft: data.draft, state: data.state, headRepo: data.head.repo?.full_name ?? '', body: data.body ?? '' };
  }
  async files(base: string, head: string): Promise<ChangedFile[]> {
    if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Invalid diff SHA');
    const repository = await mkdtemp(join(tmpdir(), 'open-pstack-diff-'));
    const env = { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' };
    try {
      await this.run(['git', 'init', '--bare', '--template=', repository], { env });
      await this.run(['git', 'fetch', '--no-tags', '--', `https://github.com/${REPO}.git`, base, head], { cwd: repository, env });
      for (const sha of [base, head]) {
        if ((await this.run(['git', 'rev-parse', '--verify', `${sha}^{commit}`], { cwd: repository, env })).trim() !== sha) throw new Error('Pinned diff commit unavailable');
      }
      const output = await this.run(['git', 'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'], { cwd: repository, env });
      return parseChangedFiles(output);
    } finally { await rm(repository, { recursive: true, force: true }); }
  }
  async comment(pr: number, body: string): Promise<string> {
    if (body.length > 60000) throw new Error('Evidence exceeds comment budget');
    const result = await this.api(`issues/${pr}/comments`, ['--method', 'POST', '-f', `body=${body}`]) as { html_url: string };
    if (typeof result.html_url !== 'string' || !result.html_url.startsWith(`https://github.com/${REPO}/issues/`) && !result.html_url.startsWith(`https://github.com/${REPO}/pull/`)) throw new Error('Missing same-repository evidence comment URL');
    return result.html_url;
  }
  async status(sha: string, state: 'success' | 'failure', target: string, description: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid status SHA');
    await this.api(`statuses/${sha}`, ['--method', 'POST', '-f', 'context=live-gate', '-f', `state=${state}`, '-f', `target_url=${target}`, '-f', `description=${description.slice(0, 140)}`], state === 'failure');
  }
  async ready(pr: number): Promise<void> { await this.run(['gh', 'pr', 'ready', String(pr), '--repo', REPO]); }
}
