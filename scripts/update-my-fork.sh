#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "Usage: bash scripts/update-my-fork.sh [--build-only | --install-only]"
  echo "Updates the current fork branch, builds macOS and an iOS device IPA, and offers to install macOS."
  echo "--build-only skips fetching and merging; --install-only uses the existing build."
  echo "The iOS IPA is written to artifacts/paseo-device-hub.ipa."
  echo "After building, you can install it directly to a connected iPad with devicectl."
  echo "Set PASEO_IOS_TEAM_ID; Xcode needs an ad hoc profile for sh.paseo with Push Notifications and the iPad UDID, plus its signing certificate."
}

mode="${1:-}"
if [[ "$mode" == "--help" || "$mode" == "-h" ]]; then usage; exit 0; fi
if [[ $# -gt 1 || ( -n "$mode" && "$mode" != "--build-only" && "$mode" != "--install-only" ) ]]; then usage >&2; exit 2; fi
if [[ "$(uname -s)" != "Darwin" ]]; then echo "This script builds the macOS app and iOS IPA." >&2; exit 1; fi
if [[ "$mode" != "--install-only" && -z "${PASEO_IOS_TEAM_ID:-}" ]]; then
  echo "Set PASEO_IOS_TEAM_ID to the 10-character Apple Developer Team ID before building the iOS IPA." >&2
  echo "Xcode also needs an ad hoc provisioning profile that includes the target iPad and a signing certificate." >&2
  exit 1
fi

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

  echo "Preparing the production iOS app and building a Release archive..."
  echo "The installed ad hoc profile must target sh.paseo, enable Push Notifications, and include the iPad UDID."
  npm run build:client
  (
    cd "$ROOT/packages/app"
    CI=1 APP_VARIANT=production npx expo prebuild --platform ios
  )

  ios_workspace="$ROOT/packages/app/ios/Paseo.xcworkspace"
  ios_scheme="Paseo"
  if [[ ! -d "$ios_workspace" ]]; then
    echo "iOS workspace not found at $ios_workspace." >&2
    exit 1
  fi

  mkdir -p "$ROOT/.dev"
  ios_workdir="$(mktemp -d "$ROOT/.dev/ios-device-hub.XXXXXX")"
  archive_path="$ios_workdir/Paseo.xcarchive"
  export_path="$ios_workdir/export"
  export_options="$ios_workdir/ExportOptions.plist"
  cat > "$export_options" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>ad-hoc</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
</dict>
</plist>
PLIST

  signing_args=("DEVELOPMENT_TEAM=$PASEO_IOS_TEAM_ID")
  xcodebuild \
    -workspace "$ios_workspace" \
    -scheme "$ios_scheme" \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$archive_path" \
    -allowProvisioningUpdates \
    "${signing_args[@]}" \
    archive
  xcodebuild \
    -allowProvisioningUpdates \
    -exportArchive \
    -archivePath "$archive_path" \
    -exportPath "$export_path" \
    -exportOptionsPlist "$export_options"

  ipa_source="$(find "$export_path" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
  if [[ -z "$ipa_source" ]]; then
    echo "Xcode completed export without producing an IPA in $export_path." >&2
    exit 1
  fi
  mkdir -p "$ROOT/artifacts"
  ipa="$ROOT/artifacts/paseo-device-hub.ipa"
  cp "$ipa_source" "$ipa"

  if command -v xcrun >/dev/null 2>&1 && xcrun devicectl list devices; then
    read -r -p "Install this IPA to a connected iPad now? [y/N] " ios_confirm
    if [[ "$ios_confirm" == "y" || "$ios_confirm" == "Y" ]]; then
      read -r -p "Enter the iPad identifier or name: " ios_device
      if [[ -z "$ios_device" ]]; then
        echo "No iPad selected; the IPA is available at $ipa."
      else
        install_dir="$ios_workdir/install"
        mkdir -p "$install_dir"
        unzip -q "$ipa" -d "$install_dir"
        app_bundle="$(find "$install_dir/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
        if [[ -z "$app_bundle" ]]; then
          echo "Could not find an app bundle inside $ipa." >&2
          exit 1
        fi
        xcrun devicectl device install app --device "$ios_device" "$app_bundle"
        echo "Installed Paseo on $ios_device."
      fi
    fi
  else
    echo "Could not list Xcode devices; the IPA is available at $ipa for Device Hub installation."
  fi

  rm -rf "$ios_workdir"
  echo "iOS Release IPA ready: $ipa"
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
