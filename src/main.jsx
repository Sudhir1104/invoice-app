import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import Auth from './Auth.jsx'
import App from './App.jsx'
import Admin from './Admin.jsx'

const ADMIN_EMAIL = "sudhir@bluesquaresolutions.com.au";

function Root() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [showAdmin, setShowAdmin] = useState(false)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) setShowAdmin(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Loading state
  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#E8E4D0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#8888CC", letterSpacing: 2 }}>
          Loading...
        </div>
      </div>
    )
  }

  // Not logged in → show login screen
  if (!session) {
    return <Auth />
  }

  // Admin panel
  if (showAdmin && session.user.email === ADMIN_EMAIL) {
    return <Admin user={session.user} onBack={() => setShowAdmin(false)} />
  }

  // Logged in → show app, with admin button for admin user
  return (
    <>
      <App user={session.user} />
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
