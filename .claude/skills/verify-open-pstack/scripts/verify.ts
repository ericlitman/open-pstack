import { classify, completeEvidence, newReceipt } from './core.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redact, retainedFile, sha256 } from './io.ts';
import { REPO, type Driver, type GitHub, type Pull, type Receipt, type Registry } from './types.ts';

class HeadMoved extends Error {}
const safe = (text: string, limit = 160): string => redact(text).replace(/[`<>\r\n]/g, ' ').slice(0, limit);
export function evidence(receipt: Receipt): string {
  const lines = ['## Live evidence: Open Pstack', `Pinned PR #${receipt.pr}: \`${receipt.sha}\` (base \`${receipt.base}\`).`,
    `Result: ${receipt.failure ? `FAILED — ${safe(receipt.failure, 500)}` : receipt.selection.noRuntime ? 'no runtime change' : 'all mapped features passed'}.`,
    `Self-test: ${receipt.selfTest ? 'required in both harnesses' : 'not requested'}.`,
    `Retained receipt: \`${safe(receipt.artifactRoot, 500)}/receipt.json\`. Full observations and all transcript/artifact hashes are retained there. Local CLI checks are not installed-harness evidence.`,
    `Evidence-set SHA-256: \`${sha256(JSON.stringify({ installations: receipt.installations, observations: receipt.observations, macProof: receipt.macProof }))}\`.`];
  for (const install of receipt.installations) lines.push(`- ${install.harness}: CLI ${safe(install.cliVersion)}, plugin ${safe(install.pluginVersion)}, SHA \`${install.sha}\`, tree \`${install.treeHash}\`.`);
  let shown = 0;
  for (const record of receipt.observations) {
    const line = `- ${record.harness} / ${safe(record.feature, 72)}: ${safe(record.surface, 48)}; action: ${safe(record.action, 48)}; observed: ${safe(record.observed, 48)}; operator reviewed. Transcript SHA-256 \`${record.transcriptHash}\`; artifact-set SHA-256 \`${sha256(JSON.stringify(record.artifacts))}\`.`;
    if (lines.join('\n').length + line.length > 48000) break;
    lines.push(line); shown++;
  }
  if (shown < receipt.observations.length) lines.push(`${receipt.observations.length - shown} additional reviewed observations are in the retained receipt; see the evidence-set digest above.`);
  lines.push('Every new head requires a fresh run, including queue-created heads. This helper never queues or merges.');
  return lines.join('\n');
}
export function liveEvidenceBody(body: string, receipt: Receipt): string {
  const managed = /<!-- pstack-live-start -->[\s\S]*?<!-- pstack-live-end -->/;
  const marker = /(?:^|\n)Live evidence:[^\n]*\n?/;
  const match = marker.exec(body);
  const summary = `<!-- pstack-live-start -->\nLive evidence:\n\n${evidence(receipt)}\nEvidence comment: ${receipt.commentUrl}\n<!-- pstack-live-end -->`;
  if (managed.test(body)) body = body.replace(managed, () => summary);
  else if (match) {
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    // Only the template marker and its known placeholder belong to this helper.
    const remaining = body.slice(match.index + match[0].length).replace(/^\n*_pending_\n?(?=\n|$)/, '');
    body = body.slice(0, start) + summary + '\n' + remaining;
  } else body += '\n\n' + summary;
  for (const text of ['The exact candidate is installed in every affected harness.', 'The changed behavior passes from each real user surface.', 'The installed version, action, and observed result appear below.']) {
    body = body.replace(`- [ ] ${text}`, `- [x] ${text}${receipt.selection.noRuntime && !receipt.selfTest ? ' (No runtime change; harness exercise not required.)' : ''}`);
  }
  return body;
}
export const MAC_TESTS = [
  'real Mac sandbox denies daily-home and vault sentinels, writes, aliases, grandchildren, and Keychain IPC',
  'actual operator HOME denial and immutable exercise sources with writable dependency leaves',
] as const;
export function validateMacTests(text: string, sha: string): void {
  if (!text.startsWith(`Pinned SHA: ${sha}\n`) || !text.trimEnd().endsWith('PSTACK_MAC_TEST_EXIT=0') ||
      !/^\s*0 fail\s*$/m.test(text) || /^\s*[1-9]\d* skip\s*$/m.test(text) || /\((?:skip|fail)\)/.test(text) ||
      !MAC_TESTS.every(name => text.split('\n').some(line => line.startsWith(`(pass) ${name}`) && /^(?:\s+\[[^\]]+\])?\s*$/.test(line.slice(`(pass) ${name}`.length))))) {
    throw new Error('Both pinned Mac isolation tests must pass without skips or failures');
  }
}
export async function revalidateMacProof(receipt: Receipt): Promise<void> {
  if (receipt.selection.noRuntime && !receipt.selfTest) return;
  const proof = receipt.macProof;
  if (!proof || proof.sha !== receipt.sha || proof.platform !== 'darwin' || proof.reviewer !== 'operator' || proof.noKeychainDialog !== true) {
    throw new Error('Required exact-SHA operator-Mac proof or no-Keychain observation missing');
  }
  const tests = await retainedFile(receipt.artifactRoot, proof.tests.path);
  if (tests.path !== proof.tests.path || tests.sha256 !== proof.tests.sha256) throw new Error('Mac isolation proof changed after acceptance');
  validateMacTests(await readFile(join(receipt.artifactRoot, tests.path), 'utf8'), receipt.sha);
  if (proof.authenticated.length !== 2) throw new Error('Authenticated native requests required in both harnesses');
  for (const harness of ['claude', 'codex'] as const) {
    const requests = proof.authenticated.filter(record => record.harness === harness);
    if (requests.length !== 1 || !requests[0]!.observed.trim()) throw new Error('Authenticated native request assertion missing');
    const request = requests[0]!, transcript = await retainedFile(receipt.artifactRoot, request.transcript);
    if (transcript.path !== request.transcript || transcript.sha256 !== request.transcriptHash ||
        !receipt.observations.some(record => record.harness === harness && record.transcript === request.transcript && record.transcriptHash === request.transcriptHash)) {
      throw new Error('Authenticated request is not bound to the reviewed native transcript');
    }
  }
}
export async function revalidateEvidence(receipt: Receipt): Promise<void> {
  for (const record of receipt.observations) {
    const transcript = await retainedFile(receipt.artifactRoot, record.transcript);
    if (transcript.path !== record.transcript || transcript.sha256 !== record.transcriptHash) throw new Error('Reviewed transcript changed after acceptance');
    for (const artifact of record.artifacts) {
      const actual = await retainedFile(receipt.artifactRoot, artifact.path);
      if (actual.path !== artifact.path || actual.sha256 !== artifact.sha256) throw new Error('Reviewed artifact changed after acceptance');
    }
  }
  await revalidateMacProof(receipt);
}
export async function verify(options: { pr: number; selfTest: boolean; root: string; registry: Registry; github: GitHub; driver: Driver; persist: (receipt: Receipt) => Promise<void> }): Promise<Receipt> {
  const { github, driver, persist } = options;
  const initial = await github.pull(options.pr);
  if (initial.state !== 'open' || initial.headRepo !== REPO) throw new Error('Require an open same-repository PR');
  const receipt = newReceipt(options.pr, initial.head.sha, initial.base.sha, options.selfTest, options.root);
  let successAttempted = false, cleanupComplete = false;
  const cleanup = async (): Promise<void> => {
    if (cleanupComplete) return;
    await driver.cleanup?.(receipt);
    cleanupComplete = true;
    receipt.cleanup = 'Disposable candidate homes removed, including relocated credentials; external evidence retained';
  };
  const current = async (): Promise<Pull> => {
    const pull = await github.pull(receipt.pr);
    if (pull.head.sha !== receipt.sha || pull.base.sha !== receipt.base || pull.state !== 'open' || pull.headRepo !== REPO) throw new HeadMoved('PR head/base or open repository identity changed; run again');
    return pull;
  };
  const phase = async (next: Receipt['phase']): Promise<void> => { receipt.phase = next; await persist(receipt); await current(); };
  try {
    await phase('classify');
    receipt.selection = classify(await github.files(receipt.base, receipt.sha), options.registry);
    await current(); await persist(receipt);
    if (!receipt.selection.noRuntime || receipt.selfTest) {
      await phase('prepare'); receipt.installations = await driver.prepare(receipt); await current(); await persist(receipt);
      await phase('exercise'); receipt.observations = await driver.exercise(receipt); await current(); await persist(receipt);
    }
    await cleanup();
    completeEvidence(receipt);
    await phase('publish'); await revalidateEvidence(receipt);
    receipt.commentUrl = await github.comment(receipt.pr, evidence(receipt)); await persist(receipt);
    const pull = await current(); await revalidateEvidence(receipt);
    receipt.proposedTemplate = liveEvidenceBody(pull.body, receipt);
    await persist(receipt); await current(); await revalidateEvidence(receipt);
    successAttempted = true;
    await github.status(receipt.sha, 'success', receipt.commentUrl, receipt.selection.noRuntime ? 'no runtime change' : 'All mapped features passed in both harnesses');
    receipt.status = 'success'; await persist(receipt); await current(); await revalidateEvidence(receipt);
    if ((await current()).draft) {
      await phase('ready'); await revalidateEvidence(receipt);
      if ((await current()).draft) {
        await github.ready(receipt.pr); receipt.madeReady = true; await persist(receipt); await current(); await revalidateEvidence(receipt);
      }
    }
    await persist(receipt); return receipt;
  } catch (error) {
    receipt.failure = redact(error instanceof Error ? error.message : String(error));
    receipt.phase = error instanceof HeadMoved ? 'head-moved' : 'failed';
    receipt.compensation = [];
    const recover = async (label: string, operation: () => Promise<void>): Promise<void> => {
      try { await operation(); receipt.compensation!.push(`${label}: done`); }
      catch (failure) { receipt.compensation!.push(`${label}: FAILED ${redact(String(failure))}`); }
    };
    await recover('remove copied session credentials', async () => {
      try { await cleanup(); }
      catch (failure) {
        receipt.cleanup = `FAILED ${redact(String(failure))}`;
        receipt.failure += `; credential cleanup ${receipt.cleanup}`;
        throw failure;
      }
    });
    await recover('persist failure receipt', async () => { await persist(receipt); });
    // Withdraw an attempted success on its original SHA even if the current head has moved.
    if (successAttempted && receipt.commentUrl) await recover('withdraw success on pinned SHA', async () => {
      await github.status(receipt.sha, 'failure', receipt.commentUrl!, 'Verification aborted; rerun required'); receipt.status = 'failure';
    });
    if (!successAttempted) {
      await recover('publish failure evidence', async () => {
        await current();
        receipt.commentUrl = await github.comment(receipt.pr, evidence(receipt));
      });
      await recover('publish pinned failure', async () => {
        await github.status(receipt.sha, 'failure', receipt.commentUrl ?? `https://github.com/${REPO}/pull/${receipt.pr}`, 'Verification failed; see retained evidence'); receipt.status = 'failure';
      });
    }
    await recover('persist compensation receipt', async () => { await persist(receipt); });
    throw new Error(receipt.failure);
  }
}
