import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { verifyAdminAccess } from '../services/emgFirestore';
import type { AdminUser } from '../types/domain';

interface AuthContextValue {
  user: User | null;
  adminProfile: AdminUser | null;
  isAuthorizedAdmin: boolean;
  authReady: boolean;
  authError: string | null;
  clearAuthError: () => void;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  resendVerification: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapFirebaseAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid administrator email or password.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many failed login attempts. Wait a few minutes before trying again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Enable Email/Password there or sign in with Google below.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing authentication.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Firebase Authentication.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed.';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [adminProfile, setAdminProfile] = useState<AdminUser | null>(null);
  const [isAuthorizedAdmin, setIsAuthorizedAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setAdminProfile(null);
        setIsAuthorizedAdmin(false);
        setAuthReady(true);
        return;
      }

      setUser(firebaseUser);
      try {
        const result = await verifyAdminAccess(firebaseUser);
        setAdminProfile(result.adminProfile);
        setIsAuthorizedAdmin(result.authorized);
        if (!result.authorized && result.reason) {
          setAuthError(result.reason);
        } else {
          setAuthError(null);
        }
      } catch (err) {
        setIsAuthorizedAdmin(false);
        setAdminProfile(null);
        setAuthError(err instanceof Error ? err.message : 'Unable to verify administrator role.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const result = await verifyAdminAccess(cred.user);
      if (!result.authorized) {
        setAuthError(result.reason || 'Access denied.');
      }
    } catch (error) {
      const msg = mapFirebaseAuthError(error);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const loginWithGoogle = async () => {
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      const result = await verifyAdminAccess(cred.user);
      if (!result.authorized) {
        setAuthError(result.reason || 'Access denied.');
      }
    } catch (error) {
      const msg = mapFirebaseAuthError(error);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resendVerification = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error) {
      const msg = mapFirebaseAuthError(error);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    setAuthError(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        adminProfile,
        isAuthorizedAdmin,
        authReady,
        authError,
        clearAuthError: () => setAuthError(null),
        loginWithEmail,
        loginWithGoogle,
        resendVerification,
        requestPasswordReset,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
