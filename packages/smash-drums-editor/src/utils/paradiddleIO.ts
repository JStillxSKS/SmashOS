import type { ChartNote, Difficulty, MetaJson, TimingAnchor } from "../types/meta";
import { createEmptyMeta } from "./metaIO";
import { clampDrumStrength, sortChartNotes } from "./chartNotes";
import { anchorsFromBpm, sortTimingAnchors, timeToBeat } from "./timing";

type ParadiddleEvent = {
  name?: string;
  vel?: number;
  time?: string | number;
};

type ParadiddleBpmEvent = {
  bpm?: number;
  time?: number;
};

type ParadiddleRecording = {
  title?: string;
  artist?: string;
  creator?: string;
  coverImagePath?: string;
  length?: number;
};

type ParadiddleAudioData = {
  songTracks?: string[];
  drumTracks?: string[];
  calibrationOffset?: number;
};

export type ParadiddleChart = {
  version?: number;
  recordingMetadata?: ParadiddleRecording;
  audioFileData?: ParadiddleAudioData;
  events?: ParadiddleEvent[];
  bpmEvents?: ParadiddleBpmEvent[];
};

export type ParadiddlePackage = {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  audioFileName: string | null;
  coverFileName: string | null;
};

export function isRlrrFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".rlrr");
}

export function isParadiddleChart(data: unknown): data is ParadiddleChart {
  if (!data || typeof data !== "object") return false;
  const chart = data as ParadiddleChart;
  return Array.isArray(chart.events) && chart.events.length > 0;
}

function paradiddleInstrumentToId(name: string): ChartNote["Id"] | null {
  const upper = name.toUpperCase();
  if (upper.includes("KICK")) return 0;
  if (upper.includes("SNARE")) return 1;
  if (upper.includes("CRASH") || upper.includes("RIDE") || upper.includes("CYM")) return 2;
  if (upper.includes("TOM") || upper.includes("FLOOR")) return 3;
  if (upper.includes("HIHAT") || upper.includes("HI_HAT")) return 4;
  return null;
}

function paradiddleVelToStrength(vel: number): ChartNote["Strength"] {
  if (vel < 70) return clampDrumStrength(0);
  if (vel > 110) return clampDrumStrength(2);
  return clampDrumStrength(1);
}

function difficultyFromFilename(filename: string): Difficulty {
  const stem = filename.replace(/\.[^.]+$/, "");
  if (/_easy$/i.test(stem)) return "easy";
  if (/_normal$/i.test(stem) || /_medium$/i.test(stem)) return "normal";
  if (/_hard$/i.test(stem)) return "hard";
  return "extreme";
}

function paradiddleBpmToAnchors(bpmEvents: ParadiddleBpmEvent[]): TimingAnchor[] {
  const sorted = bpmEvents
    .filter((ev) => ev.bpm != null && Number.isFinite(ev.bpm))
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  if (sorted.length === 0) return anchorsFromBpm(120);
  if (sorted.length === 1) return anchorsFromBpm(sorted[0].bpm!);

  const anchors: TimingAnchor[] = [];
  let beat = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    const timer = ev.time ?? 0;
    anchors.push({ beat, timer });
    const next = sorted[i + 1];
    if (!next) {
      const dt = (4 * 60) / ev.bpm!;
      anchors.push({ beat: beat + 4, timer: timer + dt });
      break;
    }
    const dt = (next.time ?? timer) - timer;
    if (dt > 0) beat += (ev.bpm! / 60) * dt;
  }
  return sortTimingAnchors(anchors);
}

function pickAudioFileName(audio?: ParadiddleAudioData): string | null {
  if (!audio) return null;
  const tracks = audio.songTracks ?? [];
  const preferred = tracks.find((name) => /^song\./i.test(name));
  return preferred ?? tracks[0] ?? audio.drumTracks?.[0] ?? null;
}

function eventsToNotes(
  events: ParadiddleEvent[],
  anchors: TimingAnchor[],
  calibrationOffset: number
): ChartNote[] {
  const byCell = new Map<string, ChartNote>();

  for (const event of events) {
    const name = event.name?.trim();
    if (!name) continue;
    const id = paradiddleInstrumentToId(name);
    if (id == null) continue;

    const rawTime = Number(event.time);
    if (!Number.isFinite(rawTime)) continue;

    const chartTime = Math.max(0, rawTime - calibrationOffset);
    const beat = Math.round(timeToBeat(chartTime, anchors) * 1000) / 1000;
    byCell.set(`${beat}:${id}`, {
      Beat: beat,
      Id: id,
      Strength: paradiddleVelToStrength(event.vel ?? 100),
    });
  }

  return sortChartNotes([...byCell.values()]);
}

export function parseParadiddleChart(
  raw: ParadiddleChart,
  filename: string
): ParadiddlePackage {
  const recording = raw.recordingMetadata ?? {};
  const audio = raw.audioFileData;
  const calibrationOffset = audio?.calibrationOffset ?? 0;
  const anchors = paradiddleBpmToAnchors(raw.bpmEvents ?? []);
  const notes = eventsToNotes(raw.events ?? [], anchors, calibrationOffset);
  const difficulty = difficultyFromFilename(filename);

  const charts: Record<Difficulty, ChartNote[]> = {
    easy: [],
    normal: [],
    hard: [],
    extreme: [],
  };
  charts[difficulty] = notes;

  const meta = createEmptyMeta();
  meta.NameSong = recording.title?.trim() || meta.NameSong;
  meta.NameArtist = recording.artist?.trim() || meta.NameArtist;
  meta.NameCharter = recording.creator?.trim() || meta.NameCharter;
  meta.SongOffsetSeconds = calibrationOffset;
  meta.SongTiming = anchors;
  meta.SongPhases = [{ beat: 0, phase: 1, power: 1, phaseName: "Intro" }];

  return {
    meta,
    charts,
    audioFileName: pickAudioFileName(audio),
    coverFileName: recording.coverImagePath?.trim() || null,
  };
}

/** Paradiddle on Windows often writes UTF-16 LE; browser File.text() assumes UTF-8. */
async function readRlrrText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
  }
  let text = new TextDecoder(encoding).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export async function parseRlrrFile(file: File): Promise<ParadiddlePackage | null> {
  if (!isRlrrFile(file)) return null;
  try {
    const data = JSON.parse(await readRlrrText(file)) as unknown;
    if (!isParadiddleChart(data)) return null;
    return parseParadiddleChart(data, file.name);
  } catch {
    return null;
  }
}