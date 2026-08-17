import { supabase } from "./supabaseClient";

function rowToObs(row) {
  return {
    id: row.id,
    datum: row.datum,
    veckodag: row.veckodag,
    timme: row.timme,
    kbana: row.kbana,
    systemtid: row.systemtid,
    skickad: row.skickad,
    klar: row.klar,
    transportTid: row.transport_tid,
    mezzVantetid: row.mezz_vantetid,
    totalLedtid: row.total_ledtid,
    ledtid: row.transport_tid, // was a stored duplicate of transportTid — now just aliased on read
    antalKolli: row.antal_kolli,
    orsak: row.orsak,
    notering: row.notering,
  };
}

export async function fetchLedtidObservations() {
  const { data, error } = await supabase.from("ledtid_observations").select("*").order("datum");
  if (error) throw error;
  return data.map(rowToObs);
}

export async function insertLedtidObservation(o) {
  const { data, error } = await supabase.from("ledtid_observations").insert({
    datum: o.datum,
    veckodag: o.veckodag,
    timme: o.timme,
    kbana: o.kbana,
    systemtid: o.systemtid,
    skickad: o.skickad,
    klar: o.klar,
    transport_tid: o.transportTid,
    mezz_vantetid: o.mezzVantetid,
    total_ledtid: o.totalLedtid,
    antal_kolli: o.antalKolli,
    orsak: o.orsak,
    notering: o.notering,
  }).select().single();
  if (error) throw error;
  return rowToObs(data);
}

export async function deleteLedtidObservation(id) {
  const { error } = await supabase.from("ledtid_observations").delete().eq("id", id);
  if (error) throw error;
}
