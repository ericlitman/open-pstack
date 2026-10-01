#!/usr/bin/env python3
"""Prove scripts/upstream-merge.py refuses unsafe runs and applies safe ones.

Builds throwaway worktrees at the audited port commit, feeds the real audit
and relabeled variants through the merge, and asserts what changed on disk.

    python3 scripts/upstream-audit.py --port <sha> --upstream <sha> > audit.json
    python3 scripts/upstream-merge-probe.py audit.json
"""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MERGE = os.path.join(ROOT, "scripts", "upstream-merge.py")


def sh(*args, cwd, check=True):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=check)


def worktree(commit):
    path = tempfile.mkdtemp(prefix="merge-probe-")
    os.rmdir(path)
    sh("git", "worktree", "add", "--detach", "-q", path, commit, cwd=ROOT)
    return path


def run(audit, tree):
    audit_path = os.path.join(tree, "probe-audit.json")
    json.dump(audit, open(audit_path, "w"))
    result = sh("python3", MERGE, audit_path, cwd=tree, check=False)
    os.remove(audit_path)
    return result.returncode, result.stdout + result.stderr


def changed(tree):
    return sh("git", "status", "--porcelain", "--untracked-files=all", cwd=tree).stdout.strip()


def check(name, condition, detail=""):
    print(f"{'ok' if condition else 'FAIL'}: {name}{'' if condition else ' ' + detail}")
    return condition


def main(audit_path):
    audit = json.load(open(audit_path))
    port = audit["port_commit"]
    results = []
    trees = []
    try:
        tree = worktree(port); trees.append(tree)
        code, out = run(audit, tree)
        results.append(check("real range merges (exit 1 for hand review)", code == 1 and "verbatim 24, clean merge 32, needs review 32, removed 2" in out, out.splitlines()[0] if out else ""))

        tree = worktree(f"{port}~1"); trees.append(tree)
        code, out = run(audit, tree)
        results.append(check("stale HEAD refused, nothing written", code == 2 and changed(tree) == "", out))

        tree = worktree(port); trees.append(tree)
        dirty = next(c["port_path"] for c in audit["changes"] if c["comparison"] == "unchanged-since-base")
        open(os.path.join(tree, dirty), "a").write("\nlocal edit\n")
        code, out = run(audit, tree)
        results.append(check("dirty mapped path refused, edit kept", code == 2 and "local edit" in open(os.path.join(tree, dirty)).read(), out))

        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        variant["changes"] = [c for c in variant["changes"] if c["change"] != "modify"]
        for c in variant["changes"]:
            c["comparison"] = "port-diverged-review"
        code, out = run(variant, tree)
        results.append(check("diverged add/delete reported, nothing written", code == 1 and changed(tree) == "" and out.count("review upstream") == len(variant["changes"]), out))

        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        row = copy.deepcopy(next(c for c in variant["changes"] if c["change"] == "modify" and c["port_path"]))
        row["comparison"] = "absent-from-port-review-exclusion"
        row["port_path"] = "plugins/pstack/skills/make-bot-ui/SKILL.md"
        variant["changes"] = [row]
        code, out = run(variant, tree)
        results.append(check("excluded path reported without crash or directory", code == 1 and "excluded path" in out and not os.path.exists(os.path.join(tree, "plugins/pstack/skills/make-bot-ui")), out))

        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        conflicted = next(c for c in variant["changes"] if c["comparison"] == "port-diverged-review" and c["change"] == "modify")
        variant["changes"] = [conflicted]
        sibling = os.path.join(tree, conflicted["port_path"] + ".upstream-base")
        open(sibling, "w").write("keep me")
        code, out = run(variant, tree)
        results.append(check("sibling temp-name file untouched", os.path.exists(sibling) and open(sibling).read() == "keep me", out))

        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        row = copy.deepcopy(next(c for c in variant["changes"] if c["comparison"] == "unchanged-since-base"))
        row["target"]["mode"] = "100755"
        variant["changes"] = [row]
        code, out = run(variant, tree)
        results.append(check("executable bit applied from target mode", code == 0 and os.access(os.path.join(tree, row["port_path"]), os.X_OK), out))

        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        row = copy.deepcopy(next(c for c in variant["changes"] if c["change"] == "add"))
        row["comparison"] = "already-matches-target"
        variant["changes"] = [row]
        code, out = run(variant, tree)
        results.append(check("already-matching addition is a no-op", code == 0 and changed(tree) == "", out))
        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        variant["changes"] = [c for c in variant["changes"] if c["port_path"] is None]
        open(os.path.join(tree, "audit.json"), "w").write("{}")
        code, out = run(variant, tree)
        results.append(check("all-unmapped audit is not refused by the untracked audit file", code == 0 and "unmapped" in out, out))

        tree = worktree(port); trees.append(tree)
        variant = copy.deepcopy(audit)
        row = copy.deepcopy(next(c for c in variant["changes"] if c["comparison"] == "port-diverged-review" and c["change"] == "modify"))
        row["target"]["mode"] = "100755"
        variant["changes"] = [row]
        binary = os.path.join(tree, row["port_path"])
        open(binary, "wb").write(b"\x00\x01 binary local copy\n")
        sh("git", "update-index", "--assume-unchanged", row["port_path"], cwd=tree)
        code, out = run(variant, tree)
        results.append(check("binary merge-file failure reported, no mode change", "merge-file failed" in out and not os.access(binary, os.X_OK), out))
    finally:
        for tree in trees:
            sh("git", "worktree", "remove", "--force", tree, cwd=ROOT, check=False)
            shutil.rmtree(tree, ignore_errors=True)
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
