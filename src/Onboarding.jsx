import { useState } from "react";
import { supabase } from "./supabase";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";

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
    setLoading(true); setError("");

    try {
      const { data: existingMember } = await supabase
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", user.id)
        .eq("role", "owner")
        .maybeSingle();

      let tenantId;

      if (existingMember?.tenant_id) {
        tenantId = existingMember.tenant_id;
        await supabase.from("tenants").update({
          name: coName, abn: coAbn, address: coAddr, phone: coPhone
        }).eq("id", tenantId);
        await supabase.from("profiles").update({
          company_name: coName, abn: coAbn, address: coAddr, phone: coPhone
        }).eq("tenant_id", tenantId);
      } else {
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

      // Save profile to localStorage
      const fromParts = [coName, coAbn ? "ABN: " + coAbn : "", coAddr, coPhone].filter(Boolean);
      localStorage.setItem("invoice_app_profile", JSON.stringify({ coName, coAbn, coAddr, coPhone, from: fromParts.join("\n"), abnS: coAbn }));
      localStorage.setItem("show_plan_picker", "true");

      // Set onboarded:true immediately — no blocking on plan picker
      await supabase.from("user_settings").update({
        tenant_id: tenantId,
        onboarded: true,
        role: "owner",
      }).eq("user_id", user.id);

      setLoading(false);
      onComplete();

    } catch (e) {
      console.error("Onboarding error:", e);
      setError("Something went wrong: " + e.message);
      setLoading(false);
    }
  };

  const ink = NAVY;

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
          {loading ? "Setting up your workspace..." : "Get Started →"}
        </button>

        <div style={{ textAlign: "center", marginTop: 12, fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>
          Signed in as {user?.email} &nbsp;·&nbsp;
          <span onClick={async () => { await supabase.auth.signOut(); }} style={{ color: "#C0392B", cursor: "pointer", textDecoration: "underline" }}>Sign out</span>
        </div>
      </div>
    </div>
  );
}
