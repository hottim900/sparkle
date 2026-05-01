#!/usr/bin/env bash
#
# Cut a GitHub Release for the version currently in VERSION.
# Reads CHANGELOG.md, extracts the section matching that version, creates an
# annotated git tag, pushes it, and creates the matching GitHub Release.
#
# Usage:
#   scripts/release.sh            # interactive, prompts before tagging
#   scripts/release.sh --yes      # skip confirmation (use from /ship)
#   scripts/release.sh --dry-run  # print extracted notes only, no side effects
#
# Run from a clean main checkout AFTER the version-bump PR has been merged.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

DRY_RUN=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2 ;;
  esac
done

if [[ ! -f VERSION ]]; then
  echo "error: VERSION file not found at repo root" >&2
  exit 1
fi
if [[ ! -f CHANGELOG.md ]]; then
  echo "error: CHANGELOG.md not found at repo root" >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < VERSION)"
if [[ -z "$VERSION" ]]; then
  echo "error: VERSION file is empty" >&2
  exit 1
fi
TAG="v${VERSION}"

NOTES="$(awk -v ver="## [${VERSION}]" '
  index($0, ver) == 1 { found = 1; next }
  found && /^## \[/  { exit }
  found              { print }
' CHANGELOG.md)"

# Trim leading/trailing blank lines.
NOTES="$(printf '%s\n' "$NOTES" | sed -e '/./,$!d' | tac | sed -e '/./,$!d' | tac)"

if [[ -z "$NOTES" ]]; then
  echo "error: no '## [${VERSION}]' section found in CHANGELOG.md" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "=== DRY RUN ==="
  echo "tag:     $TAG"
  echo "version: $VERSION"
  echo
  echo "=== release notes ==="
  printf '%s\n' "$NOTES"
  exit 0
fi

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "error: tag $TAG already exists locally" >&2
  exit 1
fi
if git ls-remote --tags --exit-code origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists on origin" >&2
  exit 1
fi
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "error: GitHub release $TAG already exists" >&2
  exit 1
fi

CURRENT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "warning: not on main (currently on: $CURRENT_BRANCH)" >&2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit or stash first" >&2
  exit 1
fi

echo "About to release $TAG from $(git rev-parse --short HEAD) ($CURRENT_BRANCH)"
echo
printf '%s\n' "$NOTES" | head -20
[[ "$(printf '%s\n' "$NOTES" | wc -l)" -gt 20 ]] && echo "  … (truncated)"
echo

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Proceed? [y/N] " reply
  case "$reply" in
    y|Y) ;;
    *) echo "aborted"; exit 0 ;;
  esac
fi

git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
printf '%s\n' "$NOTES" | gh release create "$TAG" --title "$TAG" --notes-file -

echo "✓ released $TAG"
echo "  https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$TAG"
