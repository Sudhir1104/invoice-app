import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import Auth from './Auth.jsx'
import App from './App.jsx'

function Root() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
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

  // Logged in → show app
  return <App user={session.user} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
