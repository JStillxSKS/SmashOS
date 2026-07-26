# Smash OS

**Linux-only** workstation OS for making Smash Drums indies.

Lightweight. Smooth. Charting-first. No Windows.

| Piece | Role |
|--------|------|
| **Smash Drums Editor** | Primary app (opens on login) |
| **Indies-DB** | Browser homepage (`https://indies-db.vercel.app`) |
| **SmashRoms + pipeline** | Audio → MIDI → `.indies` → pack → Quest push |
| **Charts home** | `~/Charts` — every song is one project folder |

## What you get

- Lean Debian (Bookworm) live/install image
- Openbox + tint2 + picom (low RAM, responsive)
- Autologin → Editor + tools dock
- Unified CLI: `smash`
- All Smash tooling under `/opt/smashos`

## Build the ISO

You need a **Linux** host (or GitHub Actions — see below). No Windows build path.

```bash
# On Debian/Ubuntu with live-build:
cd SmashOS
sudo ./build/build-iso.sh
# → dist/smashos-0.1.0-alpha-amd64.hybrid.iso
```

Or push to GitHub and let CI build (`.github/workflows/build-iso.yml`).

## First boot workflow

1. Boot ISO (live) or install to disk  
2. Login as `smash` (live password: `smash`)  
3. Editor opens; browser home is Indies-DB  
4. `smash new "Song Name"` → project under `~/Charts`  
5. `smash from-audio song.wav` or open Editor and chart  
6. `smash export` / `smash push-quest` when ready  

## Project layout on disk

```text
~/Charts/<Song Name>/
  source/     audio, covers
  midi/       intermediate MIDI
  export/     .indies packages
  work/       editor working files
  project.json
```

## Repo layout

```text
SmashOS/
  build/           ISO / chroot hooks
  tools/           rewritten Smash pipeline (Linux)
  packages/        Smash Drums Editor source (Linux electron build)
  desktop/         Openbox, tint2, autostart, .desktop files
  docs/            architecture + workflow
```

## Status

v0.1.0-alpha — full stack scaffolded for image build. ISO generation requires Linux or CI.
