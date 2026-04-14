import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const ADMIN_EMAILS = ["sudhir@bluesquaresolutions.com.au", "sudhir1104@gmail.com"];
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
  if (!user || !ADMIN_EMAILS.includes(user.email)) {
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
      // Load all tenants including founding member data
      const { data: tenants, error } = await supabase
        .from("tenants")
        .select("*, profiles(*), counters(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Load document counts per tenant
      const { data: docs } = await supabase.from("documents").select("tenant_id");
      const docCounts = {};
      (docs || []).forEach(d => { docCounts[d.tenant_id] = (docCounts[d.tenant_id] || 0) + 1; });

      const merged = (tenants || []).map(t => ({
        tenant_id: t.id,
        company_name: t.profiles?.company_name || t.name || "",
        abn: t.profiles?.abn || t.abn || "",
        phone: t.profiles?.phone || t.phone || "",
        email: t.email || "",
        plan: t.plan || "trial",
        doc_limit: t.doc_limit || 10,
        is_active: t.is_active !== false,
        is_founding_member: t.is_founding_member || false,
        founding_member_number: t.founding_member_number || null,
        founding_locked_price: t.founding_locked_price || null,
        docCount: docCounts[t.id] || 0,
        invoiceCount: t.counters?.invoice_count || 0,
        quoteCount: t.counters?.quote_count || 0,
        joinedAt: t.created_at || "",
        stripe_customer_id: t.stripe_customer_id || "",
      }));

      setUsers(merged);
    } catch (e) {
      console.error("Load users error:", e);
      showToast("Failed to load users: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const changePlan = async (tenantId, newPlan) => {
    setToggling(tenantId);
    const limits = { trial: 10, starter: 50, growth: 200, pro: 999999 };
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ plan: newPlan, doc_limit: limits[newPlan] || 10 })
        .eq("id", tenantId);
      if (error) throw error;
      setUsers(u => u.map(p => p.tenant_id === tenantId ? { ...p, plan: newPlan, doc_limit: limits[newPlan] || 10 } : p));
      showToast("✓ Plan updated to " + newPlan);
    } catch (e) {
      console.error("Plan change error:", e);
      showToast("Failed to update — " + e.message);
    } finally {
      setToggling(null);
    }
  };

  const [selectedTenant, setSelectedTenant] = useState(null);
  const [tenantDocs, setTenantDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const viewTenantDocs = async (tenantId, name) => {
    setLoadingDocs(true);
    setSelectedTenant({ id: tenantId, name });
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setTenantDocs(data || []);
    setLoadingDocs(false);
  };

  const deleteDocument = async (docId, docNum) => {
    if (!window.confirm("Delete " + docNum + "? This cannot be undone.")) return;
    await supabase.from("documents").delete().eq("id", docId);
    setTenantDocs(prev => prev.filter(d => d.id !== docId));
    setUsers(u => u.map(t => t.tenant_id === selectedTenant.id ? { ...t, docCount: t.docCount - 1 } : t));
    showToast("✓ Deleted " + docNum);
  };

  const toggleFounding = async (tenantId, currentValue) => {
    setToggling(tenantId);
    try {
      if (currentValue) {
        // Remove founding status
        const { error } = await supabase.from("tenants")
          .update({ is_founding_member: false, founding_member_number: null, founding_locked_price: null })
          .eq("id", tenantId);
        if (error) throw error;
        setUsers(u => u.map(p => p.tenant_id === tenantId ? { ...p, is_founding_member: false, founding_member_number: null } : p));
        showToast("✓ Founding member status removed");
      } else {
        // Get next founding number
        const { data: nextNum } = await supabase.rpc("get_next_founding_number");
        if (nextNum > 50) { showToast("❌ All 50 founding spots are taken!"); setToggling(null); return; }
        const { error } = await supabase.from("tenants")
          .update({ is_founding_member: true, founding_member_number: nextNum, founding_locked_price: 2.99, plan: "starter" })
          .eq("id", tenantId);
        if (error) throw error;
        setUsers(u => u.map(p => p.tenant_id === tenantId ? { ...p, is_founding_member: true, founding_member_number: nextNum, founding_locked_price: 2.99 } : p));
        showToast("🏆 Founding member #" + nextNum + " assigned!");
      }
    } catch (e) {
      showToast("Failed: " + e.message);
    } finally { setToggling(null); }
  };

  const deleteTenant = async (tenantId, name) => {
    if (!window.confirm("Delete tenant \"" + name + "\"?\n\nThis will remove ALL their data. This cannot be undone.")) return;
    setToggling(tenantId);
    try {
      await supabase.from("documents").delete().eq("tenant_id", tenantId);
      await supabase.from("clients").delete().eq("tenant_id", tenantId);
      await supabase.from("profiles").delete().eq("tenant_id", tenantId);
      await supabase.from("counters").delete().eq("tenant_id", tenantId);
      await supabase.from("tenant_members").delete().eq("tenant_id", tenantId);
      await supabase.from("tenant_invites").delete().eq("tenant_id", tenantId);
      await supabase.from("user_settings").update({ tenant_id: null }).eq("tenant_id", tenantId);
      await supabase.from("tenants").delete().eq("id", tenantId);
      setUsers(u => u.filter(p => p.tenant_id !== tenantId));
      showToast("✓ Tenant " + name + " deleted");
    } catch (e) {
      console.error("Delete tenant error:", e);
      showToast("Failed to delete — " + e.message);
    } finally {
      setToggling(null);
    }
  };

  const filtered = users.filter(u =>
    !search ||
    (u.company_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (u.tenant_id || "").toLowerCase().includes(search.toLowerCase())
  );

  const premiumCount = users.filter(u => u.plan !== "trial").length;
  const trialCount = users.filter(u => u.plan === "trial").length;
  const deletedCount = 0;

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
        <div className="admin-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            ["Total Tenants", users.length, NAVY],
            ["🏆 Founding", users.filter(u => u.is_founding_member).length + " / 50", "#C47A00"],
            ["Paid Plans", premiumCount, GREEN],
            ["Trial", trialCount, "#999"],
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
            <div className="admin-table-header" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", background: NAVY, padding: "10px 16px", gap: 8 }}>
              {["Email / Company", "Documents", "Plan", "Founding", "Active", "Actions"].map(h => (
                <div key={h} style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "#8888CC", padding: 32 }}>No users found.</div>
            ) : (
              filtered.map((u, i) => (
                <div key={u.tenant_id} className="admin-user-row" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", padding: "12px 16px", gap: 8, alignItems: "center", borderBottom: i < filtered.length - 1 ? "1px solid #f0f0f0" : "none", background: u.is_founding_member ? "#FFFBEB" : i % 2 === 0 ? "#fff" : "#FAFAF8" }}>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: NAVY }}>{u.company_name || "—"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#888", marginTop: 2 }}>{u.email}</div>
                    {u.phone && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>{u.phone}</div>}
                    {u.joinedAt && <div style={{ fontFamily: "monospace", fontSize: 9, color: "#ccc", marginTop: 2 }}>Joined: {new Date(u.joinedAt).toLocaleDateString("en-AU")}</div>}
                  </div>
                  <div className="admin-col-docs">
                    <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: u.docCount >= u.doc_limit ? RED : u.docCount >= u.doc_limit * 0.8 ? "#C47A00" : NAVY }}>{u.docCount}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}> / {u.doc_limit >= 999999 ? "∞" : u.doc_limit}</span>
                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#bbb", marginTop: 1 }}>{u.invoiceCount} inv · {u.quoteCount} qt</div>
                  </div>
                  <div className="admin-col-status">
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontFamily: "monospace", fontSize: 10, fontWeight: 700,
                      background: u.plan === "pro" ? "#F5F3FF" : u.plan === "growth" ? "#D1FAE5" : u.plan === "starter" ? "#EFF6FF" : "#FEF3C7",
                      color: u.plan === "pro" ? "#6D28D9" : u.plan === "growth" ? "#065F46" : u.plan === "starter" ? "#1D4ED8" : "#92400E",
                      border: "1px solid " + (u.plan === "pro" ? "#DDD6FE" : u.plan === "growth" ? "#6EE7B7" : u.plan === "starter" ? "#BFDBFE" : "#FDE68A") }}>
                      {(u.plan || "trial").toUpperCase()}
                    </span>
                  </div>
                  <div className="admin-col-deleted">
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: u.is_active ? GREEN : RED }}>{u.is_active ? "Active" : "Inactive"}</span>
                  </div>
                  <div className="admin-col-actions" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <select value={u.plan} onChange={e => changePlan(u.tenant_id, e.target.value)} disabled={toggling === u.tenant_id}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #C8C0A0", fontFamily: "monospace", fontSize: 11, cursor: "pointer", opacity: toggling === u.tenant_id ? 0.6 : 1 }}>
                      <option value="trial">Trial</option>
                      <option value="starter">Starter</option>
                      <option value="growth">Growth</option>
                      <option value="pro">Pro</option>
                    </select>
                    <button onClick={() => toggleFounding(u.tenant_id, u.is_founding_member)}
                      disabled={toggling === u.tenant_id || (!u.is_founding_member && users.filter(x => x.is_founding_member).length >= 50)}
                      title={!u.is_founding_member && users.filter(x => x.is_founding_member).length >= 50 ? "All 50 founding spots taken" : ""}
                      style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #F59E0B", background: u.is_founding_member ? "#FEF3C7" : "transparent", color: "#92400E", fontFamily: "monospace", fontSize: 10, fontWeight: 700, cursor: "pointer", opacity: toggling === u.tenant_id ? 0.6 : 1 }}>
                      {u.is_founding_member ? "✗ Remove" : "🏆 Grant"}
                    </button>
                    <button onClick={() => viewTenantDocs(u.tenant_id, u.company_name || u.email)}
                      style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid " + NAVY, background: "transparent", color: NAVY, fontFamily: "monospace", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                      📄 Docs
                    </button>
                    <button onClick={() => deleteTenant(u.tenant_id, u.company_name || u.email)} disabled={toggling === u.tenant_id}
                      style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid " + RED, background: "transparent", color: RED, fontFamily: "monospace", fontSize: 10, fontWeight: 700, cursor: "pointer", opacity: toggling === u.tenant_id ? 0.6 : 1 }}>
                      🗑 Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Legend */}
        <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 10, color: "#888", textAlign: "center" }}>
          Plan changes take effect immediately · 🏆 Founding members: $2.99/mo locked forever (max 50) · Document deletion is a paid service
        </div>

        {/* Document Management Modal */}
        {selectedTenant && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 700, width: "100%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: NAVY }}>Documents — {selectedTenant.name}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", marginTop: 2 }}>Admin deletion service — charge fee before deleting</div>
                </div>
                <button onClick={() => setSelectedTenant(null)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", fontFamily: "monospace", fontSize: 12, cursor: "pointer" }}>Close</button>
              </div>
              {loadingDocs ? (
                <div style={{ textAlign: "center", fontFamily: "monospace", color: "#8888CC", padding: 24 }}>Loading documents...</div>
              ) : tenantDocs.length === 0 ? (
                <div style={{ textAlign: "center", fontFamily: "monospace", color: "#8888CC", padding: 24 }}>No documents found.</div>
              ) : (
                tenantDocs.map((doc, i) => {
                  const docNum = (doc.prefix || (doc.doc_type === "quote" ? "QT" : "INV")) + "-" + (doc.number || "---");
                  return (
                    <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f0f0f0", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: doc.doc_type === "quote" ? GREEN : NAVY }}>{docNum}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>
                          {doc.date} · {(doc.to_address || "").split("\n")[0] || "No client"} · ${doc.grand_total || "0.00"}
                          <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 4, background: doc.pay_status === "paid" ? "#D1FAE5" : doc.pay_status === "overdue" ? "#FEE2E2" : "#FEF3C7", color: doc.pay_status === "paid" ? "#065F46" : doc.pay_status === "overdue" ? "#991B1B" : "#92400E", fontWeight: 700 }}>{doc.pay_status}</span>
                        </div>
                      </div>
                      <button onClick={() => deleteDocument(doc.id, docNum)}
                        style={{ padding: "5px 12px", border: "1px solid " + RED, background: "transparent", color: RED, borderRadius: 6, fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        🗑 Delete
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
