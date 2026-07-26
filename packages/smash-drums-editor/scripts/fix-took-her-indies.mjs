/**
 * Surgical end-of-song fix — preserves the tempo map, only adjusts:
 * 1) Last timing anchor extended past the final note
 * 2) Outro phase moved near the actual ending (Danger-style ~8 beats before last note)
 */
import fs from "fs";
import JSZip from "jszip";

const filePath =
  process.argv[2] ??
  "C:/Users/JStillxSKS/Desktop/Smash Drums Editor/output/Took Her To The O - Metal Cover.indies";
const backupPath = `${filePath}.pre-outro-fix.bak`;

function sortAnchors(anchors) {
  return [...anchors].sort((a, b) => a.beat - b.beat || a.timer - b.timer);
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

function maxNoteBeat(meta) {
  let max = 0;
  for (const key of ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"]) {
    for (const note of meta[key] ?? []) max = Math.max(max, note.Beat);
  }
  return max;
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
    const beat = Number.isInteger(anchor.beat) ? String(anchor.beat) : String(anchor.beat);
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
    meta[key].forEach((note, index) => {
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

function extendEndAnchor(anchors, maxBeat) {
  const sorted = sortAnchors(anchors);
  const last = sorted.at(-1);
  const targetBeat = Math.max(last.beat, Math.ceil(maxBeat * 4) / 4);
  if (targetBeat <= last.beat + 1 / 480) return sorted;

  const targetTimer = Math.round(beatToTime(targetBeat, sorted) * 1000) / 1000;
  const withoutDupTail = sorted.filter(
    (anchor) => Math.abs(anchor.beat - targetBeat) > 1 / 480
  );
  return sortAnchors([...withoutDupTail, { beat: targetBeat, timer: targetTimer }]);
}

if (!fs.existsSync(filePath)) {
  console.error("File not found:", filePath);
  process.exit(1);
}

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(filePath, backupPath);
  console.log("Backup:", backupPath);
}

const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
const meta = JSON.parse(await zip.file("meta.json").async("string"));

const maxBeat = maxNoteBeat(meta);
const oldAnchors = sortAnchors(meta.SongTiming);
const oldOutro = meta.SongPhases.find(
  (phase) => phase.phase === 7 || /outro/i.test(phase.phaseName || "")
);

meta.SongTiming = extendEndAnchor(meta.SongTiming, maxBeat);

const outroBeat = Math.max(0, Math.round((maxBeat - 8) * 4) / 4);
if (oldOutro && maxBeat - oldOutro.beat > 12) {
  oldOutro.beat = outroBeat;
  oldOutro.phase = 7;
  oldOutro.phaseName = "Outro";
  oldOutro.power = 0.4;
  meta.SongPhases = [...meta.SongPhases].sort((a, b) => a.beat - b.beat);
}

zip.file("meta.json", serializeMeta(meta));
const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(filePath, outBuf);

const newLast = sortAnchors(meta.SongTiming).at(-1);
console.log("Fixed:", filePath);
console.log("Timing:", JSON.stringify(oldAnchors), "->", JSON.stringify(meta.SongTiming));
console.log("Max note beat:", maxBeat);
if (oldOutro) {
  console.log("Outro beat:", oldOutro.beat, "(target was", outroBeat + ")");
}
console.log("Last anchor now:", newLast.beat, "@", newLast.timer);