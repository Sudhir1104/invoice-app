import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { TenantProvider } from "./TenantContext";
import Auth from "./Auth";
import Onboarding from "./Onboarding";
import InviteAccept from "./InviteAccept";
import App from "./App";
import Admin from "./Admin";
import TeamSettings from "./TeamSettings";

export default function AppRoot() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  const [screen, setScreen] = useState("app"); // app | admin | team
  const [inviteToken, setInviteToken] = useState(null);

  // Check for invite token in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) setInviteToken(token);
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

  // Not logged in — show invite accept or auth
  if (!user) {
    if (inviteToken) return <InviteAccept token={inviteToken} />;
    // Redirect to pricing/landing page if not on /app route
    if (window.location.pathname === "/" || window.location.pathname === "") {
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

  // Main app with tenant context
  return (
    <TenantProvider user={user}>
      {screen === "admin" && <Admin user={user} onBack={() => setScreen("app")} />}
      {screen === "team" && <TeamSettings user={user} onBack={() => setScreen("app")} />}
      {screen === "app" && <App user={user} onShowAdmin={() => setScreen("admin")} onShowTeam={() => setScreen("team")} />}
    </TenantProvider>
  );
}
