import { useState } from "react";
import { supabase } from "./supabaseClient";
import { Alert, ActionButton, Panel } from "./components";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    supabase.auth.signInWithPassword({ email, password })
      .then(({ error }) => {
        if (error) setErr(error.message);
        setLoading(false);
      });
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand__primary">SHELVING</span>{" "}
          <span className="brand__secondary">HUB</span>
        </div>
        <Panel title="LOGGA IN">
          {err && <Alert>{err}</Alert>}
          <form onSubmit={handleSubmit} className="login-form">
            <label className="login-field">
              <span>E-post</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="login-field">
              <span>Lösenord</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <ActionButton variant="primary" full disabled={loading} type="submit">
              {loading ? "Loggar in..." : "Logga in"}
            </ActionButton>
          </form>
        </Panel>
      </div>
    </div>
  );
}
