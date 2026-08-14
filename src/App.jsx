import { lazy, Suspense, useState, useEffect } from "react";
import { supabase } from "./shared/supabaseClient";
import Login from "./shared/Login";

// Each dashboard is a separate chunk. A tab is only downloaded once a user
// visits it, then kept mounted so importing a file is not lost when switching.
const Live = lazy(() => import("./components/Live"));
const Bemanning = lazy(() => import("./components/Bemanning"));
const Brief = lazy(() => import("./components/Brief"));
const Raknare = lazy(() => import("./components/Raknare"));
const Historik = lazy(() => import("./components/Historik"));
const Prognos = lazy(() => import("./components/Prognos"));
const Pafyllningsmonster = lazy(() => import("./components/Pafyllningsmonster"));
const Ledtid = lazy(() => import("./components/Ledtid"));

const TABS = [
  { id: "live",       label: "Live",            Component: Live,             dot: true },
  { id: "bemanning",  label: "Bemanning",        Component: Bemanning },
  { id: "brief",      label: "Daily Brief",      Component: Brief },
  { id: "prognos",    label: "Prognos",          Component: Prognos },
  { id: "monster",    label: "Påfyllningsmönster", Component: Pafyllningsmonster },
  { id: "ledtid",     label: "Ledtid",           Component: Ledtid },
  { id: "rakna",      label: "Räknare",          Component: Raknare },
  { id: "historik",   label: "Historik",         Component: Historik },
];

export default function App() {
  const [tab, setTab] = useState("live");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["live"]));
  const [session, setSession] = useState(undefined); // undefined = still checking, null = logged out

  const selectTab = (id) => {
    setTab(id);
    setVisitedTabs(current => current.has(id) ? current : new Set([...current, id]));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // avoid a login-screen flash while checking
  if (!session) return <Login />;

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
                onClick={() => selectTab(t.id)}
                className={"tab-button" + (active ? " is-active" : "")}
              >
                {t.dot && <span className="live-dot" />}
                {t.label}
              </button>
            );
          })}
        </div>

        <button className="logout-button" onClick={() => supabase.auth.signOut()}>
          Logga ut
        </button>
      </div>

      <div className="app-main">
        <Suspense fallback={<div className="dashboard-page">Laddar vy…</div>}>
          {TABS.filter(({ id }) => visitedTabs.has(id)).map(({ id, Component }) => (
            <div key={id} style={tab === id ? undefined : { display: "none" }}>
              <Component />
            </div>
          ))}
        </Suspense>
      </div>
    </div>
  );
}
