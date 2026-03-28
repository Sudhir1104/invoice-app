import { useState } from "react";
import { supabase } from "./supabase";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const ink = "#2D2D7A";

  const handleSubmit = async () => {
    if (!email || !password) { setError("Please enter email and password"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    setError("");
    setMessage("");

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage("✅ Account created! Please check your email to confirm, then sign in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20,
      backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(160,150,100,0.04) 2px, rgba(160,150,100,0.04) 4px)"
    }}>
      {/* Logo / Title */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 28, color: ink, fontWeight: 700, letterSpacing: 1 }}>
          📋 Blue Square Invoice
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>
          Professional Invoicing for Australian Business
        </div>
      </div>

      {/* Card */}
      <div style={{ background: "#FEFCE8", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870", boxShadow: "0 8px 40px rgba(0,0,0,0.15)", padding: "40px 36px", width: "100%", maxWidth: 400, position: "relative" }}>

        <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: ink, textAlign: "center", border: `2px solid ${ink}`, padding: "8px 16px", marginBottom: 28 }}>
          {isSignUp ? "Create Account" : "Sign In"}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#991B1B" }}>
            {error}
          </div>
        )}

        {/* Success message */}
        {message && (
          <div style={{ background: "#D1FAE5", border: "1px solid #10B981", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#065F46" }}>
            {message}
          </div>
        )}

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="you@example.com"
            style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isSignUp ? "Minimum 6 characters" : "Your password"}
            style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: "100%", padding: "13px", background: loading ? "#8888CC" : ink, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", letterSpacing: 0.5, marginBottom: 16 }}
        >
          {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
        </button>

        {/* Toggle sign up / sign in */}
        <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "#8888CC" }}>
          {isSignUp ? "Already have an account? " : "No account yet? "}
          <span onClick={() => { setIsSignUp(!isSignUp); setError(""); setMessage(""); }}
            style={{ color: ink, textDecoration: "underline", cursor: "pointer", fontWeight: 700 }}>
            {isSignUp ? "Sign in" : "Create one free"}
          </span>
        </div>

        {/* Forgot password */}
        {!isSignUp && (
          <div style={{ textAlign: "center", marginTop: 12, fontFamily: "monospace", fontSize: 11 }}>
            <span onClick={async () => {
              if (!email) { setError("Enter your email first"); return; }
              await supabase.auth.resetPasswordForEmail(email);
              setMessage("Password reset email sent!");
            }} style={{ color: "#8888CC", textDecoration: "underline", cursor: "pointer" }}>
              Forgot password?
            </span>
          </div>
        )}
      </div>

      {/* Beta note */}
      <div style={{ marginTop: 20, fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center" }}>
        🚀 BETA VERSION — invoice.bluesquaresolutions.com.au
      </div>
    </div>
  );
}
