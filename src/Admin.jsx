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
      // Load all profiles
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Load document counts per user
      const { data: docs } = await supabase
        .from("documents")
        .select("user_id");

      // Count docs per user
      const docCounts = {};
      (docs || []).forEach(d => {
        docCounts[d.user_id] = (docCounts[d.user_id] || 0) + 1;
      });

      // Merge
      const merged = (profiles || []).map(p => ({
        ...p,
        docCount: docCounts[p.user_id] || 0,
      }));

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
      const { error } = await supabase
        .from("profiles")
        .update({ is_premium: !currentValue })
        .eq("user_id", userId);
      if (error) throw error;
      setUsers(u => u.map(p => p.user_id === userId ? { ...p, is_premium: !currentValue } : p));
      showToast(!currentValue ? "✓ Upgraded to Premium" : "Downgraded to Trial");
    } catch (e) {
      console.error("Toggle error:", e);
      showToast("Failed to update user");
    } finally {
      setToggling(null);
    }
  };

  const filtered = users.filter(u =>
    !search ||
    (u.company_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.user_id || "").toLowerCase().includes(search.toLowerCase())
  );

  const premiumCount = users.filter(u => u.is_premium).length;
  const trialCount = users.filter(u => !u.is_premium && !u.deleted).length;
  const deletedCount = users.filter(u => u.deleted).length;

  return (
    <div style={{ minHeight: "100vh", background: "#E8E4D0", fontFamily: "Lato, sans-serif", padding: "0 0 60px" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: NAVY, color: "#fff", fontFamily: "monospace", fontSize: 13, padding: "10px 20px", borderRadius: 8, zIndex: 9999, pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ background: NAVY, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
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
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by company name or user ID..."
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
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", background: NAVY, padding: "10px 16px", gap: 8 }}>
              {["Company / User", "Documents", "Status", "Deleted", "Action"].map(h => (
                <div key={h} style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "#8888CC", padding: 32 }}>No users found.</div>
            ) : (
              filtered.map((u, i) => (
                <div key={u.user_id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: "12px 16px", gap: 8, alignItems: "center", borderBottom: i < filtered.length - 1 ? "1px solid #f0f0f0" : "none", background: i % 2 === 0 ? "#fff" : "#FAFAF8" }}>
                  {/* Company / User ID */}
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: NAVY }}>{u.company_name || "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#aaa", marginTop: 2 }}>{u.user_id?.slice(0, 18)}...</div>
                    {u.phone && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{u.phone}</div>}
                  </div>

                  {/* Doc count */}
                  <div>
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: u.docCount >= 10 ? RED : u.docCount >= 8 ? "#C47A00" : NAVY }}>
                      {u.docCount}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}> / 10</span>
                  </div>

                  {/* Status badge */}
                  <div>
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontFamily: "monospace", fontSize: 10, fontWeight: 700, background: u.is_premium ? "#D1FAE5" : "#FEF3C7", color: u.is_premium ? "#065F46" : "#92400E", border: `1px solid ${u.is_premium ? "#10B981" : "#F59E0B"}` }}>
                      {u.is_premium ? "PREMIUM" : "TRIAL"}
                    </span>
                  </div>

                  {/* Deleted */}
                  <div>
                    {u.deleted ? (
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: RED }}>
                        Deleted
                      </span>
                    ) : (
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: GREEN }}>Active</span>
                    )}
                  </div>

                  {/* Toggle button */}
                  <div>
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
