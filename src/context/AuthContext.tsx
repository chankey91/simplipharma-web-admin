import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthChange, getUserPanelRole } from '../services/firebase';
import type { PanelRole } from '../auth/permissions';

type AuthContextValue = {
  panelRole: PanelRole | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ panelRole: null, loading: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [panelRole, setPanelRole] = useState<PanelRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      if (user) {
        try {
          const role = await getUserPanelRole(user.uid);
          setPanelRole(role);
        } catch {
          setPanelRole(null);
        }
      } else {
        setPanelRole(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ panelRole, loading }}>{children}</AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
