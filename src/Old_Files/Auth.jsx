import { useState } from "react";
import { supabase } from "./supabase";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getLockoutKey(email) { return "lockout_" + email.toLowerCase().trim(); }

function checkLockout(email) {
  try {
    const raw = localStorage.getItem(getLockoutKey(email));
    if (!raw) return { locked: false, remaining: 0, attempts: 0 };
    const data = JSON.parse(raw);
    const elapsed = Date.now() - data.lastAttempt;
    if (data.attempts >= MAX_ATTEMPTS && elapsed < LOCKOUT_MS) {
      const remaining = Math.ceil((LOCKOUT_MS - elapsed) / 60000);
      return { locked: true, remaining, attempts: data.attempts };
    }
    // Lockout expired — reset
    if (elapsed >= LOCKOUT_MS) {
      localStorage.removeItem(getLockoutKey(email));
      return { locked: false, remaining: 0, attempts: 0 };
    }
    return { locked: false, remaining: 0, attempts: data.attempts };
  } catch { return { locked: false, remaining: 0, attempts: 0 }; }
}

function recordFailedAttempt(email) {
  try {
    const key = getLockoutKey(email);
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : { attempts: 0, lastAttempt: Date.now() };
    // Reset count if last attempt was over 15 min ago
    if (Date.now() - data.lastAttempt >= LOCKOUT_MS) data.attempts = 0;
    data.attempts += 1;
    data.lastAttempt = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
    return data.attempts;
  } catch { return 0; }
}

function clearLockout(email) {
  try { localStorage.removeItem(getLockoutKey(email)); } catch {}
}

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);

  const ink = "#2D2D7A";

  const handleSubmit = async () => {
    if (!email || !password) { setError("Please enter email and password"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }

    // Check lockout before attempting
    const lockout = checkLockout(email);
    if (lockout.locked) {
      setError("Too many failed attempts. Account locked for " + lockout.remaining + " more minute" + (lockout.remaining !== 1 ? "s" : "") + ".");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    if (isSignUp) {
      if (!/[A-Z]/.test(password)) { setError("Password must contain at least 1 uppercase letter"); setLoading(false); return; }
      if (!/[a-z]/.test(password)) { setError("Password must contain at least 1 lowercase letter"); setLoading(false); return; }
      if (!/[^A-Za-z0-9]/.test(password)) { setError("Password must contain at least 1 special character (!@#$%^&*)"); setLoading(false); return; }
      if (/012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(password)) { setError("Password cannot contain sequential letters or numbers (e.g. abc, 123)"); setLoading(false); return; }
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else { clearLockout(email); setMessage("✓ Check your email to confirm your account before signing in."); }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const attempts = recordFailedAttempt(email);
        const left = MAX_ATTEMPTS - attempts;
        if (left <= 0) {
          setError("Too many failed attempts. Account locked for 15 minutes.");
          setAttemptsLeft(0);
        } else {
          setError("Incorrect email or password. " + left + " attempt" + (left !== 1 ? "s" : "") + " remaining before lockout.");
          setAttemptsLeft(left);
        }
      } else {
        clearLockout(email);
        setAttemptsLeft(MAX_ATTEMPTS);
      }
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F5F8FF", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 20,
      backgroundImage: "none"
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
            type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKeyDown}
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
            type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isSignUp ? "Min 8 chars, uppercase, special char" : "Your password"}
            style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* Submit button */}
        <button onClick={handleSubmit} disabled={loading}
          style={{ width: "100%", padding: "13px", background: loading ? "#8888CC" : ink, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", letterSpacing: 0.5, marginBottom: 16 }}>
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

      {/* Download User Guide */}
      <div style={{ marginTop: 16, width: "100%", maxWidth: 400 }}>
        <a
          href="/BlueSquareInvoice_UserGuide.pdf"
          download="BlueSquareInvoice_UserGuide.pdf"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "11px", boxSizing: "border-box",
            background: "transparent", border: "1.5px solid #B8A870", borderRadius: 8,
            fontFamily: "monospace", fontSize: 12, color: "#6A5F30", fontWeight: 700,
            textDecoration: "none", letterSpacing: 0.5, cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(184,168,112,0.15)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          📄 Download User Guide (PDF)
        </a>
      </div>

      {/* Support note */}
      <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center" }}>
        For support: <a href="mailto:support@bluesquaresolutions.com.au" style={{ color: "#8888CC" }}>support@bluesquaresolutions.com.au</a>
      </div>
    </div>
  );
}
