import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { useTenant } from "./TenantContext";

const GST_RATE = 0.10;
const PROFILE_KEY = "invoice_app_profile";
const TC_KEY = "invoice_app_tc";
const ADMIN_EMAILS = ["sudhir@bluesquaresolutions.com.au", "sudhir1104@gmail.com"];

const DEFAULT_TC = `1. PAYMENT TERMS
1.1 Payment is due within 30 days of the invoice date unless otherwise agreed in writing.
1.2 Invoices unpaid after the due date may attract interest at the rate of 1.5% per month on the outstanding balance.
1.3 The Seller reserves the right to suspend or cancel supply of goods or services if payment is not received by the due date.
1.4 Payments must be made in Australian Dollars (AUD) unless otherwise agreed in writing.

2. GOODS AND SERVICES
2.1 All goods remain the property of the Seller until full payment has been received.
2.2 Risk in the goods passes to the Buyer upon delivery.
2.3 The Seller reserves the right to charge for any additional work performed outside the original scope of works.
2.4 Quoted prices are valid for 30 days from the date of the quote unless otherwise stated.

3. GST
3.1 All prices are inclusive of Goods and Services Tax (GST) at the current rate of 10% unless otherwise stated.
3.2 This invoice constitutes a Tax Invoice for GST purposes in accordance with the A New Tax System (Goods and Services Tax) Act 1999.
3.3 The Seller is registered for GST purposes with the Australian Business Register.

4. RETURNS AND DISPUTES
4.1 Any claims regarding defective goods or services must be made in writing within 7 days of delivery or completion.
4.2 Goods may only be returned with prior written approval from the Seller. Return freight costs are the responsibility of the Buyer.
4.3 No credit will be issued for goods that have been used, damaged, or are not in their original condition.
4.4 Disputed invoices must be notified in writing within 7 days of the invoice date. Undisputed portions remain due and payable.

5. LIMITATION OF LIABILITY
5.1 To the maximum extent permitted by law, the Seller liability is limited to the value of the invoice.
5.2 The Seller is not liable for any indirect, consequential, special or incidental loss or damage.
5.3 Nothing in these terms excludes or limits any rights you may have under the Australian Consumer Law.

6. PRIVACY
6.1 Personal information collected is used solely for providing goods and services and managing accounts.
6.2 The Seller will not disclose personal information to third parties except as required by law.

7. GOVERNING LAW
7.1 These terms and conditions are governed by the laws of the State of New South Wales, Australia.
7.2 Any disputes shall be subject to the exclusive jurisdiction of the courts of New South Wales.`;

function loadTC() { try { return localStorage.getItem(TC_KEY) || DEFAULT_TC; } catch { return DEFAULT_TC; } }
function saveTC(text) { try { localStorage.setItem(TC_KEY, text); } catch {} }
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { return {}; } }
function saveProfile(data) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch {} }

// ══════════════════════════════════════════════
// SUPABASE DATA LAYER — all queries use tenant_id
// ══════════════════════════════════════════════

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id;
}

// Plan/premium check from tenants table (source of truth)
async function dbGetTenantPlan(tenantId) {
  if (!tenantId) return { plan: "free", docLimit: 10 };
  const { data } = await supabase
    .from("tenants")
    .select("plan, doc_limit, is_active, trial_ends_at, monthly_doc_count, monthly_reset_date")
    .eq("id", tenantId)
    .maybeSingle();
  return {
    plan: data?.plan || "free",
    docLimit: data?.doc_limit ?? 10,
    isActive: data?.is_active ?? true,
    trialEndsAt: data?.trial_ends_at || null,
    monthlyDocCount: data?.monthly_doc_count ?? 0,
    monthlyResetDate: data?.monthly_reset_date || null,
  };
}

// Load documents filtered by tenant_id
async function dbLoadDocuments(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) { console.error("Load documents error:", error); return []; }
  return (data || []).map(dbRowToDoc);
}

// Save/update document — always writes tenant_id and created_by
async function dbSaveDocument(doc, payStatus, docId, tenantId, discountPct = 0) {
  const userId = await getUserId();
  if (!userId || !tenantId) return null;
  const t = calcTotals(doc.rows || [], discountPct);
  const row = {
    tenant_id: tenantId,
    created_by: userId,
    doc_type: doc.docType || "invoice",
    date: doc.date || null,
    order_ref: doc.order || "",
    from_address: doc.from || "",
    to_address: doc.to || "",
    abn_supplier: doc.abnS || "",
    abn_recipient: doc.abnR || "",
    gst_no: doc.gstNo || "",
    rows: doc.rows || [],
    pay_status: payStatus || "unpaid",
    converted: doc.convertedToInvoice || false,
    subtotal: parseFloat(t.subtotal) || 0,
    gst_total: parseFloat(t.gstTotal) || 0,
    grand_total: parseFloat(t.grandTotal) || 0,
    client_email: doc.clientEmail || "",
    client_mobile: doc.clientMobile || "",
  };
  if (docId) {
    const { data, error } = await supabase
      .from("documents")
      .update(row)
      .eq("id", docId)
      .eq("tenant_id", tenantId)
      .select()
      .single();
    if (error) { console.error("Update error:", error); return null; }
    return data;
  } else {
    const { number, prefix } = await dbGetNextNumber(doc.docType || "invoice", tenantId);
    const { data, error } = await supabase
      .from("documents")
      .insert({ ...row, number, prefix })
      .select()
      .single();
    if (error) { console.error("Insert error:", error); return null; }
    return data;
  }
}

async function dbDeleteDocument(id, tenantId) {
  if (!tenantId) return;
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) console.error("Delete error:", error);
}

// Counter is per-tenant (one row per tenant in counters table)
async function dbGetNextNumber(type, tenantId) {
  const prefix = type === "quote" ? "QT" : "INV";
  const col = type === "quote" ? "quote_count" : "invoice_count";
  const { data, error } = await supabase
    .from("counters")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) {
    await supabase.from("counters").insert({
      tenant_id: tenantId,
      invoice_count: type === "invoice" ? 1 : 0,
      quote_count: type === "quote" ? 1 : 0,
    });
    return { number: "000001", prefix };
  }
  const next = (data[col] || 0) + 1;
  await supabase.from("counters").update({ [col]: next }).eq("tenant_id", tenantId);
  return { number: String(next).padStart(6, "0"), prefix };
}

// Load clients filtered by tenant_id
async function dbLoadClients(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) { console.error("Load clients error:", error); return []; }
  return data || [];
}

// Save client — uses tenant_id + created_by
async function dbSaveClient(toAddress, abnValue, tenantId, emailValue, mobileValue) {
  if (!toAddress || toAddress.trim().length < 2 || !tenantId) return;
  const name = toAddress.split("\n")[0].trim();
  if (!name) return;
  const userId = await getUserId();
  if (!userId) return;
  const entry = { tenant_id: tenantId, created_by: userId, name, address: toAddress, abn: abnValue || "", email: emailValue || "", phone: mobileValue || "" };
  try {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", name)
      .maybeSingle();
    if (existing) {
      await supabase.from("clients").update(entry).eq("id", existing.id);
    } else {
      await supabase.from("clients").insert(entry);
    }
  } catch (e) {
    console.error("dbSaveClient exception:", e);
  }
}

// Profile is per-tenant (one row per tenant in profiles table)
async function dbLoadProfile(tenantId) {
  if (!tenantId) return loadProfile();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const local = loadProfile();
  if (!data) return { ...local };
  const profile = {
    coName: data.company_name || "",
    coAbn: data.abn || "",
    coAddr: data.address || "",
    coPhone: data.phone || "",
  };
  const fromParts = [profile.coName, profile.coAbn ? "ABN: " + profile.coAbn : "", profile.coAddr, profile.coPhone].filter(Boolean);
  profile.from = fromParts.join("\n");
  profile.abnS = profile.coAbn;
  if (local.logo) profile.logo = local.logo;
  return profile;
}

async function dbSaveProfile(profileData, tenantId) {
  if (!tenantId) return;
  saveProfile(profileData);
  const updateRow = {
    company_name: profileData.coName || "",
    abn: profileData.coAbn || "",
    address: profileData.coAddr || "",
    phone: profileData.coPhone || "",
  };
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing) {
    await supabase.from("profiles").update(updateRow).eq("tenant_id", tenantId);
  } else {
    await supabase.from("profiles").insert({ tenant_id: tenantId, ...updateRow });
  }
}

function dbRowToDoc(row) {
  return {
    id: row.id,
    docType: row.doc_type || "invoice",
    date: row.date || "",
    order: row.order_ref || "",
    from: row.from_address || "",
    to: row.to_address || "",
    abnS: row.abn_supplier || "",
    abnR: row.abn_recipient || "",
    gstNo: row.gst_no || "",
    clientEmail: row.client_email || "",
    clientMobile: row.client_mobile || "",
    coName: "", coAbn: "", coAddr: "", coPhone: "",
    rows: row.rows || [],
    payStatus: row.pay_status || "unpaid",
    convertedToInvoice: row.converted || false,
    number: row.number || "",
    prefix: row.prefix || "",
    grandTotal: row.grand_total ? String(row.grand_total) : "0.00",
    createdAt: row.created_at || "",
  };
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

const emptyRow = () => ({ id: Math.random().toString(36).slice(2), qty: "", desc: "", each: "", gst: "", total: "", gstApplied: true });
const emptyDoc = (type = "invoice") => ({
  docType: type, date: new Date().toISOString().split("T")[0],
  order: "", from: "", to: "", abnS: "", abnR: "", gstNo: "",
  clientEmail: "", clientMobile: "",
  coName: "", coAbn: "", coAddr: "", coPhone: "",
  rows: Array.from({ length: 1 }, emptyRow), payStatus: "unpaid",
});

function calcRow(row) {
  const qty = parseFloat(row.qty) || 0; const each = parseFloat(row.each) || 0; const sub = qty * each;
  if (sub <= 0) return { ...row, gst: "", total: "" };
  const applyGst = row.gstApplied !== false; // default true
  const gst = applyGst ? Math.round(sub * GST_RATE * 100) / 100 : 0;
  const total = Math.round((sub + gst) * 100) / 100;
  return { ...row, gst: applyGst ? gst.toFixed(2) : "0.00", total: total.toFixed(2) };
}

function calcTotals(rows, discountPct = 0) {
  let sub = 0; let gstTotal = 0;
  rows.forEach(r => {
    const qty = parseFloat(r.qty) || 0; const each = parseFloat(r.each) || 0; const rowSub = qty * each;
    sub += rowSub;
    if (r.gstApplied !== false) gstTotal += Math.round(rowSub * GST_RATE * 100) / 100;
  });
  const discountAmt = discountPct > 0 ? Math.round(sub * (discountPct / 100) * 100) / 100 : 0;
  const discountedSub = sub - discountAmt;
  // Recalc GST on discounted amount
  let gstAfterDiscount = 0;
  rows.forEach(r => {
    const qty = parseFloat(r.qty) || 0; const each = parseFloat(r.each) || 0; const rowSub = qty * each;
    const rowFrac = sub > 0 ? rowSub / sub : 0;
    const rowDiscounted = rowSub - (discountAmt * rowFrac);
    if (r.gstApplied !== false) gstAfterDiscount += Math.round(rowDiscounted * GST_RATE * 100) / 100;
  });
  const grand = Math.round((discountedSub + gstAfterDiscount) * 100) / 100;
  return {
    subtotal: sub.toFixed(2),
    discountAmt: discountAmt.toFixed(2),
    discountedSub: discountedSub.toFixed(2),
    gstTotal: gstAfterDiscount.toFixed(2),
    grandTotal: grand.toFixed(2)
  };
}

// ══════════════════════════════════════════════
// COMPONENTS
// ══════════════════════════════════════════════

function AutoTextarea({ value, onChange, placeholder, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = ref.current.scrollHeight + "px"; }
  }, [value]);
  return <textarea ref={ref} value={value} onChange={onChange} placeholder={placeholder} style={{ ...style, overflow: "hidden", resize: "none", scrollbarWidth: "none", msOverflowStyle: "none" }} />;
}

// ClientSearch — "To" box with saved client search + free-form address textarea
function ClientSearch({ value, onChange, onBlurSave, ink, tenantId, onSelectClient, clientEmail, clientMobile, onEmailChange, onMobileChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showList, setShowList] = useState(false);
  const [allClients, setAllClients] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => { if (showList) dbLoadClients(tenantId).then(setAllClients); }, [showList, tenantId]);
  useEffect(() => {
    const handleClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowList(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("touchstart", handleClick); };
  }, []);

  const handleClientSearch = (e) => {
    const q = e.target.value; setQuery(q);
    setResults(q.length > 0
      ? allClients.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.address || "").toLowerCase().includes(q.toLowerCase()))
      : allClients);
    setShowList(true);
  };

  const selectClient = (client) => {
    onChange(client.address, client.abn);
    if (onSelectClient) onSelectClient(client);
    setShowList(false); setQuery("");
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>

      {/* ── Saved client search bar ── */}
      <div className="search-bar-row" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase" }}>To</span>
        <div style={{ flex: 1, display: "flex", gap: 4 }}>
          <input value={query} onChange={handleClientSearch} onFocus={() => setShowList(true)}
            placeholder="Search saved clients..."
            style={{ flex: 1, border: "1px solid #C8C8E8", borderRadius: 4, padding: "3px 8px", fontFamily: "monospace", fontSize: 11, color: ink, outline: "none", background: "rgba(255,255,255,0.7)" }} />
          {allClients.length > 0 && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#8888CC", alignSelf: "center", whiteSpace: "nowrap" }}>{allClients.length} saved</span>}
        </div>
      </div>

      {/* ── Saved client dropdown ── */}
      {showList && results.length > 0 && (
        <div style={{ position: "absolute", top: "28px", left: 0, right: 0, background: "#fff", border: "1px solid #C8C0A0", borderRadius: "0 0 8px 8px", boxShadow: "0 4px 16px rgba(0,0,0,0.15)", zIndex: 1000, maxHeight: 200, overflowY: "auto" }}>
          {results.map((client, i) => (
            <div key={i} onClick={() => selectClient(client)} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}
              onMouseEnter={e => e.currentTarget.style.background = "#F5F0FF"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
              <div style={{ fontFamily: "Lato, sans-serif", fontSize: 13, fontWeight: 700, color: ink }}>{client.name}</div>
              <div style={{ fontFamily: "Lato, sans-serif", fontSize: 12, color: "#8888CC", lineHeight: 1.5 }}>{(client.address || "").split("\n").slice(1).join("\n")}</div>
              {client.abn && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#8888CC" }}>ABN: {client.abn}</div>}
            </div>
          ))}
        </div>
      )}
      {showList && query.length > 0 && results.length === 0 && (
        <div style={{ position: "absolute", top: "28px", left: 0, right: 0, background: "#fff", border: "1px solid #C8C0A0", borderRadius: "0 0 8px 8px", padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: "#8888CC", zIndex: 1000 }}>No matches for "{query}"</div>
      )}

      {/* ── Free-form address textarea — matches From field exactly ── */}
      <AutoTextarea
        value={value}
        onChange={e => onChange(e.target.value, null)}
        onBlur={() => onBlurSave && onBlurSave()}
        placeholder={"Client name / business\nStreet address\nSuburb  STATE  Postcode"}
        style={{ border: "none", background: "transparent", fontFamily: "Lato, sans-serif", fontSize: 13, color: ink, width: "100%", minHeight: 64, outline: "none", resize: "none", lineHeight: 1.6, overflow: "hidden", scrollbarWidth: "none" }}
      />

      {/* ── Email (mandatory — * hidden on print) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        <span style={{ fontFamily: "Lato, sans-serif", fontSize: 13, color: ink, whiteSpace: "nowrap" }}>✉</span>
        <input
          type="email"
          value={clientEmail || ""}
          onChange={e => onEmailChange(e.target.value)}
          onBlur={() => onBlurSave && onBlurSave()}
          placeholder="Email *"
          style={{ border: "none", background: "transparent", fontFamily: "Lato, sans-serif", fontSize: 13, color: ink, width: "100%", outline: "none", lineHeight: 1.6 }}
        />
        <span className="mandatory-star no-print" style={{ color: "#C0392B", fontWeight: 700, fontSize: 13 }}>*</span>
      </div>

      {/* ── Mobile (mandatory — * hidden on print) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <span style={{ fontFamily: "Lato, sans-serif", fontSize: 13, color: ink, whiteSpace: "nowrap" }}>📱</span>
        <input
          type="tel"
          value={clientMobile || ""}
          onChange={e => onMobileChange(e.target.value)}
          onBlur={() => onBlurSave && onBlurSave()}
          placeholder="Mobile *"
          style={{ border: "none", background: "transparent", fontFamily: "Lato, sans-serif", fontSize: 13, color: ink, width: "100%", outline: "none", lineHeight: 1.6 }}
        />
        <span className="mandatory-star no-print" style={{ color: "#C0392B", fontWeight: 700, fontSize: 13 }}>*</span>
      </div>
    </div>
  );
}

function SigCanvas() {
  const canvasRef = useRef(null); const drawing = useRef(false); const last = useRef({ x: 0, y: 0 });
  const getPos = (e, canvas) => { const rect = canvas.getBoundingClientRect(); const src = e.touches ? e.touches[0] : e; return { x: src.clientX - rect.left, y: src.clientY - rect.top }; };
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = getPos(e, canvasRef.current); };
  const draw = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const canvas = canvasRef.current; const ctx = canvas.getContext("2d"); const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#2D2D7A"; ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.stroke(); last.current = pos;
  };
  const stop = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); };
  return (
    <div>
      <canvas ref={canvasRef} width={340} height={80} style={{ border: "1px dashed #9999CC", borderRadius: 4, background: "rgba(255,255,255,0.6)", cursor: "crosshair", display: "block", touchAction: "none", maxWidth: "100%" }}
        onMouseDown={start} onMouseMove={draw} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={draw} onTouchEnd={stop} />
      <div className="sig-clear-row" style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={clear} style={{ fontFamily: "monospace", fontSize: 11, color: "#C0392B", background: "none", border: "1px solid #C0392B", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Clear</button>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "#8888CC" }}>Sign with stylus or finger</span>
      </div>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#2D2D7A", color: "#fff", fontFamily: "monospace", fontSize: 13, padding: "10px 20px", borderRadius: 8, zIndex: 9999, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{msg}</div>;
}

// ══════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════

export default function App({ user, onShowAdmin, onShowTeam }) {
  // Pull tenant_id from TenantContext — this is the source of truth
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;

  const [doc, setDoc] = useState(emptyDoc("invoice"));
  const [docId, setDocId] = useState(null);
  const [mode, setModeState] = useState("invoice");
  const [payStatus, setPayStatusState] = useState("unpaid");
  const [saved, setSaved] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [logoSrc, setLogoSrc] = useState("");
  const [tcText, setTcText] = useState(loadTC);
  const [tcEditing, setTcEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitInfo, setLimitInfo] = useState(null);
  const [discountPct, setDiscountPct] = useState(0);
  const [tenantPlan, setTenantPlan] = useState({ plan: "trial", docLimit: 10 });

  const isAdmin = ADMIN_EMAILS.includes(user?.email);
  const isPremium = isAdmin || tenantPlan.plan === "founding_starter" || tenantPlan.plan === "starter" || tenantPlan.plan === "growth" || tenantPlan.plan === "pro";
  const isActiveTrial = !isPremium && tenantPlan.trialEndsAt && new Date(tenantPlan.trialEndsAt) > new Date();
  const trialDaysLeft = isActiveTrial ? Math.ceil((new Date(tenantPlan.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
  const docLimit = tenantPlan.docLimit ?? 10;

  const totals = calcTotals(doc.rows, discountPct);
  const isQuote = mode === "quote";
  const ink = isQuote ? "#1A5C3A" : "#2D2D7A";
  const accentColor = isQuote ? "#C47A00" : "#C0392B";
  const paperBg = isQuote ? "#F0FBF4" : "#FEFCE8";
  const paperDark = isQuote ? "#D4EEDC" : "#F5F0C0";
  const borderColor = isQuote ? "#90C8A0" : "#9999CC";

  useEffect(() => {
    if (!tenantId) return;
    async function init() {
      setLoading(true);
      try {
        const [docs, profile, plan] = await Promise.all([
          dbLoadDocuments(tenantId),
          dbLoadProfile(tenantId),
          dbGetTenantPlan(tenantId),
        ]);
        setSaved(docs);
        setTenantPlan(plan);
        if (profile.coName || profile.coAbn || profile.coAddr || profile.coPhone) {
          setDoc(d => ({ ...d, coName: profile.coName || "", coAbn: profile.coAbn || "", coAddr: profile.coAddr || "", coPhone: profile.coPhone || "", from: profile.from || "", abnS: profile.abnS || "" }));
        }
        if (profile.logo) setLogoSrc(profile.logo);
      } catch (e) { console.error("Init error:", e); }
      finally { setLoading(false); }
    }
    init();
  }, [tenantId]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2800); };

  // Inject print style to remove logo border — most reliable cross-browser approach
  useEffect(() => {
    const id = "logo-print-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "@media print { .logo-label { border: none !important; border-width: 0 !important; border-style: none !important; outline: none !important; box-shadow: none !important; } }";
    document.head.appendChild(style);
  }, []);


  const signOut = async () => {
    if (!window.confirm("Sign out?")) return;
    await supabase.auth.signOut();
  };

  const deleteAccount = async () => {
    if (deleteConfirmEmail.trim().toLowerCase() !== (user?.email || "").toLowerCase()) {
      setDeleteError("Email does not match. Please try again.");
      return;
    }
    setLoading(true);
    try {
      const userId = await getUserId();
      await supabase.from("user_settings").update({ onboarded: false }).eq("user_id", userId);
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(TC_KEY);
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Delete account error:", e);
      setDeleteError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const setMode = (m) => { setModeState(m); setDoc(d => ({ ...d, docType: m })); };

  const updateCompany = (field, value) => {
    setDoc(d => {
      const updated = { ...d, [field]: value };
      const name = field === "coName" ? value : d.coName || "";
      const abn = field === "coAbn" ? value : d.coAbn || "";
      const addr = field === "coAddr" ? value : d.coAddr || "";
      const phone = field === "coPhone" ? value : d.coPhone || "";
      updated.from = [name, abn ? "ABN: " + abn : "", addr, phone].filter(Boolean).join("\n");
      if (field === "coAbn") updated.abnS = value;
      const profile = loadProfile();
      profile[field] = value; profile.from = updated.from; profile.abnS = updated.abnS || profile.abnS || "";
      dbSaveProfile(profile, tenantId);
      return updated;
    });
  };

  const updateRow = (idx, field, val) => {
    setDoc(d => {
      const rows = d.rows.map((r, i) => { if (i !== idx) return r; const updated = { ...r, [field]: val }; return (field === "qty" || field === "each" || field === "gstApplied") ? calcRow(updated) : updated; });
      return { ...d, rows };
    });
  };

  const addRow = () => setDoc(d => ({ ...d, rows: [...d.rows, emptyRow()] }));
  const removeRow = (idx) => setDoc(d => ({ ...d, rows: d.rows.filter((_, i) => i !== idx) }));

  const newDoc = () => {
    if (!window.confirm("Start a new document? Unsaved changes will be lost.")) return;
    const profile = loadProfile(); const fresh = emptyDoc(mode);
    fresh.coName = profile.coName || ""; fresh.coAbn = profile.coAbn || ""; fresh.coAddr = profile.coAddr || "";
    fresh.coPhone = profile.coPhone || ""; fresh.from = profile.from || ""; fresh.abnS = profile.abnS || "";
    setDoc(fresh); setDocId(null); setPayStatusState("unpaid"); setDiscountPct(0);
    showToast("New " + (isQuote ? "quote" : "invoice") + " started");
  };

  const saveDoc = async () => {
    // For new documents only — check plan limits via database function
    if (!docId) {
      if (!isPremium && !isActiveTrial) {
        const { data: check } = await supabase.rpc("check_and_increment_doc_count", { p_tenant_id: tenantId });
        if (check && !check.allowed) {
          setLimitInfo(check);
          setShowLimitModal(true);
          return;
        }
      }
    }
    // Mandatory field validation
    if (!doc.clientEmail || !doc.clientEmail.trim()) {
      showToast("⚠️ Client email is required"); return;
    }
    if (!doc.clientMobile || !doc.clientMobile.trim()) {
      showToast("⚠️ Client mobile is required"); return;
    }
    setLoading(true);
    try {
      const result = await dbSaveDocument(doc, payStatus, docId, tenantId, discountPct);
      if (!result) { showToast("Save failed - check connection"); return; }
      if (!docId) {
        setDocId(result.id);
        setDoc(d => ({ ...d, number: result.number, prefix: result.prefix, id: result.id }));
      }
      await dbSaveClient(doc.to, doc.abnR, tenantId, doc.clientEmail, doc.clientMobile);
      const docs = await dbLoadDocuments(tenantId); setSaved(docs);
      showToast("Saved " + (result.prefix || (isQuote ? "QT" : "INV")) + "-" + (result.number || doc.number));
    } catch (e) { console.error("Save error:", e); showToast("Save failed"); }
    finally { setLoading(false); }
  };

  const loadDoc = (item) => {
    const profile = loadProfile();
    setDoc({ ...emptyDoc(item.docType || "invoice"), ...item, coName: profile.coName || "", coAbn: profile.coAbn || "", coAddr: profile.coAddr || "", coPhone: profile.coPhone || "", from: item.from || profile.from || "", rows: item.rows?.length ? item.rows : Array.from({ length: 1 }, emptyRow) });
    setModeState(item.docType || "invoice"); setDocId(item.id); setPayStatusState(item.payStatus || "unpaid");
    setDrawerOpen(false); showToast("Loaded " + (item.prefix || "INV") + "-" + (item.number || ""));
  };

  const deleteDoc = async (id, label) => {
    if (!isPremium) { showToast("Upgrade to delete documents"); return; }
    if (!window.confirm("Delete " + label + "?")) return;
    await dbDeleteDocument(id, tenantId);
    const docs = await dbLoadDocuments(tenantId); setSaved(docs);
    if (docId === id) { setDoc(emptyDoc(mode)); setDocId(null); }
    showToast("Deleted");
  };

  const convertToInvoice = async () => {
    if (!window.confirm("Convert this Quote to a Tax Invoice?")) return;
    setLoading(true);
    try {
      if (docId) {
        await supabase.from("documents").update({ converted: true }).eq("id", docId).eq("tenant_id", tenantId);
      }
      const newInvoiceDoc = { ...doc, docType: "invoice", convertedToInvoice: true, number: "", prefix: "" };
      const result = await dbSaveDocument(newInvoiceDoc, payStatus, null, tenantId, discountPct);
      if (!result) { showToast("Conversion failed - check connection"); return; }
      await dbSaveClient(doc.to, doc.abnR, tenantId, doc.clientEmail, doc.clientMobile);
      setModeState("invoice");
      setDoc(d => ({ ...d, docType: "invoice", convertedToInvoice: true, number: result.number, prefix: result.prefix, id: result.id }));
      setDocId(result.id);
      setPayStatusState("unpaid");
      const docs = await dbLoadDocuments(tenantId); setSaved(docs);
      showToast("Converted to Invoice INV-" + result.number);
    } catch (e) {
      console.error("Convert error:", e);
      showToast("Conversion failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!doc.clientEmail || !doc.clientEmail.trim()) {
      showToast("⚠️ Client email is required before printing"); return;
    }
    if (!doc.clientMobile || !doc.clientMobile.trim()) {
      showToast("⚠️ Client mobile is required before printing"); return;
    }
    if (!doc.number) {
      saveDoc();
      setTimeout(() => {
        const cn = (doc.to || "").split("\n")[0].trim().replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Invoice";
        document.title = cn; window.print();
        setTimeout(() => { document.title = "Invoice App"; }, 3000);
      }, 800);
    } else {
      const cn = (doc.to || "").split("\n")[0].trim().replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Invoice";
      document.title = cn + " " + (doc.prefix || (isQuote ? "QT" : "INV")) + "-" + doc.number;
      window.print(); setTimeout(() => { document.title = "Invoice App"; }, 3000);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoSrc(ev.target.result);
      const profile = loadProfile(); profile.logo = ev.target.result;
      dbSaveProfile(profile, tenantId);
    };
    reader.readAsDataURL(file);
  };

  const S = {
    body: { minHeight: "100vh", background: isQuote ? "#D4E8D8" : "#E8E4D0", fontFamily: "Lato, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 0 60px", overflowX: "hidden" },
    toolbar: { width: "100%", maxWidth: 820, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 12px", gap: 10, flexWrap: "wrap" },
    paper: { width: "100%", maxWidth: 820, background: paperBg, border: "1px solid #C8C0A0", boxShadow: "0 2px 6px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.12)", padding: "28px 32px 32px", position: "relative", borderLeft: "6px solid " + (isQuote ? "#6BA87A" : "#B8A870"), overflow: "hidden" },
    label: { fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase", display: "block", marginBottom: 4 },
    metaInput: { border: "none", background: "transparent", fontFamily: "monospace", fontSize: 15, color: ink, width: "100%", outline: "none", padding: 0 },
    textarea: { border: "none", background: "transparent", fontFamily: "Lato, sans-serif", fontSize: 13, color: ink, width: "100%", height: 64, outline: "none", resize: "none", lineHeight: 1.6, overflow: "hidden", scrollbarWidth: "none" },
    btn: (bg, fg = "#fff") => ({ padding: "9px 16px", borderRadius: 8, background: bg, color: fg, border: "none", fontFamily: "Lato, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5, whiteSpace: "nowrap" }),
    th: { fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: ink, textTransform: "uppercase", background: paperDark, border: "1px solid " + borderColor, padding: "7px 8px", textAlign: "center" },
    td: { border: "1px solid " + (isQuote ? "#B8DDC8" : "#C8C8E8"), padding: 0, height: 34 },
    tdInput: { width: "100%", height: "100%", border: "none", background: "transparent", fontFamily: "monospace", fontSize: 13, color: ink, outline: "none", padding: "0 6px", textAlign: "center" },
  };

  const pill = (s, label, bg, fg, border) => (
    <button key={s} onClick={() => setPayStatusState(s)} style={{ padding: "5px 14px", borderRadius: 999, border: "1.5px solid " + border, background: bg, color: fg, fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", opacity: payStatus === s ? 1 : 0.4, transform: payStatus === s ? "scale(1.05)" : "scale(1)", transition: "all 0.15s" }}>{label}</button>
  );

  const displayNumber = doc.number ? (doc.prefix || (isQuote ? "QT" : "INV")) + "-" + doc.number : "NEW";

  // Guard: if tenantId not loaded yet, show loading
  if (!tenantId) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#8888CC" }}>Loading your workspace...</div>
      </div>
    );
  }

  return (
    <div style={S.body}>
      <style>{`
        * { box-sizing: border-box; }
        @media print { .no-print-border { border: none !important; border-width: 0 !important; border-style: none !important; outline: none !important; } }
        textarea { scrollbar-width: none; -ms-overflow-style: none; } textarea::-webkit-scrollbar { display: none; }

        @media (max-width: 600px) {
          #invoice-paper { padding: 12px 8px !important; border-left-width: 4px !important; overflow-x: hidden !important; }
          .beta-banner { font-size: 9px !important; padding: 5px 8px !important; line-height: 1.4 !important; letter-spacing: 0 !important; }
          .mobile-toolbar { flex-direction: column !important; align-items: stretch !important; gap: 6px !important; padding: 8px 10px !important; }
          .invoice-header { flex-direction: row !important; align-items: flex-start !important; gap: 10px !important; margin-bottom: 10px !important; }
          .invoice-header label { width: 70px !important; height: 50px !important; flex-shrink: 0 !important; }
          .invoice-header > div:last-child { text-align: left !important; width: 100% !important; flex: 1 !important; }
          .invoice-header > div:last-child input { text-align: left !important; font-size: 11px !important; }
          .invoice-header > div:last-child input:first-child { font-size: 14px !important; }
          .meta-grid { grid-template-columns: 1fr 1fr !important; }
          .meta-grid > div:first-child { grid-column: 1 / -1 !important; border-right: none !important; border-bottom: 1.5px solid #2D2D7A !important; }
          .meta-grid > div:nth-child(2) { border-right: 1.5px solid #2D2D7A !important; }
          .meta-grid > div:nth-child(3) { border-right: none !important; }
          .from-to-grid { grid-template-columns: 1fr !important; }
          .from-to-grid > div:first-child { border-right: none !important; border-bottom: 1.5px solid #2D2D7A !important; }
          .abn-grid { grid-template-columns: 1fr !important; }
          .abn-grid > div:first-child { border-right: none !important; border-bottom: 1px solid #C8C8E8 !important; }
          .invoice-table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch !important; }
          .invoice-table-wrap table { min-width: 460px !important; }
          .payment-row { gap: 6px !important; padding: 0 10px 8px !important; }
          .payment-row button { padding: 4px 10px !important; font-size: 10px !important; }
          .share-bar { flex-direction: column !important; gap: 8px !important; }
          .share-bar button, .share-bar a { width: 100% !important; justify-content: center !important; }
          .invoice-title { font-size: 17px !important; padding: 6px 8px !important; }
          input[type="date"] { text-align: left !important; padding-left: 4px !important; display: block !important; width: 100% !important; }
          .meta-grid > div:first-child input { text-align: left !important; }
          .assigned-on-save { display: none !important; }
          .beta-banner span { display: none !important; }
          #invoice-paper { padding: 10px 8px !important; }
          .invoice-number-display { font-size: 16px !important; }
          .mode-toggle { width: 100% !important; }
          .mode-toggle button { flex: 1 !important; }
          .action-btns { width: 100% !important; display: flex !important; gap: 6px !important; }
          .action-btns button { flex: 1 !important; padding: 9px 4px !important; font-size: 12px !important; }
        }

        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box !important; }

          /* A4 page setup */
          @page { size: A4 portrait; margin: 8mm; }

          html, body { margin: 0 !important; padding: 0 !important; background: white !important; width: 210mm !important; }

          .no-print { display: none !important; }
          .mandatory-star { display: none !important; }
          .search-bar-row { display: none !important; }
          .remove-row-btn { display: none !important; }
          .add-row-btn { display: none !important; }
          .sig-clear-row { display: none !important; }
          .logo-label { border: none !important; cursor: default !important; }

          /* Invoice paper fills A4 exactly, scaled to fit */
          #invoice-paper {
            width: 194mm !important;
            max-width: 194mm !important;
            min-height: auto !important;
            margin: 0 auto !important;
            padding: 10mm 12mm !important;
            box-shadow: none !important;
            border-left: 5px solid #B8A870 !important;
            page-break-after: always !important;
            page-break-inside: avoid !important;
            font-size: 11px !important;
          }

          /* Tighten up all internal spacing for print */
          #invoice-paper .invoice-title { font-size: 18px !important; padding: 5px 10px !important; margin-bottom: 8px !important; }
          #invoice-paper .invoice-header { margin-bottom: 6px !important; }
          #invoice-paper .meta-grid { }
          #invoice-paper table th { padding: 4px 6px !important; font-size: 9px !important; }
          #invoice-paper table td { height: 26px !important; }
          #invoice-paper table input { font-size: 11px !important; }

          /* Footer watermark */
          #invoice-paper::after {
            content: 'invoice.bluesquaresolutions.com.au';
            display: block !important;
            text-align: center;
            font-size: 8px;
            color: #ccc;
            font-family: monospace;
            letter-spacing: 1.5px;
            padding-top: 6px;
            margin-top: 6px;
            border-top: 1px solid #eee;
          }

          /* T&C on second page */
          .tc-page { display: block !important; page-break-before: always !important; padding: 20mm 15mm !important; }
        }
        .tc-page { display: none; }
        @media print {
          .logo-label { border: none !important; border-style: none !important; outline: none !important; box-shadow: none !important; }
        }

      `}</style>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 420, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: "#C0392B", marginBottom: 10 }}>Delete Account</div>
            <p style={{ fontFamily: "Lato, sans-serif", fontSize: 13, color: "#444", lineHeight: 1.7, marginBottom: 16 }}>
              Your account will be <strong>deactivated</strong>. Your invoices and data will be retained for audit purposes but you will no longer be able to log in.
            </p>
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", marginBottom: 8 }}>Type your email to confirm: <strong>{user?.email}</strong></p>
            <input type="email" value={deleteConfirmEmail} onChange={e => { setDeleteConfirmEmail(e.target.value); setDeleteError(""); }} placeholder={user?.email}
              style={{ width: "100%", border: "1.5px solid #ddd", borderRadius: 6, padding: "8px 12px", fontFamily: "monospace", fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />
            {deleteError && <div style={{ fontFamily: "monospace", fontSize: 11, color: "#C0392B", marginBottom: 8 }}>{deleteError}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setShowDeleteModal(false)} style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", fontFamily: "monospace", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              <button onClick={deleteAccount} disabled={loading} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#C0392B", color: "#fff", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
                {loading ? "Processing..." : "Yes, delete my account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Doc Limit Modal */}
      {showLimitModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.3)", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🚀</div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: "#2D2D7A", marginBottom: 10 }}>Monthly Limit Reached</div>
            <p style={{ fontFamily: "Lato, sans-serif", fontSize: 13, color: "#444", lineHeight: 1.7, marginBottom: 8 }}>
              You've used all <strong>10 free invoices</strong> this month.
              {limitInfo?.resets_on && (
                <span> Your limit resets on <strong>{new Date(limitInfo.resets_on).toLocaleDateString("en-AU", { day: "numeric", month: "long" })}</strong>.</span>
              )}
            </p>
            <p style={{ fontFamily: "Lato, sans-serif", fontSize: 13, color: "#444", lineHeight: 1.7, marginBottom: 20 }}>
              Upgrade to get <strong>unlimited invoices and quotes</strong> for just A$2.99/mo.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              <button
                onClick={async () => {
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const res = await fetch(
                      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY },
                        body: JSON.stringify({ plan: "founding", interval: "monthly", success_url: window.location.origin + "/?checkout=success", cancel_url: window.location.origin + "/?checkout=cancelled" }),
                      }
                    );
                    const data = await res.json();
                    if (data.error === "founding_full") {
                      const res2 = await fetch(
                        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY },
                          body: JSON.stringify({ plan: "starter", interval: "monthly", success_url: window.location.origin + "/?checkout=success", cancel_url: window.location.origin + "/?checkout=cancelled" }),
                        }
                      );
                      const data2 = await res2.json();
                      if (data2.url) window.location.href = data2.url;
                    } else if (data.url) {
                      window.location.href = data.url;
                    }
                  } catch (e) { showToast("Could not start checkout. Try again."); }
                }}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", borderRadius: 8, background: "#2D2D7A", color: "#fff", border: "none", fontFamily: "monospace", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                🚀 Upgrade Now — Start 30-day Free Trial
              </button>
              <a href="https://invoice.bluesquaresolutions.com.au/pricing.html"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px", borderRadius: 8, background: "transparent", color: "#2D2D7A", border: "1.5px solid #2D2D7A", fontFamily: "monospace", fontSize: 12, textDecoration: "none" }}>
                View Pricing Plans
              </a>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", marginBottom: 12 }}>
              {limitInfo?.resets_on && `Or wait until ${new Date(limitInfo.resets_on).toLocaleDateString("en-AU", { day: "numeric", month: "long" })} for your free limit to reset.`}
            </div>
            <button onClick={() => setShowLimitModal(false)} style={{ padding: "8px 24px", borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", fontFamily: "monospace", fontSize: 12, cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}

      <div className="no-print beta-banner" style={{ width: "100%", background: "#2D2D7A", color: "#fff", textAlign: "center", padding: "6px", fontFamily: "monospace", fontSize: 11, letterSpacing: 1 }}>
        For support contact <a href="mailto:support@bluesquaresolutions.com.au" style={{ color: "#FFD700", textDecoration: "underline", marginLeft: 4 }}>support@bluesquaresolutions.com.au</a>
        <span style={{ margin: "0 8px" }}>|</span> invoice.bluesquaresolutions.com.au
      </div>

      {loading && <div style={{ width: "100%", background: "#E8F5E9", textAlign: "center", padding: "4px", fontFamily: "monospace", fontSize: 11, color: "#2E7D32", letterSpacing: 1 }}>Syncing with cloud...</div>}

      {/* Trial expiry banner — shown when 7 days or less remaining */}
      {isActiveTrial && trialDaysLeft <= 7 && (
        <div className="no-print" style={{ width: "100%", background: trialDaysLeft <= 2 ? "#FEE2E2" : "#FEF3C7", textAlign: "center", padding: "6px 16px", fontFamily: "monospace", fontSize: 11, letterSpacing: 1, color: trialDaysLeft <= 2 ? "#991B1B" : "#92400E", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          ⏰ Your free trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong>. After that you'll move to the free plan (10 invoices/month).
          <button
            onClick={async () => {
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY },
                  body: JSON.stringify({ plan: "founding", interval: "monthly", success_url: window.location.origin + "/?checkout=success", cancel_url: window.location.origin + "/?checkout=cancelled" }),
                });
                const data = await res.json();
                if (data.url) window.location.href = data.url;
              } catch { showToast("Could not start checkout. Try again."); }
            }}
            style={{ padding: "4px 12px", borderRadius: 6, background: trialDaysLeft <= 2 ? "#C0392B" : "#92400E", color: "#fff", border: "none", fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            Upgrade Now →
          </button>
        </div>
      )}

      {/* Doc counter — shown for free plan only (not trial, not premium) */}
      {!isPremium && !isActiveTrial && (
        <div className="no-print" style={{ width: "100%", background: tenantPlan.monthlyDocCount >= 10 ? "#FEE2E2" : tenantPlan.monthlyDocCount >= 8 ? "#FEF3C7" : "#E8F5E9", textAlign: "center", padding: "4px", fontFamily: "monospace", fontSize: 11, letterSpacing: 1, color: tenantPlan.monthlyDocCount >= 10 ? "#991B1B" : tenantPlan.monthlyDocCount >= 8 ? "#92400E" : "#2E7D32" }}>
          FREE: {tenantPlan.monthlyDocCount} / 10 documents used this month
          {tenantPlan.monthlyDocCount >= 10 && <span style={{ marginLeft: 8, fontWeight: 700 }}>— Limit reached. Upgrade or wait until next month.</span>}
          {tenantPlan.monthlyDocCount >= 8 && tenantPlan.monthlyDocCount < 10 && <span style={{ marginLeft: 8 }}>— {10 - tenantPlan.monthlyDocCount} remaining this month</span>}
        </div>
      )}

      <div className="no-print mobile-toolbar" style={S.toolbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#4A3F00" }}>Blue Square Invoice</span>
          {user && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6A5F30", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
              {onShowTeam && (
                <button onClick={onShowTeam} style={{ fontFamily: "monospace", fontSize: 11, color: "#2D2D7A", background: "none", border: "1px solid #2D2D7A", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>👥 Team</button>
              )}
              {onShowAdmin && isAdmin && (
                <button onClick={onShowAdmin} style={{ fontFamily: "monospace", fontSize: 11, color: "#7A2D2D", background: "rgba(122,45,45,0.08)", border: "1px solid #7A2D2D", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>⚙ Admin</button>
              )}
              <button onClick={signOut} style={{ fontFamily: "monospace", fontSize: 11, color: "#C0392B", background: "none", border: "1px solid #C0392B", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>Sign out</button>
            </div>
          )}
        </div>
        <div className="mode-toggle" style={{ display: "flex", background: "rgba(0,0,0,0.15)", borderRadius: 10, padding: 3, gap: 2 }}>
          {["invoice", "quote"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", background: mode === m ? (m === "quote" ? "#2E7D52" : "#2D2D7A") : "transparent", color: mode === m ? "#fff" : "rgba(255,255,255,0.5)", transition: "all 0.2s" }}>{m.toUpperCase()}</button>
          ))}
        </div>
        <div className="action-btns" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={S.btn("#2D2D7A")} onClick={newDoc}>+ New</button>
          <button style={{ ...S.btn("#2E7D32"), opacity: loading ? 0.6 : 1 }} onClick={saveDoc} disabled={loading}>{loading ? "Saving..." : "Save"}</button>
          <button style={S.btn("#C0392B")} onClick={handlePrint}>Print / PDF</button>
        </div>
      </div>

      <div className="no-print payment-row" style={{ width: "100%", maxWidth: 820, display: "flex", alignItems: "center", gap: 10, padding: "0 0 10px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6A5F30", letterSpacing: 1, textTransform: "uppercase" }}>Payment:</span>
        {pill("unpaid", "Unpaid", "#FEF3C7", "#92400E", "#F59E0B")}
        {pill("paid", "Paid", "#D1FAE5", "#065F46", "#10B981")}
        {pill("overdue", "Overdue", "#FEE2E2", "#991B1B", "#EF4444")}
      </div>

      {doc.number && (
        <div className="no-print" style={{ width: "100%", maxWidth: 820, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(255,255,255,0.5)", border: "1px solid #C8C0A0", borderRadius: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6A5F30", fontWeight: 700, flex: 1 }}>
            Share {doc.prefix || (isQuote ? "QT" : "INV")}-{doc.number}
          </span>
          <button onClick={() => {
            const clientName = (doc.to || "").split("\n")[0].trim() || "there";
            const docNum = (doc.prefix || (isQuote ? "QT" : "INV")) + "-" + doc.number;
            const amount = "$" + calcTotals(doc.rows).grandTotal;
            const company = doc.coName || "us";
            const type = isQuote ? "quote" : "invoice";
            const msg = "Hi " + clientName + ",\n\nPlease find your " + type + " *" + docNum + "* for *" + amount + "* from " + company + ".\n\nKindly review and let us know if you have any questions.\n\nThank you,\n" + company;
            const mobile = (doc.clientMobile || "").replace(/\D/g, "").replace(/^0/, "61");
            const waUrl = mobile
              ? "https://wa.me/" + mobile + "?text=" + encodeURIComponent(msg)
              : "https://wa.me/?text=" + encodeURIComponent(msg);
            window.open(waUrl, "_blank");
          }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "#25D366", color: "#fff", border: "none", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            WhatsApp
          </button>
          <button onClick={() => {
            const clientName = (doc.to || "").split("\n")[0].trim() || "there";
            const docNum = (doc.prefix || (isQuote ? "QT" : "INV")) + "-" + doc.number;
            const t = calcTotals(doc.rows);
            const amount = "$" + t.grandTotal;
            const company = doc.coName || "us";
            const type = isQuote ? "Quote" : "Invoice";
            const subject = type + " " + docNum + " from " + company;
            const lines = doc.rows.filter(r => r.desc && r.total).map(r => "- " + r.desc + ": $" + r.total).join("\n");
            const body = "Hi " + clientName + ",\n\nPlease find your " + type.toLowerCase() + " " + docNum + " for " + amount + ".\n\nDate: " + (doc.date || "") + "\n\nItems:\n" + lines + "\n\nSubtotal: $" + t.subtotal + "\nGST (10%): $" + t.gstTotal + "\nTotal Inc. GST: " + amount + "\n\nKind regards,\n" + company + "\n" + (doc.coPhone || "") + "\n" + (doc.coAddr || "");
            const toEmail = doc.clientEmail || "";
            window.open("mailto:" + toEmail + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body), "_blank");
          }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "#2D2D7A", color: "#fff", border: "none", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            Email
          </button>
        </div>
      )}

      <div id="invoice-paper" style={S.paper}>
        <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: 1.5, color: isQuote ? "#7AB898" : "#8888CC", textTransform: "uppercase", marginBottom: 6 }}>{isQuote ? "Original Copy - Quote" : "Original Copy"}</div>
        <div className="invoice-title" style={{ fontFamily: "Georgia, serif", fontSize: 26, color: ink, textAlign: "center", letterSpacing: 1, border: "2px solid " + ink, padding: "8px 16px", marginBottom: 16 }}>{isQuote ? "Quote / Estimate" : "Tax Invoice / Statement"}</div>

        <div className="invoice-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 16 }}>
          <label className="logo-label no-print-border" style={{ width: 120, height: 70, border: "1.5px dashed #8888CC", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: 4, overflow: "hidden", flexShrink: 0, position: "relative" }}>
            {logoSrc ? <img src={logoSrc} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", textAlign: "center", lineHeight: 1.5 }}>TAP TO<br />ADD LOGO</span>}
            <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
          </label>
          <div style={{ flex: 1, textAlign: "right" }}>
            {[["coName", "Your Company Name", 17, 700], ["coAbn", "ABN: XX XXX XXX XXX", 12, 400], ["coAddr", "Address, City, State", 12, 400], ["coPhone", "Phone / Email", 12, 400]].map(([field, ph, fs, fw]) => (
              <input key={field} value={doc[field] || ""} onChange={e => updateCompany(field, e.target.value)} placeholder={ph} style={{ display: "block", width: "100%", textAlign: "right", border: "none", background: "transparent", fontFamily: "Lato, sans-serif", color: ink, padding: "2px 4px", outline: "none", fontSize: fs, fontWeight: fw }} />
            ))}
          </div>
        </div>

        <div className="meta-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", border: "1.5px solid " + ink }}>
          <div style={{ padding: "6px 10px", borderRight: "1.5px solid " + ink }}>
            <span style={S.label}>Date</span>
            <input type="date" value={doc.date || ""} onChange={e => setDoc(d => ({ ...d, date: e.target.value }))} style={S.metaInput} />
          </div>
          <div style={{ padding: "6px 10px", borderRight: "1.5px solid " + ink }}>
            <span style={S.label}>Order / PO Number</span>
            <input type="text" value={doc.order || ""} onChange={e => setDoc(d => ({ ...d, order: e.target.value }))} placeholder="Optional" style={S.metaInput} />
          </div>
          <div style={{ padding: "6px 10px" }}>
            <span style={S.label}>{isQuote ? "Quote Number" : "Invoice Number"}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="invoice-number-display" style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: accentColor }}>{displayNumber}</span>
              {!doc.number && <span className="assigned-on-save" style={{ fontFamily: "monospace", fontSize: 10, color: "#8888CC", fontStyle: "italic" }}>(assigned on save)</span>}
            </div>
          </div>
        </div>

        <div className="from-to-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1.5px solid " + ink, borderTop: "none" }}>
          <div style={{ padding: "8px 10px", minHeight: 80, borderRight: "1.5px solid " + ink }}>
            <span style={S.label}>From</span>
            <AutoTextarea value={doc.from || ""} onChange={e => setDoc(d => ({ ...d, from: e.target.value }))} placeholder={"Your name / business\nStreet address\nCity, State, Postcode"} style={S.textarea} />
          </div>
          <div style={{ padding: "8px 10px", minHeight: 80, position: "relative" }}>
            <ClientSearch
              value={doc.to || ""}
              ink={ink}
              tenantId={tenantId}
              clientEmail={doc.clientEmail}
              clientMobile={doc.clientMobile}
              onChange={(address, abn) => setDoc(d => ({ ...d, to: address, ...(abn !== null ? { abnR: abn } : {}) }))}
              onEmailChange={v => setDoc(d => ({ ...d, clientEmail: v }))}
              onMobileChange={v => setDoc(d => ({ ...d, clientMobile: v }))}
              onBlurSave={() => dbSaveClient(doc.to, doc.abnR, tenantId, doc.clientEmail, doc.clientMobile)}
              onSelectClient={(client) => setDoc(d => ({ ...d, clientEmail: client.email || d.clientEmail, clientMobile: client.phone || d.clientMobile }))}
            />
          </div>
        </div>

        <div className="from-to-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1.5px solid " + ink, borderTop: "none" }}>
          {[["ABN (Supplier):", "abnS", "XX XXX XXX XXX"], ["ABN (Recipient):", "abnR", "XX XXX XXX XXX"]].map(([lbl, field, ph], i) => (
            <div key={lbl} style={{ padding: "5px 10px", borderRight: i === 0 ? "1.5px solid " + ink : "none", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...S.label, marginBottom: 0, whiteSpace: "nowrap" }}>{lbl}</span>
              <input value={doc[field] || ""} onChange={e => setDoc(d => ({ ...d, [field]: e.target.value }))} placeholder={ph} style={{ border: "none", background: "transparent", fontFamily: "monospace", fontSize: 13, color: ink, flex: 1, outline: "none" }} />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", border: "1.5px solid " + ink, borderTop: "none", padding: "4px 10px", marginBottom: 14 }}>
          <span style={{ ...S.label, marginBottom: 0 }}>GST No:</span>
          <input value={doc.gstNo || ""} onChange={e => setDoc(d => ({ ...d, gstNo: e.target.value }))} placeholder="Enter GST number" style={{ border: "none", background: "transparent", fontFamily: "monospace", fontSize: 13, color: ink, outline: "none", flex: 1, margin: "0 12px" }} />
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC", fontStyle: "italic" }}>(New Zealand Only)</span>
        </div>

        <div className="invoice-table-wrap"><table style={{ width: "100%", borderCollapse: "collapse", border: "1.5px solid " + ink }}>
          <thead>
            <tr>{[["QTY", "60px"], ["Description", "auto"], ["Each $", "90px"], ["GST?", "48px"], ["GST $", "72px"], ["Total $", "100px"], ["", "32px"]].map(([h, w]) => <th key={h} style={{ ...S.th, width: w, textAlign: h === "Description" ? "left" : "center" }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {doc.rows.map((row, idx) => (
              <tr key={row.id} style={{ background: idx % 2 === 1 ? "rgba(" + (isQuote ? "180,220,200" : "200,200,232") + ",0.08)" : "transparent" }}>
                <td style={S.td}><input value={row.qty} onChange={e => updateRow(idx, "qty", e.target.value)} placeholder="0" type="number" min="0" step="1" style={S.tdInput} /></td>
                <td style={S.td}><input value={row.desc} onChange={e => updateRow(idx, "desc", e.target.value)} placeholder="Description of goods / services" style={{ ...S.tdInput, textAlign: "left" }} /></td>
                <td style={S.td}><input value={row.each} onChange={e => updateRow(idx, "each", e.target.value)} placeholder="0.00" type="number" min="0" step="0.01" style={S.tdInput} /></td>
                <td style={{ ...S.td, textAlign: "center", verticalAlign: "middle" }}>
                  <input type="checkbox" checked={row.gstApplied !== false} onChange={e => updateRow(idx, "gstApplied", e.target.checked)}
                    title={row.gstApplied !== false ? "GST applied — click to remove" : "No GST — click to apply"}
                    style={{ width: 15, height: 15, cursor: "pointer", accentColor: ink }} />
                </td>
                <td style={S.td}><input value={row.gst} readOnly style={{ ...S.tdInput, color: "#8888CC" }} /></td>
                <td style={S.td}><input value={row.total} readOnly style={{ ...S.tdInput, fontWeight: 700 }} /></td>
                <td className="remove-row-btn" style={S.td}><button onClick={() => removeRow(idx)} style={{ width: "100%", height: "100%", border: "none", background: "transparent", color: "#C0392B", cursor: "pointer", fontSize: 14 }}>x</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <button className="add-row-btn" onClick={addRow} style={{ width: "100%", border: "1px dashed " + (isQuote ? "#7AB898" : "#8888CC"), borderTop: "none", background: "transparent", color: isQuote ? "#7AB898" : "#8888CC", fontFamily: "monospace", fontSize: 12, letterSpacing: 1, padding: 6, cursor: "pointer" }}>+ ADD LINE ITEM</button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", border: "1.5px solid " + ink, borderTop: "1.5px solid " + ink }}>
          <div style={{ padding: 10, borderRight: "1.5px solid " + ink, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink, textTransform: "uppercase" }}>Signed:</span>
            <SigCanvas />
            <div style={{ fontFamily: "Lato, sans-serif", fontSize: 10, color: "#8888CC", fontStyle: "italic", marginTop: "auto" }}>* Indicates taxable supply</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Sub Total */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid " + (isQuote ? "#B8DDC8" : "#C8C8E8"), minHeight: 38, background: "transparent", padding: "0 10px" }}>
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: ink }}>Sub Total</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: ink }}>${totals.subtotal}</span>
              </div>
              {/* Discount row */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid " + (isQuote ? "#B8DDC8" : "#C8C8E8"), minHeight: 38, background: "transparent", padding: "0 10px" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: ink, flex: 1 }}>
                  Discount
                  {parseFloat(discountPct) > 0 && <span style={{ fontWeight: 400, fontSize: 10, color: "#8888CC", marginLeft: 4 }}>({discountPct}%)</span>}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={discountPct || ""}
                    onChange={e => setDiscountPct(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                    placeholder="0"
                    style={{ width: 36, border: "1px solid #C8C8E8", borderRadius: 4, padding: "2px 4px", fontFamily: "monospace", fontSize: 11, color: ink, textAlign: "center", background: "rgba(255,255,255,0.7)", outline: "none" }}
                  />
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: ink }}>%</span>
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: parseFloat(discountPct) > 0 ? "#C0392B" : "#aaa", minWidth: 60, textAlign: "right" }}>
                  {parseFloat(discountPct) > 0 ? "-$" + totals.discountAmt : "—"}
                </span>
              </div>
              {/* GST */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid " + (isQuote ? "#B8DDC8" : "#C8C8E8"), minHeight: 38, background: "transparent", padding: "0 10px" }}>
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: ink }}>GST (10%)</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: ink }}>${totals.gstTotal}</span>
              </div>
              {/* Total */}
              <div style={{ display: "flex", alignItems: "center", minHeight: 50, background: paperDark, padding: "0 10px" }}>
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: ink }}>Total Inc. GST</span>
                <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: accentColor }}>${totals.grandTotal}</span>
              </div>
          </div>
        </div>

        {payStatus !== "unpaid" && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%) rotate(-30deg)", fontFamily: "monospace", fontSize: 60, fontWeight: 700, color: payStatus === "paid" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 0 }}>{payStatus.toUpperCase()}</div>
        )}
      </div>

      <div className="no-print" style={{ width: "100%", maxWidth: 820, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "rgba(0,0,0,0.06)", borderRadius: 8 }}>
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#4A3F00", fontWeight: 700 }}>Terms and Conditions <span style={{ fontWeight: 400, color: "#888", fontSize: 11 }}>(prints on page 2)</span></span>
        <div style={{ display: "flex", gap: 8 }}>
          {tcEditing && <button onClick={() => { saveTC(DEFAULT_TC); setTcText(DEFAULT_TC); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #C0392B", background: "transparent", color: "#C0392B", fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>Reset to Default</button>}
          <button onClick={() => setTcEditing(e => !e)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: tcEditing ? "#2E7D32" : "#2D2D7A", color: "#fff", fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{tcEditing ? "Done Editing" : "Edit T&C"}</button>
        </div>
      </div>

      {tcEditing && (
        <div className="no-print" style={{ width: "100%", maxWidth: 820, background: "#fff", border: "1px solid #C8C0A0", borderRadius: 8, padding: 16, marginTop: 4 }}>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888", marginBottom: 8 }}>Edit your terms and conditions below. Changes save automatically.</div>
          <textarea value={tcText} onChange={e => { setTcText(e.target.value); saveTC(e.target.value); }} style={{ width: "100%", height: 400, fontFamily: "monospace", fontSize: 12, color: "#333", border: "1px solid #ddd", borderRadius: 6, padding: 12, outline: "none", resize: "vertical", lineHeight: 1.7 }} />
        </div>
      )}

      <div className="no-print" style={{ width: "100%", maxWidth: 820, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "rgba(192,57,43,0.06)", borderRadius: 8, border: "1px solid rgba(192,57,43,0.15)" }}>
        <div>
          <span style={{ fontFamily: "monospace", fontSize: 12, color: "#C0392B", fontWeight: 700 }}>Account</span>
          {user && <span style={{ fontFamily: "monospace", fontSize: 11, color: "#888", marginLeft: 8 }}>{user.email}</span>}
          {isAdmin && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#7A2D2D", marginLeft: 8, background: "rgba(122,45,45,0.1)", padding: "2px 6px", borderRadius: 4 }}>ADMIN</span>}
          {!isAdmin && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#2D2D7A", marginLeft: 8, background: "rgba(45,45,122,0.08)", padding: "2px 6px", borderRadius: 4 }}>{tenantPlan.plan?.toUpperCase()}</span>}
        </div>
        <button onClick={() => { setShowDeleteModal(true); setDeleteConfirmEmail(""); setDeleteError(""); }}
          style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #C0392B", background: "transparent", color: "#C0392B", fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          🗑 Delete Account
        </button>
      </div>

      <div className="tc-page" style={{ width: "100%", maxWidth: 820, background: "#fff", padding: "40px 48px", fontFamily: "Lato, sans-serif", fontSize: 12, color: "#333", lineHeight: 1.7 }}>
        <div style={{ textAlign: "center", marginBottom: 24, borderBottom: "2px solid #2D2D7A", paddingBottom: 16 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: "#2D2D7A", fontWeight: 700, letterSpacing: 1 }}>TERMS AND CONDITIONS OF SALE</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{doc.coName || "Company Name"} - ABN: {doc.coAbn || "XX XXX XXX XXX"}</div>
        </div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#444", lineHeight: 1.8 }}>{tcText}</div>
        <div style={{ marginTop: 24, borderTop: "1px solid #ccc", paddingTop: 12, fontSize: 10, color: "#888", textAlign: "center" }}>
          By accepting this invoice, the Buyer agrees to these Terms and Conditions. | {doc.coName || "Company"} | {doc.coPhone || ""} | {doc.coAddr || ""}
        </div>
      </div>

      {isQuote && (
        <div className="no-print" style={{ width: "100%", maxWidth: 820, background: "linear-gradient(135deg,#1A5C3A,#2E7D52)", borderRadius: "0 0 10px 10px", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontSize: 13, color: "rgba(255,255,255,0.85)" }}><strong style={{ color: "#fff" }}>This is a Quote</strong> - once approved, convert it to a Tax Invoice.</span>
          <button onClick={convertToInvoice} style={S.btn("#fff", "#1A5C3A")}>Convert to Invoice</button>
        </div>
      )}

      <div className="no-print" style={{ width: "100%", maxWidth: 820, marginTop: 16 }}>
        <button onClick={async () => {
          const opening = !drawerOpen; setDrawerOpen(opening);
          if (opening) { setLoading(true); const docs = await dbLoadDocuments(tenantId); setSaved(docs); setLoading(false); }
        }} style={{ width: "100%", background: "rgba(0,0,0,0.08)", border: "none", borderRadius: drawerOpen ? "8px 8px 0 0" : 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", cursor: "pointer", fontFamily: "Lato, sans-serif", fontSize: 14, color: "#4A3F00", fontWeight: 700 }}>
          <span>Saved Documents {saved.length > 0 ? "(" + saved.length + ")" : ""}</span>
          <span>{drawerOpen ? "▲" : "▼"}</span>
        </button>
        {drawerOpen && (
          <div style={{ background: "#fff", border: "1px solid #C8C0A0", borderTop: "none", borderRadius: "0 0 8px 8px", padding: 12 }}>
            {saved.length === 0
              ? <div style={{ textAlign: "center", color: "#8888CC", fontFamily: "monospace", fontSize: 12, padding: "20px 0" }}>No saved documents yet.</div>
              : saved.map(inv => {
                const iq = (inv.docType || "invoice") === "quote";
                const prefix = inv.prefix || (iq ? "QT" : "INV");
                const docNum = prefix + "-" + (inv.number || "---");
                const canDelete = isPremium;
                return (
                  <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: iq ? "#C47A00" : "#C0392B", fontFamily: "monospace" }}>
                        {docNum}
                        <span style={{ display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 4, marginLeft: 6, background: iq ? "#D4EEDC" : "#E0E0F8", color: iq ? "#1A5C3A" : "#2D2D7A", border: "1px solid " + (iq ? "#90C8A0" : "#9999CC") }}>{inv.convertedToInvoice ? "CONVERTED" : iq ? "QUOTE" : "INVOICE"}</span>
                        <span style={{ display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 4, marginLeft: 4, background: inv.payStatus === "paid" ? "#D1FAE5" : inv.payStatus === "overdue" ? "#FEE2E2" : "#FEF3C7", color: inv.payStatus === "paid" ? "#065F46" : inv.payStatus === "overdue" ? "#991B1B" : "#92400E" }}>{inv.payStatus || "unpaid"}</span>
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8888CC" }}>{inv.date} · {(inv.to || "").split("\n")[0] || "-"} · ${inv.grandTotal || "0.00"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {iq && !inv.convertedToInvoice && <button onClick={() => { loadDoc(inv); setTimeout(convertToInvoice, 200); }} style={S.btn("#1A5C3A")}>Convert</button>}
                      <button onClick={() => loadDoc(inv)} style={S.btn("#2D2D7A")}>Load</button>
                      <button onClick={() => deleteDoc(inv.id, docNum)} title={!canDelete ? "Upgrade to delete" : "Delete"}
                        style={{ ...S.btn(!canDelete ? "#ccc" : "#C0392B"), cursor: !canDelete ? "not-allowed" : "pointer", opacity: !canDelete ? 0.5 : 1 }}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            }
          </div>
        )}
      </div>
      <Toast msg={toast} />
    </div>
  );
}
