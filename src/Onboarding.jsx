import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";

async function redirectToCheckout(plan, interval) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        plan,
        interval,
        success_url: `${window.location.origin}/?checkout=success`,
        cancel_url: `${window.location.origin}/pricing.html?checkout=cancelled`,
      }),
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  window.location.href = data.url;
}

export default function Onboarding({ user, onComplete }) {
  const [coName, setCoName] = useState("");
  const [coAbn, setCoAbn] = useState("");
  const [coAddr, setCoAddr] = useState("");
  const [coPhone, setCoPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Plan picker state
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("founding");
  const [selectedInterval, setSelectedInterval] = useState("monthly");
  const [foundingStatus, setFoundingStatus] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    supabase.rpc("get_founding_status").then(({ data }) => {
      setFoundingStatus(data);
      if (data && !data.available) setSelectedPlan("starter");
    });
  }, []);

  const handleSubmit = async () => {
    if (!coName.trim()) { setError("Company name is required."); return; }
    if (!coAbn.trim()) { setError("ABN is required."); return; }
    setLoading(true); setError("");

    try {
      // Check if tenant already exists for this user
      const { data: existingMember } = await supabase
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", user.id)
        .eq("role", "owner")
        .maybeSingle();

      let tenantId;

      if (existingMember?.tenant_id) {
        // Tenant already exists — just update profile
        tenantId = existingMember.tenant_id;
        await supabase.from("tenants").update({
          name: coName, abn: coAbn, address: coAddr, phone: coPhone
        }).eq("id", tenantId);
        await supabase.from("profiles").update({
          company_name: coName, abn: coAbn, address: coAddr, phone: coPhone
        }).eq("tenant_id", tenantId);
      } else {
        // Create new tenant
        const { data: tenant, error: tenantErr } = await supabase
          .from("tenants")
          .insert({ name: coName, abn: coAbn, address: coAddr, phone: coPhone, email: user.email, owner_id: user.id, plan: "trial", doc_limit: 10 })
          .select().single();
        if (tenantErr) throw tenantErr;
        tenantId = tenant.id;

        await supabase.from("profiles").update({
          company_name: coName, abn: coAbn, address: coAddr, phone: coPhone
        }).eq("tenant_id", tenantId);

        const { data: existingCounter } = await supabase.from("counters").select("id").eq("tenant_id", tenantId).maybeSingle();
        if (!existingCounter) {
          await supabase.from("counters").insert({ tenant_id: tenantId, invoice_count: 0, quote_count: 0 });
        }

        const { data: existingMem } = await supabase.from("tenant_members").select("id").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
        if (!existingMem) {
          await supabase.from("tenant_members").insert({ tenant_id: tenantId, user_id: user.id, role: "owner" });
        }
      }

      // Mark as onboarded immediately so AppRoot lets user through
      await supabase.from("user_settings").update({
        tenant_id: tenantId,
        onboarded: true,
        role: "owner",
      }).eq("user_id", user.id);

      // Save to localStorage
      const fromParts = [coName, coAbn ? "ABN: " + coAbn : "", coAddr, coPhone].filter(Boolean);
      const profile = { coName, coAbn, coAddr, coPhone, from: fromParts.join("\n"), abnS: coAbn };
      localStorage.setItem("invoice_app_profile", JSON.stringify(profile));

      setLoading(false);

      // Show plan picker as overlay — user is already marked as onboarded
      setShowPlanPicker(true);

    } catch (e) {
      console.error("Onboarding error:", e);
      setError("Something went wrong: " + e.message);
      setLoading(false);
    }
  };

  const handleStartCheckout = async () => {
    setCheckoutLoading(true);
    setError("");
    try {
      await redirectToCheckout(selectedPlan, selectedInterval);
    } catch (err) {
      setError(err.message);
      setCheckoutLoading(false);
    }
  };

  const handleSkipCheckout = () => {
    // Go straight to app on free plan
    onComplete();
  };

  const getPrice = () => {
    if (selectedPlan === "founding") return selectedInterval === "monthly" ? "A$2.99" : "A$28.99";
    return selectedInterval === "monthly" ? "A$9.99" : "A$99.00";
  };

  const getSaving = () => {
    if (selectedInterval !== "yearly") return null;
    return selectedPlan === "founding" ? "Save 19% vs monthly" : "Save 17% vs monthly";
  };

  const ink = NAVY;

  // Plan picker overlay — shown after business setup
  if (showPlanPicker) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F8FF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 28, color: ink, fontWeight: 700, letterSpacing: 1 }}>📋 Blue Square Invoice</div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>Choose your plan</div>
        </div>

        <div style={{ background: "#FEFCE8", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870", boxShadow: "0 8px 40px rgba(0,0,0,0.15)", padding: "36px", width: "100%", maxWidth: 480 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: ink, textAlign: "center", border: "2px solid " + ink, padding: "8px 16px", marginBottom: 8 }}>
            Your workspace is ready!
          </div>
          <p style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center", marginBottom: 24 }}>
            Start with a 30-day free trial. Cancel anytime.
          </p>

          {error && (
            <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#991B1B" }}>
              {error}
            </div>
          )}

          {foundingStatus?.available && (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#1E40AF", textAlign: "center" }}>
              🎯 {foundingStatus.slots_remaining} of 50 founding member spots remaining
            </div>
          )}
          {foundingStatus && !foundingStatus.available && (
            <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#92400E", textAlign: "center" }}>
              All founding member spots are taken. Standard pricing applies.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {foundingStatus?.available && (
              <button onClick={() => setSelectedPlan("founding")}
                style={{ flex: 1, padding: "12px 8px", border: selectedPlan === "founding" ? "2px solid " + ink : "1.5px solid #9999CC", borderRadius: 8, background: selectedPlan === "founding" ? "#EEF0FF" : "transparent", fontFamily: "monospace", fontSize: 12, color: ink, cursor: "pointer", fontWeight: selectedPlan === "founding" ? 700 : 400 }}>
                Founding<br /><span style={{ fontSize: 10, color: "#8888CC" }}>First 50 users</span>
              </button>
            )}
            <button onClick={() => setSelectedPlan("starter")}
              style={{ flex: 1, padding: "12px 8px", border: selectedPlan === "starter" ? "2px solid " + ink : "1.5px solid #9999CC", borderRadius: 8, background: selectedPlan === "starter" ? "#EEF0FF" : "transparent", fontFamily: "monospace", fontSize: 12, color: ink, cursor: "pointer", fontWeight: selectedPlan === "starter" ? 700 : 400 }}>
              Starter<br /><span style={{ fontSize: 10, color: "#8888CC" }}>Standard rate</span>
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            {["monthly", "yearly"].map(interval => (
              <button key={interval} onClick={() => setSelectedInterval(interval)}
                style={{ flex: 1, padding: "10px", border: selectedInterval === interval ? "2px solid " + GREEN : "1.5px solid #9999CC", borderRadius: 8, background: selectedInterval === interval ? "#F0FDF4" : "transparent", fontFamily: "monospace", fontSize: 12, color: GREEN, cursor: "pointer", fontWeight: selectedInterval === interval ? 700 : 400 }}>
                {interval === "monthly" ? "Monthly" : "Yearly"}
                {interval === "yearly" && <span style={{ display: "block", fontSize: 10, color: "#8888CC" }}>Save up to 19%</span>}
              </button>
            ))}
          </div>

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 36, color: ink, fontWeight: 700 }}>{getPrice()}</div>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC" }}>per {selectedInterval === "monthly" ? "month" : "year"} · after 30-day free trial</div>
            {getSaving() && <div style={{ fontFamily: "monospace", fontSize: 11, color: GREEN, marginTop: 4, fontWeight: 700 }}>✓ {getSaving()}</div>}
          </div>

          <div style={{ marginBottom: 20, fontFamily: "monospace", fontSize: 11, color: "#555", lineHeight: 2 }}>
            {["Unlimited invoices & quotes", "Custom branding & logo", "GST + discount fields", "Signature capture", "Full PDF export", "30-day free trial · cancel anytime"].map(f => (
              <div key={f}>✓ {f}</div>
            ))}
          </div>

          <button onClick={handleStartCheckout} disabled={checkoutLoading}
            style={{ width: "100%", padding: "14px", background: checkoutLoading ? "#8888CC" : ink, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: checkoutLoading ? "not-allowed" : "pointer", marginBottom: 12 }}>
            {checkoutLoading ? "Redirecting to checkout..." : "Start 30-day free trial →"}
          </button>

          <div style={{ textAlign: "center" }}>
            <span onClick={handleSkipCheckout}
              style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textDecoration: "underline", cursor: "pointer" }}>
              Continue with free plan (10 invoices/month)
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Business setup form
  return (
    <div style={{ minHeight: "100vh", background: "#F5F8FF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 28, color: ink, fontWeight: 700, letterSpacing: 1 }}>📋 Blue Square Invoice</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>Professional Invoicing for Australian Business</div>
      </div>

      <div style={{ background: "#FEFCE8", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870", boxShadow: "0 8px 40px rgba(0,0,0,0.15)", padding: "36px 36px 32px", width: "100%", maxWidth: 460 }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: ink, textAlign: "center", border: "2px solid " + ink, padding: "8px 16px", marginBottom: 8 }}>Welcome! Set up your business</div>
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center", marginBottom: 24 }}>Takes 30 seconds. Pre-fills every invoice automatically.</p>

        {error && <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#991B1B" }}>{error}</div>}

        {[
          ["Company / Business Name *", coName, setCoName, "e.g. Smith Plumbing Pty Ltd", "Lato, sans-serif", coName ? NAVY : "#9999CC"],
          ["ABN *", coAbn, setCoAbn, "e.g. 51 824 753 556", "monospace", coAbn ? NAVY : "#9999CC"],
          ["Business Address (optional)", coAddr, setCoAddr, "e.g. 123 Main St, Sydney NSW 2000", "Lato, sans-serif", "#9999CC"],
          ["Phone / Email (optional)", coPhone, setCoPhone, "e.g. +61 400 000 000", "Lato, sans-serif", "#9999CC"],
        ].map(([label, val, setter, ph, ff, bc]) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>{label}</label>
            <input type="text" value={val} onChange={e => { setter(e.target.value); setError(""); }} placeholder={ph}
              style={{ width: "100%", padding: "11px 14px", border: "1.5px solid " + bc, borderRadius: 6, fontFamily: ff, fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}

        <button onClick={handleSubmit} disabled={loading || !coName || !coAbn}
          style={{ width: "100%", padding: "13px", background: loading || !coName || !coAbn ? "#8888CC" : GREEN, color: "#fff", border: "none", borderRadius: 8, fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700, cursor: loading || !coName || !coAbn ? "not-allowed" : "pointer", marginTop: 8 }}>
          {loading ? "Setting up your workspace..." : "Next: Choose your plan →"}
        </button>

        <div style={{ textAlign: "center", marginTop: 12, fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>
          Signed in as {user?.email} &nbsp;·&nbsp;
          <span onClick={async () => { await supabase.auth.signOut(); }} style={{ color: "#C0392B", cursor: "pointer", textDecoration: "underline" }}>Sign out</span>
        </div>
      </div>
    </div>
  );
}
