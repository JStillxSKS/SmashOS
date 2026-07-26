/**
 * Picture Perfect end-freeze fix:
 * - Pad audio with silence (extend the song)
 * - Extend last SongTiming past padded audio (integer end beat)
 * - Ensure Outro phase near real ending
 * - Set FilePath to audio.ogg
 * Does NOT invent notes in the singer gap (charts left as-is).
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import JSZip from "jszip";

const src =
  process.argv[2] ??
  "output/Picture Perfect.indies";
const bak = `${src}.pre-extend-fix.bak`;
const AUDIO_PAD_SEC = 6.0;
const EXTRA_BEATS = 12;

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
    ["FilePath", JSON.stringify(meta.FilePath || "audio.ogg")],
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
    const beat = String(anchor.beat);
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
  const here = path.dirname(new URL(import.meta.url).pathname);
  // Windows URL pathname is like /C:/... — normalize
  const hereWin = process.platform === "win32" ? here.replace(/^\/([A-Za-z]:)/, "$1") : here;
  const candidates = [
    path.resolve(hereWin, "../node_modules/ffmpeg-static/ffmpeg.exe"),
    path.resolve("node_modules/ffmpeg-static/ffmpeg.exe"),
    "ffmpeg",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  for (const c of candidates) {
    if (c !== "ffmpeg" && !fs.existsSync(c)) continue;
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
const meta = JSON.parse(await zip.file("meta.json").async("string"));
let audioBuf = Buffer.from(await zip.file("audio.ogg").async("nodebuffer"));

const maxBeat = maxNoteBeat(meta);
const oldAnchors = sortAnchors(meta.SongTiming);
const oldDur = oggDuration(audioBuf);
const last = oldAnchors.at(-1);
const prev = oldAnchors.at(-2);
const secPerBeat = (last.timer - prev.timer) / (last.beat - prev.beat);
const noteCountsBefore = Object.fromEntries(
  ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"].map((k) => [
    k,
    (meta[k] ?? []).length,
  ])
);

console.log("=== BEFORE ===");
console.log("max note beat:", maxBeat);
console.log("audio duration:", oldDur?.toFixed(3), "s");
console.log("last timing:", last.beat, "@", last.timer);
console.log(
  "phases:",
  meta.SongPhases.map((p) => `${p.phaseName}@${p.beat}`).join(", ")
);
console.log("FilePath:", JSON.stringify(meta.FilePath));
console.log("note counts:", noteCountsBefore);

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error("ffmpeg required for audio pad — aborting (no half-fixed package)");
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-fix-"));
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
if (r.status !== 0 || !fs.existsSync(outOgg)) {
  console.error("ffmpeg pad failed");
  if (r.stderr) console.error(r.stderr.slice(-600));
  process.exit(1);
}
audioBuf = fs.readFileSync(outOgg);
const newDur = oggDuration(audioBuf);
console.log("Audio padded +", AUDIO_PAD_SEC, "s ->", newDur?.toFixed(3), "s");

// Extend end timing past padded audio (integer beat)
const finalBeat = Math.ceil(Math.max(maxBeat, last.beat) + EXTRA_BEATS);
let finalTimer =
  Math.round((last.timer + (finalBeat - last.beat) * secPerBeat) * 1000) / 1000;
if (newDur != null && finalTimer < newDur + 1) {
  finalTimer = Math.round((newDur + 1.5) * 1000) / 1000;
}

const anchors = oldAnchors.filter((a) => a.beat < finalBeat - 1e-6);
if (
  !anchors.some((a) => Math.abs(a.beat - last.beat) < 1e-6) &&
  last.beat < finalBeat
) {
  anchors.push({ beat: last.beat, timer: last.timer });
}
const cleaned = anchors.filter((a) => Math.abs(a.beat - finalBeat) > 1e-6);
cleaned.push({ beat: finalBeat, timer: finalTimer });
meta.SongTiming = sortAnchors(cleaned);

meta.FilePath = "audio.ogg";

// Outro near real ending (~8 beats before last note)
const outroBeat = Math.max(0, Math.round((maxBeat - 8) * 4) / 4);
const phases = meta.SongPhases.filter(
  (p) => !(p.phase === 7 || /outro/i.test(p.phaseName || ""))
);
phases.push({
  beat: outroBeat,
  phase: 7,
  power: 0.4,
  phaseName: "Outro",
});
meta.SongPhases = phases.sort((a, b) => a.beat - b.beat);

// Charts untouched — no fake notes in singer gap

zip.file("meta.json", serializeMeta(meta));
zip.file("audio.ogg", audioBuf);
const outBuf = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});
fs.writeFileSync(src, outBuf);

const sibling = path.resolve(path.dirname(src), "../../output/Picture Perfect.indies");
const altSibling = path.resolve(
  path.dirname(src),
  "../output/Picture Perfect.indies"
);
for (const p of [sibling, altSibling]) {
  try {
    if (fs.existsSync(path.dirname(p)) && p !== path.resolve(src)) {
      // only write if a Picture Perfect.indies already lived there or parent output exists
    }
  } catch {
    /* ignore */
  }
}
// Known dual locations under this project
const extra = [
  path.resolve("output/Picture Perfect.indies"),
  path.resolve("../output/Picture Perfect.indies"),
];
for (const p of extra) {
  if (path.resolve(p) === path.resolve(src)) continue;
  if (fs.existsSync(path.dirname(p))) {
    try {
      fs.writeFileSync(p, outBuf);
      console.log("Also wrote:", p);
    } catch (e) {
      console.log("Skip write", p, e.message);
    }
  }
}

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

const lastNoteT = beatToTime(maxBeat, meta.SongTiming);
const newLast = sortAnchors(meta.SongTiming).at(-1);
const noteCountsAfter = Object.fromEntries(
  ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"].map((k) => [
    k,
    (meta[k] ?? []).length,
  ])
);

console.log("=== AFTER ===");
console.log("Wrote:", path.resolve(src));
console.log("SongTiming:", JSON.stringify(meta.SongTiming));
console.log(
  "phases:",
  meta.SongPhases.map((p) => `${p.phaseName}@${p.beat}`).join(", ")
);
console.log("FilePath:", JSON.stringify(meta.FilePath));
console.log("audio duration:", newDur?.toFixed(3), "s");
console.log("last note time:", lastNoteT.toFixed(3), "s");
console.log("end timing:", newLast.beat, "@", newLast.timer);
console.log(
  "gap lastNote -> audio end:",
  newDur != null ? `${(newDur - lastNoteT).toFixed(3)}s` : "n/a"
);
console.log(
  "gap lastNote -> end timing:",
  `${(newLast.timer - lastNoteT).toFixed(3)}s`
);
console.log("note counts (must match before):", noteCountsAfter);
const countsOk = JSON.stringify(noteCountsBefore) === JSON.stringify(noteCountsAfter);
if (!countsOk) {
  console.error("NOTE COUNTS CHANGED — abort integrity");
  process.exit(1);
}
console.log("DONE — charts untouched, song extended.");
