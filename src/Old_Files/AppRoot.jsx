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
  const [screen, setScreen] = useState("app"); // app | admin | team
  const [inviteToken, setInviteToken] = useState(null);
  const [isResetPassword, setIsResetPassword] = useState(false);

  // Check for invite token, signin param, or password reset in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) setInviteToken(token);

    // Detect Supabase password recovery from URL hash
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=email_change")) {
      setIsResetPassword(true);
    }
    // Also detect from search params (some Supabase configs use query params)
    if (params.get("type") === "recovery") {
      setIsResetPassword(true);
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

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#8888CC" }}>Loading...</div>
      </div>
    );
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
