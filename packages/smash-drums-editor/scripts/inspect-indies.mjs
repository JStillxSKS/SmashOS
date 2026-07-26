import fs from "fs";
import JSZip from "jszip";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node inspect-indies.mjs <file.indies> ...");
  process.exit(1);
}

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("MISSING:", f);
    continue;
  }
  const buf = fs.readFileSync(f);
  console.log("\n===", f, "size", buf.length);
  const zip = await JSZip.loadAsync(buf);
  console.log("entries:", Object.keys(zip.files).join(", "));
  const metaEntry = zip.file("meta.json");
  if (!metaEntry) {
    console.log("no meta.json");
    continue;
  }
  const meta = JSON.parse(await metaEntry.async("string"));
  console.log("SongTiming:", JSON.stringify(meta.SongTiming, null, 2));
  const noteCounts = {};
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v) && v[0]?.Beat !== undefined) noteCounts[k] = v.length;
  }
  console.log("note arrays:", noteCounts);
  console.log("offset:", meta.offset ?? meta.Offset ?? "(none)");
}