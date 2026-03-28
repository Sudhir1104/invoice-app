import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import Auth from './Auth.jsx'
import App from './App.jsx'
import Admin from './Admin.jsx'
import Onboarding from './Onboarding.jsx'

const ADMIN_EMAIL = "sudhir@bluesquaresolutions.com.au";

function Root() {
  const [session, setSession] = useState(undefined)
  const [showAdmin, setShowAdmin] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [onboardingProfile, setOnboardingProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) checkOnboarding(session.user.id, session.user.email)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) checkOnboarding(session.user.id, session.user.email)
      if (!session) { setShowAdmin(false); setNeedsOnboarding(false); }
    })

    return () => subscription.unsubscribe()
  }, [])

  const checkOnboarding = async (userId, email) => {
    if (email === ADMIN_EMAIL) { setNeedsOnboarding(false); return; }
    const { data } = await supabase
      .from("user_settings")
      .select("onboarded")
      .eq("user_id", userId)
      .maybeSingle();
    setNeedsOnboarding(!data || !data.onboarded);
  };

  const handleOnboardingComplete = (profile) => {
    setOnboardingProfile(profile);
    setNeedsOnboarding(false);
  };

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#8888CC", letterSpacing: 2 }}>Loading...</div>
      </div>
    )
  }

  if (!session) return <Auth />

  if (needsOnboarding && session.user.email !== ADMIN_EMAIL) {
    return <Onboarding user={session.user} onComplete={handleOnboardingComplete} />
  }

  if (showAdmin && session.user.email === ADMIN_EMAIL) {
    return <Admin user={session.user} onBack={() => setShowAdmin(false)} />
  }

  return (
    <>
      <App user={session.user} initialProfile={onboardingProfile} />
      {session.user.email === ADMIN_EMAIL && (
        <button onClick={() => setShowAdmin(true)}
          style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9000, padding: "10px 18px", borderRadius: 8, background: "#2D2D7A", color: "#fff", border: "none", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
          ⚙ Admin
        </button>
      )}
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
