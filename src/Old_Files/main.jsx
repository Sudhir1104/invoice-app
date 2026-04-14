import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import Auth from './Auth.jsx'
import App from './App.jsx'
import Admin from './Admin.jsx'
import Onboarding from './Onboarding.jsx'

const ADMIN_EMAIL = "sudhir@bluesquaresolutions.com.au";

function Root() {
  const [session, setSession] = useState(undefined)   // undefined = still loading
  const [showAdmin, setShowAdmin] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)  // have we checked yet?
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [onboardingProfile, setOnboardingProfile] = useState(null)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        checkOnboarding(session.user.id, session.user.email)
      } else {
        setOnboardingChecked(true) // no session = show login, no need to check
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        checkOnboarding(session.user.id, session.user.email)
      } else {
        setShowAdmin(false)
        setNeedsOnboarding(false)
        setOnboardingChecked(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const checkOnboarding = async (userId, email) => {
    // Admin always skips onboarding
    if (email === ADMIN_EMAIL) {
      setNeedsOnboarding(false)
      setOnboardingChecked(true)
      return
    }

    try {
      const { data } = await supabase
        .from("user_settings")
        .select("onboarded")
        .eq("user_id", userId)
        .maybeSingle()

      setNeedsOnboarding(!data || !data.onboarded)
    } catch (e) {
      console.error("Onboarding check error:", e)
      setNeedsOnboarding(false) // on error, don't block the user
    } finally {
      setOnboardingChecked(true)
    }
  }

  const handleOnboardingComplete = (profile) => {
    setOnboardingProfile(profile)
    setNeedsOnboarding(false)
  }

  // ── Still loading session ──
  if (session === undefined || (session && !onboardingChecked)) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#8888CC", letterSpacing: 2 }}>
          Loading...
        </div>
      </div>
    )
  }

  // ── Not logged in → show login/signup ──
  if (!session) return <Auth />

  // ── Logged in but needs onboarding ──
  if (needsOnboarding && session.user.email !== ADMIN_EMAIL) {
    return <Onboarding user={session.user} onComplete={handleOnboardingComplete} />
  }

  // ── Admin panel ──
  if (showAdmin && session.user.email === ADMIN_EMAIL) {
    return <Admin user={session.user} onBack={() => setShowAdmin(false)} />
  }

  // ── Main app ──
  return (
    <>
      <App user={session.user} initialProfile={onboardingProfile} />
      {session.user.email === ADMIN_EMAIL && (
        <button
          onClick={() => setShowAdmin(true)}
          style={{
            position: "fixed", bottom: 20, right: 20, zIndex: 9000,
            padding: "10px 18px", borderRadius: 8,
            background: "#2D2D7A", color: "#fff",
            border: "none", fontFamily: "monospace", fontSize: 12,
            fontWeight: 700, cursor: "pointer",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)"
          }}>
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
