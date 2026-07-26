# Tools inventory (what ships in Smash OS)

## First-class (in-tree, Linux)

| Tool | Origin | Status |
|------|--------|--------|
| Smash Drums Editor | packages/smash-drums-editor | Linux electron-builder target added |
| Indies-DB homepage | firefox policies → indies-db.vercel.app | Configured |
| AudioToMidi | tools/audio-to-midi | Paths rewritten for ~/Charts + /opt |
| MidiToSmashIndies | tools/midi-to-indies | Paths rewritten for ~/Charts |
| SmashRoms pack | tools/smashroms/pack.py | New Linux pack/validate |
| Quest apply installs | tools/smashroms/apply-installs-quest.sh | From SmashIndiesApp |
| Unified CLI | tools/pipeline/smash | New |
| Hub GUI | tools/hub/smash-hub | New |
| ADB platform tools | package `adb` / android-tools-adb | Image package list |

## Adjacent (available on host projects, optional later ports)

| Tool | Notes |
|------|--------|
| SmashIndiesApp (Quest APK) | Sideload separately; OS pushes maps into its Install path |
| SmashIndiesLibrary (site source) | Production is Indies-DB; browser opens live site |
| SmashDrumsMod score bot | Server-side (Render); not desktop-critical |
| dig-captures / log tools | Dev forensics; not on critical charting path |

Rewrite rule: anything required for day-to-day indies creation must run natively on Linux under `smash`.
