# Smash OS on a Chromebook

Smash OS is a **Debian amd64 (x86_64) hybrid ISO**. That matters a lot for Chromebooks.

## Will it boot?

| Chromebook CPU | Chance |
|----------------|--------|
| **Intel / AMD (x86_64)** | Possible *if* firmware allows USB boot of generic Linux |
| **ARM (MediaTek, Qualcomm, some Rockchip)** | **No** — this ISO will not boot. Needs a separate arm64 image (not built yet). |

Check model: ChromeOS Settings → About ChromeOS → detailed build information, or look up the board name (e.g. `octopus`, `hatch`, `corsola`). ARM boards cannot run this ISO.

## ChromeOS will not install this like Windows

Stock ChromeOS **will not** “Install Smash OS” from a USB the way a PC does. Typical path:

1. **Enable Developer Mode** (wipes local ChromeOS data — back up first).
2. **Disable verified boot / install RW_LEGACY or full UEFI** (often [MrChromebox](https://mrchromebox.tech) firmware — model-dependent, risk of bricking if wrong).
3. Boot USB from the firmware boot menu (usually Esc+Refresh+Power or similar for recovery; firmware menu varies).
4. Install Debian-style to internal storage **or** run live from USB.

Some devices only get a limited SeaBIOS payload and still fight Wi‑Fi/audio. Treat Chromebook install as **advanced**.

## Safer alternatives for a “little Chromebook”

- **Crostini (Linux container)** on ChromeOS — run Editor tooling in a container, *not* full Smash OS desktop.
- Use a **cheap Intel mini-PC / old laptop** for Smash OS; keep Chromebook for browser-only Indies-DB.
- If the Chromebook is **Intel**, MrChromebox + this USB is the realistic path after Dev Mode.

## This USB image

When flashing succeeds, the stick is a standard **hybrid ISO** (BIOS + UEFI). That is correct for PCs and for Chromebooks that already boot generic Linux. It is **not** a ChromeOS recovery image and does not install through the ChromeOS recovery utility.
