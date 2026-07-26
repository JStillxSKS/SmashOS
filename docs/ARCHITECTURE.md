# Smash OS Architecture

## Goals

- **Linux only** — no Windows dependency, ever
- **Lightweight** — Openbox + tint2 + picom, not GNOME/KDE
- **Smooth** — editor and pipeline stay responsive; no OS tax
- **Complete tooling** — every Smash Drums charting tool ships in-tree
- **One workflow** — boot → chart → export → Quest / Indies-DB

## Layers

```text
┌─────────────────────────────────────────────┐
│  Session: LightDM → Openbox (smashos)       │
│  Autostart: tint2, Editor, nm-applet        │
├─────────────────────────────────────────────┤
│  Hub / CLI: smash, smash-hub (yad)          │
├─────────────────────────────────────────────┤
│  Apps: Editor (Electron), Firefox (Indies-DB)│
├─────────────────────────────────────────────┤
│  Tools @ /opt/smashos/tools                 │
│   audio-to-midi · midi-to-indies · smashroms│
├─────────────────────────────────────────────┤
│  Data: ~/Charts/<Song>/…                    │
├─────────────────────────────────────────────┤
│  Debian Bookworm live/install rootfs        │
└─────────────────────────────────────────────┘
```

## Paths

| Path | Purpose |
|------|---------|
| `/opt/smashos` | OS tooling root |
| `/opt/smashos/bin/smash` | Unified CLI |
| `/opt/smashos/packages/smash-drums-editor` | Editor source + Linux build |
| `~/Charts` | All chart projects |
| `~/.config/smashos/current-project` | Active project pointer |
| `/etc/firefox-esr/policies/policies.json` | Homepage → Indies-DB |

## Performance defaults

- `apt-recommends false` on image build
- `vm.swappiness=10`
- No Bluetooth/CUPS by default
- Browser not auto-started (Super+B)
- Editor delayed ~600ms after panel so first paint is clean
- Optional picom vsync; fails soft if compositor unavailable

## Image build

1. `install-overlay.sh` stages files into chroot includes  
2. `live-build` installs package list  
3. chroot hook builds venv, optional Editor Linux binary, autologin  
4. Output: `dist/smashos-<version>-amd64.hybrid.iso`

CI: GitHub Actions `build-iso.yml` (Ubuntu runner + live-build).
