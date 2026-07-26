import fs from "fs";
import JSZip from "jszip";

function oggDuration(buf) {
  let lastGranule = 0,
    sampleRate = 44100,
    pos = 0;
  while (pos < buf.length - 27) {
    if (buf[pos] !== 0x4f || buf[pos + 1] !== 0x67 || buf[pos + 2] !== 0x67 || buf[pos + 3] !== 0x53) {
      pos++;
      continue;
    }
    const headerType = buf[pos + 5];
    const segCount = buf[pos + 26];
    const segTableStart = pos + 27;
    const pageBodyStart = segTableStart + segCount;
    let bodySize = 0;
    for (let i = 0; i < segCount; i++) bodySize += buf[segTableStart + i];
    if (headerType === 0 && pageBodyStart + bodySize <= buf.length) {
      const ident = buf.subarray(pageBodyStart, pageBodyStart + 30);
      if (ident[0] === 1) {
        sampleRate =
          ident[12] | (ident[13] << 8) | (ident[14] << 16) | (ident[15] << 24);
      }
    }
    const granule = Number(buf.readBigUInt64LE(pos + 6));
    if (granule > 0 && granule < 1e12) lastGranule = granule;
    pos = pageBodyStart + bodySize;
  }
  return sampleRate > 0 ? lastGranule / sampleRate : null;
}

function sortAnchors(anchors) {
  return [...anchors].sort((a, b) => a.beat - b.beat);
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

function timeToBeat(time, anchors) {
  const sorted = sortAnchors(anchors);
  if (time <= sorted[0].timer) {
    if (sorted.length < 2) return sorted[0].beat;
    const [a, b] = sorted;
    return a.beat + ((time - a.timer) * (b.beat - a.beat)) / (b.timer - a.timer);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.timer && time <= b.timer) {
      return a.beat + ((time - a.timer) / (b.timer - a.timer)) * (b.beat - a.beat);
    }
  }
  const last = sorted.at(-1);
  const prev = sorted.at(-2);
  return (
    last.beat +
    ((time - last.timer) * (last.beat - prev.beat)) / (last.timer - prev.timer)
  );
}

function maxNoteBeat(meta) {
  let max = 0;
  for (const key of ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"]) {
    for (const note of meta[key] ?? []) max = Math.max(max, note.Beat);
  }
  return max;
}

async function analyze(path) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path));
  const meta = JSON.parse(await zip.file("meta.json").async("string"));
  const audioDur = oggDuration(await zip.file("audio.ogg").async("nodebuffer"));
  const anchors = sortAnchors(meta.SongTiming);
  const last = anchors.at(-1);
  const maxBeat = maxNoteBeat(meta);
  const outro = meta.SongPhases.find((p) => p.phase === 7 || /outro/i.test(p.phaseName));
  const audioEndBeat = timeToBeat(audioDur, anchors);

  return {
    name: path.split(/[/\\]/).pop(),
    audioDur,
    anchors,
    last,
    maxBeat,
    maxNoteTime: beatToTime(maxBeat, anchors),
    outro,
    beatsAfterOutro: outro ? maxBeat - outro.beat : null,
    notePastAnchor: maxBeat > last.beat,
    anchorPastAudio: last.timer > audioDur,
    audioPastAnchor: audioDur > last.timer,
    audioEndBeat,
    anchorPastAudioSec: last.timer - audioDur,
    audioPastAnchorSec: audioDur - last.timer,
    gapAfterLastNote: audioDur - beatToTime(maxBeat, anchors),
  };
}

const files = process.argv.slice(2);
for (const f of files) {
  const r = await analyze(f);
  console.log("\n===", r.name, "===");
  console.log("SongTiming:", JSON.stringify(r.anchors));
  console.log("audio:", r.audioDur?.toFixed(3) + "s");
  console.log("last anchor:", r.last.beat, "@", r.last.timer.toFixed(3) + "s");
  console.log("max note:", r.maxBeat, "@", r.maxNoteTime.toFixed(3) + "s");
  console.log("audio end beat (extrapolated):", r.audioEndBeat.toFixed(3));
  console.log("note past anchor:", r.notePastAnchor);
  console.log("anchor past audio:", r.anchorPastAudio, `(${r.anchorPastAudioSec?.toFixed(3)}s)`);
  console.log("audio past anchor:", r.audioPastAnchor, `(${r.audioPastAnchorSec?.toFixed(3)}s)`);
  console.log("gap after last note until audio end:", r.gapAfterLastNote?.toFixed(3) + "s");
  if (r.outro) {
    console.log("outro:", r.outro.beat, "beats after outro:", r.beatsAfterOutro?.toFixed(2));
  } else {
    console.log("outro: (none)");
  }
}