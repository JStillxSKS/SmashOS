import { useState, type ReactNode } from "react";

type CollapsibleSectionProps = {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  flex?: boolean;
  children: ReactNode;
  className?: string;
};

export function CollapsibleSection({
  title,
  badge,
  defaultOpen = true,
  flex = false,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={`panel hud-panel collapsible-panel${open ? " is-open" : " is-collapsed"}${
        flex ? " panel-flex" : ""
      } ${className}`.trim()}
    >
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="collapsible-title">{title}</span>
        {badge ? (
          <span className="collapsible-badge" title={badge}>
            {badge}
          </span>
        ) : null}
        <span className="collapsible-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </section>
  );
}