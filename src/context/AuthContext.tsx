'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured, db } from '@/lib/firebase-client';
import { UserRole } from '@/lib/types';
import { useToast } from './ToastContext';

interface AuthContextType {
  user: User | null;
  role: UserRole;
  isSuperAdmin: boolean;
  loading: boolean;
  roleLoading: boolean;
  isSigningIn: boolean;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: 'viewer',
  isSuperAdmin: false,
  loading: true,
  roleLoading: false,
  isSigningIn: false,
  isConfigured: false,
  signInWithGoogle: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
});

const SUPER_ADMIN_EMAILS = [
  'admin@gmahk-galilea.org',
  (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || '').toLowerCase().trim(),
].filter(Boolean);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>('viewer');
  const [loading, setLoading] = useState<boolean>(() => isFirebaseConfigured());
  const [roleLoading, setRoleLoading] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const isSigningInRef = useRef(false);
  const { showToast } = useToast();

  const isConfigured = isFirebaseConfigured();

  useEffect(() => {
    if (!auth) return;

    let isMounted = true;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!isMounted) return;
      setUser(currentUser);
      if (currentUser) {
        setRoleLoading(true);
        const email = currentUser.email?.toLowerCase().trim() || '';
        const isSuper = SUPER_ADMIN_EMAILS.includes(email);

        let resolvedRole: UserRole = isSuper ? 'admin' : 'viewer';

        // cek peran di firestore jika pengguna bukan super admin
        if (!isSuper && db) {
          try {
            const { doc, getDoc } = await import('firebase/firestore');
            const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              if (data?.role === 'admin') {
                resolvedRole = 'admin';
              }
            }
          } catch (err) {
            console.warn('Could not query Firestore user profile:', err);
          }
        }

        if (isMounted) {
          setRole(resolvedRole);
          setRoleLoading(false);
          setLoading(false);
        }
      } else {
        if (isMounted) {
          setRole('viewer');
          setRoleLoading(false);
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    if (isSigningInRef.current) {
      return;
    }

    if (!auth || !isFirebaseConfigured()) {
      console.warn('[Auth] Google Sign-In triggered but Firebase client credentials are not configured in environment variables.');
      showToast({
        type: 'error',
        message: 'Layanan Masuk Belum Siap',
        description: 'Sistem autentikasi sedang disiapkan oleh administrator. Silakan coba beberapa saat lagi.',
      });
      return;
    }

    isSigningInRef.current = true;
    setIsSigningIn(true);

    try {
      await signInWithPopup(auth, googleProvider);
      showToast({
        type: 'success',
        message: 'Selamat Datang',
        description: 'Anda berhasil masuk ke sistem dokumentasi GMAHK Galilea.',
      });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string; name?: string };
      const code = err?.code || 'unknown-error';
      const message = err?.message || 'Terjadi kesalahan internal.';
      
      console.error('[GALILEA AUTH ERROR]', {
        code,
        message,
        name: err?.name,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        hostname: typeof window !== 'undefined' ? window.location.hostname : undefined,
        hasApiKey: Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
        hasAppId: Boolean(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
        hasMessagingSenderId: Boolean(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
      });

      if (code === 'auth/popup-closed-by-user') {
        showToast({
          type: 'info',
          message: 'Login Dibatalkan',
          description: 'Jendela masuk Google ditutup sebelum proses selesai.',
        });
      } else if (code === 'auth/cancelled-popup-request') {
        // pembatalan popup yang tertangani tidak perlu menampilkan pesan
      } else if (code === 'auth/popup-blocked') {
        showToast({
          type: 'warning',
          message: 'Popup Diblokir Browser',
          description: 'Browser Anda memblokir popup Google Sign-In. Mohon izinkan popup di browser lalu coba lagi.',
        });
      } else if (code === 'auth/operation-not-allowed') {
        showToast({
          type: 'error',
          message: 'Provider Google Belum Aktif',
          description: 'Metode login Google belum diaktifkan di Firebase Console.',
        });
      } else if (code === 'auth/unauthorized-domain') {
        showToast({
          type: 'error',
          message: 'Domain Belum Diizinkan',
          description: 'Domain belum didaftarkan di Firebase Console (Authentication > Settings > Authorized domains).',
        });
      } else if (code === 'auth/invalid-api-key') {
        showToast({
          type: 'error',
          message: 'Kunci API Firebase Tidak Valid',
          description: 'Kunci API Firebase tidak sesuai atau belum diaktifkan.',
        });
      } else if (code === 'auth/network-request-failed') {
        showToast({
          type: 'error',
          message: 'Koneksi Terputus',
          description: 'Gagal terhubung ke server Firebase. Periksa koneksi internet Anda.',
        });
      } else {
        showToast({
          type: 'error',
          message: 'Login Belum Berhasil',
          description: `Kode: ${code}\nPesan: ${message}`,
        });
      }
    } finally {
      isSigningInRef.current = false;
      setIsSigningIn(false);
    }
  };

  const signOut = async () => {
    if (!auth) return;
    try {
      await fbSignOut(auth);
      showToast({
        type: 'info',
        message: 'Keluar Berhasil',
        description: 'Sesi akun Anda telah ditutup.',
      });
    } catch {
      // sesi lokal tetap direset jika proses logout firebase gagal
    }
    setUser(null);
    setRole('viewer');
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!user) return null;
    try {
      return await user.getIdToken();
    } catch (err) {
      console.error('Failed to get user ID token:', err);
      return null;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isSuperAdmin: role === 'admin',
        loading,
        roleLoading,
        isSigningIn,
        isConfigured,
        signInWithGoogle,
        signOut,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
