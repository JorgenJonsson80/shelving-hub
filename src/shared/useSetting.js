import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

// Shared by Live.jsx (bemanning/pall/schedule/bastid/passes) and Raknare.jsx
// (e1_loc_col/e1_vnr_col) — these are "current setting" values, not logs, so
// they live in one generic key/value table instead of dedicated tables.
//
// Drop-in replacement for the old useState(() => JSON.parse(localStorage...))
// pattern: reads are now async (start at `fallback`, then pop in once the
// Supabase fetch resolves), and the returned setter persists on every call —
// same shape as useState (accepts a value or an updater function).
//
// First read also seeds Supabase from any pre-existing localStorage value
// under the same key (one-time, silent migration — safe since these are
// small settings, not historical data worth a confirmation prompt).
//
// `pollMs` (optional) re-fetches on an interval instead of only once at
// mount — needed for settings another tab writes on its own, like
// Prognos.jsx's prognos_kbana_forecast: without polling, a consumer that
// mounted before the writer's first update is stuck with whatever it read
// once (often nothing, or yesterday's value) for the rest of the session,
// even though the writer keeps upserting fresh values every minute. Leave
// it off (default) for settings only ever changed by the same tab that
// reads them — polling those would risk clobbering an in-flight local edit
// with a stale server read.
//
// `debounceMs` (optional) delays the Supabase write (not the local state
// update, which stays instant) — for settings driven by a plain number/text
// input, where every keystroke was otherwise firing its own write (e.g.
// typing "150" into a pers field wrote 1, then 15, then 150). Coalesces
// rapid-fire updates into one write after the user pauses. A pending write
// is flushed immediately on unmount so a quick tab-switch doesn't drop it.
export function useSetting(key, fallback, { pollMs, debounceMs } = {}) {
  const [value, setLocalValue] = useState(fallback);
  const pendingWrite = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let migrated = false;

    const load = () => {
      supabase.from("app_settings").select("value").eq("key", key).maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          if (data) {
            setLocalValue(data.value);
            migrated = true;
            return;
          }
          if (migrated) return; // already seeded on an earlier poll; row just hasn't been read back yet
          migrated = true;
          let legacy = null;
          const raw = localStorage.getItem(key);
          if (raw != null) {
            try { legacy = JSON.parse(raw); } catch { legacy = raw; } // raw (non-JSON) legacy strings, e.g. Raknare's column-name keys
          }
          const initial = legacy ?? fallback;
          setLocalValue(initial);
          supabase.from("app_settings")
            .upsert({ key, value: initial, updated_at: new Date().toISOString() })
            .then(() => {});
        });
    };

    load();
    if (!pollMs) return () => { cancelled = true; };
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
    // `fallback` is intentionally treated like useState's initial-value argument —
    // only its value at first read matters, so it's excluded from the deps here
    // to avoid re-fetching whenever a caller passes a fresh inline `{}`/`[]` literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pollMs]);

  useEffect(() => {
    return () => {
      if (!pendingWrite.current) return;
      clearTimeout(pendingWrite.current.timeoutId);
      supabase.from("app_settings")
        .upsert({ key, value: pendingWrite.current.value, updated_at: new Date().toISOString() })
        .then(() => {});
      pendingWrite.current = null;
    };
  }, [key]);

  // Stable across renders (only changes if `key` does) — this is what a
  // caller's setSomething function ends up being. An unmemoized version
  // here caused a real production incident: a consumer put its setter in a
  // useEffect dependency array, the effect called it, that triggered a
  // state update, which produced a brand-new setValue reference next
  // render, which the effect's deps saw as "changed" and fired again —
  // forever, for as long as the app was open. That one loop accounted for
  // ~15 million Supabase calls and >90% of this project's total database
  // time before being traced back here.
  const setValue = useCallback((updater) => {
    setLocalValue(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const write = () => {
        supabase.from("app_settings")
          .upsert({ key, value: next, updated_at: new Date().toISOString() })
          .then(() => {});
        pendingWrite.current = null;
      };
      if (debounceMs) {
        if (pendingWrite.current) clearTimeout(pendingWrite.current.timeoutId);
        pendingWrite.current = { timeoutId: setTimeout(write, debounceMs), value: next };
      } else {
        write();
      }
      return next;
    });
  }, [key, debounceMs]);

  return [value, setValue];
}
