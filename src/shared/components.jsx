import { C } from "./theme";

export function PageHeader({ eyebrow, title, subtitle, live = false, actions = null }) {
  return (
    <div className="page-header">
      <div>
        <div className={live ? "page-header__status" : undefined}>
          {live && <span className="live-dot" />}
          <span className="eyebrow" style={live ? { marginBottom: 0, color: C.red } : undefined}>
            {eyebrow}
          </span>
        </div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

export function Dropzone({ title, subtitle, icon, dragging = false, multiple = false, accept = ".xlsx", onFile, compact = false }) {
  return (
    <label
      className={"dropzone" + (dragging ? " is-dragging" : "") + (compact ? " dropzone--compact" : "")}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFile(multiple ? files : files[0]);
      }}
    >
      {icon && <div className="dropzone__icon">{icon}</div>}
      <div className="dropzone__title">{title}</div>
      {subtitle && <div className="dropzone__subtitle">{subtitle}</div>}
      <input
        type="file"
        multiple={multiple}
        accept={accept}
        className="visually-hidden-input"
        onChange={e => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFile(multiple ? files : files[0]);
        }}
      />
    </label>
  );
}

export function Alert({ children, tone = "danger" }) {
  return <div className={"alert alert--" + tone}>{children}</div>;
}

export function Panel({ title, accent = "accent", children, className = "", flush = false }) {
  return (
    <div className={"section-card " + className}>
      {title && <div className={"section-card__header section-card__header--" + accent}>{title}</div>}
      <div className={"section-card__body" + (flush ? " section-card__body--flush" : "")}>{children}</div>
    </div>
  );
}

export function MetricGrid({ children, columns = 4 }) {
  return (
    <div className="metric-grid" style={{ "--metric-columns": columns }}>
      {children}
    </div>
  );
}

export function MetricCard({ label, value, tone }) {
  return (
    <div className="metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

export function DataTable({ headers, children }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map(h => {
              const header = typeof h === "string" ? { label: h } : h;
              return (
                <th key={header.label} className={header.align === "right" ? "is-right" : undefined}>
                  {header.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ActionButton({ children, variant = "secondary", full = false, ...props }) {
  return (
    <button className={"action-button action-button--" + variant + (full ? " action-button--full" : "")} {...props}>
      {children}
    </button>
  );
}

export function PrestBar({ prest }) {
  const pct = Math.min(Math.abs(prest - 1) * 100, 60);
  const color = prest < 1 ? C.green : C.red;
  return (
    <div className="prest-bar">
      <span className="prest-bar__value" style={{ color }}>
        {Math.round(prest * 100)}%
      </span>
      <div className="prest-bar__track">
        <div className="prest-bar__fill" style={{ width: pct + "%", background: color }} />
      </div>
    </div>
  );
}

export function GapChip({ gap }) {
  const color = gap > 0.5 ? C.green : gap < -0.5 ? C.red : C.yellow;
  return (
    <span className="chip" style={{ color, background: color + "18", border: "1px solid " + color + "44" }}>
      {gap > 0 ? "+" : ""}{gap.toFixed(1)}h
    </span>
  );
}

export function BedomingPill({ text }) {
  if (!text) return null;
  const color =
    text.includes("Hog") || text.includes("Hög") ? C.red :
    text.includes("Ogiltig") ? C.dim :
    text.includes("Osakar") || text.includes("Osäker") ? C.yellow :
    text.includes("Medium") ? C.yellow :
    text.includes("Lag") || text.includes("Låg") ? C.green :
    C.dim;
  return (
    <span className="bedoming-pill" style={{ color, background: color + "18", border: "1px solid " + color + "44" }}>
      {text}
    </span>
  );
}
