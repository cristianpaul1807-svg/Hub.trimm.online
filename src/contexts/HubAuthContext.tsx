import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';

interface HubAuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const HubAuthContext = createContext<HubAuthContextType | undefined>(undefined);

export function HubAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) throw error;
      setProfile(data);
    } catch (err) {
      console.error("Error fetching Hub profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, pass: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;

      // Verify that user exists
      if (data.user) {
        // Fetch connections
        const { count, error: connError } = await supabase
          .from('hub_connections')
          .select('*', { count: 'exact', head: true })
          .eq('hub_owner_id', data.user.id);

        if (connError) throw connError;
        
        // Fetch profile
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', data.user.id)
          .maybeSingle();

        // Check if OWNER or has connections
        if (prof?.role !== 'OWNER' && (count ?? 0) === 0) {
          await supabase.auth.signOut();
          return { success: false, error: 'no_businesses' };
        }
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'auth_failed' };
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard',
      }
    });
  };

  const logout = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setLoading(false);
  };

  const value = {
    user,
    profile,
    loading,
    login,
    loginWithGoogle,
    logout,
  };

  return <HubAuthContext.Provider value={value}>{children}</HubAuthContext.Provider>;
}

export const useHubAuth = () => {
  const context = useContext(HubAuthContext);
  if (!context) throw new Error('useHubAuth must be used within HubAuthProvider');
  return context;
};
