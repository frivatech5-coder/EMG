import React, { useState } from 'react';
import {
  Lock,
  Mail,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  RefreshCw,
  ShieldCheck,
  Database,
  BellRing,
} from 'lucide-react';
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
    <div className="min-h-screen bg-[#09090B] text-zinc-100 grid grid-cols-1 lg:grid-cols-12">
      {/* Left Studio Brand Column */}
      <div className="hidden lg:flex lg:col-span-5 xl:col-span-6 flex-col justify-between p-10 xl:p-14 border-r border-white/[0.07] bg-[#0B0C10]">
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-lg p-1 border border-white/15 shrink-0">
            <img
              src="/assets/aistudio/emglogo2_dbb111d9.png"
              alt="EMG WEB SOLUTIONS — Design, Develop, Grow"
              className="h-11 w-11 object-contain"
            />
          </div>
          <div>
            <span className="block font-display text-sm font-semibold text-white tracking-tight">
              EMG WEB SOLUTIONS
            </span>
            <span className="block text-[11px] text-zinc-500">
              Operations &amp; Billing Platform
            </span>
          </div>
        </div>

        <div className="space-y-8 max-w-md">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">
              Enterprise Admin Console
            </p>
            <h1 className="font-display text-3xl xl:text-4xl font-semibold text-white tracking-tight leading-[1.15]">
              Client operations, recurring billing, and CRM in one place.
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Manage active client deployments, monthly subscriptions, verified M-Pesa and bank ledgers, invoices, and prospect pipelines in real time.
            </p>
          </div>

          <div className="space-y-3.5 pt-4 border-t border-white/[0.07]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-white">Role-Restricted Authentication</p>
                <p className="text-xs text-zinc-500">
                  Enforced via Firebase Authentication and Firestore administrator allowlists.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Database className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-white">Live Cloud Firestore Ledger</p>
                <p className="text-xs text-zinc-500">
                  Atomic duplicate-reference protection on payments and immutable audit logs.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <BellRing className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-white">Africa/Nairobi Automated Alerts</p>
                <p className="text-xs text-zinc-500">
                  Real-time grace deadlines, subscription renewals, and lead follow-ups.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-500">
          Project: <span className="font-mono text-zinc-400">{firebaseProjectInfo.projectId}</span>
        </p>
      </div>

      {/* Right Authentication Form Panel */}
      <div className="lg:col-span-7 xl:col-span-6 flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="max-w-md w-full mx-auto space-y-6">
          {/* Mobile Brand Header */}
          <div className="lg:hidden text-center space-y-3">
            <div className="inline-flex items-center justify-center bg-white rounded-xl p-1.5 border border-white/15 mx-auto">
              <img
                src="/assets/aistudio/emglogo2_dbb111d9.png"
                alt="EMG WEB SOLUTIONS — Design, Develop, Grow"
                className="h-20 w-20 object-contain"
              />
            </div>
            <h1 className="font-display text-xl font-semibold text-white tracking-tight">
              EMG WEB SOLUTIONS
            </h1>
          </div>

          <div className="space-y-1">
            <h2 className="font-display text-2xl font-semibold text-white tracking-tight">
              Administrator Sign In
            </h2>
            <p className="text-sm text-zinc-400">
              Sign in with an authorized administrator account to access the workspace.
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

          <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-6 sm:p-7 space-y-5 shadow-2xl">
            {user && !isAuthorizedAdmin ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/25 space-y-2">
                  <p className="text-sm font-semibold text-red-300">Administrator Access Denied</p>
                  <p className="text-xs text-zinc-300 leading-relaxed">
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
                    className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg border border-white/10 hover:bg-white/[0.05] text-zinc-300 transition-colors"
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
                    <label htmlFor="admin-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Administrator Email
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="admin-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@emgwebsolutions.co.ke"
                        className="w-full pl-10 pr-3.5 py-2.5 min-h-[42px] text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="admin-password" className="block text-xs font-medium text-zinc-300">
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
                      <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="admin-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full pl-10 pr-3.5 py-2.5 min-h-[42px] text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !isFirebaseConfigured}
                    className="w-full py-2.5 px-4 min-h-[42px] text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Authenticating...' : 'Sign In'}
                  </button>
                </form>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-white/[0.08]" />
                  <span className="shrink-0 mx-3 text-[11px] text-zinc-500 uppercase tracking-wider">or</span>
                  <div className="flex-grow border-t border-white/[0.08]" />
                </div>

                <button
                  type="button"
                  onClick={() => void handleGoogleLogin()}
                  disabled={submitting || !isFirebaseConfigured}
                  className="w-full py-2.5 px-4 min-h-[42px] text-sm font-medium bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-white rounded-lg transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50"
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

          <p className="lg:hidden text-center text-xs text-zinc-500">
            Firebase Project: <span className="font-mono text-zinc-400">{firebaseProjectInfo.projectId}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
