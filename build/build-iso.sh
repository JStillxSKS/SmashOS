#!/usr/bin/env bash
# Build Smash OS hybrid ISO with Debian live-build.
# Requires: Debian/Ubuntu host, live-build, debootstrap, rsync, squashfs-tools
# Usage: sudo ./build/build-iso.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "$REPO/VERSION" | tr -d '[:space:]')"
WORK="${SMASHOS_BUILD_DIR:-$REPO/build/work}"
OUT="${SMASHOS_DIST:-$REPO/dist}"
ARCH="${SMASHOS_ARCH:-amd64}"
DISTRO="${SMASHOS_DISTRO:-bookworm}"

echo "==> Smash OS $VERSION ISO build"
echo "    work=$WORK out=$OUT arch=$ARCH distro=$DISTRO"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  live-build debootstrap squashfs-tools xorriso isolinux syslinux-common \
  rsync git ca-certificates curl

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"
cd "$WORK"

lb config \
  --distribution "$DISTRO" \
  --architectures "$ARCH" \
  --binary-images iso-hybrid \
  --archive-areas "main contrib non-free non-free-firmware" \
  --debian-installer none \
  --bootappend-live "boot=live components quiet splash username=smash hostname=smashos" \
  --iso-application "Smash OS" \
  --iso-preparer "Smash OS" \
  --iso-publisher "Smash OS" \
  --iso-volume "SMASHOS_${VERSION}" \
  --memtest none \
  --apt-indices false \
  --apt-recommends false

# Package list
mkdir -p config/package-lists
cp "$REPO/build/package-lists/smashos.list.chroot" config/package-lists/smashos.list.chroot

# Includes (overlay files)
mkdir -p config/includes.chroot
# Stage overlay into a temp root then rsync
STAGE="$WORK/stage-overlay"
rm -rf "$STAGE"
mkdir -p "$STAGE"
"$REPO/build/install-overlay.sh" "$STAGE"
rsync -a "$STAGE"/ config/includes.chroot/

# Hooks
mkdir -p config/hooks/normal
cp "$REPO/build/hooks/01-smashos.chroot" config/hooks/normal/9999-smashos.hook.chroot
chmod +x config/hooks/normal/9999-smashos.hook.chroot

# Prefer noninteractive
export DEBIAN_FRONTEND=noninteractive

lb build 2>&1 | tee "$OUT/build.log"

mkdir -p "$OUT"
ISO_SRC=$(ls -1 live-image-*.hybrid.iso 2>/dev/null | head -1 || true)
if [[ -z "${ISO_SRC:-}" ]]; then
  ISO_SRC=$(ls -1 *.iso 2>/dev/null | head -1 || true)
fi
if [[ -n "${ISO_SRC:-}" && -f "$ISO_SRC" ]]; then
  DEST="$OUT/smashos-${VERSION}-${ARCH}.hybrid.iso"
  cp -f "$ISO_SRC" "$DEST"
  sha256sum "$DEST" | tee "$DEST.sha256"
  echo "==> ISO ready: $DEST"
else
  echo "ERROR: ISO not found after lb build. See $OUT/build.log" >&2
  exit 1
fi
