import fs from "fs";
import JSZip from "jszip";
import crypto from "crypto";

async function inspect(f) {
  const buf = fs.readFileSync(f);
  const zip = await JSZip.loadAsync(buf);
  const meta = JSON.parse(await zip.file("meta.json").async("string"));
  const audio = await zip.file("audio.ogg").async("nodebuffer");

  const allNotes = [];
  for (const k of ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"]) {
    for (const n of meta[k] ?? []) allNotes.push({ diff: k, ...n });
  }
  allNotes.sort((a, b) => a.Beat - b.Beat || a.Id - b.Id);

  const dupeKeys = new Map();
  for (const n of allNotes) {
    const key = `${n.diff}:${n.Beat}:${n.Id}`;
    dupeKeys.set(key, (dupeKeys.get(key) ?? 0) + 1);
  }
  const dupes = [...dupeKeys.entries()].filter(([, c]) => c > 1);

  console.log("\n===", f.split("/").pop(), "===");
  console.log("meta keys:", Object.keys(meta).join(", "));
  console.log("IndiesDbMapId:", meta.IndiesDbMapId ?? "(none)");
  console.log("FilePath:", JSON.stringify(meta.FilePath));
  console.log("SongTiming:", JSON.stringify(meta.SongTiming));
  console.log("audio md5:", crypto.createHash("md5").update(audio).digest("hex"));
  console.log("exact dupes:", dupes.length);
  console.log("phases:", meta.SongPhases?.map((p) => `${p.phaseName}@${p.beat}`).join(", "));
  console.log("last 8 notes:");
  for (const n of allNotes.slice(-8)) {
    console.log(`  ${n.diff} beat=${n.Beat} id=${n.Id} str=${n.Strength}`);
  }
}

const files = process.argv.slice(2);
for (const f of files) await inspect(f);