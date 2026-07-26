import type { ChartNote, Difficulty, MetaJson, TimingAnchor } from "../types/meta";
import { RESOLUTION } from "./resolution";

const MIN_SEGMENT_BPM = 1;
const MAX_SEGMENT_BPM = 999;
const TIME_EPS = 1e-9;
const BEAT_EPS = 1 / RESOLUTION;

export function sortTimingAnchors(anchors: TimingAnchor[]): TimingAnchor[] {
  return [...anchors].sort((a, b) => a.beat - b.beat || a.timer - b.timer);
}

function roundTime(seconds: number): number {
  return Math.round(seconds * 1_000_000) / 1_000_000;
}

function clampSegmentBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 120;
  return Math.max(MIN_SEGMENT_BPM, Math.min(MAX_SEGMENT_BPM, bpm));
}

/** BPM of the constant-tempo segment from anchors[i] → anchors[i+1]. */
export function segmentBpm(a: TimingAnchor, b: TimingAnchor): number {
  const beats = b.beat - a.beat;
  const span = b.timer - a.timer;
  if (beats <= BEAT_EPS || span <= TIME_EPS) return 120;
  return clampSegmentBpm((beats / span) * 60);
}

/** Segment BPMs for every consecutive pair (Moonscraper B values). */
export function extractSegmentBpms(anchors: TimingAnchor[]): number[] {
  const sorted = sortTimingAnchors(anchors);
  const bpms: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    bpms.push(segmentBpm(sorted[i], sorted[i + 1]));
  }
  return bpms;
}

/**
 * Rebuild absolute timers from a BPM chain (Moonscraper model).
 *
 * - Marker 0 timer is kept (editor form: usually 0; offset lives separately).
 * - Segment i BPM applies from marker i until marker i+1.
 * - If marker i+1 is **anchored**, its timer is locked and segment i BPM is
 *   forced to hit that time (same as MS locked BPM markers).
 * - Otherwise timer[i+1] = timer[i] + beats × 60 / bpm.
 */
export function retimeFromSegmentBpms(
  anchors: TimingAnchor[],
  segmentBpms: number[],
  fromIndex = 0
): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors).map((a) => ({ ...a }));
  if (sorted.length < 2) return sorted;

  const bpms = segmentBpms.map(clampSegmentBpm);
  const start = Math.max(0, Math.min(fromIndex, sorted.length - 2));

  for (let i = start; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const beats = next.beat - cur.beat;
    if (beats <= BEAT_EPS) {
      sorted[i + 1] = { ...next, timer: cur.timer };
      continue;
    }

    if (next.anchored) {
      // Lock absolute time; derive the segment BPM that reaches it.
      let span = next.timer - cur.timer;
      if (span <= TIME_EPS) {
        const bpm = bpms[i] ?? 120;
        span = beats * (60 / bpm);
        sorted[i + 1] = { ...next, timer: roundTime(cur.timer + span) };
      }
      bpms[i] = clampSegmentBpm((beats / Math.max(span, TIME_EPS)) * 60);
      continue;
    }

    const bpm = bpms[i] ?? 120;
    sorted[i + 1] = {
      ...next,
      timer: roundTime(cur.timer + beats * (60 / bpm)),
    };
  }

  if (sorted[0]?.beat === 0) {
    sorted[0] = { ...sorted[0], timer: 0, anchored: sorted[0].anchored };
  }

  return sorted;
}

/** Set the BPM that applies forward from marker `index` (Moonscraper B edit). */
export function setMarkerBpm(anchors: TimingAnchor[], index: number, bpm: number): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length < 2 || index < 0 || index >= sorted.length - 1) return sorted;

  const bpms = extractSegmentBpms(sorted);
  bpms[index] = clampSegmentBpm(bpm);
  // Free the next marker’s time so the new BPM can take effect (unless user locked it).
  return retimeFromSegmentBpms(sorted, bpms, index);
}

/**
 * Set absolute time of marker `index` by adjusting the *previous* segment BPM
 * (Moonscraper ctrl+drag style). Later free markers retime; later anchored stay.
 */
export function setMarkerTime(anchors: TimingAnchor[], index: number, time: number): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors).map((a) => ({ ...a }));
  if (sorted.length < 2 || index <= 0 || index >= sorted.length) return sorted;

  // Capture existing segment BPMs *before* moving this marker’s time so later
  // free markers keep their rates (Moonscraper ctrl+drag).
  const bpms = extractSegmentBpms(sorted);
  const prev = sorted[index - 1];
  const beats = sorted[index].beat - prev.beat;
  const nextTime = Math.max(prev.timer + TIME_EPS, time);
  sorted[index] = { ...sorted[index], timer: roundTime(nextTime) };

  if (beats > BEAT_EPS) {
    bpms[index - 1] = clampSegmentBpm((beats / (nextTime - prev.timer)) * 60);
  }

  return retimeFromSegmentBpms(sorted, bpms, index - 1);
}

/** Move a marker to a whole beat; retimes with existing segment BPMs. */
export function setMarkerBeat(anchors: TimingAnchor[], index: number, beat: number): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors).map((a) => ({ ...a }));
  if (index < 0 || index >= sorted.length) return sorted;

  // Game requires integer SongTiming beats.
  let nextBeat = Math.max(0, Math.round(beat));
  if (index === 0) {
    nextBeat = 0;
  } else {
    const minBeat = Math.floor(sorted[index - 1].beat) + 1;
    const maxBeat =
      index < sorted.length - 1 ? Math.ceil(sorted[index + 1].beat) - 1 : nextBeat;
    if (maxBeat >= minBeat) {
      nextBeat = Math.max(minBeat, Math.min(maxBeat, nextBeat));
    } else {
      nextBeat = minBeat;
    }
  }

  const bpms = extractSegmentBpms(sorted);
  sorted[index] = { ...sorted[index], beat: nextBeat };
  const from = Math.max(0, index - 1);
  return retimeFromSegmentBpms(sorted, bpms, from);
}

export function setMarkerAnchored(
  anchors: TimingAnchor[],
  index: number,
  anchored: boolean
): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors).map((a) => ({ ...a }));
  if (index < 0 || index >= sorted.length) return sorted;
  // Beat 0 is the chain root — lock is meaningless there.
  if (index === 0) {
    sorted[0] = { ...sorted[0], anchored: false };
    return sorted;
  }
  sorted[index] = { ...sorted[index], anchored: anchored || undefined };
  if (!anchored) {
    delete sorted[index].anchored;
  }
  return sorted;
}

/** Insert a BPM marker on a whole beat (game SongTiming beats are ints). */
export function insertMarkerAtBeat(anchors: TimingAnchor[], beat: number): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  // Smash SongTimingItem.beat is int — never place fractional tempo markers.
  const snapped = Math.max(0, Math.round(beat));
  if (sorted.length === 0) return anchorsFromBpm(120);

  const existing = sorted.findIndex((a) => Math.abs(a.beat - snapped) <= BEAT_EPS);
  if (existing >= 0) return sorted;

  const timer = roundTime(beatToTime(snapped, sorted));
  const next: TimingAnchor = { beat: snapped, timer };
  return sortTimingAnchors([...sorted, next]);
}

export function removeMarkerAtIndex(anchors: TimingAnchor[], index: number): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length <= 2 || index < 0 || index >= sorted.length) return sorted;
  // Keep beat 0.
  if (index === 0 && sorted[0].beat === 0) return sorted;

  const bpms = extractSegmentBpms(sorted);
  // Removing marker i: join segment i-1 and i with bpm of the left segment.
  const removed = sorted.filter((_, i) => i !== index);
  if (removed.length < 2) return sorted;

  const newBpms: number[] = [];
  for (let i = 0; i < removed.length - 1; i++) {
    // Map back to old segments roughly
    const leftBeat = removed[i].beat;
    const oldLeft = sorted.findIndex((a) => Math.abs(a.beat - leftBeat) <= BEAT_EPS);
    if (oldLeft >= 0 && oldLeft < bpms.length) {
      newBpms.push(bpms[oldLeft]);
    } else if (i < bpms.length) {
      newBpms.push(bpms[Math.min(i, bpms.length - 1)]);
    } else {
      newBpms.push(120);
    }
  }

  return retimeFromSegmentBpms(removed, newBpms, Math.max(0, index - 1));
}

export function beatToTime(beat: number, anchors: TimingAnchor[]): number {
  if (anchors.length === 0) return 0;
  const sorted = [...anchors].sort((a, b) => a.beat - b.beat);

  if (beat <= sorted[0].beat) {
    if (sorted.length < 2) return sorted[0].timer;
    const [a, b] = sorted;
    return a.timer + ((beat - a.beat) * (b.timer - a.timer)) / (b.beat - a.beat);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (beat >= a.beat && beat <= b.beat) {
      const ratio = (beat - a.beat) / (b.beat - a.beat);
      return a.timer + ratio * (b.timer - a.timer);
    }
  }

  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  return last.timer + ((beat - last.beat) * (last.timer - prev.timer)) / (last.beat - prev.beat);
}

export function timeToBeat(time: number, anchors: TimingAnchor[]): number {
  if (anchors.length === 0) return 0;
  const sorted = [...anchors].sort((a, b) => a.beat - b.beat);

  if (time <= sorted[0].timer) {
    if (sorted.length < 2) return sorted[0].beat;
    const [a, b] = sorted;
    return a.beat + ((time - a.timer) * (b.beat - a.beat)) / (b.timer - a.timer);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.timer && time <= b.timer) {
      const ratio = (time - a.timer) / (b.timer - a.timer);
      return a.beat + ratio * (b.beat - a.beat);
    }
  }

  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  return last.beat + ((time - last.timer) * (last.beat - prev.beat)) / (last.timer - prev.timer);
}

export function bpmFromAnchors(anchors: TimingAnchor[]): number {
  const sorted = [...anchors].sort((a, b) => a.beat - b.beat);
  if (sorted.length < 2) return 120;
  const span = sorted[1].timer - sorted[0].timer;
  const beats = sorted[1].beat - sorted[0].beat;
  if (span <= 0 || beats <= 0) return 120;
  return normalizeSongBpm((beats / span) * 60);
}

/** Whole-number song BPM (40–300), matching the toolbar field. */
export function normalizeSongBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.round(Math.max(40, Math.min(300, bpm)));
}

/** Snap a beat to the internal tick grid (480 ticks/beat). */
export function quantizeBeat(beat: number): number {
  if (!Number.isFinite(beat)) return 0;
  return Math.max(0, Math.round(beat * RESOLUTION) / RESOLUTION);
}

/**
 * Constant-tempo map matching common Indies packs:
 * beat 0, beat 1 (defines BPM), and an end anchor.
 *
 * Beats are whole numbers — Smash `SongTimingItem.beat` is an `int`.
 */
export function buildConstantBpmTiming(bpm: number, endBeat = 4): TimingAnchor[] {
  const whole = normalizeSongBpm(bpm);
  const spb = 60 / whole;
  // Integer end beat only (game coerces floats → int and warps BPM).
  const end = Math.max(4, Math.ceil(endBeat - 1e-9));
  if (end <= 1) {
    return [
      { beat: 0, timer: 0 },
      { beat: 1, timer: roundTime(spb) },
    ];
  }
  return [
    { beat: 0, timer: 0 },
    { beat: 1, timer: roundTime(spb) },
    { beat: end, timer: roundTime(end * spb) },
  ];
}

/**
 * Smash Drums game: `SongTimingItem.beat` is `int`.
 * Fractional anchors (e.g. 312.68125) look fine in the editor but the game
 * truncates/rounds them and the tempo map drifts vs audio.
 *
 * Snap every marker to a whole beat, keep segment BPMs, retime timers.
 * Official Indies packs only use integer beats on SongTiming.
 */
export function normalizeSongTimingForGame(anchors: TimingAnchor[]): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length === 0) return anchorsFromBpm(120);
  if (sorted.length === 1) {
    return [
      { beat: 0, timer: 0 },
      {
        beat: 4,
        timer: roundTime(4 * (60 / 120)),
        ...(sorted[0].anchored ? { anchored: true as const } : {}),
      },
    ];
  }

  const alreadyInteger = sorted.every((a) => Number.isInteger(a.beat));
  if (alreadyInteger) {
    // Still force beat 0 timer 0 for editor-style maps.
    if (sorted[0].beat === 0 && sorted[0].timer === 0) return sorted;
  }

  const bpms = extractSegmentBpms(sorted);
  const snapped: TimingAnchor[] = [];

  for (let i = 0; i < sorted.length; i++) {
    let beat = i === 0 ? 0 : Math.round(sorted[i].beat);
    if (i > 0) {
      const minBeat = snapped[snapped.length - 1].beat + 1;
      if (beat < minBeat) beat = minBeat;
    }
    snapped.push({
      beat,
      timer: sorted[i].timer,
      ...(sorted[i].anchored ? { anchored: true as const } : {}),
    });
  }

  // Drop accidental duplicates after rounding (merge into last).
  const deduped: TimingAnchor[] = [];
  const dedupedBpms: number[] = [];
  for (let i = 0; i < snapped.length; i++) {
    if (deduped.length > 0 && snapped[i].beat === deduped[deduped.length - 1].beat) {
      deduped[deduped.length - 1] = {
        ...snapped[i],
        anchored: snapped[i].anchored || deduped[deduped.length - 1].anchored,
      };
      if (i < bpms.length) {
        dedupedBpms[dedupedBpms.length - 1] = bpms[i];
      }
      continue;
    }
    deduped.push(snapped[i]);
    if (i < bpms.length) dedupedBpms.push(bpms[i]);
  }

  if (deduped.length < 2) return buildConstantBpmTiming(120, 4);

  // One fewer BPM than markers.
  while (dedupedBpms.length < deduped.length - 1) {
    dedupedBpms.push(dedupedBpms[dedupedBpms.length - 1] ?? 120);
  }
  while (dedupedBpms.length > deduped.length - 1) dedupedBpms.pop();

  return retimeFromSegmentBpms(deduped, dedupedBpms, 0);
}

/** Minimal two-point map (beat 0 → 4). Prefer buildConstantBpmTiming for full songs. */
export function anchorsFromBpm(bpm: number): TimingAnchor[] {
  const whole = normalizeSongBpm(bpm);
  const spb = 60 / whole;
  return [
    { beat: 0, timer: 0 },
    { beat: 4, timer: roundTime(4 * spb) },
  ];
}

/** Map a beat through absolute time so hits stay locked to the audio. */
export function remapBeatAcrossTiming(
  beat: number,
  oldTiming: TimingAnchor[],
  newTiming: TimingAnchor[]
): number {
  const time = beatToTime(beat, oldTiming);
  return quantizeBeat(timeToBeat(time, newTiming));
}

/**
 * Apply a new constant whole-number BPM (toolbar / Sync / Tap).
 *
 * Moonscraper-style: notes stay on their beats; only the tempo map changes,
 * so the grid stretches/squeezes against the audio. Mid-song markers are
 * replaced by a clean constant map (same as setting one B at tick 0).
 */
export function applyConstantBpmChange(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  bpm: number
): { meta: MetaJson; charts: Record<Difficulty, ChartNote[]>; changed: boolean } {
  const whole = normalizeSongBpm(bpm);
  const oldTiming = sortTimingAnchors(meta.SongTiming);

  if (oldTiming.length >= 2 && bpmFromAnchors(oldTiming) === whole) {
    // Same integer BPM and already a simple map — avoid timer jitter.
    const onlyConstant =
      oldTiming.length <= 3 &&
      extractSegmentBpms(oldTiming).every((b) => Math.abs(b - whole) < 0.05);
    if (onlyConstant) {
      return { meta, charts, changed: false };
    }
  }

  const endBeat = Math.max(4, quantizeBeat(maxContentBeat(meta, charts) + 4));
  const newTiming = buildConstantBpmTiming(whole, endBeat);

  return {
    meta: { ...meta, SongTiming: newTiming },
    charts,
    changed: true,
  };
}

export function bpmAtAnchor(anchors: TimingAnchor[], index: number): number {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length < 2) return 120;

  if (index < sorted.length - 1) {
    return segmentBpm(sorted[index], sorted[index + 1]);
  }

  if (index > 0) {
    return segmentBpm(sorted[index - 1], sorted[index]);
  }

  return 120;
}

/** BPM that applies at a beat position (forwards from the last marker at/before beat). */
export function bpmAtBeat(beat: number, anchors: TimingAnchor[]): number {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length < 2) return bpmFromAnchors(sorted);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (beat >= a.beat && beat < b.beat - TIME_EPS) return segmentBpm(a, b);
    if (Math.abs(beat - b.beat) <= BEAT_EPS && i + 1 < sorted.length - 1) {
      return segmentBpm(sorted[i + 1], sorted[i + 2]);
    }
  }

  return segmentBpm(sorted[sorted.length - 2], sorted[sorted.length - 1]);
}

export function maxContentBeat(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): number {
  let max = 0;
  for (const anchor of meta.SongTiming) max = Math.max(max, anchor.beat);
  for (const phase of meta.SongPhases) max = Math.max(max, phase.beat);
  for (const notes of Object.values(charts)) {
    for (const note of notes) max = Math.max(max, note.Beat);
  }
  return max;
}

/** Ensure a closing anchor exists through the last charted beat (integer beat). */
export function ensureEndAnchor(
  anchors: TimingAnchor[],
  endBeat: number
): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length === 0) return anchorsFromBpm(120);

  const end = Math.max(4, Math.ceil(endBeat - 1e-9));
  const last = sorted[sorted.length - 1];
  if (last.beat >= end - BEAT_EPS) return sorted;

  return [
    ...sorted,
    { beat: end, timer: roundTime(beatToTime(end, sorted)) },
  ];
}

/** Collapse per-beat anchors into tempo-change points for [SyncTrack]. */
export function simplifyAnchorsForSync(
  anchors: TimingAnchor[],
  toleranceBpm = 0.25
): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length <= 2) return sorted;

  const result: TimingAnchor[] = [sorted[0]];
  let lastBpm = bpmAtAnchor(sorted, 0);

  for (let i = 1; i < sorted.length; i++) {
    const bpm = bpmAtAnchor(sorted, i);
    if (Math.abs(bpm - lastBpm) > toleranceBpm || sorted[i].anchored) {
      result.push(sorted[i]);
      lastBpm = bpm;
    }
  }

  const tail = sorted[sorted.length - 1];
  const prev = result[result.length - 1];
  if (Math.abs(prev.beat - tail.beat) > BEAT_EPS || Math.abs(prev.timer - tail.timer) > 0.001) {
    result.push(tail);
  }

  return result.length >= 2 ? result : sorted.slice(0, 2);
}

export function prepareSyncAnchors(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): TimingAnchor[] {
  const endBeat = Math.max(maxContentBeat(meta, charts), 4);
  return simplifyAnchorsForSync(ensureEndAnchor(meta.SongTiming, endBeat));
}
