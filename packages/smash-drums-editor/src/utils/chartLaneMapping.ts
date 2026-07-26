import type { ChartNote } from "../types/meta";
import { CH_CYMBAL_OFFSET, DRUM_LANES } from "../types/meta";
import { clampDrumId } from "./chartNotes";

/** Matches ChartDrumsParser.DrumInstrument base lanes 0–4. */
export const CH_BASE_LANES = [0, 1, 2, 3, 4] as const;

export const CH_STRONG_OFFSET = 33;
export const CH_LIGHT_OFFSET = 39;

/**
 * ChartDrumsParser.GetInstrument — CH pad + cymbal flag → Indies meta Id.
 * Lane 2 + cymbal → HiHat (4); lanes 3/4 + cymbal → Cymbal (2); pads 2–4 → Tom (3).
 */
export function getInstrumentId(baseLane: number, isCymbal: boolean): ChartNote["Id"] {
  switch (baseLane) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return isCymbal ? 4 : 3;
    case 3:
    case 4:
      return isCymbal ? 2 : 3;
    default:
      return clampDrumId(baseLane);
  }
}

export type ChDrumTickEntry = { tick: number; lane: number };

/** Parse one difficulty section the same way as ChartDrumsParser.ParseOneDifficulty. */
export function chDrumEntriesToNotes(
  entries: ChDrumTickEntry[],
  resolution: number
): ChartNote[] {
  const lanesByTick = new Map<number, number[]>();

  for (const entry of entries) {
    const lane = Math.round(entry.lane);
    if (!Number.isFinite(lane)) continue;
    const lanes = lanesByTick.get(entry.tick) ?? [];
    lanes.push(lane);
    lanesByTick.set(entry.tick, lanes);
  }

  const notes: ChartNote[] = [];

  for (const [tick, lanes] of [...lanesByTick.entries()].sort((a, b) => a[0] - b[0])) {
    const set = new Set(lanes);

    for (const baseLane of CH_BASE_LANES) {
      if (!set.has(baseLane)) continue;

      const isCymbal = set.has(baseLane + CH_CYMBAL_OFFSET);
      let strength: ChartNote["Strength"] = 1;
      if (set.has(baseLane + CH_STRONG_OFFSET)) strength = 2;
      else if (set.has(baseLane + CH_LIGHT_OFFSET)) strength = 0;

      notes.push({
        Beat: tick / resolution,
        Id: getInstrumentId(baseLane, isCymbal),
        Strength: strength,
      });
    }
  }

  return notes;
}

/**
 * Indies meta Id → CH ExpertDrums lane numbers for one note at a tick.
 * Cymbal/hi-hat notes emit base pad + cymbal flag (base + 64).
 */
export function indiesNoteToChLanes(note: ChartNote): number[] {
  const lane = DRUM_LANES.find((l) => l.id === note.Id && l.chExport);
  if (!lane) return [];

  const lanes = [lane.chLane];
  if (lane.chCymbal) lanes.push(lane.chLane + CH_CYMBAL_OFFSET);

  if (note.Strength === 2) lanes.push(lane.chLane + CH_STRONG_OFFSET);
  else if (note.Strength === 0) lanes.push(lane.chLane + CH_LIGHT_OFFSET);

  return lanes;
}