import { clampPhaseId, PHASE_TYPES, phaseById, sortSongPhases } from "../types/meta";
import { useEditorStore } from "../store/useEditorStore";

export function SongPhasesPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    meta,
    placementMode,
    pendingPhasePlacement,
    updatePhase,
    addPhase,
    addPhaseAtPlayhead,
    removePhase,
    setPlacementMode,
    setPendingPhasePlacement,
  } = useEditorStore();
  const phases = sortSongPhases(meta.SongPhases);
  const placing = placementMode === "phase";

  const togglePlaceOnGrid = () => {
    setPlacementMode(placing ? null : "phase");
  };

  const content = (
    <>
      <div className="placement-config placement-config-compact">
        <div className="field-grid">
          <label>
            Type
            <select
              value={pendingPhasePlacement.phase}
              onChange={(e) =>
                setPendingPhasePlacement({ phase: clampPhaseId(Number(e.target.value)) })
              }
            >
              {PHASE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} — {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Label
            <input
              value={pendingPhasePlacement.phaseName}
              onChange={(e) => setPendingPhasePlacement({ phaseName: e.target.value })}
            />
          </label>
        </div>
        <label>
          Intensity ({Math.round(pendingPhasePlacement.power * 100)}%)
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={pendingPhasePlacement.power}
            onChange={(e) =>
              setPendingPhasePlacement({ power: Number(e.target.value) })
            }
          />
        </label>
        <button
          className={`btn btn-accent placement-btn${placing ? " is-active" : ""}`}
          type="button"
          onClick={togglePlaceOnGrid}
        >
          {placing ? "Placing…" : "Place on grid"}
        </button>
      </div>

      <ul className="phase-list">
        {phases.map((ph, index) => {
          const type = phaseById(ph.phase);
          return (
            <li key={`${ph.beat}-${index}`} className="phase-item">
              <div className="phase-item-head">
                <span
                  className="phase-badge"
                  style={{ background: type.color + "33", color: type.color }}
                >
                  {type.label}
                </span>
                <button
                  className="phase-remove"
                  type="button"
                  title="Remove phase"
                  disabled={phases.length <= 1}
                  onClick={() => removePhase(index)}
                >
                  ×
                </button>
              </div>

              <div className="phase-fields-row">
                <label>
                  Beat
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    value={ph.beat}
                    onChange={(e) => updatePhase(index, { beat: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={ph.phase}
                    onChange={(e) =>
                      updatePhase(index, { phase: clampPhaseId(Number(e.target.value)) })
                    }
                  >
                    {PHASE_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} — {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Intensity ({Math.round(ph.power * 100)}%)
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ph.power}
                  onChange={(e) => updatePhase(index, { power: Number(e.target.value) })}
                />
              </label>
            </li>
          );
        })}
      </ul>

      <div className="btn-group phase-actions">
        <button className="btn" type="button" onClick={addPhase}>
          Add
        </button>
        <button className="btn btn-accent" type="button" onClick={addPhaseAtPlayhead}>
          At playhead
        </button>
      </div>
    </>
  );

  if (embedded) {
    return <div className="tab-content">{content}</div>;
  }

  return (
    <section className="panel">
      <h3>Song Phases</h3>
      <p className="hint">Musical sections — exported in [Events]</p>
      {content}
    </section>
  );
}