import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  UserPlus,
  Shield,
  BellRing,
  Smartphone,
  Send,
  KeyRound,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/ToastContext';
import { saveAdminProfile, saveBusinessSettings } from '../services/emgFirestore';
import {
  deleteFcmToken,
  resolveNotificationPreferences,
  toggleFcmTokenEnabled,
} from '../services/notificationsEngine';
import {
  enableBrowserPushNotifications,
  getBrowserNotificationPermission,
  sendLocalBrowserNotificationPreview,
  triggerServerTestFcmPush,
} from '../lib/messaging';
import { ENV_VAPID_KEY, firebaseProjectInfo } from '../lib/firebase';
import { FIELD_LIMITS, isValidUrlOrEmpty } from '../lib/validation';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type AdminRole,
  type NotificationPreferences,
  type NotificationPriority,
  type SubscriptionPackage,
} from '../types/domain';

import { TableSkeleton } from '../components/ui/EmptyState';

export function SettingsPage() {
  const { settings, admins, fcmTokens, loading } = useData();
  const { user, adminProfile } = useAuth();
  const { showToast } = useToast();

  const [businessName, setBusinessName] = useState(settings.businessName);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || '');
  const [businessEmail, setBusinessEmail] = useState(settings.businessEmail || '');
  const [businessPhone, setBusinessPhone] = useState(settings.businessPhone || '');
  const [businessAddress, setBusinessAddress] = useState(settings.businessAddress || '');
  const [currency, setCurrency] = useState(settings.currency || 'KES');
  const [graceDays, setGraceDays] = useState(settings.defaultGracePeriodDays ?? 7);
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix || 'EMG-INV');
  const [nextInvoiceSeq, setNextInvoiceSeq] = useState(settings.nextInvoiceSequence || 1001);
  const [paymentInstructions, setPaymentInstructions] = useState(
    settings.paymentInstructions || ''
  );
  const [packages, setPackages] = useState<SubscriptionPackage[]>(settings.packages);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    resolveNotificationPreferences(settings)
  );
  const [graceDaysInput, setGraceDaysInput] = useState(
    resolveNotificationPreferences(settings).graceReminderDays.join(', ')
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Web Push (FCM) Controls
  const [enablingPush, setEnablingPush] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [browserPermission, setBrowserPermission] = useState(getBrowserNotificationPermission());

  // Admin Profile & Team State
  const [myDisplayName, setMyDisplayName] = useState(
    adminProfile?.displayName || user?.displayName || ''
  );
  const [myPhone, setMyPhone] = useState(adminProfile?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<AdminRole>('admin');
  const [addingAdmin, setAddingAdmin] = useState(false);

  useEffect(() => {
    setBusinessName(settings.businessName);
    setLogoUrl(settings.logoUrl || '');
    setBusinessEmail(settings.businessEmail || '');
    setBusinessPhone(settings.businessPhone || '');
    setBusinessAddress(settings.businessAddress || '');
    setCurrency(settings.currency || 'KES');
    setGraceDays(settings.defaultGracePeriodDays ?? 7);
    setInvoicePrefix(settings.invoicePrefix || 'EMG-INV');
    setNextInvoiceSeq(settings.nextInvoiceSequence || 1001);
    setPaymentInstructions(settings.paymentInstructions || '');
    setPackages(settings.packages);
    const resolved = resolveNotificationPreferences(settings);
    setNotifPrefs(resolved);
    setGraceDaysInput(resolved.graceReminderDays.join(', '));
  }, [settings]);

  useEffect(() => {
    if (adminProfile) {
      setMyDisplayName(adminProfile.displayName);
      setMyPhone(adminProfile.phone || '');
    }
  }, [adminProfile]);

  const handleAddPackage = () => {
    if (packages.length >= 20) {
      showToast('Maximum of 20 subscription packages allowed.', 'error');
      return;
    }
    setPackages((prev) => [
      ...prev,
      {
        id: `pkg-${Date.now().toString(36)}`,
        name: 'NEW PACKAGE',
        monthlyPrice: 1000,
        description: '',
      },
    ]);
  };

  const handleUpdatePackage = (idx: number, patch: Partial<SubscriptionPackage>) => {
    setPackages((prev) => prev.map((pkg, i) => (i === idx ? { ...pkg, ...patch } : pkg)));
  };

  const handleRemovePackage = (idx: number) => {
    if (packages.length <= 1) {
      showToast('At least one subscription package must remain configured.', 'error');
      return;
    }
    setPackages((prev) => prev.filter((_, i) => i !== idx));
  };

  const togglePushPriority = (priority: NotificationPriority) => {
    setNotifPrefs((prev) => {
      const exists = prev.pushPriorities.includes(priority);
      const next = exists
        ? prev.pushPriorities.filter((p) => p !== priority)
        : [...prev.pushPriorities, priority];
      return {
        ...prev,
        pushPriorities: next.length > 0 ? next : ['Critical'],
      };
    });
  };

  const parseGraceDaysList = (raw: string): number[] => {
    const parsed = raw
      .split(',')
      .map((s) => Math.round(Number(s.trim())))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 90);
    return parsed.length > 0
      ? Array.from(new Set(parsed)).sort((a, b) => b - a)
      : DEFAULT_NOTIFICATION_PREFERENCES.graceReminderDays;
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) {
      showToast('Business name is required.', 'error');
      return;
    }
    if (!isValidUrlOrEmpty(logoUrl)) {
      showToast('Logo URL must start with http:// or https://', 'error');
      return;
    }
    if (packages.some((p) => !p.name.trim())) {
      showToast('Every subscription package must have a name.', 'error');
      return;
    }

    const parsedGraceIntervals = parseGraceDaysList(graceDaysInput);
    const updatedNotifPrefs: NotificationPreferences = {
      ...notifPrefs,
      graceReminderDays: parsedGraceIntervals,
    };

    setSavingSettings(true);
    try {
      await saveBusinessSettings({
        businessName,
        logoUrl,
        businessEmail,
        businessPhone,
        businessAddress,
        currency,
        defaultGracePeriodDays: graceDays,
        invoicePrefix,
        nextInvoiceSequence: nextInvoiceSeq,
        paymentInstructions,
        packages,
        notificationPreferences: updatedNotifPrefs,
      });
      setGraceDaysInput(parsedGraceIntervals.join(', '));
      showToast('Business & notification settings saved to Firestore.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings.', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleEnableBrowserPush = async () => {
    setEnablingPush(true);
    try {
      const result = await enableBrowserPushNotifications({
        vapidPublicKey: notifPrefs.vapidPublicKey || ENV_VAPID_KEY,
      });
      setBrowserPermission(result.permission);
      showToast(result.message, result.ok ? 'success' : result.reason === 'missing_vapid_key' ? 'info' : 'error');
    } finally {
      setEnablingPush(false);
    }
  };

  const handleTestLocalNotification = async () => {
    setTestingPush(true);
    try {
      const res = await sendLocalBrowserNotificationPreview({
        title: 'EMG Web Solutions — Local Browser Test',
        body: 'System notifications are permitted on this browser. Deploy Cloud Functions + VAPID key for background FCM push.',
        targetSection: 'reminders',
      });
      setBrowserPermission(getBrowserNotificationPermission());
      showToast(res.message, res.ok ? 'success' : 'error');
    } finally {
      setTestingPush(false);
    }
  };

  const handleTestCloudFunctionPush = async () => {
    const activeToken = fcmTokens.find((t) => t.enabled);
    if (!activeToken) {
      showToast('Register an active FCM device token first using "Enable Browser Push".', 'error');
      return;
    }
    setTestingPush(true);
    try {
      const res = await triggerServerTestFcmPush(activeToken.token);
      showToast(res.message, res.sent ? 'success' : 'info');
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Cloud Function push test failed (ensure Cloud Functions are deployed): ${err.message}`
          : 'Cloud Function push test failed.',
        'error'
      );
    } finally {
      setTestingPush(false);
    }
  };

  const handleSaveMyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!myDisplayName.trim()) {
      showToast('Display name is required.', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      await saveAdminProfile({
        uid: user.uid,
        email: user.email || '',
        displayName: myDisplayName,
        role: adminProfile?.role || 'super_admin',
        active: true,
        phone: myPhone,
      });
      showToast('Administrator profile updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = newAdminUid.trim();
    if (!uid || !newAdminEmail.trim() || !newAdminName.trim()) {
      showToast('Firebase Auth UID, email, and display name are required.', 'error');
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
      showToast('Firebase Auth UID may only contain letters, numbers, underscores, and hyphens.', 'error');
      return;
    }
    setAddingAdmin(true);
    try {
      await saveAdminProfile({
        uid: newAdminUid.trim(),
        email: newAdminEmail.trim(),
        displayName: newAdminName.trim(),
        role: newAdminRole,
        active: true,
      });
      showToast(`Authorized administrator ${newAdminEmail.trim()}.`, 'success');
      setNewAdminUid('');
      setNewAdminEmail('');
      setNewAdminName('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to authorize administrator.', 'error');
    } finally {
      setAddingAdmin(false);
    }
  };

  const resolvedVapid = (notifPrefs.vapidPublicKey || ENV_VAPID_KEY || '').trim();

  if (loading) {
    return <TableSkeleton rows={6} />;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Business, Invoice, Package & Notification Settings */}
      <form onSubmit={(e) => void handleSaveSettings(e)} className="space-y-6">
        <section className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-white">Company Profile & Invoicing Details</h2>
            <p className="text-xs text-slate-400 mt-1">
              These details appear directly on generated invoices and PDF exports. Leave fields blank if you do not want them printed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Name *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.businessNameMax}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Logo URL (Optional)
              </label>
              <input
                type="url"
                maxLength={500}
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Email
              </label>
              <input
                type="email"
                maxLength={FIELD_LIMITS.emailMax}
                value={businessEmail}
                onChange={(e) => setBusinessEmail(e.target.value)}
                placeholder="billing@emgwebsolutions.co.ke"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Phone
              </label>
              <input
                type="text"
                maxLength={60}
                value={businessPhone}
                onChange={(e) => setBusinessPhone(e.target.value)}
                placeholder="+254 ..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Address
              </label>
              <input
                type="text"
                maxLength={300}
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                placeholder="Office location / P.O. Box"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 border-t border-white/[0.06]">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Currency *</label>
              <input
                type="text"
                required
                maxLength={8}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Default Grace Period (Days) *
              </label>
              <input
                type="number"
                min={0}
                max={90}
                required
                value={graceDays}
                onChange={(e) => setGraceDays(Number(e.target.value) || 0)}
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Invoice Prefix *
              </label>
              <input
                type="text"
                required
                maxLength={16}
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Next Invoice # *
              </label>
              <input
                type="number"
                min={1}
                required
                value={nextInvoiceSeq}
                onChange={(e) => setNextInvoiceSeq(Number(e.target.value) || 1)}
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Default Invoice Payment Instructions
            </label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.paymentNotesMax}
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value)}
              placeholder="Enter your official M-Pesa Paybill/Till, Bank Account, or PayPal payment instructions..."
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </section>

        {/* Smart Notification Rules & Preferences */}
        <section className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <BellRing className="w-4 h-4 text-blue-400" />
            <div>
              <h2 className="text-base font-semibold text-white">
                Smart Notification Rules & Automation (Africa/Nairobi)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure reminder intervals, enabled alert categories, and Web Push priority thresholds.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Grace Alert Days Remaining
              </label>
              <input
                type="text"
                value={graceDaysInput}
                onChange={(e) => setGraceDaysInput(e.target.value)}
                placeholder="7, 3, 1"
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">Comma-separated days (e.g. 7, 3, 1)</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Subscription Renewal Lead (Days)
              </label>
              <input
                type="number"
                min={1}
                max={90}
                value={notifPrefs.renewalReminderDays}
                onChange={(e) =>
                  setNotifPrefs((prev) => ({
                    ...prev,
                    renewalReminderDays: Number(e.target.value) || 14,
                  }))
                }
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Website Renewal Lead (Days)
              </label>
              <input
                type="number"
                min={1}
                max={90}
                value={notifPrefs.websiteRenewalReminderDays}
                onChange={(e) =>
                  setNotifPrefs((prev) => ({
                    ...prev,
                    websiteRenewalReminderDays: Number(e.target.value) || 14,
                  }))
                }
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Demo Feedback Reminder (Days)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={notifPrefs.demoFeedbackReminderDays}
                onChange={(e) =>
                  setNotifPrefs((prev) => ({
                    ...prev,
                    demoFeedbackReminderDays: Number(e.target.value) || 2,
                  }))
                }
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            <p className="text-xs font-medium text-slate-300">Enabled Notification Categories</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  ['subscriptions', 'Subscriptions & Grace Period'],
                  ['payments', 'Unpaid Payments & Invoices'],
                  ['leads', 'Lead Follow-ups & Demos'],
                  ['websites', 'Websites & Domain Renewals'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2.5 p-3 rounded-lg bg-[#09090B] border border-white/[0.08] cursor-pointer text-xs text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={notifPrefs.enabledCategories[key]}
                    onChange={(e) =>
                      setNotifPrefs((prev) => ({
                        ...prev,
                        enabledCategories: {
                          ...prev.enabledCategories,
                          [key]: e.target.checked,
                        },
                      }))
                    }
                    className="rounded border-white/20 bg-[#11131A] text-blue-600"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-white">
                <input
                  type="checkbox"
                  checked={notifPrefs.pushNotificationsEnabled}
                  onChange={(e) =>
                    setNotifPrefs((prev) => ({
                      ...prev,
                      pushNotificationsEnabled: e.target.checked,
                    }))
                  }
                  className="rounded border-white/20 bg-[#09090B] text-blue-600"
                />
                <span>Send system-level FCM Web Push notifications for matching alerts</span>
              </label>

              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400">Push priorities:</span>
                {(['Critical', 'Warning', 'Info'] as NotificationPriority[]).map((prio) => (
                  <label key={prio} className="inline-flex items-center gap-1.5 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifPrefs.pushPriorities.includes(prio)}
                      onChange={() => togglePushPriority(prio)}
                      className="rounded border-white/20 bg-[#09090B] text-blue-600"
                    />
                    <span>{prio}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Firebase Web Push Certificate (Public VAPID Key)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  maxLength={240}
                  value={notifPrefs.vapidPublicKey || ''}
                  onChange={(e) =>
                    setNotifPrefs((prev) => ({ ...prev, vapidPublicKey: e.target.value }))
                  }
                  placeholder={
                    ENV_VAPID_KEY
                      ? `Loaded from VITE_FIREBASE_VAPID_KEY (${ENV_VAPID_KEY.slice(0, 12)}...)`
                      : 'Paste public Web Push Certificate key from Firebase Console -> Cloud Messaging'
                  }
                  className="w-full pl-9 pr-3.5 py-2 text-xs font-mono bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Public VAPID keys are safe browser identifiers. Never place private server credentials or service account keys in frontend settings.
              </p>
            </div>
          </div>
        </section>

        {/* Subscription Packages */}
        <section className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">Subscription Packages</h2>
              <p className="text-xs text-slate-400 mt-1">
                Configure standard monthly hosting and management packages.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddPackage}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Package
            </button>
          </div>

          <div className="space-y-3">
            {packages.map((pkg, idx) => (
              <div
                key={pkg.id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-lg bg-[#09090B] border border-white/[0.06] items-center"
              >
                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-slate-400 mb-1">Package Name</label>
                  <input
                    type="text"
                    required
                    value={pkg.name}
                    onChange={(e) => handleUpdatePackage(idx, { name: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm bg-[#11131A] border border-white/10 rounded-md text-white"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Monthly Price ({currency})
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={pkg.monthlyPrice}
                    onChange={(e) =>
                      handleUpdatePackage(idx, { monthlyPrice: Number(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono-tabular bg-[#11131A] border border-white/10 rounded-md text-white"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-[11px] text-slate-400 mb-1">Description</label>
                  <input
                    type="text"
                    value={pkg.description}
                    onChange={(e) => handleUpdatePackage(idx, { description: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm bg-[#11131A] border border-white/10 rounded-md text-white"
                  />
                </div>
                <div className="sm:col-span-1 flex justify-end pt-4 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => handleRemovePackage(idx)}
                    title="Remove package"
                    aria-label={`Remove package ${pkg.name}`}
                    className="p-2 text-slate-400 hover:text-red-400 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {savingSettings ? 'Saving Settings...' : 'Save Business & Notification Settings'}
            </button>
          </div>
        </section>
      </form>

      {/* System Web Push (FCM) Device Registration & Deployment Guide */}
      <section className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-white">
                System Web Push Devices (Firebase Cloud Messaging)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Receive Chromebook and mobile browser notifications even when this dashboard tab is closed.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleEnableBrowserPush()}
              disabled={enablingPush}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
            >
              <BellRing className="w-3.5 h-3.5" />
              {enablingPush ? 'Registering...' : 'Enable Push on This Device'}
            </button>

            <button
              type="button"
              onClick={() => void handleTestLocalNotification()}
              disabled={testingPush}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Local Browser Preview
            </button>

            <button
              type="button"
              onClick={() => void handleTestCloudFunctionPush()}
              disabled={testingPush || fcmTokens.filter((t) => t.enabled).length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              Send Live FCM Push
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#09090B] border border-white/[0.06] flex items-center gap-2.5">
            {browserPermission === 'granted' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <div>
              <p className="text-slate-400">Browser Permission</p>
              <p className="font-semibold text-white capitalize">{browserPermission}</p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#09090B] border border-white/[0.06] flex items-center gap-2.5">
            {resolvedVapid ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <div>
              <p className="text-slate-400">VAPID Public Key</p>
              <p className="font-semibold text-white">
                {resolvedVapid ? 'Configured' : 'Not set yet'}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#09090B] border border-white/[0.06] flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <p className="text-slate-400">Registered Admin Devices</p>
              <p className="font-semibold text-white font-mono-tabular">
                {fcmTokens.filter((t) => t.enabled).length} active / {fcmTokens.length} total
              </p>
            </div>
          </div>
        </div>

        {fcmTokens.length > 0 && (
          <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg">
            {fcmTokens.map((tok) => (
              <div
                key={tok.id}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white">{tok.deviceLabel}</p>
                  <p className="font-mono text-[11px] text-slate-400 truncate">
                    {tok.adminEmail} · Token: {tok.token.slice(0, 22)}...
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleFcmTokenEnabled(tok.id, !tok.enabled)}
                    className={`px-2.5 py-1 rounded border text-[11px] font-medium ${
                      tok.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
                    }`}
                  >
                    {tok.enabled ? 'Enabled' : 'Paused'}
                  </button>
                  {tok.adminUid === user?.uid && (
                    <button
                      type="button"
                      onClick={() => void deleteFcmToken(tok.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 rounded"
                      title="Remove device token"
                      aria-label={`Remove device token ${tok.deviceLabel}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-4 rounded-lg bg-[#09090B] border border-white/[0.06] text-xs text-slate-300 space-y-2">
          <p className="font-semibold text-white">
            FCM HTTP v1 &amp; VAPID Deployment Setup (Project: <span className="font-mono">{firebaseProjectInfo.projectId}</span>)
          </p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400">
            <li>
              In Firebase Console &rarr; Project Settings &rarr; <span className="text-slate-200">Cloud Messaging</span>, confirm <span className="text-slate-200">Firebase Cloud Messaging API (V1)</span> is enabled (this app already uses the modern HTTP v1 SDKs and VAPID tokens—never a legacy Server Key).
            </li>
            <li>
              Under <span className="text-slate-200">Web Push certificates</span>, click <span className="text-slate-200">Generate key pair</span>, copy the public VAPID key, and paste it above (or set <code className="font-mono text-slate-200">VITE_FIREBASE_VAPID_KEY</code>), then save settings.
            </li>
            <li>
              Click <span className="text-slate-200">Enable Push on This Device</span> on your Chromebook or mobile browser to register an HTTP v1 FCM device token in Firestore.
            </li>
            <li>
              Deploy Cloud Functions with <code className="font-mono text-slate-200">FIRESTORE_DATABASE_ID={firebaseProjectInfo.databaseId}</code> using <code className="font-mono text-slate-200">firebase deploy --only functions</code> so daily 07:00 EAT scheduled checks and new-alert triggers send background FCM HTTP v1 pushes.
            </li>
          </ol>
        </div>
      </section>

      {/* Administrator Profile & Access Control */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={(e) => void handleSaveMyProfile(e)}
          className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-white">Your Administrator Profile</h2>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>
              Email: <span className="font-mono text-slate-200">{user?.email}</span>
            </p>
            <p>
              UID: <span className="font-mono text-slate-400">{user?.uid}</span>
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Display Name *
            </label>
            <input
              type="text"
              required
              value={myDisplayName}
              onChange={(e) => setMyDisplayName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Phone</label>
            <input
              type="text"
              value={myPhone}
              onChange={(e) => setMyPhone(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white"
            />
          </div>
          <button
            type="submit"
            disabled={savingProfile}
            className="px-4 py-2 text-sm font-semibold bg-white/[0.08] hover:bg-white/[0.12] text-white rounded-lg"
          >
            {savingProfile ? 'Updating...' : 'Update Profile'}
          </button>
        </form>

        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Authorized Administrators</h2>
          </div>

          <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg">
            {admins.map((a) => (
              <div key={a.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{a.displayName}</p>
                  <p className="font-mono text-slate-400 truncate">{a.email}</p>
                </div>
                <span className="text-slate-300 capitalize shrink-0">
                  {a.role.replace('_', ' ')} · {a.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>

          <form onSubmit={(e) => void handleAddAdmin(e)} className="space-y-3 pt-2 border-t border-white/[0.06]">
            <p className="text-xs font-medium text-slate-300">
              Authorize Another Firebase Auth User
            </p>
            <input
              type="text"
              placeholder="Firebase Auth UID"
              value={newAdminUid}
              onChange={(e) => setNewAdminUid(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-[#09090B] border border-white/10 rounded-lg text-white"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="email"
                placeholder="Admin Email"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
              <input
                type="text"
                placeholder="Full Name"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#09090B] border border-white/10 rounded-lg text-white"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={newAdminRole}
                onChange={(e) => setNewAdminRole(e.target.value as AdminRole)}
                aria-label="Administrator role"
                className="px-3 py-2 text-xs bg-[#09090B] border border-white/10 rounded-lg text-white"
              >
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
              <button
                type="submit"
                disabled={addingAdmin}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
              >
                {addingAdmin ? 'Adding...' : 'Authorize Admin'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
