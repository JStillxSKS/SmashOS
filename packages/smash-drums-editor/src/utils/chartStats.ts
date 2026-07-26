import type { ChartNote, Difficulty, MetaJson } from "../types/meta";
import { TICKS_PER_MEASURE, beatToTick } from "./resolution";
import { beatToTime } from "./timing";

export type DifficultyStats = {
  noteCount: number;
  /** Notes per second across the charted time span */
  nps: number;
  chartSeconds: number;
  peakMeasure: number;
  peakMeasureNotes: number;
};

export type ChartStats = Record<Difficulty, DifficultyStats>;

function maxBeat(notes: ChartNote[]): number {
  let max = 0;
  for (const note of notes) max = Math.max(max, note.Beat);
  return max;
}

function measureNoteCounts(notes: ChartNote[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const note of notes) {
    const measure = Math.floor(beatToTick(note.Beat) / TICKS_PER_MEASURE);
    counts.set(measure, (counts.get(measure) ?? 0) + 1);
  }
  return counts;
}

export function statsForDifficulty(
  notes: ChartNote[],
  timing: MetaJson["SongTiming"],
  fallbackDuration: number
): DifficultyStats {
  const noteCount = notes.length;
  if (noteCount === 0) {
    return {
      noteCount: 0,
      nps: 0,
      chartSeconds: 0,
      peakMeasure: 0,
      peakMeasureNotes: 0,
    };
  }

  const endBeat = maxBeat(notes);
  const chartSeconds = Math.max(
    beatToTime(endBeat, timing),
    fallbackDuration > 0 ? fallbackDuration : 0,
    0.001
  );

  const counts = measureNoteCounts(notes);
  let peakMeasure = 0;
  let peakMeasureNotes = 0;
  for (const [measure, count] of counts) {
    if (count > peakMeasureNotes) {
      peakMeasure = measure;
      peakMeasureNotes = count;
    }
  }

  return {
    noteCount,
    nps: Math.round((noteCount / chartSeconds) * 100) / 100,
    chartSeconds: Math.round(chartSeconds * 100) / 100,
    peakMeasure,
    peakMeasureNotes,
  };
}

export function computeChartStats(
  charts: Record<Difficulty, ChartNote[]>,
  meta: MetaJson,
  audioDuration: number
): ChartStats {
  const timing = meta.SongTiming;
  return {
    easy: statsForDifficulty(charts.easy, timing, audioDuration),
    normal: statsForDifficulty(charts.normal, timing, audioDuration),
    hard: statsForDifficulty(charts.hard, timing, audioDuration),
    extreme: statsForDifficulty(charts.extreme, timing, audioDuration),
  };
}