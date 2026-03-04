#!/usr/bin/env bash
# Skills drift detection — warns when skill docs diverge from actual codebase.
# Non-blocking: always exits 0. Uses GitHub Actions annotations.

set -euo pipefail

DRIFT_FOUND=0
SUMMARY=""

warn() {
  local label="$1" documented="$2" actual="$3"
  echo "::warning::Skills drift: $label — documented: $documented, actual: $actual"
  SUMMARY+="| $label | $documented | $actual | ⚠️ |\n"
  DRIFT_FOUND=1
}

ok() {
  local label="$1" documented="$2" actual="$3"
  SUMMARY+="| $label | $documented | $actual | ✅ |\n"
}

check() {
  local label="$1" documented="$2" actual="$3" threshold="${4:-2}"
  local diff=$(( actual - documented ))
  if [ "${diff#-}" -gt "$threshold" ]; then
    warn "$label" "$documented" "$actual"
  else
    ok "$label" "$documented" "$actual"
  fi
}

# --- E2E spec file count ---
e2e_doc=$(grep -oP '\d+(?= spec files?)' .claude/skills/testing/SKILL.md | head -1)
e2e_actual=$(find e2e -name "*.spec.ts" 2>/dev/null | wc -l)
e2e_doc="${e2e_doc:-0}"
check "E2E spec files" "$e2e_doc" "$e2e_actual"

# --- Unit/integration test file count ---
test_doc=$(grep -oP '\d+(?= files)' .claude/skills/testing/SKILL.md | head -1)
test_actual=$(find src server -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | wc -l)
test_doc="${test_doc:-0}"
check "Test files" "$test_doc" "$test_actual"

# --- Component file count ---
comp_doc=$(grep -c '\.tsx' .claude/skills/project-structure/SKILL.md | head -1 || echo 0)
comp_actual=$(find src/components -maxdepth 1 -name "*.tsx" 2>/dev/null | wc -l)
# project-structure lists all .tsx files, not just components — count only src/components/ lines
comp_doc=$(grep -cP '^\s+\S+\.tsx' .claude/skills/project-structure/SKILL.md || echo 0)
comp_actual_dir=$(find src/components -maxdepth 1 -name "*.tsx" 2>/dev/null | wc -l)
check "Component files" "$comp_doc" "$comp_actual_dir"

# --- Output ---
echo ""
if [ "$DRIFT_FOUND" -eq 1 ]; then
  echo "⚠️  Skills drift detected — update skill docs to match codebase"
else
  echo "✅ Skills documentation is up to date"
fi

# Write to GitHub Step Summary if available
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Skills Drift Check"
    echo ""
    echo "| Check | Documented | Actual | Status |"
    echo "|-------|-----------|--------|--------|"
    echo -e "$SUMMARY"
    if [ "$DRIFT_FOUND" -eq 1 ]; then
      echo ""
      echo "⚠️ Update skill files to reflect current codebase state."
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit 0
