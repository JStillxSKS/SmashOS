import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/useEditorStore";
import {
  clearSessionDraft,
  countNotes,
  draftIsWorthKeeping,
  draftSongLabel,
  markCleanSave,
  mediaIdentity,
  writeDiskAutosave,
  writeSessionDraft,
} from "../utils/draftStorage";

/** Debounce after last edit before writing a draft. */
const DEBOUNCE_MS = 2500;
/** Periodic safety write while the chart is dirty. */
const INTERVAL_MS = 20_000;
/** Don't thrash full .indies package writes more often than this. */
const DISK_MIN_GAP_MS = 45_000;

/**
 * Quiet autosave: IndexedDB session draft always; full `.autosave.indies` on
 * desktop when audio is loaded. No dialogs, no opening folders.
 */
export function useAutosave(): void {
  const timerRef = useRef<number | null>(null);
  const writingRef = useRef(false);
  const lastDiskWriteRef = useRef(0);
  const dirtyRef = useRef(false);
  const lastFingerprintRef = useRef("");
  const prevAudioIdentityRef = useRef<string | null>(null);
  const prevCoverIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    const fingerprint = (state: ReturnType<typeof useEditorStore.getState>) =>
      `${state.historyVersion}|${countNotes(state.charts)}|${state.meta.NameSong}|${state.meta.NameArtist}|${state.meta.SongOffsetSeconds}|${state.meta.SongTiming?.length ?? 0}|${state.meta.SongPhases?.length ?? 0}|${mediaIdentity(state.audioFile)}|${mediaIdentity(state.coverImageFile)}`;

    const schedule = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush("debounce");
      }, DEBOUNCE_MS);
    };

    const flush = async (_reason: "debounce" | "interval" | "unload" | "force") => {
      if (writingRef.current) return;
      const state = useEditorStore.getState();
      if (state.exportingIndies) return;
      if (!dirtyRef.current && _reason !== "force") return;

      const hasAudio = Boolean(state.audioFile && state.audioBuffer);
      if (!draftIsWorthKeeping(state.meta, state.charts, hasAudio)) {
        dirtyRef.current = false;
        return;
      }

      writingRef.current = true;
      try {
        let diskAutosaveName: string | null = null;
        const now = Date.now();
        const canDisk =
          hasAudio &&
          state.audioFile &&
          state.audioBuffer &&
          window.electronAPI?.isDesktop &&
          now - lastDiskWriteRef.current >= DISK_MIN_GAP_MS;

        if (canDisk) {
          try {
            diskAutosaveName = await writeDiskAutosave({
              meta: state.meta,
              charts: state.charts,
              audioFile: state.audioFile!,
              coverFile: state.coverImageFile,
              audioBuffer: state.audioBuffer!,
            });
            lastDiskWriteRef.current = Date.now();
          } catch {
            // Keep session draft even if disk write fails
          }
        }

        const written = await writeSessionDraft({
          payload: {
            version: 1,
            savedAt: Date.now(),
            meta: state.meta,
            charts: state.charts,
            difficulty: state.difficulty,
            scrollTick: state.scrollTick,
            sourceIndiesPath: state.sourceIndiesPath,
            songLabel: draftSongLabel(state.meta),
            noteCount: countNotes(state.charts),
            diskAutosaveName,
          },
          audioFile: state.audioFile,
          coverFile: state.coverImageFile,
          prevAudioIdentity: prevAudioIdentityRef.current,
          prevCoverIdentity: prevCoverIdentityRef.current,
        });

        prevAudioIdentityRef.current = written.audioIdentity;
        prevCoverIdentityRef.current = written.coverIdentity;
        dirtyRef.current = false;
        useEditorStore.setState({
          lastAutosaveAt: written.savedAt,
          autosaveStatus: diskAutosaveName
            ? `Autosaved to ${diskAutosaveName}`
            : "Draft autosaved",
        });
      } catch {
        // best-effort
      } finally {
        writingRef.current = false;
      }
    };

    lastFingerprintRef.current = fingerprint(useEditorStore.getState());

    const unsub = useEditorStore.subscribe((state) => {
      const fp = fingerprint(state);
      if (fp === lastFingerprintRef.current) return;
      lastFingerprintRef.current = fp;
      dirtyRef.current = true;
      schedule();
    });

    const intervalId = window.setInterval(() => {
      if (dirtyRef.current) void flush("interval");
    }, INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) {
        void flush("unload");
      }
    };
    const onPageHide = () => {
      if (dirtyRef.current) void flush("unload");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      unsub();
      window.clearInterval(intervalId);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}

/** Call after a successful manual Save / export so recovery won't nag. */
export async function acknowledgeCleanSave(): Promise<void> {
  markCleanSave(Date.now());
  await clearSessionDraft();
  useEditorStore.setState({
    lastAutosaveAt: Date.now(),
    autosaveStatus: "Saved",
  });
}

export { markCleanSave, clearSessionDraft };
