import React, { useState } from 'react';
import { Lock, Mail, AlertCircle, CheckCircle2, ShieldAlert, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isFirebaseConfigured, firebaseProjectInfo } from '../lib/firebase';

export function LoginPage() {
  const {
    user,
    isAuthorizedAdmin,
    authError,
    loginWithEmail,
    loginWithGoogle,
    resendVerification,
    requestPasswordReset,
    logout,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setInfoMessage(null);
    if (!email.trim() || !password) {
      setLocalError('Enter both administrator email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await loginWithEmail(email, password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLocalError(null);
    setInfoMessage(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    setLocalError(null);
    setInfoMessage(null);
    if (!email.trim()) {
      setLocalError('Enter your administrator email address first to send a password reset link.');
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setInfoMessage(`Password reset email sent to ${email.trim()}.`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to send reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setLocalError(null);
    setInfoMessage(null);
    setSubmitting(true);
    try {
      await resendVerification();
      setInfoMessage('Verification email sent. Check your inbox and reload once verified.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to send verification email.');
    } finally {
      setSubmitting(false);
    }
  };

  const displayedError = localError || authError;

  return (
    <div className="min-h-screen bg-[#09090B] text-slate-100 flex flex-col justify-center px-4 py-10">
      <div className="max-w-md w-full mx-auto space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center bg-white rounded-2xl px-4 py-2.5 shadow-lg border border-white/15 mx-auto">
            <img
              src="/assets/aistudio/emglogo0_fdf409c7.png"
              alt="EMG WEB SOLUTIONS — Design, Develop, Grow"
              className="h-20 sm:h-24 w-auto object-contain"
            />
          </div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            EMG WEB SOLUTIONS
          </h1>
          <p className="text-sm text-slate-400">
            Authorized Administrator Business Management Console
          </p>
        </div>

        {!isFirebaseConfigured && (
          <div className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-4 space-y-2 text-sm text-amber-200">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Firebase Configuration Required</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-100/90">
              Set your Firebase web credentials in <code className="font-mono">.env</code> or{' '}
              <code className="font-mono">firebase-applet-config.json</code> before signing in.
            </p>
          </div>
        )}

        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 sm:p-7 space-y-5 shadow-2xl">
          {user && !isAuthorizedAdmin ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/25 space-y-2">
                <p className="text-sm font-semibold text-red-300">Administrator Access Denied</p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Signed in as <span className="font-mono text-white">{user.email}</span>.{' '}
                  {displayedError || 'This account does not have active EMG administrator privileges.'}
                </p>
              </div>

              {!user.emailVerified && (
                <button
                  type="button"
                  onClick={() => void handleResendVerification()}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  Resend Email Verification Link
                </button>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Recheck Access
                </button>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border border-white/10 hover:bg-white/[0.05] text-slate-300 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <>
              {displayedError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-200 leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{displayedError}</span>
                </div>
              )}

              {infoMessage && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{infoMessage}</span>
                </div>
              )}

              <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-4">
                <div>
                  <label htmlFor="admin-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Administrator Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="admin-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@emgwebsolutions.co.ke"
                      className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="admin-password" className="block text-xs font-medium text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => void handlePasswordReset()}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="admin-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !isFirebaseConfigured}
                  className="w-full py-2.5 px-4 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Authenticating...' : 'Sign In with Email'}
                </button>
              </form>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-white/[0.08]" />
                <span className="shrink-0 mx-3 text-xs text-slate-500">or</span>
                <div className="flex-grow border-t border-white/[0.08]" />
              </div>

              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                disabled={submitting || !isFirebaseConfigured}
                className="w-full py-2.5 px-4 text-sm font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 text-white rounded-lg transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
                  />
                </svg>
                <span>Continue with Google Admin Account</span>
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-500">
          Firebase Project: <span className="font-mono text-slate-400">{firebaseProjectInfo.projectId}</span>
        </p>
      </div>
    </div>
  );
}
