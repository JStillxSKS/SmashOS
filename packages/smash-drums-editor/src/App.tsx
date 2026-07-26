import { ChartEditor } from "./components/ChartEditor";
import { MobileLayoutGate } from "./components/MobileLayoutGate";
import { SessionRecovery } from "./components/SessionRecovery";
import { SidebarDrawer, useSidebarDrawers } from "./components/SidebarDrawer";
import { SidebarLeft } from "./components/SidebarLeft";
import { SidebarRight } from "./components/SidebarRight";
import { Toolbar } from "./components/Toolbar";
import { AuthProvider } from "./context/AuthContext";
import { MobileLayoutProvider } from "./hooks/MobileLayoutProvider";
import { useAutosave } from "./hooks/useAutosave";
import { useMobileLayout } from "./hooks/useMobileLayout";
import "./styles.css";
import "./styles-future.css";
import "./styles-mobile.css";

function EditorShell() {
  const { isMobileShell, showGate } = useMobileLayout();
  const { leftOpen, rightOpen, toggleLeft, toggleRight, setLeftOpen, setRightOpen } =
    useSidebarDrawers(isMobileShell);
  useAutosave();

  const closePanels = () => {
    setLeftOpen(false);
    setRightOpen(false);
  };

  return (
    <>
      <MobileLayoutGate open={showGate} />
      <SessionRecovery />
      <div
        className={`app app--future${isMobileShell ? " app--mobile" : ""}`}
        data-mobile-shell={isMobileShell ? "1" : "0"}
      >
        <div className="app-shell">
          <Toolbar
            isMobileShell={isMobileShell}
            onToggleLeft={toggleLeft}
            onToggleRight={toggleRight}
            leftOpen={leftOpen}
            rightOpen={rightOpen}
          />
          <div
            className="workspace"
            data-left-open={leftOpen}
            data-right-open={rightOpen}
          >
            {isMobileShell && (leftOpen || rightOpen) && (
              <button
                type="button"
                className="mobile-drawer-backdrop"
                aria-label="Close panel"
                onClick={closePanels}
              />
            )}
            <SidebarDrawer side="left" open={leftOpen} onToggle={toggleLeft}>
              <SidebarLeft />
            </SidebarDrawer>
            <div className="editor-main">
              <ChartEditor />
            </div>
            <SidebarDrawer side="right" open={rightOpen} onToggle={toggleRight}>
              <SidebarRight />
            </SidebarDrawer>
          </div>
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MobileLayoutProvider>
        <EditorShell />
      </MobileLayoutProvider>
    </AuthProvider>
  );
}
