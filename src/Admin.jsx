import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const ADMIN_EMAIL = "sudhir@bluesquaresolutions.com.au";
const NAVY = "#2D2D7A";
const GREEN = "#2E7D52";
const RED = "#C0392B";
const GOLD = "#B8A870";

export default function Admin({ user, onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [toggling, setToggling] = useState(null);

  // Block non-admin access
  if (!user || user.email !== ADMIN_EMAIL) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 14, color: RED }}>Access denied.</div>
      </div>
    );
  }

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2800); };

  const loadUsers = async () => {
    setLoading(true);
    try {
      // user_settings is the source of truth — every user has a row here
      const { data: settings, error } = await supabase
        .from("user_settings")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Load document counts per user
      const { data: docs } = await supabase
        .from("documents")
        .select("user_id");

      // Load all profiles for company details
      const { data: profiles } = await supabase
        .from("profiles")
        .select("*");

      // Load counters
      const { data: counters } = await supabase
        .from("counters")
        .select("user_id, invoice_count, quote_count");

      // Build lookup maps
      const docCounts = {};
      (docs || []).forEach(d => {
        docCounts[d.user_id] = (docCounts[d.user_id] || 0) + 1;
      });
      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
      const counterMap = {};
      (counters || []).forEach(c => { counterMap[c.user_id] = c; });

      // Build user list from user_settings (all users)
      const merged = (settings || []).map(s => {
        const profile = profileMap[s.user_id] || {};
        const counter = counterMap[s.user_id] || {};
        return {
          user_id: s.user_id,
          company_name: profile.company_name || "",
          abn: profile.abn || "",
          phone: profile.phone || "",
          email: s.email || profile.email || "",
          is_premium: s.is_premium || false,
          deleted: profile.deleted || false,
          deleted_at: profile.deleted_at || null,
          docCount: docCounts[s.user_id] || 0,
          invoiceCount: counter.invoice_count || 0,
          quoteCount: counter.quote_count || 0,
          joinedAt: s.created_at || "",
        };
      });

      setUsers(merged);
    } catch (e) {
      console.error("Load users error:", e);
      showToast("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const togglePremium = async (userId, currentValue) => {
    setToggling(userId);
    try {
      // Check if user_settings row exists
      const { data: existing } = await supabase
        .from("user_settings")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("user_settings")
          .update({ is_premium: !currentValue })
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_settings")
          .insert({ user_id: userId, is_premium: !currentValue });
        if (error) throw error;
      }
      setUsers(u => u.map(p => p.user_id === userId ? { ...p, is_premium: !currentValue } : p));
      showToast(!currentValue ? "✓ Upgraded to Premium" : "↓ Downgraded to Trial");
    } catch (e) {
      console.error("Toggle error:", e);
      showToast("Failed to update — " + e.message);
    } finally {
      setToggling(null);
    }
  };

  const deleteUser = async (userId, email) => {
    if (!window.confirm("Permanently delete " + email + "?\n\nThis will remove ALL their data including invoices, clients and their account. This cannot be undone.")) return;
    setToggling(userId);
    try {
      const { error } = await supabase.rpc("delete_user_completely", { target_user_id: userId });
      if (error) throw error;
      setUsers(u => u.filter(p => p.user_id !== userId));
      showToast("✓ User " + email + " deleted");
    } catch (e) {
      console.error("Delete user error:", e);
      showToast("Failed to delete user — " + e.message);
    } finally {
      setToggling(null);
    }
  };

  const filtered = users.filter(u =>
    !search ||
    (u.company_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.user_id || "").toLowerCase().includes(search.toLowerCase())
  );

  const premiumCount = users.filter(u => u.is_premium).length;
  const trialCount = users.filter(u => !u.is_premium && !u.deleted).length;
  const deletedCount = users.filter(u => u.deleted).length;

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4D0", fontFamily: "Lato, sans-serif", padding: "0 0 60px" }}>
      <style>{`
        * { box-sizing: border-box; }
        @media (max-width: 600px) {
          .admin-table-header { display: none !important; }
          .admin-user-row { display: block !important; padding: 14px !important; border-bottom: 2px solid #f0f0f0 !important; }
          .admin-user-row > div { display: block !important; width: 100% !important; margin-bottom: 6px !important; }
          .admin-col-deleted { display: none !important; }
          .admin-col-actions { display: flex !important; gap: 8px !important; margin-top: 8px !important; }
          .admin-col-actions button { flex: 1 !important; }
          .admin-stats { gap: 8px !important; }
          .admin-stats > div { padding: 10px !important; }
          .admin-search-row { flex-direction: column !important; gap: 8px !important; }
          .admin-search-row input { width: 100% !important; }
          .admin-search-row button { width: 100% !important; }
          .admin-header { padding: 12px 14px !important; flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .admin-header button { width: 100% !important; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: NAVY, color: "#fff", fontFamily: "monospace", fontSize: 13, padding: "10px 20px", borderRadius: 8, zIndex: 9999, pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="admin-header" style={{ background: NAVY, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: "#fff", letterSpacing: 1 }}>Admin Panel</div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", marginTop: 2 }}>Blue Square Invoice — User Management</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC" }}>{user.email}</span>
          <button onClick={onBack} style={{ padding: "7px 16px", borderRadius: 6, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
            ← Back to App
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px" }}>

        {/* Stats */}
        <div className="admin-stats" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            ["Total Users", users.length, NAVY],
            ["Premium", premiumCount, GREEN],
            ["Trial", trialCount, "#C47A00"],
          ].map(([label, count, color]) => (
            <div key={label} style={{ background: "#fff", borderRadius: 10, padding: "16px 20px", border: `2px solid ${color}`, textAlign: "center" }}>
              <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color }}>{count}</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", marginTop: 2, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Search + Refresh */}
        <div className="admin-search-row" style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email or company name..."
            style={{ flex: 1, padding: "9px 14px", border: "1.5px solid #C8C0A0", borderRadius: 8, fontFamily: "monospace", fontSize: 12, outline: "none", background: "#fff" }}
          />
          <button onClick={loadUsers} style={{ padding: "9px 16px", borderRadius: 8, background: NAVY, color: "#fff", border: "none", fontFamily: "monospace", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            ↻ Refresh
          </button>
        </div>

        {/* Users Table */}
        {loading ? (
          <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 13, color: "#8888CC", padding: 40 }}>Loading users...</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #C8C0A0", overflow: "hidden" }}>
            {/* Table header */}
            <div className="admin-table-header" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", background: NAVY, padding: "10px 16px", gap: 8 }}>
              {["Email / Company", "Documents", "Status", "Deleted", "Action"].map(h => (
                <div key={h} style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "#8888CC", padding: 32 }}>No users found.</div>
            ) : (
              filtered.map((u, i) => (
                <div key={u.user_id} className="admin-user-row" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: "12px 16px", gap: 8, alignItems: "center", borderBottom: i < filtered.length - 1 ? "1px solid #f0f0f0" : "none", background: i % 2 === 0 ? "#fff" : "#FAFAF8" }}>
                  {/* Company / User */}
                  <div>
                    {u.email
                      ? <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: NAVY }}>{u.email}</div>
                      : <div style={{ fontFamily: "monospace", fontSize: 11, color: "#bbb", fontStyle: "italic" }}>No email yet</div>
                    }
                    {u.company_name && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#888", marginTop: 2 }}>{u.company_name}</div>}
                    {u.phone && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>{u.phone}</div>}
                    {u.joinedAt && <div style={{ fontFamily: "monospace", fontSize: 9, color: "#ccc", marginTop: 2 }}>Joined: {new Date(u.joinedAt).toLocaleDateString("en-AU")}</div>}
                  </div>

                  {/* Doc count */}
                  <div className="admin-col-docs">
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: u.docCount >= 10 ? RED : u.docCount >= 8 ? "#C47A00" : NAVY }}>
                      {u.docCount}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}> / 10</span>
                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#bbb", marginTop: 1 }}>
                      {u.invoiceCount} inv · {u.quoteCount} qt
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="admin-col-status">
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontFamily: "monospace", fontSize: 10, fontWeight: 700, background: u.is_premium ? "#D1FAE5" : "#FEF3C7", color: u.is_premium ? "#065F46" : "#92400E", border: `1px solid ${u.is_premium ? "#10B981" : "#F59E0B"}` }}>
                      {u.is_premium ? "PREMIUM" : "TRIAL"}
                    </span>
                  </div>

                  {/* Deleted */}
                  <div className="admin-col-deleted">
                    {u.deleted ? (
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: RED }}>
                        Deleted
                      </span>
                    ) : (
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: GREEN }}>Active</span>
                    )}
                  </div>

                  {/* Toggle + Delete buttons */}
                  <div className="admin-col-actions" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button
                      onClick={() => togglePremium(u.user_id, u.is_premium)}
                      disabled={toggling === u.user_id || u.deleted}
                      style={{
                        padding: "6px 12px", borderRadius: 6, border: "none", cursor: u.deleted ? "not-allowed" : "pointer",
                        background: u.is_premium ? "#FEE2E2" : "#D1FAE5",
                        color: u.is_premium ? RED : GREEN,
                        fontFamily: "monospace", fontSize: 11, fontWeight: 700,
                        opacity: toggling === u.user_id ? 0.6 : 1, whiteSpace: "nowrap"
                      }}>
                      {toggling === u.user_id ? "..." : u.is_premium ? "↓ To Trial" : "↑ To Premium"}
                    </button>
                    <button
                      onClick={() => deleteUser(u.user_id, u.email || u.user_id)}
                      disabled={toggling === u.user_id}
                      style={{
                        padding: "5px 12px", borderRadius: 6, border: "1px solid " + RED,
                        background: "transparent", color: RED,
                        fontFamily: "monospace", fontSize: 10, fontWeight: 700,
                        cursor: "pointer", opacity: toggling === u.user_id ? 0.6 : 1,
                        whiteSpace: "nowrap"
                      }}>
                      🗑 Delete User
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Legend */}
        <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 10, color: "#888", textAlign: "center" }}>
          Doc count turns yellow at 8+, red at 10 (limit reached) &nbsp;·&nbsp; Deleted accounts are shown but cannot be upgraded
        </div>
      </div>
    </div>
  );
}
