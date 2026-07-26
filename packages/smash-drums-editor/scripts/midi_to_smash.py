#!/usr/bin/env python3
"""
MIDI drums → Smash Drums Editor chart converter.

Converts General MIDI drum tracks into:
  - .indies package (meta.json + optional audio/cover/preview)
  - meta.json, notes.chart, song.ini folder for editing

Examples:
  python midi_to_smash.py song_drums.mid
  python midi_to_smash.py song_drums.mid --audio song.ogg
  python midi_to_smash.py a.mid b.mid --out "C:\\Charts"
  python midi_to_smash.py drums.mid --artist "Black Sabbath" --title "Paranoid" --charter "Me"
  python midi_to_smash.py drums.mid --offset 0.05 --bpm 163
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import wave
import zipfile
from collections import defaultdict
from pathlib import Path

# Optional deps — only required for audio/cover packaging
try:
    import mido
except ImportError:
    print("Missing dependency: mido\n  pip install mido", file=sys.stderr)
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

try:
    import soundfile as sf
except ImportError:
    sf = None  # type: ignore

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = ImageDraw = ImageFont = None  # type: ignore

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
# Prefer the Desktop "Smash Drums Editor\output" used by the app
DEFAULT_OUTPUT = Path.home() / "Desktop" / "Smash Drums Editor" / "output"
if not DEFAULT_OUTPUT.parent.exists():
    DEFAULT_OUTPUT = SCRIPT_DIR.parent / "output"

# GM percussion → Smash instrument Id
# 0 Kick | 1 Snare | 2 Cymbal | 3 Tom | 4 Hi-hat | 5 Clapfire
GM_TO_SMASH: dict[int, int] = {
    35: 0,  # Acoustic Bass Drum
    36: 0,  # Bass Drum 1
    37: 1,  # Side Stick → snare-ish
    38: 1,  # Acoustic Snare
    39: 5,  # Hand Clap → clapfire
    40: 1,  # Electric Snare
    41: 3,  # Low Floor Tom
    42: 4,  # Closed Hi-Hat
    43: 3,  # High Floor Tom
    44: 4,  # Pedal Hi-Hat
    45: 3,  # Low Tom
    46: 4,  # Open Hi-Hat
    47: 3,  # Low-Mid Tom
    48: 3,  # Hi-Mid Tom
    49: 2,  # Crash Cymbal 1
    50: 3,  # High Tom
    51: 2,  # Ride Cymbal 1
    52: 2,  # Chinese Cymbal
    53: 2,  # Ride Bell
    54: 5,  # Tambourine → clapfire
    55: 2,  # Splash Cymbal
    56: 5,  # Cowbell → clapfire
    57: 2,  # Crash Cymbal 2
    59: 2,  # Ride Cymbal 2
}

SMASH_NAMES = {0: "Kick", 1: "Snare", 2: "Cymbal", 3: "Tom", 4: "Hi-hat", 5: "Clapfire"}
GM_NAMES = {
    35: "Acoustic BD",
    36: "Bass Drum 1",
    37: "Side Stick",
    38: "Acoustic Snare",
    39: "Hand Clap",
    40: "Electric Snare",
    41: "Low Floor Tom",
    42: "Closed HH",
    43: "High Floor Tom",
    44: "Pedal HH",
    45: "Low Tom",
    46: "Open HH",
    47: "Low-Mid Tom",
    48: "Hi-Mid Tom",
    49: "Crash 1",
    50: "High Tom",
    51: "Ride 1",
    52: "Chinese",
    53: "Ride Bell",
    54: "Tambourine",
    55: "Splash",
    56: "Cowbell",
    57: "Crash 2",
    59: "Ride 2",
}

RESOLUTION = 480
BEATS_PER_MEASURE = 4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def vel_to_strength(vel: int) -> int:
    if vel < 70:
        return 0
    if vel > 110:
        return 2
    return 1


def quantize_beat(beat: float) -> float:
    return int(round(beat * RESOLUTION)) / RESOLUTION


def sort_notes(notes: list[dict]) -> list[dict]:
    return sorted(notes, key=lambda n: (n["Beat"], n["Id"], n["Strength"]))


def dedupe_notes(notes: list[dict]) -> list[dict]:
    best: dict[tuple, dict] = {}
    for n in notes:
        key = (n["Beat"], n["Id"])
        if key not in best or n["Strength"] > best[key]["Strength"]:
            best[key] = n
    return sort_notes(list(best.values()))


def beat_to_tick(beat: float) -> int:
    return int(round(beat * RESOLUTION))


def beat_in_measure(beat: float) -> float:
    m = beat % BEATS_PER_MEASURE
    return m + BEATS_PER_MEASURE if m < 0 else m


def is_on_beat(beat: float) -> bool:
    n = beat_in_measure(beat)
    return abs(n - round(n)) < 1e-6 and round(n) % 2 == 0


def is_off_beat(beat: float) -> bool:
    n = beat_in_measure(beat)
    return abs(n - round(n)) < 1e-6 and round(n) % 2 == 1


def simplify_id(diff: str, id_: int) -> int:
    if diff == "easy" and id_ in (3, 4, 5):
        return 2
    if diff == "normal" and id_ == 4:
        return 3
    return id_


def apply_density_gate(
    diff: str, beat: float, tick_delta: int, on_beat: bool, off_beat: bool
) -> tuple[bool, bool, bool]:
    on, off = on_beat, off_beat
    if diff == "easy" and tick_delta > RESOLUTION * 3 and not off:
        on = True
    if diff == "normal" and tick_delta > RESOLUTION * 2 and not off:
        on = True
    if diff == "hard" and tick_delta >= RESOLUTION and not off:
        on = True
    if diff == "hard":
        n = beat_in_measure(beat)
        if abs(n * 2 - round(n * 2)) < 1e-6:
            on = True
    return on, off, (not on and not off)


def pick_notes_at_beat(
    diff: str, beat: float, notes: list[dict], on_beat: bool, off_beat: bool
) -> list[dict]:
    sorted_n = sorted(notes, key=lambda n: n["Id"])
    downbeat = abs(beat_in_measure(beat)) < 1e-6
    kick = 0

    def copy_note(note: dict, id_: int) -> dict:
        return {"Beat": note["Beat"], "Id": id_, "Strength": note["Strength"]}

    if diff == "easy":
        if not on_beat:
            return []
        for note in sorted_n:
            if note["Id"] == kick and downbeat:
                return [copy_note(note, kick)]
        first = next((n for n in sorted_n if n["Id"] != kick), sorted_n[0] if sorted_n else None)
        if not first:
            return []
        return [copy_note(first, simplify_id(diff, first["Id"]))]

    if diff == "normal":
        if on_beat:
            for note in sorted_n:
                if note["Id"] == kick and downbeat:
                    return [copy_note(note, kick)]
            first = next(
                (n for n in sorted_n if n["Id"] != kick), sorted_n[0] if sorted_n else None
            )
            if not first:
                return []
            return [copy_note(first, simplify_id(diff, first["Id"]))]
        if off_beat:
            ret = []
            for note in sorted_n:
                if note["Id"] == kick:
                    continue
                ret.append(copy_note(note, simplify_id(diff, note["Id"])))
                if len(ret) >= 2:
                    break
            return ret
        return []

    if on_beat:
        ret = []
        for note in sorted_n:
            if note["Id"] == kick:
                ret.append(copy_note(note, kick))
                break
        for note in sorted_n:
            if note["Id"] == kick:
                continue
            ret.append(copy_note(note, note["Id"]))
            break
        if not ret and sorted_n:
            return [copy_note(sorted_n[0], sorted_n[0]["Id"])]
        return ret
    if off_beat:
        non_kick = [n for n in sorted_n if n["Id"] != kick]
        pool = non_kick if len(sorted_n) > 2 else sorted_n
        return [copy_note(n, n["Id"]) for n in pool[:2]]
    return []


def downchart(extreme: list[dict], diff: str) -> list[dict]:
    by_tick: dict[int, list[dict]] = defaultdict(list)
    for note in extreme:
        by_tick[beat_to_tick(note["Beat"])].append(note)
    out: list[dict] = []
    prev_tick = 0
    for tick in sorted(by_tick):
        beat = tick / RESOLUTION
        tick_delta = tick - prev_tick
        on, off, skip = apply_density_gate(
            diff, beat, tick_delta, is_on_beat(beat), is_off_beat(beat)
        )
        if skip:
            continue
        picked = pick_notes_at_beat(diff, beat, by_tick[tick], on, off)
        out.extend(picked)
        if picked:
            prev_tick = tick
    return sort_notes(out)


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or "Untitled Song"


def guess_meta_from_filename(path: Path) -> tuple[str, str]:
    """
    Heuristic title/artist from common demucs / stem naming:
      Artist__Song_drums_....mid
      Artist - Song.mid
      Song.mid
    """
    stem = path.stem
    # strip trailing _drums / _drum / timestamp junk
    stem = re.sub(r"_(drums?|drum|percussion)(_\d+)?$", "", stem, flags=re.I)
    stem = re.sub(r"_\d{10,}$", "", stem)

    if "__" in stem:
        artist, title = stem.split("__", 1)
        return artist.replace("_", " ").strip(), title.replace("_", " ").strip()
    if " - " in stem:
        left, right = stem.split(" - ", 1)
        return left.strip(), right.strip()
    return "Unknown Artist", stem.replace("_", " ").strip()


# ---------------------------------------------------------------------------
# MIDI parse
# ---------------------------------------------------------------------------

def build_song_timing(bpm: float, end_beat: float) -> list[dict]:
    """Constant-tempo map matching Smash Drums Editor (beat 0, 1, end)."""
    spb = 60.0 / bpm
    end = max(4.0, quantize_beat(end_beat))
    return [
        {"beat": 0, "timer": 0.0},
        {"beat": 1, "timer": spb},
        {"beat": end, "timer": end * spb},
    ]


def parse_midi(path: Path, bpm_override: float | None = None) -> dict:
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat
    tempo_events: list[tuple[int, int]] = [(0, 500000)]
    notes_raw: list[tuple[int, int, int]] = []

    for track in mid.tracks:
        abs_tick = 0
        for msg in track:
            abs_tick += msg.time
            if msg.type == "set_tempo":
                tempo_events.append((abs_tick, msg.tempo))
            elif msg.type == "note_on" and msg.velocity > 0:
                notes_raw.append((abs_tick, msg.note, msg.velocity))

    tempo_events.sort(key=lambda x: x[0])
    tempo_map: list[tuple[int, int]] = []
    for t, tempo in tempo_events:
        if tempo_map and tempo_map[-1][0] == t:
            tempo_map[-1] = (t, tempo)
        else:
            tempo_map.append((t, tempo))

    def tick_to_seconds(tick: int) -> float:
        sec = 0.0
        cur_tempo = tempo_map[0][1]
        prev = 0
        for t, tempo in tempo_map:
            if t >= tick:
                break
            sec += (t - prev) * (cur_tempo / 1_000_000.0) / tpb
            prev = t
            cur_tempo = tempo
        sec += (tick - prev) * (cur_tempo / 1_000_000.0) / tpb
        return sec

    midi_bpm = 60_000_000.0 / tempo_map[0][1]
    bpm = float(bpm_override) if bpm_override else midi_bpm

    extreme: list[dict] = []
    unmapped: dict[int, int] = defaultdict(int)
    gm_counts: dict[int, int] = defaultdict(int)
    # wall-clock seconds for kick/snare (alignment)
    align_times: list[float] = []

    for tick, note, vel in notes_raw:
        gm_counts[note] += 1
        smash_id = GM_TO_SMASH.get(note)
        if smash_id is None:
            unmapped[note] += 1
            continue
        beat = quantize_beat(tick / tpb)
        extreme.append(
            {"Beat": float(beat), "Id": smash_id, "Strength": vel_to_strength(vel)}
        )
        if note in (35, 36, 38, 40):  # kick / snare for alignment
            align_times.append(tick_to_seconds(tick))

    extreme = dedupe_notes(extreme)
    last_beat = extreme[-1]["Beat"] if extreme else 0.0
    last_tick = max((t for t, _, _ in notes_raw), default=0)
    midi_duration = tick_to_seconds(last_tick)
    duration_sec = last_beat * 60.0 / bpm if bpm > 0 else midi_duration
    song_timing = build_song_timing(bpm, last_beat + 4)

    return {
        "bpm": int(round(bpm)),
        "bpm_float": bpm,
        "midi_bpm": midi_bpm,
        "tpb": tpb,
        "extreme": extreme,
        "unmapped": dict(unmapped),
        "gm_counts": dict(gm_counts),
        "duration_sec": duration_sec,
        "midi_duration_sec": midi_duration,
        "last_beat": last_beat,
        "song_timing": song_timing,
        "note_count_raw": len(notes_raw),
        "align_times": align_times,
        "tempo_map": tempo_map,
    }


def align_midi_to_audio(
    align_times: list[float],
    midi_bpm: float,
    audio_path: Path,
    bpm_hint: float | None = None,
) -> dict | None:
    """
    Find BPM + lag so MIDI kick/snare line up with audio onsets.
    Returns {bpm, lag_sec, score} or None if deps/audio missing / score too weak.
    audio_time ≈ midi_time * (midi_bpm / bpm) + lag_sec
    """
    if sf is None or np is None or not align_times:
        return None
    try:
        data, sr = sf.read(str(audio_path), always_2d=True)
    except Exception:
        return None

    mono = data.mean(axis=1).astype(np.float32)
    hop = max(1, int(sr * 0.01))
    n = len(mono) // hop
    if n < 100:
        return None
    frames = mono[: n * hop].reshape(n, hop)
    env = np.sqrt((frames * frames).mean(axis=1))
    nov = np.maximum(0.0, np.diff(env, prepend=env[0]))
    peak = float(nov.max()) or 1.0
    nov = nov / peak
    audio_dur = len(mono) / float(sr)

    # Use early/mid hits for a stable lock (skip extreme tail)
    times = np.array(align_times, dtype=np.float64)
    if len(times) > 500:
        times = times[:500]

    def score(lag: float, bpm: float) -> float:
        scale = midi_bpm / bpm
        mt = times * scale + lag
        idx = np.round(mt / 0.01).astype(np.int64)
        valid = (idx >= 0) & (idx < len(nov)) & (mt < audio_dur)
        idx = idx[valid]
        if len(idx) < 20:
            return 0.0
        total = 0.0
        for i in idx:
            lo = max(0, int(i) - 3)
            hi = min(len(nov), int(i) + 4)
            total += float(nov[lo:hi].max())
        return total / len(idx)

    center = float(bpm_hint) if bpm_hint else midi_bpm
    bpm_lo = max(60.0, center - 12.0)
    bpm_hi = min(280.0, center + 12.0)

    best = (0.0, 0.0, midi_bpm)  # score, lag, bpm
    for bpm in np.linspace(bpm_lo, bpm_hi, 49):
        for lag in np.linspace(-1.0, 8.0, 181):
            sc = score(float(lag), float(bpm))
            if sc > best[0]:
                best = (sc, float(lag), float(bpm))

    # Refine around best
    sc0, lag0, bpm0 = best
    for bpm in np.linspace(bpm0 - 0.6, bpm0 + 0.6, 25):
        if bpm <= 0:
            continue
        for lag in np.linspace(lag0 - 0.08, lag0 + 0.08, 33):
            sc = score(float(lag), float(bpm))
            if sc > best[0]:
                best = (sc, float(lag), float(bpm))

    baseline = score(0.0, midi_bpm)
    sc, lag, bpm = best
    # Require a meaningful improvement over naive MIDI tempo @ 0 lag
    if sc < 0.25 or sc < baseline * 1.05:
        return {
            "bpm": midi_bpm,
            "lag_sec": 0.0,
            "score": sc,
            "baseline": baseline,
            "accepted": False,
        }

    return {
        "bpm": bpm,
        "lag_sec": lag,
        "score": sc,
        "baseline": baseline,
        "accepted": True,
    }


def apply_timing_fix(
    notes: list[dict],
    *,
    bpm: float,
    beat_shift: float = 0.0,
) -> tuple[list[dict], list[dict], float, float]:
    """Shift notes by beat_shift, rebuild SongTiming. Returns notes, timing, last_beat, duration."""
    shifted = []
    for n in notes:
        b = quantize_beat(n["Beat"] + beat_shift)
        if b < 0:
            continue
        shifted.append({"Beat": float(b), "Id": n["Id"], "Strength": n["Strength"]})
    shifted = sort_notes(shifted)
    last_beat = shifted[-1]["Beat"] if shifted else 0.0
    timing = build_song_timing(bpm, last_beat + 4)
    duration = last_beat * 60.0 / bpm if bpm > 0 else 0.0
    return shifted, timing, last_beat, duration


# ---------------------------------------------------------------------------
# Serialize
# ---------------------------------------------------------------------------

def format_meta(meta: dict) -> str:
    def fmt_beat(b: float) -> str:
        return f"{b:.1f}" if float(b).is_integer() else str(b)

    def fmt_timer(t: float) -> str:
        return "0.0" if t == 0 else str(t)

    def note_block(notes: list[dict]) -> str:
        if not notes:
            return "[]"
        lines = ["["]
        for i, n in enumerate(notes):
            comma = "," if i < len(notes) - 1 else ""
            lines += [
                "        {",
                f'            "Beat": {fmt_beat(n["Beat"])},',
                f'            "Strength": {n["Strength"]},',
                f'            "Id": {n["Id"]}',
                f"        }}{comma}",
            ]
        lines.append("    ]")
        return "\n".join(lines)

    def timing_block(anchors: list[dict]) -> str:
        lines = ["["]
        for i, a in enumerate(anchors):
            comma = "," if i < len(anchors) - 1 else ""
            b = a["beat"]
            b_s = str(int(b)) if float(b).is_integer() else str(b)
            lines += [
                "        {",
                f'            "beat": {b_s},',
                f'            "timer": {fmt_timer(a["timer"])}',
                f"        }}{comma}",
            ]
        lines.append("    ]")
        return "\n".join(lines)

    def phase_block(phases: list[dict]) -> str:
        if not phases:
            return "[]"
        lines = ["["]
        for i, p in enumerate(phases):
            comma = "," if i < len(phases) - 1 else ""
            lines += [
                "        {",
                f'            "beat": {fmt_beat(p["beat"])},',
                f'            "phase": {p["phase"]},',
                f'            "power": {p["power"]},',
                f'            "phaseName": {json.dumps(p["phaseName"])}',
                f"        }}{comma}",
            ]
        lines.append("    ]")
        return "\n".join(lines)

    offset = meta["SongOffsetSeconds"]
    offset_s = f"{offset:.1f}" if float(offset).is_integer() else str(offset)

    return "\n".join(
        [
            "{",
            f'    "NameArtist": {json.dumps(meta["NameArtist"])},',
            f'    "NameSong": {json.dumps(meta["NameSong"])},',
            f'    "NameCharter": {json.dumps(meta["NameCharter"])},',
            f'    "FilePath": {json.dumps(meta["FilePath"])},',
            f'    "SongOffsetSeconds": {offset_s},',
            f'    "SongTiming": {timing_block(meta["SongTiming"])},',
            f'    "SongPhases": {phase_block(meta["SongPhases"])},',
            f'    "ChartEasy": {note_block(meta["ChartEasy"])},',
            f'    "ChartNormal": {note_block(meta["ChartNormal"])},',
            f'    "ChartHard": {note_block(meta["ChartHard"])},',
            f'    "ChartExtreme": {note_block(meta["ChartExtreme"])}',
            "}",
            "",
        ]
    )


def write_chart_file(path: Path, meta: dict, bpm: int) -> None:
    lines = [
        "[Song]",
        "{",
        f'  Name = "{meta["NameSong"]}"',
        f'  Artist = "{meta["NameArtist"]}"',
        f'  Charter = "{meta["NameCharter"]}"',
        "  Offset = 0",
        f"  Resolution = {RESOLUTION}",
        "  Player2 = bass",
        "  Difficulty = 0",
        "  PreviewStart = 0",
        "  PreviewEnd = 0",
        '  Genre = "rock"',
        '  MediaType = "cd"',
        '  MusicStream = "song.ogg"',
        "}",
        "[SyncTrack]",
        "{",
        "  0 = TS 4",
        f"  0 = B {int(bpm * 1000)}",
        "}",
        "[Events]",
        "{",
        '  0 = E "section Intro"',
        "}",
    ]

    def smash_to_ch(id_: int) -> list[tuple[int, bool]]:
        return {
            0: [(0, False)],
            1: [(1, False)],
            2: [(3, True)],
            3: [(4, False)],
            4: [(2, True)],
        }.get(id_, [])

    for name, notes in (
        ("EasyDrums", meta["ChartEasy"]),
        ("MediumDrums", meta["ChartNormal"]),
        ("HardDrums", meta["ChartHard"]),
        ("ExpertDrums", meta["ChartExtreme"]),
    ):
        lines += [f"[{name}]", "{"]
        by_tick: dict[int, list[dict]] = defaultdict(list)
        for n in notes:
            by_tick[beat_to_tick(n["Beat"])].append(n)
        for tick in sorted(by_tick):
            seen: set[tuple[int, bool]] = set()
            for n in by_tick[tick]:
                for lane, is_cym in smash_to_ch(n["Id"]):
                    key = (lane, is_cym)
                    if key in seen:
                        continue
                    seen.add(key)
                    lines.append(f"  {tick} = N {lane} 0")
                    if is_cym:
                        lines.append(f"  {tick} = N {lane + 64} 0")
        lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_song_ini(path: Path, meta: dict, duration: float) -> None:
    path.write_text(
        f"""[song]
name = {meta['NameSong']}
artist = {meta['NameArtist']}
charter = {meta['NameCharter']}
genre = rock
preview_start_time = 0
song_length = {int(duration * 1000)}
diff_drums = 0
delay = 0
loading_phrase = Converted from MIDI drums
""",
        encoding="utf-8",
    )


def make_cover_png(path: Path, title: str, artist: str) -> None:
    if Image is None:
        return
    size = 500
    img = Image.new("RGB", (size, size), (18, 18, 22))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        c = int(18 + (y / size) * 40)
        draw.line([(0, y), (size, y)], fill=(c, 10, 10))
    draw.rectangle([30, 30, size - 30, size - 30], outline=(220, 40, 40), width=4)
    try:
        font_big = ImageFont.truetype("arial.ttf", 42)
        font_sm = ImageFont.truetype("arial.ttf", 28)
    except Exception:
        font_big = ImageFont.load_default()
        font_sm = font_big

    def center_text(text: str, y: int, font, fill) -> None:
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        draw.text(((size - w) / 2, y), text[:40], font=font, fill=fill)

    center_text(title, 200, font_big, (255, 255, 255))
    center_text(artist, 260, font_sm, (200, 200, 200))
    center_text("Smash Drums", 340, font_sm, (160, 160, 160))
    img.save(path, "PNG")


def make_preview_wav(audio_path: Path, out_path: Path, seconds: int = 12, out_rate: int = 22050) -> None:
    if sf is None or np is None:
        # silent placeholder
        with wave.open(str(out_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(out_rate)
            w.writeframes(b"\x00\x00" * out_rate * seconds)
        return
    data, sr = sf.read(str(audio_path), always_2d=True)
    mono = data.mean(axis=1)
    n = int(seconds * sr)
    clip = mono[:n]
    if len(clip) < n:
        clip = np.pad(clip, (0, n - len(clip)))
    x_old = np.linspace(0, 1, len(clip), endpoint=False)
    x_new = np.linspace(0, 1, int(seconds * out_rate), endpoint=False)
    resampled = np.interp(x_new, x_old, clip).astype(np.float32)
    pcm_i16 = (np.clip(resampled, -1, 1) * 32767.0).astype(np.int16)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(out_rate)
        w.writeframes(pcm_i16.tobytes())


def find_sidecar_audio(midi_path: Path) -> Path | None:
    """Look for song.ogg / song.mp3 / matching stems next to the MIDI."""
    parent = midi_path.parent
    stem = midi_path.stem
    base = re.sub(r"_(drums?|drum|percussion)(_\d+)?$", "", stem, flags=re.I)
    base = re.sub(r"_\d{10,}$", "", base)
    candidates = [
        parent / f"{base}.ogg",
        parent / f"{base}.mp3",
        parent / f"{base}.wav",
        parent / f"{base}.flac",
        parent / "song.ogg",
        parent / "song.mp3",
        parent / "audio.ogg",
        parent / f"{stem}.ogg",
    ]
    # also try without _drums and with " - " style
    for p in candidates:
        if p.exists():
            return p
    # any non-drum ogg in same folder with similar name
    for p in parent.glob("*.ogg"):
        if "drum" not in p.stem.lower():
            if base.lower() in p.stem.lower() or p.stem.lower() in base.lower():
                return p
    return None


def copy_as_ogg(src: Path, dst: Path) -> None:
    """Copy audio into package. Indies expects audio.ogg; non-ogg is still copied as-is
    with .ogg name only if already ogg; otherwise write sidecar note.
    """
    if src.suffix.lower() == ".ogg":
        dst.write_bytes(src.read_bytes())
        return
    # Keep original extension alongside, and also write as audio.ogg copy of bytes
    # (game may only accept ogg — still package original for editor load)
    dst.write_bytes(src.read_bytes())
    sidecar = dst.with_name(f"source_audio{src.suffix.lower()}")
    sidecar.write_bytes(src.read_bytes())


# ---------------------------------------------------------------------------
# Convert one file
# ---------------------------------------------------------------------------

def convert_one(
    midi_path: Path,
    *,
    out_root: Path,
    artist: str | None,
    title: str | None,
    charter: str,
    audio: Path | None,
    offset: float,
    bpm: float | None,
    no_downchart: bool,
    open_folder: bool,
    align: bool = True,
    force: bool = True,
) -> Path:
    midi_path = midi_path.resolve()
    if not midi_path.exists():
        raise FileNotFoundError(f"MIDI not found: {midi_path}")
    if midi_path.suffix.lower() not in {".mid", ".midi"}:
        raise ValueError(f"Not a MIDI file: {midi_path}")

    g_artist, g_title = guess_meta_from_filename(midi_path)
    artist = (artist or g_artist).strip() or "Unknown Artist"
    title = (title or g_title).strip() or midi_path.stem

    # Parse with MIDI-native tempo first; BPM override / align applied after
    parsed = parse_midi(midi_path, bpm_override=None)
    extreme = parsed["extreme"]
    if not extreme:
        raise RuntimeError(f"No mappable drum notes in {midi_path.name}")

    safe_guess = sanitize_filename(title)
    audio_src = audio
    if audio_src is None or not Path(audio_src).exists():
        audio_src = find_sidecar_audio(midi_path)
    if (audio_src is None or not Path(audio_src).exists()) and (out_root / safe_guess / "audio.ogg").exists():
        audio_src = out_root / safe_guess / "audio.ogg"

    bpm_final = float(bpm) if bpm is not None else float(parsed["midi_bpm"])
    beat_shift = 0.0
    song_offset = float(offset)
    align_info: dict | None = None

    # Auto tempo fit when possible. Classic symptom of wrong MIDI tempo:
    # offset lines up the start, then notes fall behind → BPM is too low.
    # We fix BPM from the audio and only apply a beat-shift lag when the
    # lock is strong AND the user did not set --offset themselves.
    if align and audio_src and Path(audio_src).exists() and bpm is None:
        print(f"  Fitting tempo to audio: {audio_src.name} ...")
        align_info = align_midi_to_audio(
            parsed["align_times"],
            parsed["midi_bpm"],
            audio_src,
            bpm_hint=parsed["midi_bpm"],
        )
        if align_info and align_info.get("accepted"):
            bpm_final = float(align_info["bpm"])
            lag = float(align_info["lag_sec"])
            # If user already provided an offset, only correct BPM (no lag shift)
            # so their start lock still roughly holds.
            if abs(song_offset) < 1e-6 and abs(lag) > 0.02:
                beat_shift = lag * bpm_final / 60.0
                print(
                    f"  Tempo fit: BPM {parsed['midi_bpm']:.2f} → {bpm_final:.2f}, "
                    f"lag {lag:+.3f}s (beat shift {beat_shift:+.3f}), "
                    f"score {align_info['score']:.3f}"
                )
            else:
                print(
                    f"  Tempo fit: BPM {parsed['midi_bpm']:.2f} → {bpm_final:.2f} "
                    f"(score {align_info['score']:.3f}). "
                    f"Lag {lag:+.3f}s left to Song Offset / your manual offset."
                )
        elif align_info:
            print(
                f"  Tempo fit weak (score {align_info['score']:.3f} vs baseline "
                f"{align_info['baseline']:.3f}) — keeping MIDI tempo {parsed['midi_bpm']:.2f}. "
                f"If notes fall behind, raise BPM a few points (e.g. --bpm 163)."
            )
        else:
            print("  Tempo fit skipped (could not analyse audio).")

    extreme, song_timing, last, duration_sec = apply_timing_fix(
        extreme, bpm=bpm_final, beat_shift=beat_shift
    )
    # User --offset is silent lead-in (chart before audio). Applied as SongOffsetSeconds.
    # When we already beat-shifted for audio lag, leave offset as user-specified only.
    parsed["bpm"] = int(round(bpm_final))
    parsed["bpm_float"] = bpm_final
    parsed["song_timing"] = song_timing
    parsed["last_beat"] = last
    parsed["duration_sec"] = duration_sec

    if no_downchart:
        hard = normal = easy = extreme
    else:
        hard = downchart(extreme, "hard")
        normal = downchart(extreme, "normal")
        easy = downchart(extreme, "easy")

    phases = [
        {"beat": 0.0, "phase": 1, "power": 0.6, "phaseName": "Intro"},
        {"beat": 16.0 + beat_shift, "phase": 2, "power": 0.7, "phaseName": "Verse"},
        {"beat": 80.0 + beat_shift, "phase": 4, "power": 0.9, "phaseName": "CHORUS"},
        {"beat": 144.0 + beat_shift, "phase": 2, "power": 0.7, "phaseName": "Verse"},
        {"beat": 208.0 + beat_shift, "phase": 4, "power": 0.9, "phaseName": "CHORUS"},
        {"beat": 272.0 + beat_shift, "phase": 6, "power": 0.85, "phaseName": "Solo"},
        {"beat": 336.0 + beat_shift, "phase": 4, "power": 0.9, "phaseName": "CHORUS"},
        {"beat": 400.0 + beat_shift, "phase": 7, "power": 0.7, "phaseName": "Outro"},
    ]
    phases = [
        {**p, "beat": float(quantize_beat(p["beat"]))}
        for p in phases
        if p["beat"] <= last + 4
    ] or [{"beat": 0.0, "phase": 1, "power": 0.7, "phaseName": "Intro"}]

    meta = {
        "NameArtist": artist,
        "NameSong": title,
        "NameCharter": charter,
        "FilePath": "audio.ogg",
        "SongOffsetSeconds": song_offset,
        "SongTiming": song_timing,
        "SongPhases": phases,
        "ChartEasy": easy,
        "ChartNormal": normal,
        "ChartHard": hard,
        "ChartExtreme": extreme,
    }

    safe = sanitize_filename(title)
    out_root.mkdir(parents=True, exist_ok=True)
    folder = out_root / safe
    if not force and folder.exists() and any(folder.iterdir()):
        n = 2
        while (out_root / f"{safe} ({n})").exists():
            n += 1
        folder = out_root / f"{safe} ({n})"
        safe = folder.name
    folder.mkdir(parents=True, exist_ok=True)
    indies_path = out_root / f"{safe}.indies"

    meta_text = format_meta(meta)
    (folder / "meta.json").write_text(meta_text, encoding="utf-8")
    write_chart_file(folder / "notes.chart", meta, parsed["bpm"])
    write_song_ini(folder / "song.ini", meta, parsed["duration_sec"])

    cover_path = folder / "cover.png"
    make_cover_png(cover_path, title, artist)

    # Prefer explicit/found audio; also reuse already-packaged audio.ogg in out folder
    if audio_src is None or not audio_src.exists():
        packaged = folder / "audio.ogg"
        if packaged.exists():
            audio_src = packaged

    audio_dst = folder / "audio.ogg"
    preview_path = folder / "preview.wav"
    has_audio = False
    if audio_src and audio_src.exists():
        if audio_src.resolve() != audio_dst.resolve():
            copy_as_ogg(audio_src, audio_dst)
        make_preview_wav(audio_src, preview_path)
        has_audio = True
    else:
        with wave.open(str(preview_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(22050)
            w.writeframes(b"\x00\x00" * 22050 * 12)

    with zipfile.ZipFile(indies_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", meta_text)
        if has_audio and audio_dst.exists():
            zf.write(audio_dst, "audio.ogg")
        if cover_path.exists():
            zf.write(cover_path, "cover.png")
        zf.write(preview_path, "preview.wav")

    # Report
    def count_ids(notes: list[dict]) -> str:
        c: dict[int, int] = defaultdict(int)
        for n in notes:
            c[n["Id"]] += 1
        parts = [f"{SMASH_NAMES[i]}={c[i]}" for i in sorted(c)]
        return ", ".join(parts) if parts else "(empty)"

    print()
    print("=" * 60)
    print(f"  {artist} — {title}")
    print("=" * 60)
    print(f"  MIDI:     {midi_path}")
    print(f"  BPM:      {parsed['bpm_float']:.3f}  (MIDI file said {parsed['midi_bpm']:.2f})")
    if beat_shift:
        print(f"  Beat shift: {beat_shift:+.3f} (audio lock)")
    print(f"  Duration: {parsed['duration_sec']:.1f}s  |  last beat {parsed['last_beat']}")
    print(f"  Offset:   {song_offset}s")
    print(f"  Audio:    {audio_src if has_audio else '(none — load Song in editor)'}")
    print()
    print("  Source GM notes:")
    for n, cnt in sorted(parsed["gm_counts"].items(), key=lambda x: -x[1]):
        mapped = GM_TO_SMASH.get(n)
        dest = SMASH_NAMES.get(mapped, "?") if mapped is not None else "SKIPPED"
        print(f"    {n:3d} {GM_NAMES.get(n, 'unknown'):16s} x{cnt:<5d} → {dest}")
    if parsed["unmapped"]:
        print("  Unmapped (skipped):", parsed["unmapped"])
    print()
    print(f"  Extreme: {len(extreme):4d}  ({count_ids(extreme)})")
    print(f"  Hard:    {len(hard):4d}  ({count_ids(hard)})")
    print(f"  Normal:  {len(normal):4d}  ({count_ids(normal)})")
    print(f"  Easy:    {len(easy):4d}  ({count_ids(easy)})")
    print()
    print(f"  Folder:  {folder}")
    print(f"  Indies:  {indies_path}")
    print()
    print("  Open in Smash Drums Editor → Import → pick the .indies file")
    if not has_audio:
        print("  Then load Song audio if hits should play with music.")
    print("=" * 60)

    if open_folder:
        try:
            import os

            os.startfile(folder)  # type: ignore[attr-defined]
        except Exception:
            pass

    return indies_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="midi_to_smash",
        description="Convert MIDI drum tracks into Smash Drums Editor charts (.indies).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  midi_to_smash.py drums.mid
  midi_to_smash.py drums.mid --audio song.ogg
  midi_to_smash.py a.mid b.mid c.mid
  midi_to_smash.py drums.mid --artist "Tool" --title "Parabola" --charter "You"
  midi_to_smash.py drums.mid --offset 0.08 --bpm 160

Drag & drop MIDI files onto Convert MIDI to Smash.bat on your Desktop.
""",
    )
    p.add_argument(
        "midi",
        nargs="+",
        type=Path,
        help="One or more .mid / .midi drum files",
    )
    p.add_argument(
        "--audio",
        "-a",
        type=Path,
        default=None,
        help="Full-mix audio (ogg preferred). Auto-detects song.ogg next to MIDI if omitted.",
    )
    p.add_argument("--artist", default=None, help="Artist name (default: guess from filename)")
    p.add_argument("--title", default=None, help="Song title (default: guess from filename)")
    p.add_argument("--charter", "-c", default="MIDI Convert", help="Charter name")
    p.add_argument(
        "--offset",
        type=float,
        default=0.0,
        help="Song offset in seconds (positive = chart waits for audio)",
    )
    p.add_argument(
        "--bpm",
        type=float,
        default=None,
        help="Override BPM (default: read from MIDI tempo)",
    )
    p.add_argument(
        "--out",
        "-o",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output directory (default: {DEFAULT_OUTPUT})",
    )
    p.add_argument(
        "--no-downchart",
        action="store_true",
        help="Copy Extreme notes into Hard/Normal/Easy instead of thinning",
    )
    p.add_argument(
        "--open",
        action="store_true",
        help="Open the output folder when done (Windows)",
    )
    p.add_argument(
        "--inspect",
        action="store_true",
        help="Only print MIDI note stats, do not convert",
    )
    p.add_argument(
        "--no-align",
        action="store_true",
        help="Do not auto-fit BPM/lag against audio (use MIDI tempo as-is)",
    )
    p.add_argument(
        "--no-force",
        action="store_true",
        help="Do not overwrite existing output folder (create Song (2) instead)",
    )
    return p


def inspect_midi(path: Path) -> None:
    parsed = parse_midi(path)
    print(f"\n{path.name}")
    print(f"  ticks/beat: {parsed['tpb']}")
    print(f"  BPM:        {parsed['midi_bpm']:.3f}")
    print(f"  duration:   {parsed['midi_duration_sec']:.2f}s")
    print(f"  note-ons:   {parsed['note_count_raw']}")
    print("  notes:")
    for n, cnt in sorted(parsed["gm_counts"].items(), key=lambda x: -x[1]):
        mapped = GM_TO_SMASH.get(n)
        dest = SMASH_NAMES.get(mapped, "?") if mapped is not None else "SKIP"
        print(f"    {n:3d} {GM_NAMES.get(n, '?'):16s} x{cnt:<5d} → {dest}")
    if parsed["unmapped"]:
        print("  unmapped:", parsed["unmapped"])


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    midis: list[Path] = []
    for m in args.midi:
        if m.is_dir():
            midis.extend(sorted(m.glob("*.mid")))
            midis.extend(sorted(m.glob("*.midi")))
        else:
            midis.append(m)

    if not midis:
        parser.error("No MIDI files found")

    if args.inspect:
        for m in midis:
            try:
                inspect_midi(m)
            except Exception as e:
                print(f"ERROR {m}: {e}", file=sys.stderr)
        return 0

    if args.audio and len(midis) > 1:
        print("Note: --audio applies to every MIDI when converting multiple files.")

    errors = 0
    for m in midis:
        try:
            convert_one(
                m,
                out_root=args.out.resolve(),
                artist=args.artist,
                title=args.title if len(midis) == 1 else None,
                charter=args.charter,
                audio=args.audio,
                offset=args.offset,
                bpm=args.bpm,
                no_downchart=args.no_downchart,
                open_folder=args.open and len(midis) == 1,
                align=not args.no_align,
                force=not args.no_force,
            )
        except Exception as e:
            errors += 1
            print(f"ERROR converting {m}: {e}", file=sys.stderr)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
