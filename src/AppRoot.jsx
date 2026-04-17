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

export default function AppRoot() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  const [screen, setScreen] = useState("app");
  const [inviteToken, setInviteToken] = useState(null);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) setInviteToken(token);

    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=email_change")) {
      setIsResetPassword(true);
    }
    if (params.get("type") === "recovery") {
      setIsResetPassword(true);
    }

    const checkout = params.get("checkout");
    if (checkout === "success") {
      setCheckoutStatus("success");
      window.history.replaceState({}, "", "/");
    } else if (checkout === "cancelled") {
      setCheckoutStatus("cancelled");
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
      setUser(session?.user ?? null);
      if (session?.user) checkOnboarded(session.user.id);
      else { setAuthLoading(false); setOnboarded(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkOnboarded = async (userId) => {
    const { data } = await supabase
      .from("user_settings")
      .select("onboarded, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    setOnboarded(!!(data?.onboarded && data?.tenant_id));
    setAuthLoading(false);
  };

  // Poll until onboarded = true (used after Stripe checkout redirect)
  const waitForOnboarding = async (userId, maxAttempts = 10) => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const { data } = await supabase
        .from("user_settings")
        .select("onboarded, tenant_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (data?.onboarded && data?.tenant_id) {
        setOnboarded(true);
        setCheckoutStatus(null);
        return;
      }
    }
    // After max attempts — mark onboarded anyway and show app
    await supabase.from("user_settings").update({ onboarded: true }).eq("user_id", userId);
    setOnboarded(true);
    setCheckoutStatus(null);
  };

  // When checkout=success detected and user is logged in — start polling
  useEffect(() => {
    if (checkoutStatus === "success" && user && !onboarded) {
      waitForOnboarding(user.id);
    }
  }, [checkoutStatus, user]);

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#8888CC" }}>Loading...</div>
      </div>
    );
  }

  // Checkout success — waiting for webhook to process
  if (checkoutStatus === "success" && !onboarded) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F8FF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 24, color: "#2D2D7A", marginBottom: 12 }}>Payment successful!</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#8888CC", marginBottom: 24, lineHeight: 1.6 }}>
            Setting up your account...<br />This takes just a moment.
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#2D2D7A", opacity: 0.3, animation: "pulse 1.2s ease-in-out " + (i * 0.2) + "s infinite" }} />
            ))}
          </div>
          <style>{"@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }"}</style>
        </div>
      </div>
    );
  }

  // Checkout cancelled — go back to pricing
  if (checkoutStatus === "cancelled") {
    window.location.href = "/pricing.html";
    return null;
  }

  // Show reset password screen if coming from reset email
  if (isResetPassword) return <ResetPassword />;

  // Not logged in — show invite accept or auth
  if (!user) {
    if (inviteToken) return <InviteAccept token={inviteToken} />;
    // Check if user came from Sign In button (has ?signin=true)
    const params = new URLSearchParams(window.location.search);
    const isSignIn = params.get("signin") === "true";
    // Redirect to pricing page unless they explicitly want to sign in
    if (!isSignIn) {
      window.location.href = "/pricing.html";
      return null;
    }
    return <Auth />;
  }

  // Logged in but has invite token — accept invite
  if (inviteToken) {
    return <InviteAccept token={inviteToken} user={user} onAccepted={() => { setInviteToken(null); setOnboarded(true); window.history.replaceState({}, "", "/"); }} />;
  }

  // Not onboarded yet
  if (!onboarded) {
    return <Onboarding user={user} onComplete={() => setOnboarded(true)} />;
  }

  // Main app — reset to "app" screen when user changes
  // (prevents stale admin/team screen if re-login happens)
  return (
    <TenantProvider user={user}>
      {screen === "admin" && (
        <Admin user={user} onBack={() => setScreen("app")} />
      )}
      {screen === "team" && (
        <TeamSettings user={user} onBack={() => setScreen("app")} />
      )}
      {screen === "app" && (
        <App
          user={user}
          onShowAdmin={() => setScreen("admin")}
          onShowTeam={() => setScreen("team")}
        />
      )}
    </TenantProvider>
  );
}