import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthChange, getUserPanelPermissions } from '../services/firebase';
import {
  canAccessPath as pathAllowed,
  canWrite as moduleWritable,
  type PanelPermissions,
  type PanelRole,
  type WriteModule,
} from '../auth/permissions';

type AuthContextValue = {
  panelRole: PanelRole | null;
  permissions: PanelPermissions | null;
  homePath: string;
  loading: boolean;
  canAccessPath: (pathname: string) => boolean;
  canWrite: (module: WriteModule) => boolean;
};

const AuthContext = createContext<AuthContextValue>({
  panelRole: null,
  permissions: null,
  homePath: '/',
  loading: true,
  canAccessPath: () => false,
  canWrite: () => false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [permissions, setPermissions] = useState<PanelPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      if (user) {
        try {
          const perms = await getUserPanelPermissions(user.uid);
          setPermissions(perms);
        } catch {
          setPermissions(null);
        }
      } else {
        setPermissions(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const homePath = permissions?.homePath || '/';
    return {
      panelRole: permissions?.role ?? null,
      permissions,
      homePath,
      loading,
      canAccessPath: (pathname: string) => (permissions ? pathAllowed(permissions, pathname) : false),
      canWrite: (module: WriteModule) => moduleWritable(permissions, module),
    };
  }, [permissions, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
};
