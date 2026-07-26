import type { MetaJson } from "../types/meta";
import { sortTimingAnchors } from "./timing";

export const OFFSET_NUDGE_FINE_MS = 10;
export const OFFSET_NUDGE_COARSE_MS = 100;

/**
 * Seconds of chart time before audio begins.
 * In the editor, SongOffsetSeconds is authoritative and SongTiming[0].timer stays at 0.
 * Imported/exported Indies packs may bake offset into SongTiming[0].timer instead.
 */
export function getSongOffset(meta: Pick<MetaJson, "SongOffsetSeconds" | "SongTiming">): number {
  if (meta.SongOffsetSeconds > 0) return meta.SongOffsetSeconds;
  const sorted = sortTimingAnchors(meta.SongTiming);
  const first = sorted[0];
  const timingOffset = first?.beat === 0 ? first.timer : 0;
  return Math.max(timingOffset, meta.SongOffsetSeconds);
}

export function offsetToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

export function offsetFromMs(ms: number): number {
  return ms / 1000;
}

/** Chart time is in the silent lead-in before audio begins */
export function isInSilentLeadIn(chartTime: number, offsetSeconds: number): boolean {
  return chartTime < offsetSeconds;
}

/** Chart timeline → audio element position (0 during silent lead-in) */
export function chartToAudioTime(chartTime: number, offsetSeconds: number): number {
  if (chartTime < offsetSeconds) return 0;
  return chartTime - offsetSeconds;
}

/** Audio file position → chart timeline */
export function audioToChartTime(audioTime: number, offsetSeconds: number): number {
  return audioTime + offsetSeconds;
}