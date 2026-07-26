import type { ChartNote, Difficulty, MetaJson } from "../types/meta";

export type HistorySnapshot = {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
};

const MAX_DEPTH = 50;
const COALESCE_MS = 300;

export type HistoryTag = "offset" | "meta" | "chart" | "timing" | "phase";

let past: HistorySnapshot[] = [];
let future: HistorySnapshot[] = [];
let lastCommitTime = 0;
let lastCommitTag: HistoryTag | null = null;

function cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HistorySnapshot;
}

export function extractSnapshot(state: {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
}): HistorySnapshot {
  return cloneSnapshot({ meta: state.meta, charts: state.charts });
}

function shouldCoalesce(tag: HistoryTag, now: number): boolean {
  return (
    tag === lastCommitTag &&
    (tag === "offset" || tag === "meta") &&
    now - lastCommitTime < COALESCE_MS
  );
}

/** Save current chart state before a mutation. Returns true if the undo stack changed. */
export function commitHistory(snapshot: HistorySnapshot, tag: HistoryTag): boolean {
  const now = Date.now();
  if (shouldCoalesce(tag, now)) {
    lastCommitTime = now;
    return false;
  }

  past.push(cloneSnapshot(snapshot));
  if (past.length > MAX_DEPTH) past.shift();
  future = [];
  lastCommitTime = now;
  lastCommitTag = tag;
  return true;
}

export function clearHistory(): void {
  past = [];
  future = [];
  lastCommitTime = 0;
  lastCommitTag = null;
}

export function undoDepth(): number {
  return past.length;
}

export function redoDepth(): number {
  return future.length;
}

export function undo(current: HistorySnapshot): HistorySnapshot | null {
  if (past.length === 0) return null;
  const prev = past.pop()!;
  future.push(cloneSnapshot(current));
  lastCommitTag = null;
  return cloneSnapshot(prev);
}

export function redo(current: HistorySnapshot): HistorySnapshot | null {
  if (future.length === 0) return null;
  const next = future.pop()!;
  past.push(cloneSnapshot(current));
  lastCommitTag = null;
  return cloneSnapshot(next);
}