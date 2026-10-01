#!/usr/bin/env python3
"""Apply an upstream pstack range to the port tree mechanically.

Reads the JSON that scripts/upstream-audit.py prints. For each mapped path it
either checks out the upstream blob (the port still matches the old upstream
blob), runs a three-way `git merge-file` in place and leaves conflict markers
for the hand pass, or reports the row for review without touching the tree.
Refuses to run unless HEAD is the audited port commit and the mapped paths are
clean, so an audit never overwrites work done after it was taken.

    python3 scripts/upstream-audit.py --port <sha> --upstream <sha> > audit.json
    python3 scripts/upstream-merge.py audit.json
"""
import json
import os
import subprocess
import sys
import tempfile

REGULAR_MODES = {"100644", "100755"}


def git(*args, **kwargs):
    return subprocess.run(["git", *args], capture_output=True, check=True, **kwargs).stdout


def blob(rev, path):
    return git("show", f"{rev}:{path}")


def apply_mode(path, mode):
    executable = mode == "100755"
    current = os.stat(path).st_mode
    os.chmod(path, (current | 0o111) if executable else (current & ~0o111))


def refuse_drift(audit, ports):
    head = git("rev-parse", "HEAD").decode().strip()
    if head != audit["port_commit"]:
        return f"HEAD {head[:12]} is not the audited port commit {audit['port_commit'][:12]}"
    if not ports:
        return None
    dirty = git("status", "--porcelain", "--untracked-files=all", "--", *ports).decode().strip()
    if dirty:
        return "mapped paths have local changes:\n" + dirty
    return None


def merge_three_way(port, old, new):
    with tempfile.TemporaryDirectory(prefix="upstream-merge-") as tmp:
        base_path, new_path = os.path.join(tmp, "base"), os.path.join(tmp, "target")
        open(base_path, "wb").write(old)
        open(new_path, "wb").write(new)
        return subprocess.run(
            ["git", "merge-file", "-L", "port", "-L", "upstream-base", "-L", "upstream-target", port, base_path, new_path]
        ).returncode


def main(audit_path):
    audit = json.load(open(audit_path))
    base, target = audit["upstream_base"], audit["upstream_target"]
    mapped = [c for c in audit["changes"] if c["port_path"] is not None]
    drift = refuse_drift(audit, [c["port_path"] for c in mapped])
    if drift:
        print(f"refusing to run: {drift}")
        return 2
    verbatim, clean, review, removed, skipped = [], [], [], [], []
    for change in audit["changes"]:
        up, port, comparison = change["upstream_path"], change["port_path"], change["comparison"]
        if port is None:
            skipped.append(up)
            continue
        if comparison == "already-matches-target":
            continue
        if comparison == "absent-from-port-review-exclusion":
            review.append((port, f"upstream {change['change']}d an excluded path"))
            continue
        if change["change"] == "delete":
            if comparison != "unchanged-since-base":
                review.append((port, f"upstream deleted a port-edited file ({comparison})"))
                continue
            os.remove(port)
            removed.append(port)
            continue
        mode = change["target"]["mode"]
        if mode not in REGULAR_MODES:
            review.append((port, f"upstream entry mode {mode} is not a regular file"))
            continue
        new = blob(target, up)
        if change["change"] == "add" and comparison != "upstream-addition":
            review.append((port, f"upstream added a path the port already has ({comparison})"))
            continue
        if change["change"] == "add" or comparison == "unchanged-since-base":
            os.makedirs(os.path.dirname(port) or ".", exist_ok=True)
            open(port, "wb").write(new)
            apply_mode(port, mode)
            verbatim.append(port)
            continue
        hunks = merge_three_way(port, blob(base, up), new)
        if hunks < 0 or hunks > 127:
            review.append((port, f"git merge-file failed with status {hunks}"))
            continue
        apply_mode(port, mode)
        if hunks:
            review.append((port, f"{hunks} conflict hunks"))
        else:
            clean.append(port)
    print(f"verbatim {len(verbatim)}, clean merge {len(clean)}, needs review {len(review)}, removed {len(removed)}, unmapped {len(skipped)}")
    for port, why in review:
        print(f"review {why}: {port}")
    for path in skipped:
        print(f"unmapped {path}")
    return 1 if review else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
