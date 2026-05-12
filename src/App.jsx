import { useState } from "react";
import Live from "./components/Live";
import Bemanning from "./components/Bemanning";
import Brief from "./components/Brief";
import Raknare from "./components/Raknare";
import Historik from "./components/Historik";

const TABS = [
  { id: "live",      label: "Live",        Component: Live,     dot: true },
  { id: "bemanning", label: "Bemanning",   Component: Bemanning },
  { id: "brief",     label: "Daily Brief", Component: Brief },
  { id: "rakna",     label: "Räknare",     Component: Raknare },
  { id: "historik",  label: "Historik",    Component: Historik },
];

export default function App() {
  const [tab, setTab] = useState("live");
  const { Component: ActiveTab } = TABS.find(t => t.id === tab);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand__primary">SHELVING</span>
          <span className="brand__secondary">HUB</span>
        </div>

        <div className="tabs">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={"tab-button" + (active ? " is-active" : "")}
              >
                {t.dot && <span className="live-dot" />}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="app-main">
        <ActiveTab />
      </div>
    </div>
  );
}
