import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { useTenant } from "./TenantContext";

const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";
const RED = "#C0392B";

export default function TeamSettings({ user, onBack }) {
  const { tenant, members, isOwner, isAdmin, refreshTenant } = useTenant();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  useEffect(() => { loadInvites(); }, []);

  const loadInvites = async () => {
    const { data } = await supabase
      .from("tenant_invites")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("accepted", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    setInvites(data || []);
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) { setError("Please enter a valid email."); return; }
    setLoading(true); setError("");
    try {
      const { data, error: invErr } = await supabase
        .from("tenant_invites")
        .insert({ tenant_id: tenant.id, invited_by: user.id, email: inviteEmail.trim().toLowerCase(), role: inviteRole })
        .select().single();
      if (invErr) throw invErr;

      const inviteLink = window.location.origin + "?invite=" + data.token;
      const msg = "Hi! You've been invited to join " + tenant.name + " on Blue Square Invoice.\n\nClick this link to accept: " + inviteLink + "\n\nThis invite expires in 7 days.";
      window.open("mailto:" + inviteEmail + "?subject=Invitation to join " + tenant.name + " on Blue Square Invoice&body=" + encodeURIComponent(msg), "_blank");

      setInviteEmail("");
      loadInvites();
      showToast("✓ Invite sent to " + inviteEmail);
    } catch (e) {
      setError("Failed to send invite: " + e.message);
    } finally { setLoading(false); }
  };

  const copyInviteLink = async (token) => {
    const link = window.location.origin + "?invite=" + token;
    await navigator.clipboard.writeText(link);
    showToast("✓ Invite link copied!");
  };

  const removeInvite = async (id) => {
    await supabase.from("tenant_invites").delete().eq("id", id);
    loadInvites();
    showToast("Invite removed");
  };

  const removeMember = async (memberId, memberUserId) => {
    if (memberUserId === user.id) { showToast("You can't remove yourself"); return; }
    if (!window.confirm("Remove this team member?")) return;
    await supabase.from("tenant_members").update({ is_active: false }).eq("id", memberId);
    await supabase.from("user_settings").update({ tenant_id: null, role: null }).eq("user_id", memberUserId);
    refreshTenant();
    showToast("Member removed");
  };

  const changeRole = async (memberId, newRole) => {
    await supabase.from("tenant_members").update({ role: newRole }).eq("id", memberId);
    const { data: mem } = await supabase.from("tenant_members").select("user_id").eq("id", memberId).single();
    if (mem) await supabase.from("user_settings").update({ role: newRole }).eq("user_id", mem.user_id);
    refreshTenant();
    showToast("Role updated");
  };

  const roleBadge = (role) => {
    const colors = { owner: [NAVY, "#E8E8F8"], admin: [GREEN, "#E8F5E9"], staff: ["#C47A00", "#FFF8E1"] };
    const [fg, bg] = colors[role] || ["#666", "#f0f0f0"];
    return <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: fg, background: bg, border: "1px solid " + fg, textTransform: "uppercase" }}>{role}</span>;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4D0", fontFamily: "Lato, sans-serif", padding: "0 0 60px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: NAVY, color: "#fff", fontFamily: "monospace", fontSize: 13, padding: "10px 20px", borderRadius: 8, zIndex: 9999, pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background: NAVY, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: "#fff" }}>Team Settings</div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", marginTop: 2 }}>{tenant?.name} — Manage your team</div>
        </div>
        <button onClick={onBack} style={{ padding: "7px 16px", borderRadius: 6, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
          ← Back to App
        </button>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px" }}>

        {/* Current Team Members */}
        <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #C8C0A0", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ background: NAVY, padding: "12px 16px", fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#fff" }}>
            👥 Team Members ({members.length})
          </div>
          {members.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "#8888CC" }}>No team members yet.</div>
          ) : (
            members.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < members.length - 1 ? "1px solid #f0f0f0" : "none", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: NAVY }}>
                    {m.user_settings?.email || "Unknown"}
                    {m.user_id === user.id && <span style={{ marginLeft: 8, fontSize: 10, color: "#8888CC" }}>(you)</span>}
                  </div>
                  <div style={{ marginTop: 4 }}>{roleBadge(m.role)}</div>
                </div>
                {isOwner && m.user_id !== user.id && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={m.role} onChange={e => changeRole(m.id, e.target.value)}
                      style={{ padding: "5px 10px", border: "1px solid #C8C0A0", borderRadius: 6, fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
                      <option value="admin">Admin</option>
                      <option value="staff">Staff</option>
                    </select>
                    <button onClick={() => removeMember(m.id, m.user_id)}
                      style={{ padding: "5px 12px", border: "1px solid " + RED, background: "transparent", color: RED, borderRadius: 6, fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Invite New Member */}
        {isAdmin && (
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #C8C0A0", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ background: GREEN, padding: "12px 16px", fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#fff" }}>
              ➕ Invite Team Member
            </div>
            <div style={{ padding: 16 }}>
              {error && <div style={{ background: "#FEE2E2", border: "1px solid #EF4444", borderRadius: 6, padding: "10px 14px", marginBottom: 12, fontFamily: "monospace", fontSize: 12, color: "#991B1B" }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input type="email" value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setError(""); }}
                  placeholder="colleague@company.com"
                  style={{ flex: 1, minWidth: 200, padding: "10px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 13, outline: "none" }} />
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  style={{ padding: "10px 14px", border: "1.5px solid #9999CC", borderRadius: 6, fontFamily: "monospace", fontSize: 13, cursor: "pointer" }}>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={sendInvite} disabled={loading}
                  style={{ padding: "10px 20px", background: GREEN, color: "#fff", border: "none", borderRadius: 6, fontFamily: "monospace", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
                  {loading ? "Sending..." : "Send Invite"}
                </button>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", marginTop: 8 }}>
                An email with a join link will open in your email client.
              </div>
            </div>
          </div>
        )}

        {/* Pending Invites */}
        {invites.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #C8C0A0", overflow: "hidden" }}>
            <div style={{ background: "#C47A00", padding: "12px 16px", fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#fff" }}>
              ⏳ Pending Invites ({invites.length})
            </div>
            {invites.map((inv, i) => (
              <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < invites.length - 1 ? "1px solid #f0f0f0" : "none", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: NAVY }}>{inv.email}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "#8888CC", marginTop: 2 }}>
                    Role: {inv.role} · Expires: {new Date(inv.expires_at).toLocaleDateString("en-AU")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => copyInviteLink(inv.token)}
                    style={{ padding: "5px 12px", border: "1px solid " + NAVY, background: "transparent", color: NAVY, borderRadius: 6, fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
                    Copy Link
                  </button>
                  <button onClick={() => removeInvite(inv.id)}
                    style={{ padding: "5px 12px", border: "1px solid " + RED, background: "transparent", color: RED, borderRadius: 6, fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Role Legend */}
        <div style={{ marginTop: 16, background: "#fff", borderRadius: 10, border: "1px solid #C8C0A0", padding: "14px 16px" }}>
          <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: NAVY, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Role Permissions</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                {["Permission", "Owner", "Admin", "Staff"].map(h => <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#666" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                ["Create documents", "✅", "✅", "✅"],
                ["Delete any document", "✅", "✅", "❌"],
                ["Manage clients", "✅", "✅", "✅"],
                ["Invite staff", "✅", "✅", "❌"],
                ["Billing & upgrade", "✅", "❌", "❌"],
              ].map(([perm, ...vals]) => (
                <tr key={perm} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 10px", color: "#444" }}>{perm}</td>
                  {vals.map((v, i) => <td key={i} style={{ padding: "6px 10px", textAlign: "left" }}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
