# Gateway model probe evidence

Tracking: [issue #5](https://github.com/thisguymartin/pstack-flex/issues/5).

## Candidate and scope

- Source candidate: branch `flex/multiple-gateway-models`, based on `92dc0bc`, with uncommitted implementation changes.
- Implementation diff SHA-256 before this evidence file: `84b4c3ee7fc66902532e1d457048a487e6a63629b31d2d214e52585f72863c75`.
- Packaged version: 1.4.1. This candidate has not been installed as a plugin.
- Actual parent: Codex session, invoking the candidate's external runner with `--parent codex`.
- CLI: Claude Code 2.1.283.
- Each probe used `--effort high`, read-only mode, a separate empty synthetic workspace and isolated Claude configuration, and a synthetic text file. No repository or customer data was used in the prompt.
- Keys were supplied through hidden terminal input, injected into child environments, and were not included in commands, this repository, or evidence below.

## Observed results

Each probe exited 0, returned the exact requested marker, recorded `modelVerified: true` with `modelEvidence: provider-report`, and retained `costUsd: null`.

| Requested model | Reported model | Elapsed milliseconds | Receipt status |
| --- | --- | --- | --- |
| `deepseek-flash` | `deepseek-flash` | 2684 | `complete` |
| `deepseek-v4-pro` | `deepseek-v4-pro` | 7737 | `complete` |
| `MiniMax-M3` | `MiniMax-M3` | 11416 | `complete` |
| `MiniMax-M3.1-Flash-Preview` | `MiniMax-M3.1-Flash-Preview` | 5090 | `complete` |

These single short probes establish authentication, model selection, and successful completion through the runner. They do not rank coding quality or speed, prove hidden reasoning depth, or verify CLI request-body effort forwarding. The prompt included the expected marker, so completion does not independently prove a file tool was used.

## Remaining release gate

Install the exact candidate and run setup from both real Claude Code and Codex user surfaces. Verify independent model effort choices, per-model probes, mixed-provider panels, saved-sheet readback, and unchanged configuration on failed access. Record installed version, surface, action, and observed result before merge or rollout. Changing only the runner's `--parent` flag would not satisfy this gate.
