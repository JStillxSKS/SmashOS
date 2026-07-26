# Smash OS workflow

## Daily path

1. Boot Smash OS (autologin → Editor)
2. **Super+H** → Hub, or terminal:
   ```bash
   smash new "My Song"
   ```
3. Drop audio into `~/Charts/My Song/source/`
4. Generate chart seed:
   ```bash
   smash pipeline ~/Charts/My\ Song/source/drums.wav
   ```
   or chart manually in Editor
5. Export `.indies` into `export/`
6. Ship:
   ```bash
   smash pack
   smash push-quest
   smash apply-quest
   ```
7. Browse / publish: **Super+B** → Indies-DB

## Shortcuts

| Key | Action |
|-----|--------|
| Super+E | Editor |
| Super+B | Indies-DB browser |
| Super+H | Hub |
| Super+C | Charts folder |
| Super+Enter | Terminal |

## Project layout

```text
~/Charts/My Song/
  project.json
  source/     # wav/mp3/ogg, cover art
  midi/       # intermediate MIDI
  export/     # .indies + smashrom bundles
  work/       # editor scratch
```

## Commands

| Command | Does |
|---------|------|
| `smash new "Title"` | Create project, set current |
| `smash list` | List projects (`*` = current) |
| `smash open "Title"` | Switch current |
| `smash from-audio file.wav` | Audio → MIDI |
| `smash from-midi file.mid` | MIDI → `.indies` |
| `smash pipeline file.wav` | Full convert chain |
| `smash pack` | SmashRoms validate + zip |
| `smash push-quest` | adb push to headset Install |
| `smash apply-quest` | Copy Install → game Indies |
| `smash doctor` | Health check |
