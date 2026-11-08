#!/usr/bin/env bash
# Codex review of the current branch against origin/main (see CLAUDE.md "Review").
#
#   scripts/codex-review.sh <out.md> [previous-round.md]
#
# Runs Codex read-only on `git diff origin/main...HEAD`. With a previous round's output, asks
# Codex to verify each earlier finding first. The review ends with one line:
#   VERDICT: PASS   or   VERDICT: CHANGES REQUESTED
# Exit code: 0 = PASS, 1 = CHANGES REQUESTED, 2 = no verdict / Codex error.
#
# CODEX_MODEL overrides the model (default gpt-6.1-sol; some ChatGPT plans reject others).
set -euo pipefail

out=${1:?usage: scripts/codex-review.sh <out.md> [previous-round.md]}
prev=${2:-}
root=$(git rev-parse --show-toplevel)
branch=$(git rev-parse --abbrev-ref HEAD)
model=${CODEX_MODEL:-gpt-6.1-sol}

git fetch -q origin main

prompt=$(mktemp)
trap 'rm -f "$prompt"' EXIT
{
  echo "The change under review is \`git diff origin/main...HEAD\` in this repository (branch $branch)."
  echo "Read that diff and any files you need. Do not modify any files."
  if [[ -n "$prev" ]]; then
    echo
    echo "This is a FOLLOW-UP round. The previous round's findings are below and later commits claim to"
    echo "fix them. Verify each one (FIXED / NOT FIXED with evidence), then review the whole diff again."
    echo '--- PREVIOUS FINDINGS ---'
    cat "$prev"
    echo '--- END PREVIOUS FINDINGS ---'
  fi
  echo
  cat "$root/scripts/codex-review-prompt.md"
} > "$prompt"

codex exec -m "$model" -C "$root" -s read-only --ephemeral -o "$out" - < "$prompt" > "$out.log" 2>&1 || true

verdict=$(grep -Eo 'VERDICT: (PASS|CHANGES REQUESTED)' "$out" 2>/dev/null | tail -1 || true)
echo "${verdict:-VERDICT: MISSING (see $out.log)}"
case "$verdict" in
  'VERDICT: PASS') exit 0 ;;
  'VERDICT: CHANGES REQUESTED') exit 1 ;;
  *) exit 2 ;;
esac
