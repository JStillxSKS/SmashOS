# Smash OS tools

All charting tooling lives here and is installed to `/opt/smashos/tools` on the image.

| Path | Role |
|------|------|
| `pipeline/smash` | Unified CLI + workflow hub entry |
| `hub/smash-hub` | Lightweight GUI (yad) |
| `audio-to-midi/` | Drum-first audio → GM MIDI |
| `midi-to-indies/` | MIDI → `.indies` + editor folders |
| `smashroms/pack.py` | Validate + pack ship bundles |
| `smashroms/apply-installs-quest.sh` | On-device Install → game Indies |
| `requirements.txt` | Python deps for the pipeline |

On Smash OS, invoke via `smash …` only — paths stay consistent.
