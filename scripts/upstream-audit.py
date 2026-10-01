#!/usr/bin/env python3
"""Compare pinned upstream and port Git trees without changing either checkout."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def tree(ref, prefix):
    entries = {}
    for entry in git("ls-tree", "-rz", ref, "--", prefix).split(b"\0"):
        if entry:
            metadata, path = entry.split(b"\t", 1)
            mode, kind, oid = metadata.decode().split()
            entries[path.decode()] = {"mode": mode, "type": kind, "oid": oid}
    return entries


def port_path(path):
    relative = path.removeprefix("pstack/")
    if relative == "README.md":
        return "README-UPSTREAM.md"
    if relative.startswith(("skills/", "agents/", "assets/")):
        return "plugins/pstack/" + relative
    return None


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", default="origin/main", help="Port commit to inspect")
parser.add_argument("--upstream", default="cursor/main", help="Upstream target commit")
args = parser.parse_args()
port = git("rev-parse", "--verify", args.port + "^{commit}").decode().strip()
target = git("rev-parse", "--verify", args.upstream + "^{commit}").decode().strip()
sync_doc = git("show", port + ":UPSTREAM.md").decode()
match = re.search(r"^\| Commit \| `([0-9a-f]{40})` \|$", sync_doc, re.MULTILINE)
if not match:
    parser.error("UPSTREAM.md must contain exactly the recorded full commit row")
base = match.group(1)
subprocess.run(["git", "merge-base", "--is-ancestor", base, target], cwd=ROOT, check=True)
before = tree(base, "pstack/")
after = tree(target, "pstack/")
local = tree(port, "plugins/pstack/") | tree(port, "README-UPSTREAM.md")

changes = []
for path in sorted(before.keys() | after.keys()):
    old, new = before.get(path), after.get(path)
    if old == new:
        continue
    mapped = port_path(path)
    current = local.get(mapped)
    status = "add" if old is None else "delete" if new is None else "modify"
    if mapped is None:
        disposition = "distribution-review"
    elif current == new:
        disposition = "already-matches-target"
    elif old is None and current is None:
        disposition = "upstream-addition"
    elif current is None:
        disposition = "absent-from-port-review-exclusion"
    elif current == old:
        disposition = "unchanged-since-base"
    else:
        disposition = "port-diverged-review"
    changes.append({"upstream_path": path, "port_path": mapped, "change": status,
                    "comparison": disposition, "base": old, "target": new, "port": current})

mapped_paths = {port_path(path) for path in before.keys() | after.keys()} - {None}
port_only = sorted(local.keys() - mapped_paths)
excluded = sorted(path for path in after if port_path(path) and port_path(path) not in local
                  and path in before)


def skill_names(entries, prefix):
    return sorted(path[len(prefix):-len("/SKILL.md")] for path in entries
                  if path.startswith(prefix) and path.endswith("/SKILL.md")
                  and path[len(prefix):].count("/") == 1)


commits = []
for line in git("log", "--reverse", "--format=%H%x09%cs%x09%s", base + ".." + target,
                "--", "pstack/").decode().splitlines():
    sha, date, subject = line.split("\t", 2)
    commits.append({"sha": sha, "date": date, "subject": subject})
report = {
    "port_commit": port, "upstream_base": base, "upstream_target": target,
    "upstream_version": json.loads(git("show", target + ":pstack/.cursor-plugin/plugin.json"))["version"],
    "port_version": json.loads(git("show", port + ":plugins/pstack/.claude-plugin/plugin.json"))["version"],
    "upstream_commits": commits,
    "summary": {"changed_files": len(changes),
                "by_change": dict(sorted(Counter(row["change"] for row in changes).items())),
                "by_comparison": dict(sorted(Counter(row["comparison"] for row in changes).items()))},
    "skills": {"upstream": skill_names(after, "pstack/skills/"),
               "port": skill_names(local, "plugins/pstack/skills/")},
    "changes": changes, "port_only_files": port_only, "existing_upstream_files_absent_from_port": excluded,
    "interpretation": "Blob equality is evidence, not a semantic approval. Review adaptations and exclusions before applying changes. Unmapped documentation and manifests need distribution-specific review.",
}
print(json.dumps(report, indent=2, sort_keys=True))
