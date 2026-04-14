import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "./supabase";

const TenantContext = createContext(null);

export function TenantProvider({ user, children }) {
  const [tenant, setTenant] = useState(null);
  const [memberRole, setMemberRole] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadTenantData();
  }, [user]);

  const loadTenantData = async () => {
    setLoading(true);
    try {
      // Get user settings to find their tenant
      const { data: settings } = await supabase
        .from("user_settings")
        .select("*, tenants(*)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (settings?.tenants) {
        setTenant(settings.tenants);
        setMemberRole(settings.role);

        // Load team members
        const { data: memberData } = await supabase
          .from("tenant_members")
          .select("*")
          .eq("tenant_id", settings.tenants.id)
          .eq("is_active", true);

        // Load emails separately from user_settings
        if (memberData && memberData.length > 0) {
          const userIds = memberData.map(m => m.user_id);
          const { data: userSettingsData } = await supabase
            .from("user_settings")
            .select("user_id, email")
            .in("user_id", userIds);
          
          const emailMap = {};
          (userSettingsData || []).forEach(u => { emailMap[u.user_id] = u.email; });
          
          const membersWithEmail = memberData.map(m => ({
            ...m,
            user_settings: { email: emailMap[m.user_id] || "" }
          }));
          setMembers(membersWithEmail);
        } else {
          setMembers([]);
        }
      }
    } catch (e) {
      console.error("Load tenant error:", e);
    } finally {
      setLoading(false);
    }
  };

  const refreshTenant = () => loadTenantData();

  const isOwner = memberRole === "owner";
  const isAdmin = memberRole === "owner" || memberRole === "admin";
  const isStaff = !!memberRole;

  return (
    <TenantContext.Provider value={{
      tenant, setTenant, memberRole, members,
      isOwner, isAdmin, isStaff, loading, refreshTenant
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}
