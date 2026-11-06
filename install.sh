#!/bin/sh
# Installs Afterglow from its latest GitHub release:
#
#   curl -fsSL https://aryenp.github.io/afterglow/install.sh | sh
#
# What it does, in order:
#   1. Checks this is a Mac with Apple silicon on macOS 14.2 or later.
#   2. Downloads Afterglow.zip from the latest release on github.com/AryenP/afterglow.
#   3. Checks the app's code signature is intact and made with Afterglow's own signing certificate
#      (its SHA-256 is below). Anything else is not installed.
#   4. Quits Afterglow if this copy is running, puts the new one in /Applications (or
#      ~/Applications if /Applications can't be written), replacing the old copy. Settings and
#      everything it learned live elsewhere and stay.
#   5. Opens it.
#
# Why this avoids macOS's "couldn't verify" message: that check runs on apps a browser downloaded
# (they carry a quarantine flag). curl doesn't add the flag. Afterglow isn't notarized by Apple, so
# the signature check in step 3 is what stands in for it.
#
# For testing: AFTERGLOW_DEST=<folder> installs there instead, AFTERGLOW_NO_OPEN=1 doesn't open it.
# Everything runs inside main(), called on the last line, so a cut-off download runs nothing.

main() {
  set -eu
  REPO="AryenP/afterglow"
  ZIP_URL="https://github.com/$REPO/releases/latest/download/Afterglow.zip"
  # SHA-256 of the "Afterglow Local Signing" certificate (codesign -d --extract-certificates).
  # Change it only together with the signing identity (scripts/make-signing-identity.sh).
  CERT_SHA256="7bff1ef48363d83412b5adff17ae385b8efaac6950ee1e3fab1b21b3fc37202d"

  [ "$(uname -s)" = "Darwin" ] || fail "this installs the Mac app. Run it on a Mac."
  [ "$(uname -m)" = "arm64" ] || fail "Afterglow needs a Mac with Apple silicon (M1 or later)."
  version="$(sw_vers -productVersion)"
  major="${version%%.*}"
  rest="${version#*.}"
  minor="${rest%%.*}"
  [ "$rest" = "$version" ] && minor=0
  if [ "$major" -lt 14 ] || { [ "$major" -eq 14 ] && [ "$minor" -lt 2 ]; }; then
    fail "Afterglow needs macOS 14.2 or later. This Mac has $version."
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "Downloading Afterglow…"
  curl -fL --proto '=https' --tlsv1.2 --progress-bar -o "$tmp/Afterglow.zip" "$ZIP_URL" \
    || fail "couldn't download $ZIP_URL. Check the connection and try again."
  ditto -x -k "$tmp/Afterglow.zip" "$tmp/unzipped" 2>/dev/null || fail "the download isn't a complete zip. Try again."
  app="$tmp/unzipped/Afterglow.app"
  [ -d "$app" ] || fail "the download has no Afterglow.app in it."

  say "Checking the signature…"
  codesign --verify --deep --strict "$app" 2>/dev/null || fail "the app's signature doesn't check out, so it wasn't installed."
  codesign -d --extract-certificates="$tmp/cert" "$app" 2>/dev/null || true
  [ -f "$tmp/cert0" ] || fail "couldn't read the app's signing certificate, so it wasn't installed."
  [ "$(shasum -a 256 "$tmp/cert0" | cut -d ' ' -f 1)" = "$CERT_SHA256" ] \
    || fail "the app isn't signed with Afterglow's certificate, so it wasn't installed."
  new_version="$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '')"

  dest="${AFTERGLOW_DEST:-/Applications}"
  if [ -z "${AFTERGLOW_DEST:-}" ] && [ ! -w "$dest" ]; then
    dest="$HOME/Applications"
    mkdir -p "$dest"
  fi
  target="$dest/Afterglow.app"

  # Quit this copy if it's running, so it can be replaced. Another copy elsewhere is left alone.
  was_running=0
  if pgrep -f "$target/Contents/MacOS/" >/dev/null 2>&1; then
    was_running=1
    say "Quitting Afterglow to replace it…"
    osascript -e 'quit app id "xyz.afterglow.app"' >/dev/null 2>&1 || true
    i=0
    while pgrep -f "$target/Contents/MacOS/" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -le 20 ] || fail "Afterglow didn't quit. Quit it from the menu bar and run this again."
      sleep 0.5
    done
  fi

  # Swap in the new copy; put the old one back if the copy fails.
  if [ -e "$target" ]; then
    mv "$target" "$tmp/previous.app" || fail "couldn't move the old Afterglow out of $dest."
  fi
  if ! ditto "$app" "$target"; then
    rm -rf "$target"
    [ -e "$tmp/previous.app" ] && mv "$tmp/previous.app" "$target"
    fail "couldn't copy Afterglow into $dest. The old copy is back."
  fi
  xattr -dr com.apple.quarantine "$target" 2>/dev/null || true

  say "Afterglow${new_version:+ $new_version} is in $dest."
  if [ -z "${AFTERGLOW_NO_OPEN:-}" ]; then
    open "$target"
    if [ "$was_running" = 1 ]; then say "It's open again."; else say "Opening it now. Its setup takes a minute."; fi
  fi
}

say() { printf '%s\n' "$*"; }
fail() { printf 'Afterglow: %s\n' "$*" >&2; exit 1; }

main "$@"
