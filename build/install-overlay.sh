#!/usr/bin/env bash
# Install Smash OS tooling + desktop into a target root (default /).
# Usage (from SmashOS repo root):
#   sudo ./build/install-overlay.sh
#   sudo ./build/install-overlay.sh /path/to/chroot
set -euo pipefail

ROOT="${1:-/}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "$REPO/VERSION" 2>/dev/null || echo dev)"

echo "==> Smash OS overlay $VERSION → $ROOT"

install -d "$ROOT/opt/smashos/tools"
install -d "$ROOT/opt/smashos/bin"
install -d "$ROOT/opt/smashos/packages"
install -d "$ROOT/opt/smashos/branding"
install -d "$ROOT/usr/local/bin"
install -d "$ROOT/usr/local/share/applications"
install -d "$ROOT/usr/local/share/smashos/branding"
install -d "$ROOT/usr/share/pixmaps"
install -d "$ROOT/etc"
install -d "$ROOT/etc/profile.d"
install -d "$ROOT/etc/firefox/policies"
install -d "$ROOT/etc/firefox-esr/policies"
install -d "$ROOT/etc/skel/.config/openbox"
install -d "$ROOT/etc/skel/.config/tint2"
install -d "$ROOT/etc/skel/.config/autostart"
install -d "$ROOT/etc/skel/Charts/Songs"
install -d "$ROOT/usr/share/xsessions"
install -d "$ROOT/usr/share/xsessions"

# Branding — Smash Drums Editor logo
if [[ -d "$REPO/branding" ]]; then
  rsync -a "$REPO/branding/" "$ROOT/opt/smashos/branding/"
  rsync -a "$REPO/branding/" "$ROOT/usr/local/share/smashos/branding/"
  # pixmaps for .desktop Icon= names
  for f in smashos-logo.png smashos-logo.svg smashos-logo.jpg smashos-logo.ico; do
    if [[ -f "$REPO/branding/$f" ]]; then
      install -m 0644 "$REPO/branding/$f" "$ROOT/usr/share/pixmaps/$f" || true
    fi
  done
fi

# Tools
rsync -a --delete \
  "$REPO/tools/audio-to-midi/" "$ROOT/opt/smashos/tools/audio-to-midi/"
rsync -a --delete \
  "$REPO/tools/midi-to-indies/" "$ROOT/opt/smashos/tools/midi-to-indies/"
rsync -a --delete \
  "$REPO/tools/smashroms/" "$ROOT/opt/smashos/tools/smashroms/"
rsync -a --delete \
  "$REPO/tools/pipeline/" "$ROOT/opt/smashos/tools/pipeline/"
rsync -a --delete \
  "$REPO/tools/hub/" "$ROOT/opt/smashos/tools/hub/"

# Editor source (built later or used for npm desktop:dev)
if [[ -d "$REPO/packages/smash-drums-editor" ]]; then
  rsync -a --delete \
    --exclude node_modules --exclude dist --exclude release --exclude android \
    "$REPO/packages/smash-drums-editor/" "$ROOT/opt/smashos/packages/smash-drums-editor/"
fi

# smash CLI
install -m 0755 "$REPO/tools/pipeline/smash" "$ROOT/opt/smashos/bin/smash"
install -m 0755 "$REPO/tools/hub/smash-hub" "$ROOT/opt/smashos/bin/smash-hub"
ln -sfn /opt/smashos/bin/smash "$ROOT/usr/local/bin/smash"
ln -sfn /opt/smashos/bin/smash-hub "$ROOT/usr/local/bin/smash-hub"

# Make python tools executable
chmod 0755 "$ROOT/opt/smashos/tools/audio-to-midi/audio_to_midi.py" || true
chmod 0755 "$ROOT/opt/smashos/tools/midi-to-indies/midi_to_smash.py" || true
chmod 0755 "$ROOT/opt/smashos/tools/smashroms/pack.py" || true
chmod 0755 "$ROOT/opt/smashos/tools/smashroms/apply-installs-quest.sh" || true

# Desktop entries
install -m 0644 "$REPO/desktop/applications/"*.desktop \
  "$ROOT/usr/local/share/applications/"

# Firefox homepage = Indies-DB
install -m 0644 "$REPO/desktop/firefox/policies.json" \
  "$ROOT/etc/firefox/policies/policies.json"
# ESR path
install -d "$ROOT/etc/firefox-esr/policies"
install -m 0644 "$REPO/desktop/firefox/policies.json" \
  "$ROOT/etc/firefox-esr/policies/policies.json"

# Openbox skel
install -m 0644 "$REPO/desktop/openbox/rc.xml" "$ROOT/etc/skel/.config/openbox/rc.xml"
install -m 0644 "$REPO/desktop/openbox/menu.xml" "$ROOT/etc/skel/.config/openbox/menu.xml"
install -m 0755 "$REPO/desktop/openbox/autostart" "$ROOT/etc/skel/.config/openbox/autostart"
install -m 0644 "$REPO/desktop/tint2/tint2rc" "$ROOT/etc/skel/.config/tint2/tint2rc"

# X session
cat > "$ROOT/usr/share/xsessions/smashos.desktop" << 'EOF'
[Desktop Entry]
Name=Smash OS
Comment=Lightweight Smash Drums charting environment
Exec=openbox-session
Type=Application
DesktopNames=Openbox
EOF

# Environment for all users
cat > "$ROOT/etc/profile.d/smashos.sh" << 'EOF'
export SMASHOS_ROOT=/opt/smashos
export PATH="/opt/smashos/bin:/usr/local/bin:$PATH"
export SMASH_CHARTS="${SMASH_CHARTS:-$HOME/Charts}"
export INDIES_DB_URL="${INDIES_DB_URL:-https://indies-db.vercel.app}"
EOF
chmod 0644 "$ROOT/etc/profile.d/smashos.sh"

# Version stamp
echo "$VERSION" > "$ROOT/opt/smashos/VERSION"
echo "Smash OS $VERSION" > "$ROOT/etc/smashos-release"

echo "==> Overlay installed."
