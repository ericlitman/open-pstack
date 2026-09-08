#!/usr/bin/env python3
"""Apply an upstream pstack range to the port tree mechanically.

Reads the JSON that scripts/upstream-audit.py prints. For each mapped
modification it either checks out the upstream blob (the port still matches
the old upstream blob) or runs a three-way `git merge-file` in place, leaving
conflict markers for the hand pass. Additions are copied; deletions are
removed. Unmapped paths are listed and left alone.

    python3 scripts/upstream-audit.py --port <sha> --upstream <sha> > audit.json
    python3 scripts/upstream-merge.py audit.json
"""
import json
import os
import subprocess
import sys


def blob(rev, path):
    return subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, check=True).stdout


def main(audit_path):
    audit = json.load(open(audit_path))
    base, target = audit["upstream_base"], audit["upstream_target"]
    verbatim, clean, conflicted, removed, skipped = [], [], [], [], []
    for change in audit["changes"]:
        up, port = change["upstream_path"], change["port_path"]
        if port is None:
            skipped.append(up)
            continue
        if change["change"] == "delete":
            if os.path.exists(port):
                os.remove(port)
            removed.append(port)
            continue
        new = blob(target, up)
        if change["change"] == "add" or change["comparison"] == "unchanged-since-base":
            os.makedirs(os.path.dirname(port) or ".", exist_ok=True)
            open(port, "wb").write(new)
            verbatim.append(port)
            continue
        old = blob(base, up)
        tmp_base, tmp_new = port + ".upstream-base", port + ".upstream-target"
        open(tmp_base, "wb").write(old)
        open(tmp_new, "wb").write(new)
        result = subprocess.run(
            ["git", "merge-file", "-L", "port", "-L", "upstream-base", "-L", "upstream-target", port, tmp_base, tmp_new]
        )
        os.remove(tmp_base)
        os.remove(tmp_new)
        (clean if result.returncode == 0 else conflicted).append((port, result.returncode))
    print(f"verbatim {len(verbatim)}, clean merge {len(clean)}, conflicted {len(conflicted)}, removed {len(removed)}, unmapped {len(skipped)}")
    for port, hunks in conflicted:
        print(f"conflict {hunks:2d} {port}")
    for path in skipped:
        print(f"unmapped {path}")
    return 1 if conflicted else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
