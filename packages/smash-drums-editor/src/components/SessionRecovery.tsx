import { useEffect, useState } from "react";
import { clearHistory } from "../store/history";
import { useEditorStore } from "../store/useEditorStore";
import {
  clearSessionDraft,
  collectRecoveryCandidates,
  markCleanSave,
  readDiskAutosaveAsFile,
  type RecoveryCandidate,
  type StoredDraft,
} from "../utils/draftStorage";

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "unknown time";
  }
}

async function applySessionDraft(draft: StoredDraft): Promise<void> {
  const store = useEditorStore.getState();
  clearHistory();
  useEditorStore.setState({
    meta: draft.meta,
    charts: draft.charts,
    difficulty: draft.difficulty,
    scrollTick: draft.scrollTick,
    currentTime: 0,
    isPlaying: false,
    sourceIndiesPath: draft.sourceIndiesPath,
    historyVersion: store.historyVersion + 1,
    clipboardMessage: `Restored draft: ${draft.songLabel}`,
  });

  if (draft.coverBlob) {
    const cover = new File(
      [draft.coverBlob],
      draft.coverFileName || "cover.png",
      { type: draft.coverBlob.type || "image/png" }
    );
    await useEditorStore.getState().loadCoverImage(cover);
  } else {
    useEditorStore.getState().clearCoverImage();
  }

  if (draft.audioBlob) {
    const audio = new File(
      [draft.audioBlob],
      draft.audioFileName || "audio.ogg",
      { type: draft.audioBlob.type || "audio/ogg" }
    );
    await useEditorStore.getState().loadAudio(audio);
  }
}

export function SessionRecovery() {
  const [candidates, setCandidates] = useState<RecoveryCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await collectRecoveryCandidates();
        if (!cancelled) setCandidates(list);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (candidates === null || candidates.length === 0) return null;

  const primary = candidates[0];

  const dismiss = async () => {
    setBusy(true);
    try {
      markCleanSave(Date.now());
      await clearSessionDraft();
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (item: RecoveryCandidate) => {
    setBusy(true);
    setError(null);
    try {
      if (item.source === "session" && item.draft) {
        await applySessionDraft(item.draft);
      } else if (item.source === "disk" && item.diskName) {
        const file = await readDiskAutosaveAsFile(item.diskName);
        if (!file) throw new Error("Could not read autosave file from disk.");
        await useEditorStore.getState().loadMeta(file);
        useEditorStore.setState({
          clipboardMessage: `Restored autosave: ${item.label}`,
        });
      } else {
        throw new Error("Nothing to restore.");
      }
      markCleanSave(Date.now());
      await clearSessionDraft();
      setCandidates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="session-recovery" role="dialog" aria-modal="true" aria-labelledby="session-recovery-title">
      <div className="session-recovery-card">
        <h2 id="session-recovery-title">Recover unsaved work?</h2>
        <p className="session-recovery-lead">
          The editor found an autosave from a previous session. Restore it, or discard and start clean.
        </p>
        <ul className="session-recovery-list">
          {candidates.slice(0, 5).map((c) => (
            <li key={c.id} className={c.id === primary.id ? "is-primary" : undefined}>
              <div className="session-recovery-item-main">
                <strong>{c.label}</strong>
                <span className="session-recovery-meta">
                  {formatWhen(c.savedAt)}
                  {" · "}
                  {c.source === "session" ? "session draft" : "disk autosave"}
                  {c.noteCount >= 0 ? ` · ${c.noteCount} notes` : ""}
                  {c.hasAudio ? " · audio" : ""}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-accent"
                disabled={busy}
                onClick={() => void restore(c)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="session-recovery-error">{error}</p>}
        <div className="session-recovery-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void dismiss()}>
            Discard
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={busy}
            onClick={() => void restore(primary)}
          >
            {busy ? "Restoring…" : "Restore latest"}
          </button>
        </div>
      </div>
    </div>
  );
}
