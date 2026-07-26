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
  rsync git ca-certificates curl wget gnupg dpkg-dev

# Ubuntu runners ship a stale debian-archive-keyring → debootstrap fails on bookworm.
# Install the current keyring .deb straight from Debian.
KEYRING_DEB_URL="${DEBIAN_ARCHIVE_KEYRING_DEB:-http://deb.debian.org/debian/pool/main/d/debian-archive-keyring/debian-archive-keyring_2025.1_all.deb}"
echo "==> Installing current Debian archive keyring"
wget -q -O /tmp/debian-archive-keyring.deb "$KEYRING_DEB_URL" \
  || wget -q -O /tmp/debian-archive-keyring.deb "https://deb.debian.org/debian/pool/main/d/debian-archive-keyring/debian-archive-keyring_2025.1_all.deb"
dpkg -i /tmp/debian-archive-keyring.deb || apt-get install -f -y -qq
# Also import release keys into a dedicated keyring for debootstrap
mkdir -p /etc/apt/trusted.gpg.d
if [[ -f /usr/share/keyrings/debian-archive-keyring.gpg ]]; then
  cp -f /usr/share/keyrings/debian-archive-keyring.gpg /etc/apt/trusted.gpg.d/debian-archive-keyring.gpg || true
fi

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"
cd "$WORK"

# Force Debian mode even when the host is Ubuntu (GitHub Actions runners)
lb config \
  --mode debian \
  --distribution "$DISTRO" \
  --architectures "$ARCH" \
  --binary-images iso-hybrid \
  --archive-areas "main contrib non-free non-free-firmware" \
  --mirror-bootstrap "http://deb.debian.org/debian/" \
  --mirror-chroot "http://deb.debian.org/debian/" \
  --mirror-binary "http://deb.debian.org/debian/" \
  --keyring-packages "debian-archive-keyring" \
  --apt-options "--yes --option Acquire::Check-Valid-Until=false" \
  --debootstrap-options "--keyring=/usr/share/keyrings/debian-archive-keyring.gpg --variant=minbase" \
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
