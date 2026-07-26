# Building Smash OS

## Requirements

- **Linux host** (Debian/Ubuntu recommended) **or** GitHub Actions  
- Root / sudo  
- ~20 GB free disk during build  
- Network (debootstrap pulls packages)

**Not supported:** building the ISO on Windows. This tree is authored anywhere; the image is produced only on Linux/CI.

## Local ISO

```bash
cd SmashOS
chmod +x build/build-iso.sh build/install-overlay.sh build/hooks/01-smashos.chroot
chmod +x tools/pipeline/smash tools/hub/smash-hub
sudo ./build/build-iso.sh
# → dist/smashos-<version>-amd64.hybrid.iso
```

Flash with Rufus (DD mode), `balenaEtcher`, or:

```bash
sudo dd if=dist/smashos-*.hybrid.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

## Overlay only (existing Debian)

On a minimal Debian/Openbox install:

```bash
sudo ./build/install-overlay.sh
sudo apt install openbox tint2 picom thunar firefox-esr python3-pip adb yad …
# or use package list as a guide
```

## CI

Push a `v*` tag or run workflow **Build Smash OS ISO** → download artifact `smashos-iso`.

## Live credentials

- User: `smash`  
- Password: `smash`  
- Change after install if you use the image as a daily driver.

## Editor binary

Chroot hook tries `electron-builder --linux`. If that fails, `smash editor` falls back to `npx electron` on the packaged source under `/opt/smashos/packages/smash-drums-editor`.
