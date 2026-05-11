import { C } from "./theme";

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
