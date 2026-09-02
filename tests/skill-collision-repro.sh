#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note() { printf '%s\n' "$*"; }

legacy_command_dir="$repo/plugins/pstack/commands"
if [ -e "$legacy_command_dir" ]; then
  note "FAIL: legacy command layer still exists: $legacy_command_dir"
  find "$legacy_command_dir" -mindepth 1 -print 2>/dev/null || true
  fail=1
else
  note "ok: native skills are the only user-facing workflow surface"
fi

bad_principle=""
for skill in "$repo"/plugins/pstack/skills/principle-*/SKILL.md; do
  if [ ! -f "$skill" ]; then
    bad_principle="no principle-* leaves found"$'\n'
    break
  fi
  front="$(sed -n '2,/^---$/p' "$skill")"
  printf '%s\n' "$front" | grep -q '^user-invocable: false$' || bad_principle="$bad_principle$skill (missing user-invocable: false)"$'\n'
  printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$' && bad_principle="$bad_principle$skill (still carries disable-model-invocation)"$'\n'
done
if [ -n "$bad_principle" ]; then
  note "FAIL: principle-* leaves must be user-invocable: false and model-readable:"
  note "$bad_principle"
  fail=1
else
  note "ok: all principle-* leaves request user-hidden and remain model-readable"
fi

verof() { { grep -m1 '"version"' "$1" || true; } | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
vc="$(verof "$repo/plugins/pstack/.claude-plugin/plugin.json")"
vx="$(verof "$repo/plugins/pstack/.codex-plugin/plugin.json")"
vm="$(verof "$repo/.claude-plugin/marketplace.json")"
vu="$(sed -n 's/| open-pstack version | `\([^`]*\)` |/\1/p' "$repo/UPSTREAM.md")"
if [ -n "$vc" ] && [ "$vc" = "$vx" ] && [ "$vc" = "$vm" ] && [ "$vc" = "$vu" ]; then
  note "ok: open-pstack version matches across UPSTREAM.md and the 3 manifests ($vc)"
else
  note "FAIL: open-pstack version differs: upstream=$vu claude-plugin=$vc codex-plugin=$vx marketplace=$vm"
  fail=1
fi

# Active configuration must use Claude's rolling family aliases. Concrete
# provider reports may still appear in runner fixtures, but no shipped
# descriptor, native-agent model field, or live test invocation may pin one.
legacy_model_pins="$(
  grep -REn \
    --include='*.md' --include='*.ts' --include='*.sh' \
    'claude:claude-(fable|opus)-[0-9]|^model: claude-(fable|opus)-[0-9]|--model claude-(fable|opus)-[0-9]' \
    "$repo/plugins/pstack" "$repo/tests" "$repo/README.md" "$repo/docs/reference.md" \
    2>/dev/null || true
)"
standalone_code_pins="$(
  grep -REn \
    --include='*.ts' --include='*.js' \
    --exclude='*.test.ts' --exclude='*.test.js' \
    "['\"]claude-(fable|opus)-[0-9]" \
    "$repo/plugins/pstack" \
    2>/dev/null || true
)"
if [ -n "$legacy_model_pins" ] || [ -n "$standalone_code_pins" ]; then
  note "FAIL: active Fable or Opus configuration still pins a model revision:"
  [ -z "$legacy_model_pins" ] || note "$legacy_model_pins"
  [ -z "$standalone_code_pins" ] || note "$standalone_code_pins"
  fail=1
else
  note "ok: active Fable and Opus configuration uses rolling aliases"
fi

# Static invariant (CHANGES maintenance note): provider-dispatch owns the default
# provider/model quad and the four panel skills plus setup-pstack copy it verbatim.
setup="$repo/plugins/pstack/skills/setup-pstack/SKILL.md"
dispatch="$repo/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md"
quad_of() { { grep -oE '(claude|codex|grok):[a-z0-9.-]+@(low|medium|high|xhigh|max)' || true; } | tr '\n' ' ' | sed 's/ $//'; }
canon_quad="$(awk '
  $0 == "## Model matrix" { in_matrix = 1; next }
  in_matrix && /^## / { exit }
  in_matrix && /^\|/ {
    line = $0
    sub(/^\|/, "", line)
    sub(/\|$/, "", line)
    n = split(line, cells, "|")
    for (i = 1; i <= n; i++) {
      gsub(/^ +| +$/, "", cells[i])
      gsub(/`/, "", cells[i])
    }
    family = cells[1]
    if (family == "Family" || family ~ /^:?-+:?$/) next
    provider = cells[3]
    model = cells[4]
    effort = cells[5]
    if (out != "") out = out " "
    out = out provider ":" model "@" effort
  }
  END { print out }
' "$dispatch")"
quad_bad=""
[ -n "$canon_quad" ] || quad_bad="could not read the canonical quad from $dispatch"$'\n'
# Anchor on the quad's last slug rather than a hard-coded one, so a model swap in
# setup-pstack cannot leave this check hunting for a slug nobody ships any more.
anchor="${canon_quad##* }"
# arena, architect, and how each state the quad on one line; interrogate lists it
# as one slug per row of its Reviewer A/B/C/D table (upstream #167).
for name in arena architect how; do
  skill="$repo/plugins/pstack/skills/$name/SKILL.md"
  n="$(grep -Fc "$anchor" "$skill" || true)"
  if [ "$n" != "1" ]; then
    quad_bad="$quad_bad$skill: expected exactly 1 default-quad line, found $n"$'\n'
    continue
  fi
  got="$(grep -F "$anchor" "$skill" | quad_of)"
  [ "$got" = "$canon_quad" ] || quad_bad="$quad_bad$skill: [$got] != [$canon_quad]"$'\n'
done
interrogate="$repo/plugins/pstack/skills/interrogate/SKILL.md"
got="$(grep -E '^\| Reviewer [A-Z] \|' "$interrogate" | quad_of)"
[ "$got" = "$canon_quad" ] || quad_bad="$quad_bad$interrogate reviewer table: [$got] != [$canon_quad]"$'\n'
while IFS= read -r line; do
  got="$(printf '%s\n' "$line" | quad_of)"
  [ "$got" = "$canon_quad" ] || quad_bad="$quad_bad$setup role row: [$got] != [$canon_quad]"$'\n'
done < <(grep -E '^(arena runners|arena cross-judge pool|architect runners|interrogate reviewers|how critics):' "$setup")
if [ -n "$quad_bad" ]; then
  note "FAIL: the default model quad is not identical across provider dispatch, the panel skills, and setup-pstack:"
  note "$quad_bad"
  fail=1
else
  note "ok: default model quad identical across provider dispatch + 4 panel skills + setup-pstack ($canon_quad)"
fi

plugin="$repo/plugins/pstack"
canon="$plugin/skills/poteto-mode/references/bugbot-triage.md"
skill="$plugin/skills/babysit/SKILL.md"
playbook="$plugin/skills/poteto-mode/playbooks/babysit.md"
bugbot_skill_rel="../poteto-mode/references/bugbot-triage.md"
bugbot_playbook_rel="../references/bugbot-triage.md"
bugbot_bad=""
if [ ! -f "$canon" ]; then
  bugbot_bad="${bugbot_bad}canonical rubric missing: $canon"$'\n'
fi
skill_op="$(grep -F 'Review-bot comments (Bugbot and similar automation):' "$skill" || true)"
skill_n="$(printf '%s\n' "$skill_op" | awk 'NF { c++ } END { print c+0 }')"
if [ "$skill_n" != "1" ]; then
  bugbot_bad="${bugbot_bad}standalone babysit skill lost bugbot-triage operational line"$'\n'
else
  skill_dest="$(printf '%s\n' "$skill_op" | sed -n 's/.*](\([^)]*\)).*/\1/p')"
  if [ "$skill_dest" != "$bugbot_skill_rel" ]; then
    bugbot_bad="${bugbot_bad}standalone babysit Markdown destination is [$skill_dest], not [$bugbot_skill_rel]"$'\n'
  fi
  if ! printf '%s\n' "$skill_op" | grep -Fq 'classify as fix, dismiss, or ask'; then
    bugbot_bad="${bugbot_bad}standalone babysit lost fix/dismiss/ask classification"$'\n'
  fi
  if ! printf '%s\n' "$skill_op" | grep -Fq "Follow the rubric's Ask by default categories, including security, data, and high-severity findings."; then
    bugbot_bad="${bugbot_bad}standalone babysit lost ask-by-default escalation"$'\n'
  fi
fi
playbook_op="$(grep -E '^8\. \*\*Bugbot is triaged skeptically, always\.\*\*' "$playbook" || true)"
playbook_n="$(printf '%s\n' "$playbook_op" | awk 'NF { c++ } END { print c+0 }')"
if [ "$playbook_n" != "1" ]; then
  bugbot_bad="${bugbot_bad}poteto-mode babysit playbook lost step-8 Bugbot operational line"$'\n'
elif ! printf '%s\n' "$playbook_op" | grep -Fq "$bugbot_playbook_rel"; then
  bugbot_bad="${bugbot_bad}poteto-mode babysit playbook step 8 lost bugbot-triage binding ($bugbot_playbook_rel)"$'\n'
fi
copies="$(find "$plugin" -name 'bugbot-triage.md' ! -path '*/node_modules/*' -print 2>/dev/null || true)"
n="$(printf '%s\n' "$copies" | awk 'NF { c++ } END { print c+0 }')"
if [ "$n" != "1" ]; then
  bugbot_bad="${bugbot_bad}expected exactly 1 bugbot-triage.md under plugin, found $n"$'\n'
fi
if [ -n "$bugbot_bad" ]; then
  note "FAIL: babysit Bugbot binding on the packaged plugin"
  note "$bugbot_bad"
  fail=1
else
  note "ok: babysit Bugbot binding on the packaged plugin"
fi

forge_neutral_files=(
  "$plugin/skills/poteto-mode/playbooks/shipping.md"
  "$plugin/skills/poteto-mode/playbooks/babysit.md"
  "$plugin/skills/poteto-mode/playbooks/autopilot-full.md"
  "$plugin/skills/poteto-mode/playbooks/autopilot-stack.md"
  "$plugin/skills/poteto-mode/playbooks/opening-a-pr.md"
  "$plugin/skills/poteto-mode/playbooks/multi-phase-plan.md"
  "$plugin/skills/poteto-mode/references/bugbot-triage.md"
)
graphite_commands="$(grep -En 'gt (submit|track|restack|sync|merge|ls)' "${forge_neutral_files[@]}" || true)"
if [ -n "$graphite_commands" ]; then
  note "FAIL: forge-neutral stack playbooks still name Graphite commands:"
  note "$graphite_commands"
  fail=1
else
  note "ok: forge-neutral stack playbooks name no Graphite command"
fi

unsafe_shell_templates="$(perl -ne 'while (/`((?:git|gh|origin|skills\/poteto-mode\/scripts\/watch-pr\/watch-pr)[^`]*)`/g) { my $command = $1; print "$command\n" if $command =~ /<[^>]+>/ }' "${forge_neutral_files[@]}" | sort -u)"
if [ -n "$unsafe_shell_templates" ]; then
  note "FAIL: executable shell templates paste placeholder text into commands:"
  note "$unsafe_shell_templates"
  fail=1
else
  note "ok: forge-derived values stay quoted shell data"
fi

shipping="$plugin/skills/poteto-mode/playbooks/shipping.md"
autopilot_full="$plugin/skills/poteto-mode/playbooks/autopilot-full.md"
autopilot_stack="$plugin/skills/poteto-mode/playbooks/autopilot-stack.md"
opening_a_pr="$plugin/skills/poteto-mode/playbooks/opening-a-pr.md"
multi_phase_plan="$plugin/skills/poteto-mode/playbooks/multi-phase-plan.md"
shipping_safety_bad=""
grep -Fq 'watch-pr --owner "$base_owner" --repo "$base_name" --pr "$pr"' "$playbook" || shipping_safety_bad="${shipping_safety_bad}Babysit watcher does not pin the base repository and PR number"$'\n'
grep -Fq -- '--disable-auto' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not disarm pre-existing auto-merge"$'\n'
grep -Fq 'Before launching any verifier' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not disarm the frozen queue before independent verification"$'\n'
shipping_disarm_order="$(awk '/^2\. / { disarm = index($0, "Before launching any verifier"); verify = index($0, "One subagent per PR"); if (disarm == 0 || verify == 0 || disarm >= verify) print $0 }' "$shipping")"
if [ -n "$shipping_disarm_order" ]; then
  shipping_safety_bad="${shipping_safety_bad}Shipping does not confirm the frozen queue unarmed before launching verifiers"$'\n'
fi
grep -Fq 'current bottom and every descendant' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not disarm the frontier and descendants before mutation"$'\n'
grep -Fq 'Stop before any rebase, force-push, retarget, arm, or merge' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping can mutate the frontier before every merge request is confirmed off"$'\n'
grep -Fq 'skills/poteto-mode/scripts/watch-pr/watch-pr' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not use the installed-plugin watcher path"$'\n'
grep -Fq -- '--owner "$base_owner" --repo "$base_name"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not pin the GitHub watcher to the base repository"$'\n'
grep -Fq -- '--force-with-lease="refs/heads/$branch:$captured_sha"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not bind rewritten branch pushes to the captured SHA"$'\n'
grep -Fq 'git merge-base --is-ancestor "$landing_base_sha" "refs/heads/$branch"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not prove its recorded patch base is an ancestor before rebasing"$'\n'
grep -Fq 'git rebase --onto "$trunk_tip" "$landing_base_sha" -- "$branch"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not drop a squash-merged parent with an option-safe onto rebase"$'\n'
grep -Fq 'return to step 5 and merge it' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not merge after an unarmed frontier becomes ready"$'\n'
grep -Fq 'any terminal, non-passing conclusion, regardless of whether auto-merge or a merge-queue entry is pending' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping lets pending merge state hide a terminal required-check failure"$'\n'
grep -Fq '`UNSTABLE` is not a failure by itself' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping treats advisory or pending status as a terminal failure"$'\n'
grep -Fq "return to step 4's guarded rebase and step 3's re-verification" "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not recover an armed stale or conflicted frontier"$'\n'
if grep -Fq 'origin pr merge "$pr" --squash' "$shipping"; then
  shipping_safety_bad="${shipping_safety_bad}Shipping passes GitHub's unsupported squash flag to Origin"$'\n'
fi
grep -Fq '<verdict-sha>' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not preserve the independent verdict head"$'\n'
grep -Fq 'set `<landing-sha>` to `<current-head>`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not capture the post-rewrite landing head"$'\n'
grep -Fq 'require the local branch tip to match it' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping compares or merges a published head that the local patch calculation did not inspect"$'\n'
if grep -Fq '<verified-sha>' "$shipping"; then
  shipping_safety_bad="${shipping_safety_bad}Shipping still conflates the verdict head with the current landing head"$'\n'
fi
grep -Fq '`gh pr merge "$pr" --squash --match-head-commit "$landing_sha" --repo "$base_repo"`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not bind an immediate GitHub merge to the current landing head and base repository"$'\n'
grep -Fq '`gh pr merge "$pr" --squash --auto --match-head-commit "$landing_sha" --repo "$base_repo"`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not bind GitHub auto-merge setup to the current landing head and base repository"$'\n'
grep -Fq 'required, SHA-scoped verification check for the independent verdict' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping allows armed auto-merge to outlive its independent verdict"$'\n'
grep -Fq -- '--json headRefOid,baseRefName,state,mergedAt,mergeStateStatus,statusCheckRollup,autoMergeRequest' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not observe the head SHA and base branch while watching"$'\n'
grep -Fq 'On any head or base change' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not invalidate an armed merge after a head or base change"$'\n'
shipping_step_2="$(grep -E '^2\. ' "$shipping" || true)"
shipping_step_4="$(grep -E '^4\. ' "$shipping" || true)"
shipping_step_5="$(grep -E '^5\. ' "$shipping" || true)"
shipping_step_8="$(grep -E '^8\. ' "$shipping" || true)"
printf '%s\n' "$shipping_step_2" | grep -Fq '`mergeQueueEntry`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not inspect GitHub merge-queue state before verification"$'\n'
printf '%s\n' "$shipping_step_2" | grep -Fq '`dequeuePullRequest`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not dequeue GitHub merge-queue entries before verification"$'\n'
printf '%s\n' "$shipping_step_2" | grep -Fq 'both `autoMergeRequest` and `mergeQueueEntry` are null' || shipping_safety_bad="${shipping_safety_bad}Shipping treats a null auto-merge request as fully disarmed"$'\n'
printf '%s\n' "$shipping_step_4" | grep -Fq '`mergeQueueEntry`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not dequeue the frontier and descendants before mutation"$'\n'
printf '%s\n' "$shipping_step_4" | grep -Fq 'Re-read `baseRefName` after any retarget and require it to equal `<trunk>`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not verify the destination after retargeting"$'\n'
printf '%s\n' "$shipping_step_4" | grep -Fq 'Record `<trunk>` as `<landing-base-ref>`' || shipping_safety_bad="${shipping_safety_bad}Shipping conflates the destination branch with the patch-base commit"$'\n'
printf '%s\n' "$shipping_step_5" | grep -Fq '`baseRefName` equals `<trunk>`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not require the intended destination immediately before merge"$'\n'
printf '%s\n' "$shipping_step_5" | grep -Fq 'GitHub has no server-enforced expected-base precondition' || shipping_safety_bad="${shipping_safety_bad}Shipping does not state the GitHub base-guard limitation"$'\n'
printf '%s\n' "$shipping_step_5" | grep -Fq 'Run the GitHub merge immediately after the matching preflight' || shipping_safety_bad="${shipping_safety_bad}Shipping cannot execute its required GitHub merge after checking the destination"$'\n'
printf '%s\n' "$shipping_step_8" | grep -Fq '`baseRefName`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not monitor the destination branch during landing"$'\n'
printf '%s\n' "$shipping_step_8" | grep -Fq '`mergeQueueEntry`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not monitor native merge-queue state during landing"$'\n'
github_pr_commands="$(grep -Eho '`gh pr (create|edit|view|ready|merge|checks)[^`]*`' "${forge_neutral_files[@]}" || true)"
github_pr_unscoped="$(printf '%s\n' "$github_pr_commands" | grep -Fv -- '--repo "$base_repo"' || true)"
if [ -n "$github_pr_unscoped" ]; then
  shipping_safety_bad="${shipping_safety_bad}GitHub PR commands do not all name the canonical base repository: ${github_pr_unscoped}"$'\n'
fi
for remote_file in "$shipping" "$autopilot_full" "$autopilot_stack"; do
  grep -Fq '<head-remote>' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not resolve the head push remote independently"$'\n'
  grep -Fq '<head-url>' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not bind its remote read to the head push repository"$'\n'
  grep -Fq '<base-remote>' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not resolve the base fetch remote independently"$'\n'
  grep -Fq 'git ls-remote -- "$head_url" "refs/heads/$branch"' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not read the published SHA from the head push repository"$'\n'
  grep -Fq '"$head_url" "HEAD:refs/heads/$branch"' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not publish to the exact head URL whose SHA it captured"$'\n'
  if grep -Fq '<git-remote>' "$remote_file"; then
    shipping_safety_bad="${shipping_safety_bad}${remote_file} still couples base fetches and head pushes through one legacy placeholder"$'\n'
  fi
  if grep -Eq 'git (ls-remote|push)[^`]*[[:space:]]origin([[:space:]]|`)' "$remote_file"; then
    shipping_safety_bad="${shipping_safety_bad}${remote_file} hard-codes origin for a guarded Git operation"$'\n'
  fi
done
grep -Fq 'Fetch current trunk through `<base-remote>`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not fetch trunk from the base repository"$'\n'
if [ "$(grep -Fc 'through `<base-remote>`' "$shipping")" -lt 2 ]; then
  shipping_safety_bad="${shipping_safety_bad}Shipping does not keep using the base repository after the first merge"$'\n'
fi
grep -Fq 'Fetch another stack branch directly through `<head-url>`' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not fetch a fork parent through the head push repository URL"$'\n'
if grep -Fq '<parent-remote>' "$autopilot_stack"; then
  shipping_safety_bad="${shipping_safety_bad}Autopilot-stack still fetches a parent through a remote name whose fetch and push repositories can differ"$'\n'
fi
grep -Fq 'When the head repository is a fork, keep the local child branch rebased onto its parent' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not retain local parent ancestry for fork heads"$'\n'
grep -Fq 'create or retarget every PR against `<trunk>` in the base repository' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack tries to use a fork-only branch as a PR base"$'\n'
grep -Fq 'never infer stack order from their equal base branches' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not preserve explicit fork stack order"$'\n'
grep -Fq 'git rebase --onto "$parent_tip" "$current_base_sha" -- "$branch"' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not move only child commits when a parent tip changes"$'\n'
grep -Fq "Shipping step 4's disarm-and-confirm rule to that child and every descendant" "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR can rewrite or retarget an armed existing stack"$'\n'
grep -Fq 'If repository instructions require a draft until named evidence exists' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR ignores repository-required draft evidence gates"$'\n'
grep -Fq 'Create every fork PR' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR does not bind a root fork PR to its explicit head repository"$'\n'
grep -Fq 'A fork child PR targets trunk while retaining local parent ancestry' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan does not model fork stack PR bases"$'\n'
for fork_file in "$autopilot_stack" "$opening_a_pr" "$multi_phase_plan"; do
  grep -Fq 'gh api --method POST "repos/$base_repo/pulls"' "$fork_file" || shipping_safety_bad="${shipping_safety_bad}${fork_file} does not create fork PRs through the organization-capable GitHub API"$'\n'
  grep -Fq -- '-f "head_repo=$head_name"' "$fork_file" || shipping_safety_bad="${shipping_safety_bad}${fork_file} does not identify the validated fork repository"$'\n'
done
grep -Fq 'Rebase each unmerged stack child onto its parent' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan flattens unmerged stack children onto trunk"$'\n'
grep -Fq 'An appended stack child keeps its recorded parent tip until that parent lands' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan rebases an unmerged stack child onto trunk before delivery"$'\n'
grep -Fq 'For fork heads, take the order from the verified local parent ancestry' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping tries to infer a fork stack from shared trunk bases"$'\n'
grep -Fq 'only the current bottom PR through Shipping, one at a time' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack offers merge-when-ready outside the current bottom frontier"$'\n'
grep -Fq -- '--force-with-lease="refs/heads/$branch:$captured_sha"' "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not bind its post-rebase push to the captured SHA"$'\n'
grep -Fq "A private-stack child fetches its parent's exact tip" "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full rebases a private-stack child onto trunk instead of its parent"$'\n'
grep -Fq 'Record the selected exact commit as `<target-tip>`' "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not record the exact rebase target"$'\n'
grep -Fq 'git rebase --onto "$target_tip" "$current_base_sha" -- "$branch"' "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not isolate child commits when changing a private-stack parent"$'\n'
grep -Fq 'git fetch -- "$head_url" "refs/heads/$branch"' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR does not refresh a fork head through its push repository URL"$'\n'
grep -Fq 'resolve and validate `<head-url>` through Shipping step 1, capture it as `head_url`' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR does not resolve its head URL before a shared-worktree refresh"$'\n'
grep -Fq 'git fetch -- "$head_url" "refs/heads/$head_branch"' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan does not fetch a live-lane head through its push repository URL"$'\n'
grep -Fq 'Resolve and validate `<head-url>` through Shipping step 1 and capture it as `head_url` for the live-lane fetch' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan does not resolve its head URL before a live-lane fetch"$'\n'
autopilot_full_rewrite_order="$(awk '/^2\. / { capture = index($0, "git ls-remote"); rebase = index($0, "git rebase --onto"); if (capture == 0 || rebase == 0 || capture >= rebase) print $0 }' "$autopilot_full")"
if [ -n "$autopilot_full_rewrite_order" ]; then
  shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not capture the published head before rebasing"$'\n'
fi
grep -Fq "Shipping step 4's disarm-and-confirm rule" "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full can rewrite an armed pull request"$'\n'
grep -Fq "Shipping step 5's server-enforced expected-head flow" "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not bind owner merges to the current landing SHA"$'\n'
grep -Fq -- '--force-with-lease="refs/heads/$branch:$captured_sha"' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not bind its topology push to the captured SHA"$'\n'
grep -Fq "Shipping step 4's disarm-and-confirm rule" "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack can rewrite an armed pull request"$'\n'
grep -Fq "step 6's captured-SHA lease flow" "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack drift handling does not reuse its guarded push flow"$'\n'
if [ -n "$shipping_safety_bad" ]; then
  note "FAIL: forge-neutral landing safety rules regressed:"
  note "$shipping_safety_bad"
  fail=1
else
  note "ok: forge-neutral landing keeps head/base, auto-merge/queue, split-remote, fork-stack, rebase-push, and watch safety rules"
fi

excluded_skill="$plugin/skills/make-bot-ui"
if [ -e "$excluded_skill" ]; then
  note "FAIL: excluded upstream skill exists: $excluded_skill"
  fail=1
else
  note "ok: excluded upstream skills stay absent"
fi

routed_model_skills=(how why unslop typescript-best-practices)
routed_model_bad=""
for name in "${routed_model_skills[@]}"; do
  routed_skill="$plugin/skills/$name/SKILL.md"
  front="$(sed -n '2,/^---$/p' "$routed_skill")"
  if printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$'; then
    routed_model_bad="${routed_model_bad}${routed_skill}"$'\n'
  fi
done
if [ -n "$routed_model_bad" ]; then
  note "FAIL: skills routed by name must stay model-invocable:"
  note "$routed_model_bad"
  fail=1
else
  note "ok: routed skills stay model-invocable"
fi

sol_descriptor="$(awk -F '|' '
  $2 ~ /^[[:space:]]*sol[[:space:]]*$/ {
    for (i = 4; i <= 6; i++) gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
    print $4 ":" $5 "@" $6
  }
' "$dispatch")"
solo_code_bad=""
if [ -z "$sol_descriptor" ]; then
  solo_code_bad="could not read the sol row from $dispatch"$'\n'
fi
for role in bug-fix perf-issue hillclimb; do
  setup_descriptor="$(sed -n "s/^${role}: //p" "$setup")"
  if [ "$setup_descriptor" != "$sol_descriptor" ]; then
    solo_code_bad="${solo_code_bad}${setup} ${role}: [${setup_descriptor}] != [${sol_descriptor}]"$'\n'
  fi
  role_playbook="$plugin/skills/poteto-mode/playbooks/$role.md"
  playbook_descriptor="$(sed -n 's/.*default `\([^`]*\)`.*/\1/p' "$role_playbook")"
  if [ "$playbook_descriptor" != "$sol_descriptor" ]; then
    solo_code_bad="${solo_code_bad}${role_playbook}: [${playbook_descriptor}] != [${sol_descriptor}]"$'\n'
  fi
done
if [ -n "$solo_code_bad" ]; then
  note "FAIL: solo code roles must use the sol row:"
  note "$solo_code_bad"
  fail=1
else
  note "ok: solo code roles stay on the sol row ($sol_descriptor)"
fi

codex_manifest="$plugin/.codex-plugin/plugin.json"
logo_path="$(sed -n 's/^[[:space:]]*"logo":[[:space:]]*"\([^"]*\)".*/\1/p' "$codex_manifest")"
logo_bad=""
case "$logo_path" in
  "") logo_bad="interface.logo is missing from $codex_manifest" ;;
  /*) logo_bad="interface.logo must be plugin-relative: $logo_path" ;;
esac
logo_rel="${logo_path#./}"
case "/$logo_rel/" in
  */../*) logo_bad="interface.logo escapes the plugin root: $logo_path" ;;
esac
if [ -z "$logo_bad" ] && { [ ! -f "$plugin/$logo_rel" ] || [ -L "$plugin/$logo_rel" ]; }; then
  logo_bad="interface.logo does not name a regular file under the plugin root: $logo_path"
fi
if [ -n "$logo_bad" ]; then
  note "FAIL: codex logo path does not resolve"
  note "$logo_bad"
  fail=1
else
  note "ok: codex logo path resolves"
fi

if [ "${PSTACK_STATIC_ONLY:-0}" = "1" ]; then
  exit "$fail"
fi

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/.claude-plugin" "$scratch/skills/foo"
printf '%s\n' '{"name": "testplug", "version": "0.0.1", "description": "native skill repro"}' \
  > "$scratch/.claude-plugin/plugin.json"
cat > "$scratch/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: collision test skill
---

Say exactly: SKILL-RAN
Then stop. Do not invoke any skill or tool.
EOF

run() {
  claude -p --plugin-dir "$scratch" --model fable --effort max --max-turns 3 "$1" < /dev/null 2>&1
}

check() { # $1 label, $2 expected marker, $3 output
  if printf '%s' "$3" | grep -q "$2"; then
    note "ok: $1 -> $2"
  else
    note "FAIL: $1 expected $2, got: $3"
    fail=1
  fi
}

invoke='Call the Skill tool with skill "testplug:foo" exactly once and follow what it says.'

check "model-initiated Skill-tool invocation" "SKILL-RAN" "$(run "$invoke")"
check "user /testplug:foo invocation" "SKILL-RAN" "$(run '/testplug:foo')"

exit "$fail"
