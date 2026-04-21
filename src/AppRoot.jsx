import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { TenantProvider } from "./TenantContext";
import Auth from "./Auth";
import Onboarding from "./Onboarding";
import InviteAccept from "./InviteAccept";
import ResetPassword from "./ResetPassword";
import App from "./App";
import Admin from "./Admin";
import TeamSettings from "./TeamSettings";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";
const SUPABASE_URL = "https://gogigxsmzhvzavhjawni.supabase.co";

// ── Plan Picker Modal ─────────────────────────────────────────────────────────
function PlanPickerModal({ user, onClose }) {
  const [selectedPlan, setSelectedPlan] = useState("founding");
  const [selectedInterval, setSelectedInterval] = useState("monthly");
  const [foundingStatus, setFoundingStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.rpc("get_founding_status").then(({ data }) => {
      setFoundingStatus(data);
      if (data && !data.available) setSelectedPlan("starter");
    });
  }, []);

  const handleCheckout = async () => {
    setLoading(true); setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZ2lneHNtemh2emF2aGphd25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTg5NjIsImV4cCI6MjA5MDA5NDk2Mn0.r7ftBw5XIGA7xwnAAUR6Bp-rpmFhTBDQGSMz-Ff98P4",
        },
        body: JSON.stringify({
          plan: selectedPlan,
          interval: selectedInterval,
          success_url: `${window.location.origin}/?checkout=success`,
          cancel_url: `${window.location.origin}/pricing.html`,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.url) {
        localStorage.removeItem("show_plan_picker");
        window.location.href = data.url;
      } else throw new Error("No checkout URL returned");
    } catch (err) {
      console.error("Checkout error:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  const handleSkip = () => {
    localStorage.removeItem("show_plan_picker");
    onClose();
  };

  const getPrice = () => {
    if (selectedPlan === "founding") return selectedInterval === "monthly" ? "A$2.99/mo" : "A$28.99/yr";
    return selectedInterval === "monthly" ? "A$9.99/mo" : "A$99/yr";
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#FEFCE8", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870", borderRadius: 12, padding: 32, maxWidth: 480, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>

        <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: NAVY, textAlign: "center", marginBottom: 6 }}>🎉 Workspace ready!</div>
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center", marginBottom: 20 }}>Unlock unlimited invoices with a 30-day free trial.</p>

        {error && <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontFamily: "monospace", fontSize: 12, color: "#991B1B" }}>{error}</div>}

        {foundingStatus?.available && (
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontFamily: "monospace", fontSize: 11, color: "#1E40AF", textAlign: "center" }}>
            🎯 {foundingStatus.slots_remaining} of 50 founding member spots remaining
          </div>
        )}

        {/* Plan buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {foundingStatus?.available && (
            <button onClick={() => setSelectedPlan("founding")}
              style={{ flex: 1, padding: "10px 8px", border: selectedPlan === "founding" ? "2px solid " + NAVY : "1.5px solid #9999CC", borderRadius: 8, background: selectedPlan === "founding" ? "#EEF0FF" : "transparent", fontFamily: "monospace", fontSize: 12, color: NAVY, cursor: "pointer", fontWeight: selectedPlan === "founding" ? 700 : 400 }}>
              Founding<br /><span style={{ fontSize: 10, color: "#8888CC" }}>First 50 users</span>
            </button>
          )}
          <button onClick={() => setSelectedPlan("starter")}
            style={{ flex: 1, padding: "10px 8px", border: selectedPlan === "starter" ? "2px solid " + NAVY : "1.5px solid #9999CC", borderRadius: 8, background: selectedPlan === "starter" ? "#EEF0FF" : "transparent", fontFamily: "monospace", fontSize: 12, color: NAVY, cursor: "pointer", fontWeight: selectedPlan === "starter" ? 700 : 400 }}>
            Starter<br /><span style={{ fontSize: 10, color: "#8888CC" }}>Standard rate</span>
          </button>
        </div>

        {/* Interval buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["monthly", "yearly"].map(i => (
            <button key={i} onClick={() => setSelectedInterval(i)}
              style={{ flex: 1, padding: "8px", border: selectedInterval === i ? "2px solid " + GREEN : "1.5px solid #9999CC", borderRadius: 8, background: selectedInterval === i ? "#F0FDF4" : "transparent", fontFamily: "monospace", fontSize: 12, color: GREEN, cursor: "pointer", fontWeight: selectedInterval === i ? 700 : 400 }}>
              {i === "monthly" ? "Monthly" : "Yearly"}{i === "yearly" ? <span style={{ display: "block", fontSize: 10, color: "#8888CC" }}>Save up to 19%</span> : null}
            </button>
          ))}
        </div>

        {/* Price */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 32, color: NAVY, fontWeight: 700 }}>{getPrice()}</span>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC" }}>after 30-day free trial · cancel anytime</div>
        </div>

        {/* Features */}
        <div style={{ marginBottom: 16, fontFamily: "monospace", fontSize: 11, color: "#555", lineHeight: 2 }}>
          {["Unlimited invoices & quotes", "Custom branding & logo", "GST + discount fields", "Full PDF export"].map(f => <div key={f}>✓ {f}</div>)}
        </div>

        <button onClick={handleCheckout} disabled={loading}
          style={{ width: "100%", padding: "13px", background: loading ? "#8888CC" : NAVY, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginBottom: 10 }}>
          {loading ? "Redirecting to checkout..." : "Start 30-day free trial →"}
        </button>

        <div style={{ textAlign: "center" }}>
          <span onClick={handleSkip} style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textDecoration: "underline", cursor: "pointer" }}>
            Continue with free plan (10 invoices/month)
          </span>
        </div>
      </div>
    </div>
  );
}

// ── App Root ──────────────────────────────────────────────────────────────────
export default function AppRoot() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [screen, setScreen] = useState("app");
  const [inviteToken, setInviteToken] = useState(null);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) setInviteToken(token);

    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=email_change")) setIsResetPassword(true);
    if (params.get("type") === "recovery") setIsResetPassword(true);

    if (params.get("checkout") === "success") {
      setCheckoutSuccess(true);
      localStorage.removeItem("show_plan_picker");
      window.history.replaceState({}, "", "/");
    } else if (params.get("checkout") === "cancelled") {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) checkOnboarded(session.user.id);
      else setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === "SIGNED_OUT") {
        setUser(null); setAuthLoading(false); setOnboarded(false); setShowPlanPicker(false);
      } else if (_event === "SIGNED_IN") {
        setUser(session?.user ?? null);
        if (session?.user) checkOnboarded(session.user.id);
      }
      // All other events ignored — prevents re-render loops
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkOnboarded = async (userId) => {
    const { data } = await supabase
      .from("user_settings")
      .select("onboarded, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    const isOnboarded = !!(data?.onboarded && data?.tenant_id);
    setOnboarded(isOnboarded);
    setAuthLoading(false);

    // Show plan picker if flagged (new user just onboarded)
    if (isOnboarded && localStorage.getItem("show_plan_picker") === "true") {
      setShowPlanPicker(true);
    }
  };

  // Poll after Stripe checkout success
  useEffect(() => {
    if (!checkoutSuccess || !user) return;
    const poll = async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const { data } = await supabase.from("user_settings").select("onboarded, tenant_id").eq("user_id", user.id).maybeSingle();
        if (data?.onboarded && data?.tenant_id) { setOnboarded(true); setCheckoutSuccess(false); return; }
      }
      setOnboarded(true); setCheckoutSuccess(false);
    };
    poll();
  }, [checkoutSuccess, user]);

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#8888CC" }}>Loading...</div>
      </div>
    );
  }

  if (checkoutSuccess) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F8FF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: NAVY, marginBottom: 12 }}>Payment successful!</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#8888CC", lineHeight: 1.6 }}>Setting up your account...<br />This takes just a moment.</div>
        </div>
      </div>
    );
  }

  if (isResetPassword) return <ResetPassword />;

  if (!user) {
    if (inviteToken) return <InviteAccept token={inviteToken} />;
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") !== "true") { window.location.href = "/pricing.html"; return null; }
    return <Auth />;
  }

  if (inviteToken) {
    return <InviteAccept token={inviteToken} user={user} onAccepted={() => { setInviteToken(null); setOnboarded(true); window.history.replaceState({}, "", "/"); }} />;
  }

  if (!onboarded) {
    return <Onboarding user={user} onComplete={() => { setOnboarded(true); setShowPlanPicker(true); }} />;
  }

  return (
    <TenantProvider user={user}>
      {showPlanPicker && <PlanPickerModal user={user} onClose={() => setShowPlanPicker(false)} />}
      {screen === "admin" && <Admin user={user} onBack={() => setScreen("app")} />}
      {screen === "team" && <TeamSettings user={user} onBack={() => setScreen("app")} />}
      {screen === "app" && <App user={user} onShowAdmin={() => setScreen("admin")} onShowTeam={() => setScreen("team")} />}
    </TenantProvider>
  );
}
