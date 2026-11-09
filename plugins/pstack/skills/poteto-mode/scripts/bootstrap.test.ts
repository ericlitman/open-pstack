import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";

const nodeEntryPoints = [
  ["bootstrap", "bootstrap.ts"],
  ["watch-pr", "watch-pr/watch-pr"],
] as const;
const bunPackageCache = Bun.spawnSync([process.execPath, "pm", "cache"], {
  cwd: import.meta.dir,
})
  .stdout.toString().trim();

describe("Bun runtime guard", () => {
  for (const [name, path] of nodeEntryPoints) {
    it(`rejects Node before ${name} uses Bun-only APIs`, () => {
      const result = Bun.spawnSync(["node", join(import.meta.dir, path)]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toBe(
        "pstack poteto-mode tooling requires Bun (https://bun.sh). Install Bun, then re-run.\n"
      );
    });
  }
});

describe("dependency bootstrap", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "pstack-bootstrap-"));
    directories.push(directory);
    const pluginDirectory = join(directory, "plugins", "pstack");
    const scriptsDirectory = join(pluginDirectory, "skills", "poteto-mode", "scripts");
    const configPath = join(directory, "bunfig.toml");
    writeFileSync(configPath, "");
    cpSync(import.meta.dir, scriptsDirectory, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules",
    });
    const environment: Record<string, string | undefined> = {
      ...process.env,
      HOME: join(directory, "home"),
      USERPROFILE: join(directory, "home"),
      LOCALAPPDATA: join(directory, "local"),
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_CACHE_HOME: join(directory, "cache"),
      BUN_INSTALL: join(directory, "bun"),
      BUN_INSTALL_CACHE_DIR: bunPackageCache,
    };
    delete environment.NODE_PATH;
    delete environment.NODE_OPTIONS;
    delete environment.BUN_OPTIONS;

    function command(args = ["--help"], entry = join("watch-pr", "watch-pr")) {
      return [
        process.execPath,
        "--no-env-file",
        `--config=${configPath}`,
        "--no-install",
        join(scriptsDirectory, entry),
        ...args,
      ];
    }

    return {
      directory,
      pluginDirectory,
      scriptsDirectory,
      configPath,
      environment,
      command,
      cacheRoot: join(directory, "cache", "open-pstack", "poteto-mode-tools"),
      run(args = ["--help"], entry = join("watch-pr", "watch-pr"), input = "") {
        const result = Bun.spawnSync(command(args, entry), {
          cwd: directory,
          env: environment,
          stdin: Buffer.from(input),
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      },
    };
  }

  const helpResult = {
    exitCode: 0,
    stdout: expect.stringContaining("Usage: watch-pr [options]"),
    stderr: "",
  };

  it("runs copied watch-pr without installing dependencies inside the plugin", () => {
    const test = fixture();
    const initialEntries = readdirSync(test.pluginDirectory, { recursive: true }).sort();

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(test.run()).toEqual(helpResult);
    }

    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
    expect(readdirSync(test.pluginDirectory, { recursive: true }).sort()).toEqual(initialEntries);
  }, 60_000);

  it("publishes one complete cache for concurrent cold starts", async () => {
    const test = fixture();
    const children = Array.from({ length: 4 }, () => Bun.spawn(test.command(), {
      cwd: test.directory,
      env: test.environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }));
    const results = await Promise.all(children.map(async (child) => {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    }));

    for (const result of results) expect(result).toEqual(helpResult);
    expect(readdirSync(test.cacheRoot)).toHaveLength(1);
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
    expect(test.run()).toEqual(helpResult);
  }, 60_000);

  it("loads the cached dependency instead of an incompatible ancestor package", () => {
    const test = fixture();
    const ancestor = join(test.directory, "node_modules", "commander");
    mkdirSync(ancestor, { recursive: true });
    writeFileSync(join(ancestor, "package.json"), '{"name":"commander","version":"0.0.0","main":"index.js"}');
    writeFileSync(join(ancestor, "index.js"), 'throw new Error("wrong commander");\n');

    expect(test.run()).toEqual(helpResult);
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
  }, 60_000);

  it("accepts a cache path containing the platform path-list delimiter", () => {
    const test = fixture();
    test.environment.XDG_CACHE_HOME = join(test.directory, `cache${delimiter}path`);

    expect(test.run()).toEqual(helpResult);
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
  }, 60_000);

  it("uses fresh caches when either the manifest or frozen lockfile changes", () => {
    const test = fixture();
    expect(test.run()).toEqual(helpResult);
    const originalCache = join(test.cacheRoot, readdirSync(test.cacheRoot)[0]!);
    const manifestPath = join(test.scriptsDirectory, "package.json");
    const lockfilePath = join(test.scriptsDirectory, "bun.lock");
    const originalManifest = readFileSync(manifestPath, "utf8");
    const originalLockfile = readFileSync(lockfilePath, "utf8");

    writeFileSync(manifestPath, `${originalManifest}\n`);
    expect(test.run()).toEqual(helpResult);
    expect(readdirSync(test.cacheRoot)).toHaveLength(2);

    writeFileSync(lockfilePath, `${originalLockfile}\n`);
    expect(test.run()).toEqual(helpResult);
    expect(readdirSync(test.cacheRoot)).toHaveLength(3);
    expect(readFileSync(join(originalCache, "package.json"), "utf8")).toBe(originalManifest);
    expect(readFileSync(join(originalCache, "bun.lock"), "utf8")).toBe(originalLockfile);
  }, 60_000);

  it("preserves arguments, runtime flags, cwd, streams, status, and existing NODE_PATH", () => {
    const test = fixture();
    const externalPaths = [join(test.directory, "first modules"), join(test.directory, "second modules")];
    const externalPackage = join(externalPaths[1]!, "bootstrap-external-probe");
    mkdirSync(externalPackage, { recursive: true });
    writeFileSync(join(externalPackage, "package.json"), JSON.stringify({
      type: "module",
      exports: "./index.js",
    }));
    writeFileSync(join(externalPackage, "index.js"), 'export default "external dependency";\n');
    test.environment.NODE_PATH = externalPaths.join(delimiter);
    writeFileSync(join(test.scriptsDirectory, "probe.ts"), `
import { ensureDependenciesInstalled } from "./bootstrap.ts";
ensureDependenciesInstalled();
const { Command } = await import("commander");
console.log(JSON.stringify({
  name: new Command("probe").name(),
  args: process.argv.slice(2),
  execArgv: process.execArgv,
  cwd: process.cwd(),
  input: await Bun.stdin.text(),
  nodePath: process.env.NODE_PATH,
  external: (await import("bootstrap-external-probe")).default,
}));
console.error("probe stderr");
process.exit(23);
`);

    const result = test.run(["--value", "two words", "-"], "probe.ts", "stdin payload\n");
    expect(result.exitCode).toBe(23);
    expect(result.stderr).toBe("probe stderr\n");
    const observed = JSON.parse(result.stdout);
    expect(observed).toMatchObject({
      name: "probe",
      args: ["--value", "two words", "-"],
      execArgv: ["--no-env-file", `--config=${test.configPath}`, "--no-install"],
      cwd: realpathSync(test.directory),
      input: "stdin payload\n",
      external: "external dependency",
    });
    expect(observed.nodePath).toBe(externalPaths.join(delimiter));
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
  }, 60_000);

  it("reports an incomplete published cache without replacing or deleting it", () => {
    const test = fixture();
    expect(test.run()).toEqual(helpResult);
    const cacheDirectory = join(test.cacheRoot, readdirSync(test.cacheRoot)[0]!);
    rmSync(join(cacheDirectory, "node_modules", "commander"), { recursive: true });
    const entries = readdirSync(test.cacheRoot, { recursive: true }).sort();

    const result = test.run();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Incomplete poteto-mode dependency cache at ${cacheDirectory}`);
    expect(result.stderr).toContain("Remove that cache directory and re-run.");
    expect(readdirSync(test.cacheRoot, { recursive: true }).sort()).toEqual(entries);
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
  }, 60_000);

  it("retains frozen-install diagnostics and removes only failed staging data", () => {
    const test = fixture();
    expect(test.run()).toEqual(helpResult);
    const publishedCaches = readdirSync(test.cacheRoot);
    writeFileSync(join(test.scriptsDirectory, "bun.lock"), "invalid lockfile\n");

    const result = test.run();
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("bun install");
    expect(result.stderr).toContain("lockfile");
    expect(result.stderr).toContain("bun install --frozen-lockfile exited with status 1");
    expect(readdirSync(test.cacheRoot)).toEqual(publishedCaches);
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
  }, 60_000);

  it("keeps the working directory selected by a relative Bun --cwd flag", () => {
    const test = fixture();
    const launchDirectory = join(test.directory, "work", "start");
    mkdirSync(launchDirectory, { recursive: true });
    writeFileSync(join(test.scriptsDirectory, "cwd-probe.ts"), `
import { ensureDependenciesInstalled } from "./bootstrap.ts";
ensureDependenciesInstalled();
console.log(process.cwd());
`);
    const [bun, ...args] = test.command([], "cwd-probe.ts");

    for (const flags of [["--cwd=.."], ["--cwd", ".."]]) {
      const result = Bun.spawnSync([bun!, ...flags, ...args], {
        cwd: launchDirectory,
        env: test.environment,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString().trim()).toBe(
        realpathSync(join(test.directory, "work"))
      );
    }
  }, 60_000);

  it("stops the running command when its process is terminated", async () => {
    if (process.platform === "win32") return;
    const test = fixture();
    expect(test.run()).toEqual(helpResult);
    const readyPath = join(test.directory, "ready");
    test.environment.PSTACK_BOOTSTRAP_TEST_READY = readyPath;
    writeFileSync(join(test.scriptsDirectory, "signal-probe.ts"), `
import { writeFileSync } from "node:fs";
import { ensureDependenciesInstalled } from "./bootstrap.ts";
ensureDependenciesInstalled();
writeFileSync(process.env.PSTACK_BOOTSTRAP_TEST_READY!, String(process.pid));
setInterval(() => {}, 1000);
`);
    const child = Bun.spawn(test.command([], "signal-probe.ts"), {
      cwd: test.directory,
      env: test.environment,
      stdout: "ignore",
      stderr: "pipe",
    });
    let commandPid: number | undefined;
    try {
      for (let attempt = 0; attempt < 400 && !existsSync(readyPath); attempt++) {
        if (child.exitCode !== null) break;
        await Bun.sleep(25);
      }
      expect(existsSync(readyPath)).toBe(true);
      commandPid = Number(readFileSync(readyPath, "utf8"));
      child.kill("SIGTERM");
      await child.exited;
      let running = true;
      try {
        process.kill(commandPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        running = false;
      }
      expect(running).toBe(false);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      if (commandPid && commandPid !== child.pid) {
        try {
          process.kill(commandPid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }
  }, 60_000);

  it("uses a user cache when XDG_CACHE_HOME is absent", () => {
    const test = fixture();
    delete test.environment.XDG_CACHE_HOME;

    expect(test.run()).toEqual(helpResult);
    const cacheHome = process.platform === "win32"
      ? test.environment.LOCALAPPDATA!
      : join(test.environment.HOME!, ".cache");
    expect(readdirSync(join(cacheHome, "open-pstack", "poteto-mode-tools"))).toHaveLength(1);
    expect(existsSync(join(test.scriptsDirectory, "node_modules"))).toBe(false);
  }, 60_000);
});
