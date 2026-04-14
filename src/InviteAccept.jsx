import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";

export default function InviteAccept({ token, user, onAccepted }) {
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => { loadInvite(); }, [token]);

  const loadInvite = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_invites")
      .select("*, tenants(name)")
      .eq("token", token)
      .eq("accepted", false)
      .single();

    if (error || !data) { setError("This invite is invalid or has expired."); }
    else if (new Date(data.expires_at) < new Date()) { setError("This invite has expired."); }
    else { setInvite(data); setEmail(data.email); }
    setLoading(false);
  };

  const handleAuth = async () => {
    if (!email || !password) { setError("Please enter email and password."); return; }
    setAuthLoading(true); setError("");
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await acceptInvite();
    } catch (e) { setError(e.message); }
    finally { setAuthLoading(false); }
  };

  const acceptInvite = async () => {
    setAccepting(true);
    try {
      const { data, error } = await supabase.rpc("accept_invite", { invite_token: token });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      if (onAccepted) onAccepted();
      else window.location.href = "/";
    } catch (e) { setError("Failed to accept invite: " + e.message); }
    finally { setAccepting(false); }
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ fontFamily: "monospace", color: "#8888CC" }}>Loading invite...</div></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 28, color: NAVY, fontWeight: 700 }}>📋 Blue Square Invoice</div>
      </div>

      <div style={{ background: "#FEFCE8", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870", boxShadow: "0 8px 40px rgba(0,0,0,0.15)", padding: "36px", width: "100%", maxWidth: 420 }}>
        {error ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#C0392B", marginBottom: 8 }}>Invalid Invite</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#666" }}>{error}</div>
            <button onClick={() => window.location.href = "/"} style={{ marginTop: 16, padding: "10px 24px", background: NAVY, color: "#fff", border: "none", borderRadius: 8, fontFamily: "monospace", fontSize: 12, cursor: "pointer" }}>Go to Login</button>
          </div>
        ) : invite ? (
          <>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: NAVY, marginBottom: 6 }}>You're invited!</div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: "#666" }}>
                Join <strong>{invite.tenants?.name}</strong> as <strong>{invite.role}</strong>
              </div>
            </div>

            {!user ? (
              <>
                <div style={{ display: "flex", marginBottom: 20, border: "1.5px solid #9999CC", borderRadius: 8, overflow: "hidden" }}>
                  {["Create Account", "Sign In"].map((label, i) => (
                    <button key={label} onClick={() => setIsSignUp(i === 0)}
                      style={{ flex: 1, padding: "9px", border: "none", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", background: (isSignUp ? i === 0 : i === 1) ? NAVY : "#f5f5f5", color: (isSignUp ? i === 0 : i === 1) ? "#fff" : "#666" }}>
                      {label}
                    </button>
                  ))}
                </div>

                {[["Email", email, setEmail, "email", "you@example.com"], ["Password", password, setPassword, "password", "Min 6 characters"]].map(([label, val, setter, type, ph]) => (
                  <div key={label} style={{ marginBottom: 14 }}>
                    <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: NAVY, textTransform: "uppercase", display: "block", marginBottom: 6 }}>{label}</label>
                    <input type={type} value={val} onChange={e => setter(e.target.value)} placeholder={ph}
                      style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: NAVY, background: "transparent", outline: "none", boxSizing: "border-box" }} />
                  </div>
                ))}

                <button onClick={handleAuth} disabled={authLoading}
                  style={{ width: "100%", padding: "13px", background: authLoading ? "#8888CC" : GREEN, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: authLoading ? "not-allowed" : "pointer", marginTop: 8 }}>
                  {authLoading ? "Please wait..." : isSignUp ? "Create Account & Join" : "Sign In & Join"}
                </button>
              </>
            ) : (
              <button onClick={acceptInvite} disabled={accepting}
                style={{ width: "100%", padding: "13px", background: accepting ? "#8888CC" : GREEN, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: accepting ? "not-allowed" : "pointer" }}>
                {accepting ? "Joining..." : "Accept Invite & Join " + invite.tenants?.name}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
