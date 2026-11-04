#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "Usage: bash scripts/update-my-fork.sh [--build-only | --install-only]"
  echo "Updates the current fork branch, builds for macOS, and offers to install."
  echo "--build-only skips fetching and merging; --install-only uses the existing build."
}

mode="${1:-}"
if [[ "$mode" == "--help" || "$mode" == "-h" ]]; then usage; exit 0; fi
if [[ $# -gt 1 || ( -n "$mode" && "$mode" != "--build-only" && "$mode" != "--install-only" ) ]]; then usage >&2; exit 2; fi
if [[ "$(uname -s)" != "Darwin" ]]; then echo "This script builds the macOS app." >&2; exit 1; fi

if [[ -z "$mode" ]]; then
  branch="$(git symbolic-ref --quiet --short HEAD)" || { echo "Check out your fork branch first." >&2; exit 1; }
  # Permit this new script to run before it has been added to the fork.
  changes="$(git status --porcelain --untracked-files=all | awk '$0 != "?? scripts/update-my-fork.sh"')"
  if [[ -n "$changes" ]]; then
    echo "The checkout has uncommitted or untracked changes. Save them before updating." >&2
    git status --short
    exit 1
  fi
  echo "Fetching upstream history and release tags from origin..."
  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    git fetch --unshallow --tags origin
  else
    git fetch --tags origin
  fi
  echo "Recent stable version tags:"
  git tag --list 'v[0-9]*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -20 || true
  read -r -p "Enter the upstream stable tag to merge into $branch (or press Enter to cancel): " tag
  if [[ -z "$tag" ]]; then echo "Cancelled."; exit 0; fi
  if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || ! git rev-parse --verify --quiet "refs/tags/$tag^{commit}" >/dev/null; then
    echo "That is not a locally available stable version tag." >&2; exit 1
  fi
  remote_tag="$(git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}")"
  if [[ -z "$remote_tag" ]]; then echo "The tag was not found on origin." >&2; exit 1; fi
  local_oid="$(git rev-parse "refs/tags/$tag")"
  if ! printf '%s\n' "$remote_tag" | grep -Fq "${local_oid}"; then
    echo "The local tag does not match origin; resolve the discrepancy before continuing." >&2; exit 1
  fi
  echo "This may create a local merge commit on $branch. It will not push."
  read -r -p "Merge $tag and build? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then echo "Cancelled."; exit 0; fi
  if ! git merge --no-edit "refs/tags/$tag"; then
    echo "Merge stopped. Resolve conflicts and complete the merge, then run this script with --build-only." >&2
    exit 1
  fi
fi

if [[ "$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)" != "" ]]; then
  echo "A merge is still in progress. Complete it before building." >&2; exit 1
fi
case "$(uname -m)" in
  arm64) arch=arm64; output_dir=mac-arm64 ;;
  x86_64) arch=x64; output_dir=mac ;;
  *) echo "Unsupported Mac architecture: $(uname -m)" >&2; exit 1 ;;
esac
app="$ROOT/packages/desktop/release/$output_dir/Paseo.app"
if [[ "$mode" != "--install-only" ]]; then
  echo "Installing the lockfile dependencies with npm ci..."
  npm ci
  echo "Building a locally signed app without the hardened runtime or notarization."
  CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:desktop -- --publish never --mac "--$arch" --dir \
    --config.mac.identity=- --config.mac.hardenedRuntime=false --config.mac.notarize=false
  echo "Build complete: $app"
fi
if [[ ! -d "$app" ]]; then echo "App not found at $app. Build it first." >&2; exit 1; fi
echo "This will install $app to /Applications/Paseo.app and retain the previous app as a backup."
echo "Finish any agent work and quit Paseo before installing; the script will not stop it."
read -r -p "Install the app now? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then echo "Installation skipped."; exit 0; fi
if pgrep -x Paseo >/dev/null; then
  echo "Paseo is running. Quit it when safe, then rerun with --install-only." >&2; exit 1
fi

staging="$(mktemp -d /Applications/.paseo-install.XXXXXX)"
trap 'rm -rf "$staging"' EXIT
ditto "$app" "$staging/Paseo.app"
codesign --verify --deep --strict "$staging/Paseo.app"
if pgrep -x Paseo >/dev/null; then
  echo "Paseo started during copying. Quit it when safe, then rerun with --install-only." >&2; exit 1
fi
backup=""
if [[ -e /Applications/Paseo.app || -L /Applications/Paseo.app ]]; then
  mkdir -p /Applications/.paseo-backups
  backup="$(mktemp -d /Applications/.paseo-backups/backup.XXXXXX)"
  mv /Applications/Paseo.app "$backup/Paseo.app"
fi
if ! mv "$staging/Paseo.app" /Applications/Paseo.app; then
  echo "Installation failed." >&2
  if [[ -n "$backup" ]]; then
    if mv "$backup/Paseo.app" /Applications/Paseo.app; then
      echo "Restored the previous app." >&2
    else
      echo "Restore the previous app manually from $backup/Paseo.app." >&2
    fi
  fi
  exit 1
fi
echo "Installed /Applications/Paseo.app."
if [[ -n "$backup" ]]; then echo "Previous app saved at $backup/Paseo.app"; fi
