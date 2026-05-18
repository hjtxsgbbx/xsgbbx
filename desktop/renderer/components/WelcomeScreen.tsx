import React from "react";

interface WelcomeScreenProps {
  status: "disconnected" | "connecting" | "ready";
  onOpenProject: () => void;
  onShowHelp: () => void;
}

const SvgIcon: React.FC<{ name: string; className?: string }> = ({ name, className = "icon-svg" }) => {
  const icons: Record<string, React.ReactNode> = {
    key: <svg className={className} viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
    folder: <svg className={className} viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    chat: <svg className={className} viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    check: <svg className={className} viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
    arrow: <svg className={className} viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  };
  return <>{icons[name] || null}</>;
};

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  status,
  onOpenProject,
  onShowHelp,
}) => {
  const isReady = status === "ready";

  return (
    <div className="welcome-container" role="main" aria-label="Welcome screen">
      <div className="welcome-card">
        <h1 className="welcome-logo">agent_1</h1>
        <p className="welcome-subtitle">Cross-Platform AI Coding Agent</p>
        <p className="welcome-desc">
          Configure your API provider and select a project to start working.
          Your workspace will be loaded into the editor.
        </p>

        <div className="welcome-steps" role="list" aria-label="Getting started steps">
          {[
            { iconName: "key", label: "API Key", desc: "Configure provider" },
            { iconName: "folder", label: "Project", desc: "Select workspace" },
            { iconName: "chat", label: "Chat", desc: "Start coding" },
          ].map((item) => (
            <div key={item.label} className="welcome-step" role="listitem">
              <div className="welcome-step-icon" aria-hidden="true"><SvgIcon name={item.iconName} className="icon-svg icon-lg" /></div>
              <div className="welcome-step-label">{item.label}</div>
              <div className="welcome-step-desc">{item.desc}</div>
            </div>
          ))}
        </div>

        <button
          className="btn-get-started"
          onClick={onOpenProject}
          disabled={isReady}
          aria-label={isReady ? "Project loaded" : "Get started - open a project"}
        >
          {isReady ? <><SvgIcon name="check" className="icon-svg icon-sm" /> Project Loaded</> : <>Get Started <SvgIcon name="arrow" className="icon-svg icon-sm" /></>}
        </button>

        <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }}>
          <button
            onClick={onShowHelp}
            aria-label="Show help and keyboard shortcuts"
            style={{
              background: "transparent",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
              padding: "8px 20px",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              transition: "all 0.15s",
            }}
          >
            Help & Shortcuts
          </button>
        </div>

        <p className="welcome-footer" aria-label="Application version and status">
          Version 1.0.0 | Built with Electron + React | Status:{" "}
          {status === "ready" ? "Ready" : "No project loaded"}
        </p>
      </div>
    </div>
  );
};
