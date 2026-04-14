import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";
const RED = "#C0392B";

// Password validation rules
function validatePassword(password, confirmPassword, history = []) {
  const errors = [];

  if (password.length < 8) errors.push("At least 8 characters");
  if (!/[A-Z]/.test(password)) errors.push("At least 1 uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("At least 1 lowercase letter");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("At least 1 special character (!@#$%^&*)");
  if (/012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(password))
    errors.push("No consecutive sequential letters or numbers (e.g. 123, abc)");
  if (password !== confirmPassword && confirmPassword.length > 0)
    errors.push("Passwords do not match");

  return errors;
}

function StrengthBar({ password }) {
  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  if (password.length >= 12) strength++;

  const colors = ["#EF4444", "#F59E0B", "#F59E0B", "#84CC16", "#22C55E"];
  const labels = ["Very Weak", "Weak", "Fair", "Strong", "Very Strong"];

  if (!password) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i <= strength ? colors[strength - 1] : "#e5e7eb",
            transition: "background 0.2s"
          }} />
        ))}
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 10, color: strength > 0 ? colors[strength - 1] : "#999" }}>
        {strength > 0 ? labels[strength - 1] : ""}
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    // Supabase sends the reset token as a URL hash fragment
    // We need to exchange it for a session
    const handleReset = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (data?.session) {
        setSessionReady(true);
      } else {
        // Try to get session from URL hash (Supabase v2)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const type = hashParams.get("type");

        if (type === "recovery" && accessToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!sessionError) setSessionReady(true);
        }
      }
    };

    // Also listen for auth state change (Supabase fires PASSWORD_RECOVERY event)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setSessionReady(true);
      }
    });

    handleReset();
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async () => {
    const validationErrors = validatePassword(password, confirm);
    if (validationErrors.length > 0) { setErrors(validationErrors); return; }

    setLoading(true);
    setErrors([]);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      // Redirect to app after 3 seconds
      setTimeout(() => {
        window.location.href = "/?signin=true";
      }, 3000);
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setLoading(false);
    }
  };

  const validationErrors = validatePassword(password, confirm);
  const isValid = validationErrors.length === 0 && password.length > 0;

  return (
    <div style={{
      minHeight: "100vh", background: "#F5F8FF", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20
    }}>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 28, color: NAVY, fontWeight: 700 }}>
          📋 Blue Square Invoice
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>
          Set New Password
        </div>
      </div>

      <div style={{
        background: "#fff", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870",
        boxShadow: "0 8px 40px rgba(0,0,0,0.1)", padding: "36px", width: "100%", maxWidth: 420
      }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: NAVY, textAlign: "center", border: `2px solid ${NAVY}`, padding: "8px 16px", marginBottom: 24 }}>
          {success ? "Password Updated!" : "Create New Password"}
        </div>

        {success ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <p style={{ fontFamily: "monospace", fontSize: 13, color: GREEN, marginBottom: 16 }}>
              Your password has been updated successfully!
            </p>
            <p style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>
              Redirecting you to sign in...
            </p>
          </div>
        ) : !sessionReady ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#888" }}>
              Verifying your reset link...
            </p>
            <p style={{ fontFamily: "monospace", fontSize: 11, color: RED, marginTop: 12 }}>
              If this takes too long, your reset link may have expired.<br/>
              <a href="/?signin=true" style={{ color: NAVY }}>Request a new one →</a>
            </p>
          </div>
        ) : (
          <>
            {errors.length > 0 && (
              <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "10px 14px", marginBottom: 16 }}>
                {errors.map((e, i) => (
                  <div key={i} style={{ fontFamily: "monospace", fontSize: 11, color: RED, marginBottom: i < errors.length - 1 ? 4 : 0 }}>
                    ✗ {e}
                  </div>
                ))}
              </div>
            )}

            {/* New Password */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: NAVY, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                New Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  style={{ width: "100%", padding: "11px 40px 11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: NAVY, background: "transparent", outline: "none", boxSizing: "border-box" }}
                />
                <button onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 14 }}>
                  {showPass ? "🙈" : "👁"}
                </button>
              </div>
              <StrengthBar password={password} />
            </div>

            {/* Confirm Password */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: NAVY, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                Confirm Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  style={{ width: "100%", padding: "11px 40px 11px 14px", border: `1.5px solid ${confirm && confirm === password ? "#2E7D52" : confirm ? "#EF4444" : "#9999CC"}`, borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: NAVY, background: "transparent", outline: "none", boxSizing: "border-box" }}
                />
                <button onClick={() => setShowConfirm(!showConfirm)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 14 }}>
                  {showConfirm ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {/* Rules checklist */}
            <div style={{ background: "#F8F9FF", borderRadius: 8, padding: "12px 14px", marginBottom: 20, border: "1px solid #E8E8F8" }}>
              <div style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>Password Requirements</div>
              {[
                ["At least 8 characters", password.length >= 8],
                ["1 uppercase letter", /[A-Z]/.test(password)],
                ["1 lowercase letter", /[a-z]/.test(password)],
                ["1 special character (!@#$%^&*)", /[^A-Za-z0-9]/.test(password)],
                ["No sequential letters/numbers (abc, 123)", !/012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(password) && password.length > 0],
                ["Passwords match", password === confirm && password.length > 0],
              ].map(([rule, met]) => (
                <div key={rule} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontFamily: "monospace", fontSize: 11, color: !password ? "#ccc" : met ? GREEN : RED }}>
                  <span>{!password ? "○" : met ? "✓" : "✗"}</span>
                  <span>{rule}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !isValid}
              style={{ width: "100%", padding: "13px", background: loading || !isValid ? "#8888CC" : GREEN, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: loading || !isValid ? "not-allowed" : "pointer" }}>
              {loading ? "Updating password..." : "Set New Password →"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
