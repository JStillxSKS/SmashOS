import type { ChartNote, Difficulty, MetaJson } from "../types/meta";
import { getSongOffset } from "./offset";
import { RESOLUTION } from "./resolution";
import { maxContentBeat, timeToBeat } from "./timing";

const MIN_BEATS = 8;
const END_PADDING_BEATS = 4;

export function songExtentTicks(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  duration: number
): number {
  let maxBeat = Math.max(maxContentBeat(meta, charts), MIN_BEATS);

  if (duration > 0) {
    const endBeat = timeToBeat(duration + getSongOffset(meta), meta.SongTiming);
    maxBeat = Math.max(maxBeat, endBeat);
  }

  return Math.ceil((maxBeat + END_PADDING_BEATS) * RESOLUTION);
}