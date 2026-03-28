import { useState } from "react";
import { supabase } from "./supabase";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";
const GOLD = "#B8A870";

export default function Onboarding({ user, onComplete }) {
  const [coName, setCoName] = useState("");
  const [coAbn, setCoAbn] = useState("");
  const [coAddr, setCoAddr] = useState("");
  const [coPhone, setCoPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!coName.trim()) { setError("Company name is required."); return; }
    if (!coAbn.trim()) { setError("ABN is required."); return; }

    setLoading(true);
    setError("");

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const userId = authUser?.id;
      if (!userId) throw new Error("Not logged in");

      const fromParts = [coName, coAbn ? "ABN: " + coAbn : "", coAddr, coPhone].filter(Boolean);
      const from = fromParts.join("\n");

      // Save to profiles table
      const profileData = {
        user_id: userId,
        company_name: coName,
        abn: coAbn,
        address: coAddr,
        phone: coPhone,
        email: authUser?.email || "",
      };

      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        await supabase.from("profiles").update(profileData).eq("user_id", userId);
      } else {
        await supabase.from("profiles").insert(profileData);
      }

      // Mark onboarding complete in user_settings
      await supabase
        .from("user_settings")
        .update({ onboarded: true })
        .eq("user_id", userId);

      // Save to localStorage as cache
      localStorage.setItem("invoice_app_profile", JSON.stringify({
        coName, coAbn, coAddr, coPhone, from, abnS: coAbn
      }));

      onComplete({ coName, coAbn, coAddr, coPhone, from, abnS: coAbn });
    } catch (e) {
      console.error("Onboarding error:", e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const ink = NAVY;

  return (
    <div style={{
      minHeight: "100vh", background: "#E8E4D0", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 20,
      backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(160,150,100,0.04) 2px, rgba(160,150,100,0.04) 4px)"
    }}>
      {/* Header */}
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 28, color: ink, fontWeight: 700, letterSpacing: 1 }}>
          📋 Blue Square Invoice
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>
          Professional Invoicing for Australian Business
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: "#FEFCE8", border: "1px solid #C8C0A0", borderLeft: "6px solid #B8A870",
        boxShadow: "0 8px 40px rgba(0,0,0,0.15)", padding: "36px 36px 32px",
        width: "100%", maxWidth: 460
      }}>
        {/* Welcome header */}
        <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: ink, textAlign: "center", border: `2px solid ${ink}`, padding: "8px 16px", marginBottom: 8 }}>
          Welcome! Let's set up your business
        </div>
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center", marginBottom: 24, letterSpacing: 0.5 }}>
          This takes 30 seconds and pre-fills every invoice automatically.
        </p>

        {/* Progress indicator */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 4 }}>
          {["Business Name", "ABN", "Details"].map((step, i) => (
            <div key={step} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 4, background: i === 0 ? NAVY : i === 1 ? (coName ? NAVY : "#E0D8C0") : (coAbn ? GREEN : "#E0D8C0"), borderRadius: 2, marginBottom: 4 }} />
              <div style={{ fontFamily: "monospace", fontSize: 9, color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 }}>{step}</div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontFamily: "monospace", fontSize: 12, color: "#991B1B" }}>
            {error}
          </div>
        )}

        {/* Company Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Company / Business Name <span style={{ color: "#C0392B" }}>*</span>
          </label>
          <input
            type="text"
            value={coName}
            onChange={e => { setCoName(e.target.value); setError(""); }}
            placeholder="Blue Square Solutions"
            style={{ width: "100%", padding: "11px 14px", border: `1.5px solid ${coName ? NAVY : "#9999CC"}`, borderRadius: 6, fontFamily: "Lato, sans-serif", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* ABN */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            ABN (Australian Business Number) <span style={{ color: "#C0392B" }}>*</span>
          </label>
          <input
            type="text"
            value={coAbn}
            onChange={e => { setCoAbn(e.target.value); setError(""); }}
            placeholder="XX XXX XXX XXX"
            style={{ width: "100%", padding: "11px 14px", border: `1.5px solid ${coAbn ? NAVY : "#9999CC"}`, borderRadius: 6, fontFamily: "monospace", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa", marginTop: 4 }}>
            Required for Australian tax invoices. <a href="https://abr.business.gov.au" target="_blank" style={{ color: NAVY }}>Look up your ABN →</a>
          </div>
        </div>

        {/* Address */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Business Address <span style={{ color: "#aaa", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={coAddr}
            onChange={e => setCoAddr(e.target.value)}
            placeholder="123 Main St, Sydney NSW 2000"
            style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "Lato, sans-serif", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* Phone */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Phone / Email <span style={{ color: "#aaa", fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={coPhone}
            onChange={e => setCoPhone(e.target.value)}
            placeholder="+61 400 000 000 or hello@business.com.au"
            style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "Lato, sans-serif", fontSize: 14, color: ink, background: "transparent", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || !coName || !coAbn}
          style={{
            width: "100%", padding: "13px",
            background: loading || !coName || !coAbn ? "#8888CC" : GREEN,
            color: "#fff", border: "none", borderRadius: 8,
            fontFamily: "Lato, sans-serif", fontSize: 15, fontWeight: 700,
            cursor: loading || !coName || !coAbn ? "not-allowed" : "pointer",
            letterSpacing: 0.5, transition: "background 0.2s"
          }}>
          {loading ? "Setting up..." : "Start Invoicing →"}
        </button>

        <div style={{ textAlign: "center", marginTop: 12, fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>
          Signed in as {user?.email} &nbsp;·&nbsp;
          <span onClick={async () => { await supabase.auth.signOut(); }} style={{ color: "#C0392B", cursor: "pointer", textDecoration: "underline" }}>
            Sign out
          </span>
        </div>
      </div>

      {/* Beta note */}
      <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center" }}>
        🚀 BETA VERSION — invoice.bluesquaresolutions.com.au
      </div>
    </div>
  );
}
