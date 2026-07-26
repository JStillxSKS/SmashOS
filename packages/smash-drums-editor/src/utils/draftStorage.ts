import type { ChartNote, Difficulty, MetaJson } from "../types/meta";
import { buildIndiesZip, sanitizeIndiesFilename } from "./indiesIO";
import { saveBlobFile } from "./fileSave";

const DB_NAME = "smash-drums-editor";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const DRAFT_KEY = "current";
const AUDIO_KEY = "current-audio";
const COVER_KEY = "current-cover";
const CLEAN_SAVE_KEY = "sde-last-clean-save-at";

export type ChartDraftPayload = {
  version: 1;
  savedAt: number;
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  difficulty: Difficulty;
  scrollTick: number;
  sourceIndiesPath: string | null;
  songLabel: string;
  noteCount: number;
  /** Relative output filename when a full .autosave.indies was written */
  diskAutosaveName: string | null;
  audioFileName: string | null;
  coverFileName: string | null;
  hasAudio: boolean;
  hasCover: boolean;
  /** Identity of last stored audio so we can skip re-writes */
  audioIdentity: string | null;
  coverIdentity: string | null;
};

export type StoredDraft = ChartDraftPayload & {
  audioBlob: Blob | null;
  coverBlob: Blob | null;
};

export type RecoveryCandidate = {
  id: string;
  label: string;
  savedAt: number;
  source: "session" | "disk";
  noteCount: number;
  hasAudio: boolean;
  /** Disk recovery only */
  diskName?: string;
  draft?: StoredDraft;
};

type MediaRecord = {
  identity: string;
  fileName: string | null;
  blob: Blob;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE);
      }
    };
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export function countNotes(charts: Record<Difficulty, ChartNote[]>): number {
  return (
    charts.easy.length +
    charts.normal.length +
    charts.hard.length +
    charts.extreme.length
  );
}

export function draftSongLabel(meta: MetaJson): string {
  const title = (meta.NameSong || "").trim();
  const artist = (meta.NameArtist || "").trim();
  if (title && artist) return `${artist} — ${title}`;
  if (title) return title;
  if (artist) return artist;
  return "Untitled Song";
}

export function autosaveDiskName(meta: MetaJson): string {
  const base = sanitizeIndiesFilename(meta.NameSong || meta.NameArtist || "song");
  return `${base}.autosave.indies`;
}

export function mediaIdentity(file: File | null | undefined): string | null {
  if (!file) return null;
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Meaningful work worth recovering (not a blank editor). */
export function draftIsWorthKeeping(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  hasAudio: boolean
): boolean {
  if (countNotes(charts) > 0) return true;
  if (hasAudio) return true;
  if ((meta.NameSong || "").trim() && (meta.NameSong || "").trim() !== "Untitled Song") {
    return true;
  }
  if ((meta.NameArtist || "").trim()) return true;
  if ((meta.SongTiming?.length ?? 0) > 1) return true;
  if ((meta.SongPhases?.length ?? 0) > 0) return true;
  if ((meta.SongOffsetSeconds ?? 0) !== 0) return true;
  return false;
}

export async function writeSessionDraft(input: {
  payload: Omit<
    ChartDraftPayload,
    "hasAudio" | "hasCover" | "audioIdentity" | "coverIdentity" | "audioFileName" | "coverFileName"
  > & {
    audioFileName?: string | null;
    coverFileName?: string | null;
  };
  audioFile: File | null;
  coverFile: File | null;
  /** Previous identities — skip blob rewrite when unchanged */
  prevAudioIdentity?: string | null;
  prevCoverIdentity?: string | null;
}): Promise<ChartDraftPayload> {
  const audioId = mediaIdentity(input.audioFile);
  const coverId = mediaIdentity(input.coverFile);

  const payload: ChartDraftPayload = {
    ...input.payload,
    audioFileName: input.audioFile?.name ?? input.payload.audioFileName ?? null,
    coverFileName: input.coverFile?.name ?? input.payload.coverFileName ?? null,
    hasAudio: Boolean(input.audioFile),
    hasCover: Boolean(input.coverFile),
    audioIdentity: audioId,
    coverIdentity: coverId,
  };

  try {
    const db = await openDb();
    try {
      const tx = db.transaction(DRAFT_STORE, "readwrite");
      const store = tx.objectStore(DRAFT_STORE);
      await idbRequest(store.put(payload, DRAFT_KEY));

      if (input.audioFile && audioId !== input.prevAudioIdentity) {
        const rec: MediaRecord = {
          identity: audioId!,
          fileName: input.audioFile.name,
          blob: input.audioFile,
        };
        await idbRequest(store.put(rec, AUDIO_KEY));
      } else if (!input.audioFile) {
        await idbRequest(store.delete(AUDIO_KEY));
      }

      if (input.coverFile && coverId !== input.prevCoverIdentity) {
        const rec: MediaRecord = {
          identity: coverId!,
          fileName: input.coverFile.name,
          blob: input.coverFile,
        };
        await idbRequest(store.put(rec, COVER_KEY));
      } else if (!input.coverFile) {
        await idbRequest(store.delete(COVER_KEY));
      }
    } finally {
      db.close();
    }
  } catch {
    // Private mode / quota — session draft is best-effort
  }

  return payload;
}

export async function readSessionDraft(): Promise<StoredDraft | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(DRAFT_STORE, "readonly");
      const store = tx.objectStore(DRAFT_STORE);
      const value = await idbRequest(store.get(DRAFT_KEY));
      if (!value || typeof value !== "object") return null;
      const payload = value as ChartDraftPayload;
      if (payload.version !== 1 || !payload.meta || !payload.charts) return null;

      let audioBlob: Blob | null = null;
      let coverBlob: Blob | null = null;
      if (payload.hasAudio) {
        const audioRec = (await idbRequest(store.get(AUDIO_KEY))) as MediaRecord | undefined;
        if (audioRec?.blob) audioBlob = audioRec.blob;
      }
      if (payload.hasCover) {
        const coverRec = (await idbRequest(store.get(COVER_KEY))) as MediaRecord | undefined;
        if (coverRec?.blob) coverBlob = coverRec.blob;
      }

      return {
        ...payload,
        audioBlob,
        coverBlob,
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearSessionDraft(): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(DRAFT_STORE, "readwrite");
      const store = tx.objectStore(DRAFT_STORE);
      await idbRequest(store.delete(DRAFT_KEY));
      await idbRequest(store.delete(AUDIO_KEY));
      await idbRequest(store.delete(COVER_KEY));
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export function getLastCleanSaveAt(): number {
  try {
    const raw = localStorage.getItem(CLEAN_SAVE_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function markCleanSave(at = Date.now()): void {
  try {
    localStorage.setItem(CLEAN_SAVE_KEY, String(at));
  } catch {
    // ignore
  }
}

/** Quiet full-package autosave to the output folder (desktop). No alerts. */
export async function writeDiskAutosave(options: {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  audioFile: File;
  coverFile: File | null;
  audioBuffer: AudioBuffer;
}): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.isDesktop) return null;

  const blob = await buildIndiesZip({
    meta: options.meta,
    charts: options.charts,
    audioFile: options.audioFile,
    coverFile: options.coverFile,
    audioBuffer: options.audioBuffer,
  });
  const name = autosaveDiskName(options.meta);
  await saveBlobFile(name, blob, { backup: false });
  return name;
}

export async function listDiskRecovery(): Promise<
  { name: string; path: string; mtime: number }[]
> {
  const api = window.electronAPI;
  if (!api?.isDesktop || !api.listRecoveryFiles) return [];
  try {
    const files = await api.listRecoveryFiles();
    return files.filter((f) => f.name.endsWith(".autosave.indies"));
  } catch {
    return [];
  }
}

export async function readDiskAutosaveAsFile(
  relativeName: string
): Promise<File | null> {
  const api = window.electronAPI;
  if (!api?.isDesktop || !api.readOutputBinary) return null;
  try {
    const bytes = await api.readOutputBinary(relativeName);
    if (!bytes || bytes.length === 0) return null;
    return new File([new Uint8Array(bytes)], relativeName, {
      type: "application/zip",
    });
  } catch {
    return null;
  }
}

export async function collectRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  const out: RecoveryCandidate[] = [];
  const lastClean = getLastCleanSaveAt();

  const session = await readSessionDraft();
  if (
    session &&
    session.savedAt > lastClean &&
    draftIsWorthKeeping(session.meta, session.charts, Boolean(session.audioBlob))
  ) {
    out.push({
      id: "session",
      label: session.songLabel || draftSongLabel(session.meta),
      savedAt: session.savedAt,
      source: "session",
      noteCount: session.noteCount ?? countNotes(session.charts),
      hasAudio: Boolean(session.audioBlob),
      draft: session,
    });
  }

  const disk = await listDiskRecovery();
  for (const file of disk) {
    if (file.mtime <= lastClean) continue;
    if (
      session?.diskAutosaveName &&
      session.diskAutosaveName === file.name &&
      Math.abs(session.savedAt - file.mtime) < 5000
    ) {
      continue;
    }
    const base = file.name.replace(/\.autosave\.indies$/i, "");
    out.push({
      id: `disk:${file.name}`,
      label: base || file.name,
      savedAt: file.mtime,
      source: "disk",
      noteCount: -1,
      hasAudio: true,
      diskName: file.name,
    });
  }

  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}
