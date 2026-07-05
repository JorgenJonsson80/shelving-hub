import { useState, useEffect } from "react";
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
export function useSetting(key, fallback) {
  const [value, setLocalValue] = useState(fallback);

  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", key).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLocalValue(data.value);
          return;
        }
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
    // `fallback` is intentionally treated like useState's initial-value argument —
    // only its value at first read matters, so it's excluded from the deps here
    // to avoid re-fetching whenever a caller passes a fresh inline `{}`/`[]` literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = (updater) => {
    setLocalValue(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      supabase.from("app_settings")
        .upsert({ key, value: next, updated_at: new Date().toISOString() })
        .then(() => {});
      return next;
    });
  };

  return [value, setValue];
}
