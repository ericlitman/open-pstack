import { resolve } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { type Lane, REGISTRY, resolveLane } from "./registry/index.ts";
import { runLane } from "./run.ts";
import { PARENTS, UsageError } from "./types.ts";

const HELP = `Usage: pstack-runner --parent <${Object.keys(PARENTS).join("|")}> --provider <${REGISTRY.adapters.map((adapter) => adapter.id).join("|")}> \\
  --model <slug> --effort <level> --mode <read-only|isolated-write> \\
  [--writer-sandbox <bounded|full-access>] \\
  --prompt <file> --cwd <dir> --output <file> --receipt <file> [--timeout <seconds>]

Runs exactly one external model lane. A Claude or Codex parent rejects its own
provider; use that parent's native subagent primitive. A Grok parent runs every
explicit Grok descriptor here. Output and receipt paths must not already exist.
There is no implicit timeout. Pass --timeout only when the user or task supplies
a real deadline; it is one end-to-end launcher deadline shared by setup,
preflight, and model execution. --writer-sandbox
defaults to bounded; full-access applies only to an isolated-write lane on a
provider that supports it, and only when the model sheet opts in.
`;

interface Io {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: Io = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new UsageError(`${name} is required`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseArgs(argv: readonly string[]): Lane | null {
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        parent: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        mode: { type: "string" },
        "writer-sandbox": { type: "string" },
        prompt: { type: "string" },
        cwd: { type: "string" },
        output: { type: "string" },
        receipt: { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (parsed.values.help) return null;
  const timeoutValue = stringValue(parsed.values.timeout);
  const timeoutSeconds = timeoutValue === undefined ? null : Number(timeoutValue);
  if (
    timeoutSeconds !== null &&
    (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
  ) {
    throw new UsageError("timeout must be a number greater than zero");
  }
  return resolveLane({
    parent: stringValue(parsed.values.parent) ?? "",
    provider: stringValue(parsed.values.provider) ?? "",
    model: stringValue(parsed.values.model) ?? "",
    effort: stringValue(parsed.values.effort) ?? "",
    mode: stringValue(parsed.values.mode) ?? "",
    writerSandbox: stringValue(parsed.values["writer-sandbox"]),
    promptPath: resolve(required("prompt", stringValue(parsed.values.prompt))),
    cwd: resolve(required("cwd", stringValue(parsed.values.cwd))),
    outputPath: resolve(required("output", stringValue(parsed.values.output))),
    receiptPath: resolve(required("receipt", stringValue(parsed.values.receipt))),
    timeoutMs: timeoutSeconds === null ? null : timeoutSeconds * 1_000,
  });
}

export async function main(
  argv: readonly string[],
  startedAt: number = Date.now(),
  io: Io = defaultIo
): Promise<number> {
  try {
    const lane = parseArgs(argv);
    if (lane === null) {
      io.stdout(HELP);
      return 0;
    }
    const result = await runLane(lane, startedAt);
    const rendered = `${JSON.stringify(result.receipt)}\n`;
    if (result.exitCode === 0) io.stdout(rendered);
    else io.stderr(rendered);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    io.stderr(HELP);
    return 64;
  }
}
