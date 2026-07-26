import fs from "node:fs";

function parseChart(text) {
  const song = {};
  const tracks = new Map();
  let section = "";
  let inBlock = false;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const sm = line.match(/^\[([^\]]+)\]$/);
    if (sm) {
      section = sm[1];
      if (section !== "Song") tracks.set(section, []);
      inBlock = false;
      continue;
    }
    if (line === "{") {
      inBlock = true;
      continue;
    }
    if (line === "}") {
      inBlock = false;
      continue;
    }
    if (!inBlock) continue;
    if (section === "Song") {
      const m = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (m) song[m[1]] = m[2].replace(/^"|"$/g, "");
      continue;
    }
    const tm = line.match(/^(\d+)\s*=\s*(\w+)(?:\s+(.+))?$/);
    if (tm) tracks.get(section)?.push({ tick: +tm[1], key: tm[2], value: tm[3] ?? "" });
  }
  return { song, tracks };
}

function syncSummary(entries) {
  const a = new Map();
  const b = new Map();
  const ts = new Map();
  for (const e of entries) {
    if (e.key === "A") a.set(e.tick, +e.value);
    if (e.key === "B") b.set(e.tick, +e.value);
    if (e.key === "TS") ts.set(e.tick, +e.value);
  }
  const ticks = [...new Set([...a.keys(), ...b.keys(), ...ts.keys()])].sort((x, y) => x - y);
  return ticks.map((tick) => ({
    tick,
    beat: tick / 480,
    ts: ts.get(tick),
    anchorSec: a.has(tick) ? a.get(tick) / 1e6 : null,
    bpm: b.has(tick) ? b.get(tick) / 1000 : null,
  }));
}

function drumNotes(entries) {
  return entries
    .filter((e) => e.key === "N")
    .map((e) => {
      const [lane] = e.value.split(/\s+/);
      return { tick: e.tick, lane: +lane };
    })
    .sort((a, b) => a.tick - b.tick || a.lane - b.lane);
}

const desktop = parseChart(fs.readFileSync("C:/Users/JStillxSKS/Desktop/Untitled Song.chart", "utf8"));
const exported = parseChart(
  fs.readFileSync(
    "C:/Users/JStillxSKS/Desktop/Smash Drums Editor/output/UNDEAD/UNDEAD/notes.chart",
    "utf8"
  )
);

const syncA = syncSummary(desktop.tracks.get("SyncTrack") || []);
const syncB = syncSummary(exported.tracks.get("SyncTrack") || []);
const notesA = drumNotes(desktop.tracks.get("ExpertDrums") || []);
const notesB = drumNotes(exported.tracks.get("ExpertDrums") || []);

const key = (n) => `${n.tick}:${n.lane}`;
const setA = new Set(notesA.map(key));
const setB = new Set(notesB.map(key));
const onlyA = notesA.filter((n) => !setB.has(key(n)));
const onlyB = notesB.filter((n) => !setA.has(key(n)));

console.log("=== SONG METADATA ===");
console.log("Desktop MusicStream:", desktop.song.MusicStream);
console.log("Desktop DrumStream:", desktop.song.DrumStream ?? "(none)");
console.log("Export MusicStream:", exported.song.MusicStream);
console.log("Offset:", desktop.song.Offset, "vs", exported.song.Offset);

console.log("\n=== SYNCTRACK ===");
console.log("Desktop (Moonscraper?):", JSON.stringify(syncA, null, 2));
console.log("Smash Editor export:", JSON.stringify(syncB, null, 2));

console.log("\n=== EXPERT DRUMS ===");
console.log("Note count desktop:", notesA.length, "| export:", notesB.length);
console.log("Only in desktop:", onlyA.length);
console.log("Only in export:", onlyB.length);
if (onlyA.length) console.log("Desktop-only samples:", onlyA.slice(0, 20));
if (onlyB.length) console.log("Export-only samples:", onlyB.slice(0, 20));

const maxTickA = Math.max(...notesA.map((n) => n.tick), 0);
const maxTickB = Math.max(...notesB.map((n) => n.tick), 0);
console.log("Max note tick desktop:", maxTickA, `(${(maxTickA / 480).toFixed(2)} beats)`);
console.log("Max note tick export:", maxTickB, `(${(maxTickB / 480).toFixed(2)} beats)`);