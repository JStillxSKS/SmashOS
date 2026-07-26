import { useEffect, useState, type ReactNode } from "react";

type DrawerSide = "left" | "right";

type SidebarDrawerProps = {
  side: DrawerSide;
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
};

const STORAGE_KEYS: Record<DrawerSide, string> = {
  left: "sde-drawer-left",
  right: "sde-drawer-right",
};

function readDrawerPref(side: DrawerSide, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEYS[side]);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    // localStorage unavailable
  }
  return defaultOpen;
}

/**
 * @param mobileShell When true, drawers default closed and stay closed until opened
 *   (mobile overlay panels). Desktop keeps previous open preference.
 */
export function useSidebarDrawers(mobileShell = false) {
  const defaultOpen = !mobileShell;
  const [leftOpen, setLeftOpen] = useState(() =>
    readDrawerPref("left", defaultOpen)
  );
  const [rightOpen, setRightOpen] = useState(() =>
    readDrawerPref("right", defaultOpen)
  );

  // When entering mobile shell, force panels closed so the highway is usable.
  useEffect(() => {
    if (mobileShell) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [mobileShell]);

  useEffect(() => {
    if (mobileShell) return;
    try {
      localStorage.setItem(STORAGE_KEYS.left, leftOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [leftOpen, mobileShell]);

  useEffect(() => {
    if (mobileShell) return;
    try {
      localStorage.setItem(STORAGE_KEYS.right, rightOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [rightOpen, mobileShell]);

  return {
    leftOpen,
    rightOpen,
    setLeftOpen,
    setRightOpen,
    toggleLeft: () => setLeftOpen((v) => !v),
    toggleRight: () => setRightOpen((v) => !v),
  };
}

export function SidebarDrawer({ side, children, open, onToggle }: SidebarDrawerProps) {
  const label = side === "left" ? "left panel" : "right panel";

  return (
    <div
      className={`sidebar-wing sidebar-wing--${side}${open ? " is-open" : " is-collapsed"}`}
    >
      <button
        type="button"
        className="drawer-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        title={open ? "Collapse panel" : "Expand panel"}
      >
        <span className="drawer-toggle-icon" aria-hidden />
      </button>
      <div className="sidebar-drawer-content" inert={!open ? true : undefined}>
        {children}
      </div>
    </div>
  );
}
