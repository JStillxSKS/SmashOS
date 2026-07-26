#!/usr/bin/env python3
"""
Audio â†’ MIDI converter â€” **drums-first**.

Default engine: drum onset + kit classify â†’ General MIDI channel 10
  (kick / snare / hat / tom) so MidiToSmashIndies can eat it next.

Also:
  --engine melody   librosa pyin (pitched melody)
  --engine basic-pitch  if installed

Examples:
  python audio_to_midi.py drums.wav
  python audio_to_midi.py drums.ogg --then-smash
  python audio_to_midi.py vocal.wav --engine melody
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = Path.home() / "Charts" / "_pipeline" / "midi"

AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".aiff", ".aif", ".wma"}
_SMASH = Path("/opt/smashos/tools/midi-to-indies/midi_to_smash.py")

# General MIDI percussion (channel 10 uses note numbers as instruments)
GM_KICK = 36
GM_SNARE = 38
GM_CHH = 42
GM_OHH = 46
GM_TOM_LOW = 45
GM_TOM_MID = 47
GM_TOM_HIGH = 50
GM_CRASH = 49


def _die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    sys.exit(code)


def _has_basic_pitch() -> bool:
    try:
        import basic_pitch  # noqa: F401
        from basic_pitch.inference import predict  # noqa: F401

        return True
    except Exception:
        return False


def _has_librosa() -> bool:
    try:
        import librosa  # noqa: F401
        import numpy  # noqa: F401
        import mido  # noqa: F401

        return True
    except Exception:
        return False


def _sec_to_ticks(sec: float, tempo_bpm: float, ticks_per_beat: int) -> int:
    beats = sec * (tempo_bpm / 60.0)
    return int(round(beats * ticks_per_beat))


def _write_drum_midi(
    hits: list[tuple[float, int, int]],
    out_midi: Path,
    *,
    tempo_bpm: float = 120.0,
    note_len_sec: float = 0.08,
) -> None:
    """hits: (time_sec, gm_note, velocity)"""
    import mido

    ticks_per_beat = 480
    mid = mido.MidiFile(ticks_per_beat=ticks_per_beat)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo_bpm), time=0))
    # Channel 9 = MIDI channel 10 (0-based) for drums
    ch = 9

    events: list[tuple[float, int, int, int]] = []  # t, on/off, note, vel
    for t, note, vel in hits:
        vel = max(1, min(127, int(vel)))
        note = max(0, min(127, int(note)))
        events.append((t, 1, note, vel))
        events.append((t + note_len_sec, 0, note, 0))
    events.sort(key=lambda e: (e[0], 0 if e[1] == 0 else 1))

    last_tick = 0
    for t_sec, is_on, note, vel in events:
        tick = _sec_to_ticks(t_sec, tempo_bpm, ticks_per_beat)
        delta = max(0, tick - last_tick)
        last_tick = tick
        if is_on:
            track.append(
                mido.Message("note_on", channel=ch, note=note, velocity=vel, time=delta)
            )
        else:
            track.append(
                mido.Message("note_off", channel=ch, note=note, velocity=0, time=delta)
            )
    track.append(mido.MetaMessage("end_of_track", time=0))
    mid.save(str(out_midi))


def convert_drums(
    audio_path: Path,
    out_midi: Path,
    *,
    hop_length: int = 256,
    delta: float = 0.07,
    wait: int = 1,
    pre_max: int = 3,
    post_max: int = 3,
    pre_avg: int = 3,
    post_avg: int = 5,
) -> None:
    """
    Drum-focused: onset detect + band energy â†’ GM kick/snare/hat/tom.
    Uses hit timing (what drums have), not pitch tracking (what they mostly lack).
    """
    import librosa
    import numpy as np

    print("  engine: drums (onset + kit classify â†’ GM channel 10)")
    print("  focus: kick / snare / hat / tom â€” best on drum stems or drum-heavy mixes")

    y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
    if y.size == 0:
        _die(f"Empty audio: {audio_path}")

    # Onset envelope + peak picking
    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length, aggregate=np.median)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=oenv,
        sr=sr,
        hop_length=hop_length,
        units="frames",
        backtrack=True,
        delta=delta,
        wait=wait,
        pre_max=pre_max,
        post_max=post_max,
        pre_avg=pre_avg,
        post_avg=post_avg,
    )
    if len(onset_frames) == 0:
        # Retry looser
        onset_frames = librosa.onset.onset_detect(
            y=y, sr=sr, hop_length=hop_length, units="frames", backtrack=True
        )
    if len(onset_frames) == 0:
        _die("No drum hits detected. Try a louder clip or lower --delta (e.g. 0.03).")

    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)

    # Band energies for classification
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)

    def band_energy(frame: int, f_lo: float, f_hi: float) -> float:
        idx = np.where((freqs >= f_lo) & (freqs < f_hi))[0]
        if idx.size == 0 or frame < 0 or frame >= S.shape[1]:
            return 0.0
        return float(np.mean(S[idx, frame] ** 2))

    hits: list[tuple[float, int, int]] = []
    counts = {"kick": 0, "snare": 0, "hat": 0, "tom": 0, "crash": 0}

    for fr, t in zip(onset_frames, onset_times):
        fr = int(fr)
        # Small window around onset
        frames = range(max(0, fr - 1), min(S.shape[1], fr + 3))
        low = sum(band_energy(f, 20, 120) for f in frames)
        mid = sum(band_energy(f, 150, 500) for f in frames)
        high = sum(band_energy(f, 5000, 12000) for f in frames)
        mid_snare = sum(band_energy(f, 200, 2500) for f in frames)
        total = low + mid + high + 1e-9

        # RMS-ish velocity from onset envelope
        env_v = float(oenv[fr]) if fr < len(oenv) else 0.5
        # Normalize roughly
        vel = int(np.clip(40 + env_v * 8.0, 40, 127))

        low_r = low / total
        high_r = high / total
        mid_r = mid_snare / total

        # Classify
        if low_r > 0.45 and low > mid and low > high * 0.8:
            note = GM_KICK
            counts["kick"] += 1
        elif high_r > 0.40 and high > low * 1.2:
            # open vs closed hat by brightness + duration proxy
            if high_r > 0.55 and env_v > 1.5:
                note = GM_OHH
            else:
                note = GM_CHH
            counts["hat"] += 1
        elif mid_r > 0.35 and mid_snare > low * 0.9:
            note = GM_SNARE
            counts["snare"] += 1
        elif low_r > 0.25 and mid > high:
            # tom-ish
            if low_r > 0.4:
                note = GM_TOM_LOW
            elif mid > low:
                note = GM_TOM_HIGH
            else:
                note = GM_TOM_MID
            counts["tom"] += 1
        elif high_r > 0.3 and mid_r > 0.25 and env_v > 2.0:
            note = GM_CRASH
            counts["crash"] += 1
        else:
            # Default: snare-ish body hit
            if low > high:
                note = GM_KICK
                counts["kick"] += 1
            else:
                note = GM_SNARE
                counts["snare"] += 1

        hits.append((float(t), note, vel))

    # Dedupe near-identical times same note
    hits.sort(key=lambda h: h[0])
    cleaned: list[tuple[float, int, int]] = []
    for h in hits:
        if cleaned and h[1] == cleaned[-1][1] and (h[0] - cleaned[-1][0]) < 0.03:
            # keep louder
            if h[2] > cleaned[-1][2]:
                cleaned[-1] = h
            continue
        cleaned.append(h)

    _write_drum_midi(cleaned, out_midi)
    print(
        f"  hits: {len(cleaned)}  "
        f"(kick={counts['kick']} snare={counts['snare']} "
        f"hat={counts['hat']} tom={counts['tom']} crash={counts['crash']})"
    )


def convert_basic_pitch(
    audio_path: Path,
    out_midi: Path,
    *,
    onset_threshold: float | None,
    frame_threshold: float | None,
    minimum_note_length: float | None,
    minimum_frequency: float | None,
    maximum_frequency: float | None,
    melodia_trick: bool,
) -> None:
    from basic_pitch.inference import predict

    kwargs: dict = {"melodia_trick": melodia_trick}
    if onset_threshold is not None:
        kwargs["onset_threshold"] = onset_threshold
    if frame_threshold is not None:
        kwargs["frame_threshold"] = frame_threshold
    if minimum_note_length is not None:
        kwargs["minimum_note_length"] = minimum_note_length
    if minimum_frequency is not None:
        kwargs["minimum_frequency"] = minimum_frequency
    if maximum_frequency is not None:
        kwargs["maximum_frequency"] = maximum_frequency

    print("  engine: basic-pitch (melody / pitched)")
    _model_output, midi_data, _note_events = predict(str(audio_path), **kwargs)
    if not hasattr(midi_data, "write"):
        _die("basic-pitch returned unexpected MIDI object")
    midi_data.write(str(out_midi))


def convert_melody(
    audio_path: Path,
    out_midi: Path,
    *,
    fmin: float,
    fmax: float,
    hop_length: int,
    min_note_ms: float,
    velocity: int,
) -> None:
    import librosa
    import numpy as np
    import mido

    print("  engine: melody (librosa pyin) â€” pitched lines only, not drums")
    y, sr = librosa.load(str(audio_path), sr=None, mono=True)
    if y.size == 0:
        _die(f"Empty audio: {audio_path}")

    f0, voiced_flag, _ = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, hop_length=hop_length
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop_length)

    notes: list[tuple[float, float, int]] = []
    cur_start: float | None = None
    cur_midi: int | None = None
    last_t = 0.0

    def flush(end_t: float) -> None:
        nonlocal cur_start, cur_midi
        if cur_start is None or cur_midi is None:
            return
        if (end_t - cur_start) * 1000.0 >= min_note_ms:
            notes.append((cur_start, end_t, cur_midi))
        cur_start = None
        cur_midi = None

    for t, f, voiced in zip(times, f0, voiced_flag):
        last_t = float(t)
        if voiced and f is not None and not np.isnan(f):
            midi_n = int(round(librosa.hz_to_midi(float(f))))
            midi_n = max(0, min(127, midi_n))
            if cur_midi is None:
                cur_start, cur_midi = float(t), midi_n
            elif midi_n != cur_midi:
                flush(float(t))
                cur_start, cur_midi = float(t), midi_n
        else:
            flush(float(t))
    flush(last_t + hop_length / float(sr))

    if not notes:
        _die("No pitched notes found. For drums use default engine (don't pass --engine melody).")

    tempo_bpm = 120.0
    ticks_per_beat = 480
    mid = mido.MidiFile(ticks_per_beat=ticks_per_beat)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo_bpm), time=0))
    track.append(mido.Message("program_change", program=0, time=0))

    events: list[tuple[float, int, int, int]] = []
    vel = max(1, min(127, velocity))
    for start, end, note in notes:
        events.append((start, 1, note, vel))
        events.append((end, 0, note, 0))
    events.sort(key=lambda e: (e[0], 0 if e[1] == 0 else 1))

    last_tick = 0
    for t_sec, is_on, note, vel_e in events:
        tick = _sec_to_ticks(t_sec, tempo_bpm, ticks_per_beat)
        delta = max(0, tick - last_tick)
        last_tick = tick
        if is_on:
            track.append(mido.Message("note_on", note=note, velocity=vel_e, time=delta))
        else:
            track.append(mido.Message("note_off", note=note, velocity=0, time=delta))
    track.append(mido.MetaMessage("end_of_track", time=0))
    mid.save(str(out_midi))
    print(f"  notes written: {len(notes)}")


def convert_one(
    audio_path: Path,
    out_dir: Path,
    *,
    engine: str,
    onset_threshold: float | None,
    frame_threshold: float | None,
    minimum_note_length: float | None,
    min_note_ms: float,
    fmin: float,
    fmax: float,
    velocity: int,
    melodia_trick: bool,
    drum_delta: float,
) -> Path:
    if not audio_path.is_file():
        _die(f"Not found: {audio_path}")

    ext = audio_path.suffix.lower()
    if ext not in AUDIO_EXTS:
        print(f"Warning: unusual extension {ext!r} â€” trying anywayâ€¦")

    out_dir.mkdir(parents=True, exist_ok=True)
    out_midi = out_dir / f"{audio_path.stem}.mid"

    print(f"Transcribing: {audio_path.name}")

    use = engine
    if use == "auto":
        use = "drums"  # drums are the product focus

    if use == "drums":
        if not _has_librosa():
            _die("Need: pip install librosa soundfile mido numpy")
        convert_drums(audio_path, out_midi, delta=drum_delta)
    elif use == "basic-pitch":
        if not _has_basic_pitch():
            _die("basic-pitch not installed (often needs Python 3.10â€“3.12).")
        convert_basic_pitch(
            audio_path,
            out_midi,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=minimum_note_length,
            minimum_frequency=fmin,
            maximum_frequency=fmax,
            melodia_trick=melodia_trick,
        )
    elif use in ("melody", "librosa"):
        if not _has_librosa():
            _die("Need: pip install librosa soundfile mido numpy")
        convert_melody(
            audio_path,
            out_midi,
            fmin=fmin,
            fmax=fmax,
            hop_length=512,
            min_note_ms=min_note_ms,
            velocity=velocity,
        )
    else:
        _die(f"Unknown engine: {use}")

    if not out_midi.is_file():
        _die(f"MIDI was not written: {out_midi}")

    print(f"  â†’ {out_midi}  ({out_midi.stat().st_size} bytes)")
    return out_midi


def open_folder(path: Path) -> None:
    if sys.platform == "win32":
        subprocess.run(["explorer", str(path.resolve())], check=False)
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


def run_smash(midi_path: Path) -> None:
    if not _SMASH.is_file():
        print(f"MidiToSmash not found at {_SMASH} â€” skip --then-smash")
        return
    print(f"Running MidiToSmash: {midi_path.name}")
    r = subprocess.run([sys.executable, str(_SMASH), str(midi_path)], check=False)
    if r.returncode != 0:
        print("MidiToSmash exited with an error.", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Audio â†’ MIDI (default: DRUMS â†’ GM percussion MIDI)."
    )
    p.add_argument("audio", nargs="+", type=Path, help="Audio file(s)")
    p.add_argument(
        "--out",
        "-o",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output folder (default: {DEFAULT_OUTPUT})",
    )
    p.add_argument(
        "--engine",
        choices=("auto", "drums", "melody", "librosa", "basic-pitch"),
        default="auto",
        help="auto/drums = drum kit MIDI (default). melody = pitched. basic-pitch if installed.",
    )
    p.add_argument(
        "--delta",
        type=float,
        default=0.07,
        help="Drum onset sensitivity (lower = more hits, default 0.07)",
    )
    p.add_argument("--onset", type=float, default=None, help="basic-pitch only")
    p.add_argument("--frame", type=float, default=None, help="basic-pitch only")
    p.add_argument("--min-note-ms", type=float, default=50.0, dest="min_note_ms")
    p.add_argument("--min-freq", type=float, default=65.0)
    p.add_argument("--max-freq", type=float, default=2093.0)
    p.add_argument("--velocity", type=int, default=80)
    p.add_argument("--no-melodia", action="store_true")
    p.add_argument("--then-smash", action="store_true")
    p.add_argument("--open", action="store_true")
    args = p.parse_args(argv)

    out_dir = args.out.expanduser().resolve()
    written: list[Path] = []

    for raw in args.audio:
        audio_path = raw.expanduser().resolve()
        try:
            mid = convert_one(
                audio_path,
                out_dir,
                engine=args.engine,
                onset_threshold=args.onset,
                frame_threshold=args.frame,
                minimum_note_length=args.min_note_ms,
                min_note_ms=args.min_note_ms,
                fmin=args.min_freq,
                fmax=args.max_freq,
                velocity=args.velocity,
                melodia_trick=not args.no_melodia,
                drum_delta=args.delta,
            )
            written.append(mid)
            if args.then_smash:
                run_smash(mid)
        except SystemExit:
            raise
        except Exception as e:
            print(f"FAILED: {audio_path.name}: {e}", file=sys.stderr)

    if not written:
        _die("No MIDI files produced.")

    print()
    print(f"Done. {len(written)} file(s) in: {out_dir}")
    if args.open:
        open_folder(out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
