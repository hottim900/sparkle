#!/usr/bin/env bash
#
# Cut a GitHub Release for a Sparkle version.
# Reads CHANGELOG.md, extracts the section matching the version, creates an
# annotated git tag at the target commit, pushes it, and creates the matching
# GitHub Release with those notes.
#
# Usage:
#   scripts/release.sh                          # version=$(cat VERSION), sha=HEAD, interactive
#   scripts/release.sh --yes                    # skip confirmation (use from /ship)
#   scripts/release.sh --dry-run                # print extracted notes only, no side effects
#   scripts/release.sh --version=1.4.5.0        # override version (skip VERSION file read)
#   scripts/release.sh --sha=abc1234            # tag a historical commit (for backfill)
#
# Run from a clean main checkout AFTER the version-bump PR has been merged
# (unless --version + --sha are both supplied to backfill historical releases).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

DRY_RUN=0
ASSUME_YES=0
VERSION_OVERRIDE=""
SHA_OVERRIDE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=1 ;;
    --yes|-y)         ASSUME_YES=1 ;;
    --version=*)      VERSION_OVERRIDE="${arg#*=}" ;;
    --sha=*)          SHA_OVERRIDE="${arg#*=}" ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0 ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2 ;;
  esac
done

if [[ ! -f CHANGELOG.md ]]; then
  echo "error: CHANGELOG.md not found at repo root" >&2
  exit 1
fi

if [[ -n "$VERSION_OVERRIDE" ]]; then
  VERSION="$VERSION_OVERRIDE"
else
  if [[ ! -f VERSION ]]; then
    echo "error: VERSION file not found at repo root" >&2
    exit 1
  fi
  VERSION="$(tr -d '[:space:]' < VERSION)"
  if [[ -z "$VERSION" ]]; then
    echo "error: VERSION file is empty" >&2
    exit 1
  fi
fi
TAG="v${VERSION}"

if [[ -n "$SHA_OVERRIDE" ]]; then
  if ! TARGET_SHA="$(git rev-parse --verify --quiet "${SHA_OVERRIDE}^{commit}")"; then
    echo "error: invalid commit ref: $SHA_OVERRIDE" >&2
    exit 1
  fi
else
  TARGET_SHA="$(git rev-parse HEAD)"
fi
SHORT_SHA="$(git rev-parse --short "$TARGET_SHA")"

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
  echo "target:  $SHORT_SHA"
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
if [[ -z "$SHA_OVERRIDE" && "$CURRENT_BRANCH" != "main" ]]; then
  echo "warning: not on main (currently on: $CURRENT_BRANCH)" >&2
fi
# Dirty-tree check only matters when reading VERSION/CHANGELOG from working tree.
if [[ -z "$VERSION_OVERRIDE" && -n "$(git status --porcelain VERSION CHANGELOG.md 2>/dev/null)" ]]; then
  echo "error: VERSION or CHANGELOG.md is dirty; commit or stash first" >&2
  exit 1
fi

echo "About to release $TAG at $SHORT_SHA"
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

git tag -a "$TAG" -m "$TAG" "$TARGET_SHA"
git push origin "$TAG"
printf '%s\n' "$NOTES" | gh release create "$TAG" --title "$TAG" --notes-file - --target "$TARGET_SHA"

echo "✓ released $TAG"
echo "  https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$TAG"
