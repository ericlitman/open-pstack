# Setup and model configuration

## Sub-features

Installed setup invocation, harness-to-provider mapping, generated routing/model preferences, unavailable-provider handling, and changed configuration references.

## How to get to it (user POV)

Invoke `/pstack:setup-pstack` in the isolated Claude session, or `$setup-pstack` in the isolated Codex session. The installed instructions are the authority for the setup inputs.

## Driving it with verify-open-pstack

Use only the sandboxed run-owned fixture workspace and process `HOME`; both `CLAUDE_CONFIG_DIR` and `CODEX_HOME` must point into run-owned state. Literal `~/.claude` and `~/.codex` setup writes must resolve inside that fixture home, never the operator's daily home. Exercise each changed setup branch with explicit requested model/provider inputs. Retain the native invocation transcript and generated configuration file (redacted), then invoke a consuming installed skill and observe it use the configured route. Check that all paths written remain in run-owned state. Record requested versus observed provider/model and changed failure branches. Capture separate local CLI output only as supplemental evidence.

## Gotchas

Do not copy a daily configuration to make setup pass. Stop if required provider authentication is unavailable. Generated configuration by itself does not prove the consuming surface. The trusted parent requires explicit caam 0.1.22 account emails, validates vault identities, and copies only disposable Claude/Codex credential files into run-owned config roots. No candidate login or vault activation/writeback is allowed. Both sessions and provider children remain sandboxed against daily home/GitHub/SSH/provider files and Keychain/securityd, with no real Library/Keychain link. Retain sentinel-denial proof and observable native API requests; delete copied credentials in final cleanup while preserving redacted evidence.
