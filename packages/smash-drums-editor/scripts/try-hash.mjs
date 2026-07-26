import fs from "fs";
import crypto from "crypto";
import JSZip from "jszip";

const KNOWN = {
  "3CUhATcr": { title: "Danger", artist: "Shotty Horroh", file: "Danger.indies" },
  "3FqVcLYK": { title: "Rockstar", artist: "HARDY", file: "Rockstar.indies" },
  BcdTd4hd: { title: "Enter Sandman", artist: "Metallica", file: null },
};

const BASE_DIR = "C:/Users/JStillxSKS/Desktop/Smash Drums Editor/output";

function unityHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function toBase64Url(buf, len = 8) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, len);
}

function tryHashes(label, inputs) {
  const results = [];
  for (const [name, raw] of Object.entries(inputs)) {
    const s = typeof raw === "string" ? raw : String(raw);
    const md5 = crypto.createHash("md5").update(s).digest();
    const sha1 = crypto.createHash("sha1").update(s).digest();
    const sha256 = crypto.createHash("sha256").update(s).digest();
    const crc = crc32(s);
    results.push({
      name,
      input: s.slice(0, 80),
      md5b64_8: toBase64Url(md5, 8),
      sha1b64_8: toBase64Url(sha1, 8),
      sha256b64_8: toBase64Url(sha256, 8),
      md5hex_8: md5.toString("hex").slice(0, 8),
      sha1hex_8: sha1.toString("hex").slice(0, 8),
      unity_u32: unityHash(s).toString(36),
      crc32_b64: toBase64Url(Buffer.from([
        (crc >>> 24) & 255,
        (crc >>> 16) & 255,
        (crc >>> 8) & 255,
        crc & 255,
      ]), 8),
      crc32_hex: crc.toString(16).padStart(8, "0"),
    });
  }
  console.log(`\n=== ${label} ===`);
  console.table(results);
}

function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dotnetStringHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash | 0;
}

function fnv1a64(str) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

function b64FromInt64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(n);
  return toBase64Url(buf, 8);
}

function b64FromInt32(n) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(n);
  return toBase64Url(buf, 6);
}

const QUEST_PATHS = (filename) => [
  filename,
  `${filename}.indies`,
  `Indies/${filename}.indies`,
  `SmashDrums/Indies/${filename}.indies`,
  `/SmashDrums/Indies/${filename}.indies`,
  `/storage/emulated/0/SmashDrums/Indies/${filename}.indies`,
  `/storage/emulated/0/Android/data/com.PotamWorks.SmashDrums/files/Indies/${filename}.indies`,
  `com.PotamWorks.SmashDrums/files/Indies/${filename}.indies`,
];

async function loadMeta(file) {
  const path = `${BASE_DIR}/${file}`;
  const buf = fs.readFileSync(path);
  const zip = await JSZip.loadAsync(buf);
  const meta = JSON.parse(await zip.file("meta.json").async("string"));
  const audio = await zip.file("audio.ogg").async("uint8array");
  const cover = zip.file("cover.png")
    ? await zip.file("cover.png").async("uint8array")
    : null;
  return { meta, audio, cover, buf, zipNames: Object.keys(zip.files) };
}

for (const [hash, info] of Object.entries(KNOWN)) {
  console.log(`\nTarget hash: ${hash} → ${info.title} / ${info.artist}`);
  if (!info.file) continue;
  const { meta, audio, cover, buf, zipNames } = await loadMeta(info.file);
  const title = meta.NameSong?.trim() ?? info.title;
  const artist = meta.NameArtist?.trim() ?? info.artist;
  const charter = meta.NameCharter?.trim() ?? "";
  const filename = info.file.replace(/\.indies$/i, "");

  const pathInputs = Object.fromEntries(
    QUEST_PATHS(filename).map((p, i) => [`path${i}`, p]),
  );

  tryHashes("string inputs", {
    title,
    artist,
    charter,
    FilePath: meta.FilePath ?? "",
    "title|artist": `${title}|${artist}`,
    "artist|title": `${artist}|${title}`,
    filename,
    "filename.indies": `${filename}.indies`,
    "[Indies] title": `[Indies] ${title}`,
    metaJson: JSON.stringify(meta),
    metaJsonNoCharts: JSON.stringify(
      Object.fromEntries(
        Object.entries(meta).filter(([k]) => !k.startsWith("Chart")),
      ),
    ),
    ...pathInputs,
  });

  const dotnetHits = [];
  for (const [name, raw] of Object.entries({ title, artist, filename, ...pathInputs })) {
    const h = dotnetStringHash(raw);
    const b64 = b64FromInt32(h);
    if (b64 === hash || b64.slice(0, 8) === hash) dotnetHits.push({ name, raw, h, b64 });
    const fnv = fnv1a64(raw);
    const fnvB64 = b64FromInt64(fnv);
    if (fnvB64 === hash) dotnetHits.push({ name, raw, fnv: fnv.toString(16), fnvB64 });
  }
  if (dotnetHits.length) console.log("dotnet/fnv hits:", dotnetHits);

  tryHashes("binary inputs", {
    zipBytes_md5: crypto.createHash("md5").update(buf).digest("hex"),
    audio_md5: crypto.createHash("md5").update(audio).digest("hex"),
    audio_sha1_8: crypto.createHash("sha1").update(audio).digest("hex").slice(0, 8),
    cover_md5: cover ? crypto.createHash("md5").update(cover).digest("hex") : "(none)",
  });

  console.log("zip entries:", zipNames.join(", "));
  console.log("meta non-chart keys:", Object.keys(meta).filter((k) => !k.startsWith("Chart")));
}