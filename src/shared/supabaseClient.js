import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The anon key is meant to be public (same as VITE_API_URL already is) —
// access control happens via Row Level Security policies in Postgres,
// not by keeping this key secret. See supabase/schema.sql.
export const supabase = createClient(url, anonKey);
