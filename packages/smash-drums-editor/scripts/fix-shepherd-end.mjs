/**
 * Shepherd Of Fire end-stuck experiment:
 * - Extend last SongTiming anchor past final note (+8 beats)
 * - Nudge Outro nearer the real ending (~8 beats before last note)
 * - Optional: pad audio with silence if ffmpeg is available
 *
 * Does not claim this fixed Took Her; user wants another try with a real tail.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import JSZip from "jszip";

const src =
  process.argv[2] ??
  "C:/Users/JStillxSKS/Downloads/Shepherd Of Fire.indies";
const out =
  process.argv[3] ??
  "C:/Users/JStillxSKS/Downloads/Shepherd Of Fire.endfix.indies";
const bak = `${src}.pre-endfix.bak`;

const EXTRA_BEATS = 8; // ~3.75s at 128 BPM
const AUDIO_PAD_SEC = 4.0;

function sortAnchors(anchors) {
  return [...anchors].sort((a, b) => a.beat - b.beat || a.timer - b.timer);
}

function maxNoteBeat(meta) {
  let max = 0;
  for (const key of ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"]) {
    for (const note of meta[key] ?? []) max = Math.max(max, note.Beat);
  }
  return max;
}

function beatToTime(beat, anchors) {
  const sorted = sortAnchors(anchors);
  if (beat <= sorted[0].beat) {
    if (sorted.length < 2) return sorted[0].timer;
    const [a, b] = sorted;
    return a.timer + ((beat - a.beat) * (b.timer - a.timer)) / (b.beat - a.beat);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (beat >= a.beat && beat <= b.beat) {
      return a.timer + ((beat - a.beat) / (b.beat - a.beat)) * (b.timer - a.timer);
    }
  }
  const last = sorted.at(-1);
  const prev = sorted.at(-2);
  return (
    last.timer +
    ((beat - last.beat) * (last.timer - prev.timer)) / (last.beat - prev.beat)
  );
}

function oggDuration(buf) {
  let lastGranule = 0n;
  let sampleRate = 0;
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf[i] === 0x01 && buf.toString("ascii", i + 1, i + 7) === "vorbis") {
      sampleRate = buf.readUInt32LE(i + 12);
      break;
    }
  }
  let offset = 0;
  while (offset + 27 < buf.length) {
    if (buf.toString("ascii", offset, offset + 4) !== "OggS") {
      offset++;
      continue;
    }
    const granule = buf.readBigUInt64LE(offset + 6);
    const nseg = buf[offset + 26];
    let segsum = 0;
    for (let j = 0; j < nseg; j++) segsum += buf[offset + 27 + j];
    if (granule !== 0xffffffffffffffffn && granule > lastGranule) {
      lastGranule = granule;
    }
    offset += 27 + nseg + segsum;
  }
  return sampleRate ? Number(lastGranule) / sampleRate : null;
}

function formatDecimalBeat(beat) {
  if (Number.isInteger(beat)) return `${beat}.0`;
  return String(beat);
}

function serializeMeta(meta) {
  const lines = ["{"];
  const scalarFields = [
    ["NameArtist", JSON.stringify(meta.NameArtist)],
    ["NameSong", JSON.stringify(meta.NameSong)],
    ["NameCharter", JSON.stringify(meta.NameCharter)],
    ["FilePath", JSON.stringify(meta.FilePath)],
    [
      "SongOffsetSeconds",
      Number.isInteger(meta.SongOffsetSeconds)
        ? `${meta.SongOffsetSeconds}.0`
        : String(meta.SongOffsetSeconds),
    ],
  ];

  for (const [key, value] of scalarFields) {
    lines.push(`    "${key}": ${value},`);
  }

  lines.push('    "SongTiming": [');
  meta.SongTiming.forEach((anchor, index) => {
    const beat = Number.isInteger(anchor.beat)
      ? String(anchor.beat)
      : String(anchor.beat);
    const timer = anchor.timer === 0 ? "0.0" : String(anchor.timer);
    lines.push("        {");
    lines.push(`            "beat": ${beat},`);
    lines.push(`            "timer": ${timer}`);
    lines.push(`        }${index < meta.SongTiming.length - 1 ? "," : ""}`);
  });
  lines.push("    ],");

  lines.push('    "SongPhases": [');
  meta.SongPhases.forEach((phase, index) => {
    lines.push("        {");
    lines.push(`            "beat": ${formatDecimalBeat(phase.beat)},`);
    lines.push(`            "phase": ${phase.phase},`);
    lines.push(`            "power": ${phase.power},`);
    lines.push(`            "phaseName": ${JSON.stringify(phase.phaseName)}`);
    lines.push(`        }${index < meta.SongPhases.length - 1 ? "," : ""}`);
  });
  lines.push("    ],");

  for (const key of ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"]) {
    lines.push(`    "${key}": [`);
    (meta[key] ?? []).forEach((note, index) => {
      lines.push("        {");
      lines.push(`            "Beat": ${formatDecimalBeat(note.Beat)},`);
      lines.push(`            "Strength": ${note.Strength},`);
      lines.push(`            "Id": ${note.Id}`);
      lines.push(`        }${index < meta[key].length - 1 ? "," : ""}`);
    });
    lines.push(`    ]${key !== "ChartExtreme" ? "," : ""}`);
  }

  lines.push("}");
  return lines.join("\n");
}

function findFfmpeg() {
  for (const c of [
    "ffmpeg",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  ]) {
    const r = spawnSync(c, ["-version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

if (!fs.existsSync(src)) {
  console.error("File not found:", src);
  process.exit(1);
}

if (!fs.existsSync(bak)) {
  fs.copyFileSync(src, bak);
  console.log("Backup:", bak);
} else {
  console.log("Backup already exists:", bak);
}

const zip = await JSZip.loadAsync(fs.readFileSync(src));
// Prefer pre-fix content if we previously overwrote src without finishing
const loadFrom = fs.existsSync(bak) ? bak : src;
const zipSrc = await JSZip.loadAsync(fs.readFileSync(loadFrom));
const meta = JSON.parse(await zipSrc.file("meta.json").async("string"));
let audioBuf = await zipSrc.file("audio.ogg").async("nodebuffer");

const maxBeat = maxNoteBeat(meta);
const oldAnchors = sortAnchors(meta.SongTiming);
const oldDur = oggDuration(audioBuf);
const last = oldAnchors.at(-1);
const prev = oldAnchors.at(-2);
const secPerBeat = (last.timer - prev.timer) / (last.beat - prev.beat);

console.log("=== BEFORE ===");
console.log("max note beat:", maxBeat);
console.log("audio duration:", oldDur?.toFixed(3), "s");
console.log("last anchor:", last.beat, "@", last.timer);
console.log(
  "gap audio-lastNote:",
  (oldDur - beatToTime(maxBeat, oldAnchors)).toFixed(3),
  "s"
);

// Optional audio pad (stronger than anchor-only; Took Her was anchor-only)
const ffmpeg = findFfmpeg();
let audioPadded = false;
if (ffmpeg) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-"));
  const inOgg = path.join(tmpDir, "in.ogg");
  const outOgg = path.join(tmpDir, "out.ogg");
  fs.writeFileSync(inOgg, audioBuf);
  const r = spawnSync(
    ffmpeg,
    [
      "-y",
      "-i",
      inOgg,
      "-af",
      `apad=pad_dur=${AUDIO_PAD_SEC}`,
      "-c:a",
      "libvorbis",
      "-q:a",
      "6",
      outOgg,
    ],
    { encoding: "utf8" }
  );
  if (r.status === 0 && fs.existsSync(outOgg)) {
    audioBuf = fs.readFileSync(outOgg);
    audioPadded = true;
    console.log("Audio padded +", AUDIO_PAD_SEC, "s silence via ffmpeg");
  } else {
    console.log("ffmpeg pad failed; continuing with timing-only");
    if (r.stderr) console.log(r.stderr.slice(-400));
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
} else {
  console.log("ffmpeg not found; timing-only fix");
}

// Move end anchor: keep prior map, replace/extend past last note
const finalBeat = Math.ceil(maxBeat) + EXTRA_BEATS;
const finalTimer =
  Math.round((last.timer + (finalBeat - last.beat) * secPerBeat) * 1000) / 1000;

// Drop any anchors at/after finalBeat, keep history, append new end
const anchors = oldAnchors.filter((a) => a.beat < finalBeat - 1e-6);
// If last was exactly maxBeat (678), keep it as a mid-point? Better keep full history
// under finalBeat. Original last 678 stays if finalBeat is 686.
if (!anchors.some((a) => Math.abs(a.beat - last.beat) < 1e-6) && last.beat < finalBeat) {
  anchors.push({ beat: last.beat, timer: last.timer });
}
anchors.push({ beat: finalBeat, timer: finalTimer });
meta.SongTiming = sortAnchors(anchors);

// Outro nudge
const outro = meta.SongPhases?.find(
  (p) => p.phase === 7 || /outro/i.test(p.phaseName || "")
);
const oldOutroBeat = outro?.beat;
if (outro && maxBeat - outro.beat > 12) {
  outro.beat = Math.round((maxBeat - 8) * 4) / 4;
  outro.phase = 7;
  outro.phaseName = "Outro";
  outro.power = 0.4;
  meta.SongPhases = [...meta.SongPhases].sort((a, b) => a.beat - b.beat);
}

zipSrc.file("meta.json", serializeMeta(meta));
if (audioPadded) zipSrc.file("audio.ogg", audioBuf);

// Preserve other entries from source zip (cover, preview)
const outBuf = await zipSrc.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});
fs.writeFileSync(out, outBuf);
fs.writeFileSync(src, outBuf);

const newDur = oggDuration(audioBuf);
const newLast = sortAnchors(meta.SongTiming).at(-1);
const lastNoteT = beatToTime(maxBeat, meta.SongTiming);

console.log("=== AFTER ===");
console.log("Wrote:", out);
console.log("Also overwrote:", src);
console.log("SongTiming:", JSON.stringify(meta.SongTiming));
console.log("last anchor now:", newLast.beat, "@", newLast.timer);
console.log("audio duration:", newDur?.toFixed(3), "s", audioPadded ? "(padded)" : "");
console.log("last note time:", lastNoteT.toFixed(3), "s");
console.log("gap lastNote -> end anchor:", (newLast.timer - lastNoteT).toFixed(3), "s");
console.log(
  "gap lastNote -> audio end:",
  newDur != null ? (newDur - lastNoteT).toFixed(3) + "s" : "n/a"
);
if (outro) console.log("Outro beat:", oldOutroBeat, "->", outro.beat);
console.log("Done. Copy to headset and play Extreme through the ending.");
