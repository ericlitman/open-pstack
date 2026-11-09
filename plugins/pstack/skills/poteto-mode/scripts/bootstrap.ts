import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

if (typeof Bun === "undefined") {
  console.error(
    "pstack poteto-mode tooling requires Bun (https://bun.sh). Install Bun, then re-run."
  );
  process.exit(1);
}

const scriptsDirectory = import.meta.dir;

function dependencyCacheRoot(): string {
  const cacheHome =
    process.env.XDG_CACHE_HOME ||
    (process.platform === "win32"
      ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
      : join(homedir(), ".cache"));
  return resolve(cacheHome, "open-pstack", "poteto-mode-tools");
}

function hasCommander(directory: string): boolean {
  try {
    const entry = Bun.resolveSync("commander", directory);
    const commanderDirectory = realpathSync(
      join(directory, "node_modules", "commander")
    );
    return realpathSync(entry).startsWith(commanderDirectory + sep);
  } catch {
    return false;
  }
}

function installDependencies(
  cacheDirectory: string,
  packageJson: Buffer,
  lockfile: Buffer
): void {
  const cacheRoot = dirname(cacheDirectory);
  mkdirSync(cacheRoot, { recursive: true });
  const stagingDirectory = mkdtempSync(join(cacheRoot, ".staging-"));
  try {
    writeFileSync(join(stagingDirectory, "package.json"), packageJson);
    writeFileSync(join(stagingDirectory, "bun.lock"), lockfile);
    const result = Bun.spawnSync(
      [process.execPath, "install", "--frozen-lockfile"],
      { cwd: stagingDirectory }
    );
    if (result.exitCode !== 0) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error(
        `bun install --frozen-lockfile exited with status ${result.exitCode}`
      );
    }
    if (!hasCommander(stagingDirectory)) {
      throw new Error(
        "bun install --frozen-lockfile completed without installing commander"
      );
    }

    try {
      renameSync(stagingDirectory, cacheDirectory);
    } catch (error) {
      if (!existsSync(cacheDirectory)) throw error;
    }
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

export function ensureDependenciesInstalled(): void {
  const packageJson = readFileSync(join(scriptsDirectory, "package.json"));
  const lockfile = readFileSync(join(scriptsDirectory, "bun.lock"));
  const installKey = createHash("sha256")
    .update(packageJson)
    .update("\0")
    .update(lockfile)
    .digest("hex");
  const cacheDirectory = join(dependencyCacheRoot(), installKey);
  if (!existsSync(cacheDirectory)) {
    installDependencies(cacheDirectory, packageJson, lockfile);
  }
  if (!hasCommander(cacheDirectory)) {
    throw new Error(
      `Incomplete poteto-mode dependency cache at ${cacheDirectory}. Remove that cache directory and re-run.`
    );
  }

  const load = createRequire(join(cacheDirectory, "package.json"));
  const commander = load("commander");
  Bun.plugin({
    name: "pstack-commander",
    setup(builder) {
      builder.module("commander", () => ({
        loader: "object",
        exports: commander,
      }));
    },
  });
}
