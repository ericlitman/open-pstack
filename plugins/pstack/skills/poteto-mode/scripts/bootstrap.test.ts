import { describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const nodeEntryPoints = [
  ["bootstrap", "bootstrap.ts"],
  ["watch-pr", "watch-pr/watch-pr"],
] as const;

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
  it("runs copied watch-pr without installing dependencies inside the plugin", () => {
    const directory = mkdtempSync(join(tmpdir(), "pstack-bootstrap-"));
    const pluginDirectory = join(directory, "plugins", "pstack");
    const scriptsDirectory = join(pluginDirectory, "skills", "poteto-mode", "scripts");

    try {
      cpSync(import.meta.dir, scriptsDirectory, {
        recursive: true,
        filter: (source) => basename(source) !== "node_modules",
      });
      const initialEntries = readdirSync(pluginDirectory, { recursive: true }).sort();
      const environment: Record<string, string | undefined> = {
        ...process.env,
        HOME: join(directory, "home"),
        XDG_CONFIG_HOME: join(directory, "config"),
        XDG_CACHE_HOME: join(directory, "cache"),
        BUN_INSTALL: join(directory, "bun"),
        BUN_INSTALL_CACHE_DIR: join(directory, "bun-cache"),
      };
      delete environment.NODE_PATH;
      delete environment.NODE_OPTIONS;
      delete environment.BUN_OPTIONS;

      for (let attempt = 0; attempt < 2; attempt++) {
        const result = Bun.spawnSync([
          process.execPath,
          "--no-env-file",
          "--config=/dev/null",
          join(scriptsDirectory, "watch-pr", "watch-pr"),
          "--help",
        ], { cwd: directory, env: environment });

        expect({
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        }).toEqual({
          exitCode: 0,
          stdout: expect.stringContaining("Usage: watch-pr [options]"),
          stderr: "",
        });
      }

      expect(existsSync(join(scriptsDirectory, "node_modules"))).toBe(false);
      expect(readdirSync(pluginDirectory, { recursive: true }).sort()).toEqual(initialEntries);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
