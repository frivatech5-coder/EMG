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
  Building2,
  Layers,
  Search,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/ToastContext';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import {
  executePurgeMatch,
  findMatchingRecordsForPurge,
  saveAdminProfile,
  saveBusinessSettings,
  type PurgeScanResult,
} from '../services/emgFirestore';
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
import { INPUT_CLASS, PageHeader, SegmentedTabs } from '../components/ui/PageHeader';

type SettingsTab = 'general' | 'packages' | 'notifications' | 'webpush' | 'admins' | 'cleanup';

const BASE_SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: typeof Building2 }> = [
  { id: 'general', label: 'Company & Invoicing', icon: Building2 },
  { id: 'packages', label: 'Packages', icon: Layers },
  { id: 'notifications', label: 'Notification Rules', icon: BellRing },
  { id: 'webpush', label: 'Web Push (FCM)', icon: Smartphone },
  { id: 'admins', label: 'Administrators', icon: Shield },
];

export function SettingsPage() {
  const { settings, admins, fcmTokens, loading } = useData();
  const { user, adminProfile, isSuperAdmin } = useAuth();
  const { showToast } = useToast();

  const settingsTabs = isSuperAdmin
    ? [...BASE_SETTINGS_TABS, { id: 'cleanup' as const, label: 'Data Cleanup', icon: Trash2 }]
    : BASE_SETTINGS_TABS;

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

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

  // Super Admin Data Cleanup / Purge by Keyword
  const [purgeKeyword, setPurgeKeyword] = useState('');
  const [scanningPurge, setScanningPurge] = useState(false);
  const [executingPurge, setExecutingPurge] = useState(false);
  const [purgeScan, setPurgeScan] = useState<PurgeScanResult | null>(null);
  const [confirmPurgeOpen, setConfirmPurgeOpen] = useState(false);

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

  const saveWorkspaceSettings = async () => {
    if (!businessName.trim()) {
      showToast('Business name is required.', 'error');
      setActiveTab('general');
      return;
    }
    if (!isValidUrlOrEmpty(logoUrl)) {
      showToast('Logo URL must start with http:// or https://', 'error');
      setActiveTab('general');
      return;
    }
    if (!currency.trim() || !invoicePrefix.trim()) {
      showToast('Currency and invoice prefix are required.', 'error');
      setActiveTab('general');
      return;
    }
    if (packages.some((p) => !p.name.trim())) {
      showToast('Every subscription package must have a name.', 'error');
      setActiveTab('packages');
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
      showToast('Workspace & notification settings saved to Firestore.', 'success');
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
      showToast(
        result.message,
        result.ok ? 'success' : result.reason === 'missing_vapid_key' ? 'info' : 'error'
      );
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
      showToast('Register an active FCM device token first using "Enable Push on This Device".', 'error');
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

  const handleScanPurge = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = purgeKeyword.trim();
    if (term.length < 2) {
      showToast('Enter at least 2 characters to scan Firestore records.', 'error');
      return;
    }
    setScanningPurge(true);
    try {
      const result = await findMatchingRecordsForPurge(term);
      setPurgeScan(result);
      if (result.totalMatched === 0) {
        showToast(`No records matched "${result.keyword}" across any collection.`, 'info');
      } else {
        showToast(
          `Found ${result.totalMatched} matching Firestore document${result.totalMatched === 1 ? '' : 's'} for "${result.keyword}".`,
          'success'
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to scan records.', 'error');
    } finally {
      setScanningPurge(false);
    }
  };

  const handleExecutePurge = async () => {
    if (!purgeScan || purgeScan.totalMatched === 0) return;
    setExecutingPurge(true);
    try {
      const deletedCount = await executePurgeMatch(purgeScan);
      showToast(
        `Permanently purged ${deletedCount} document${deletedCount === 1 ? '' : 's'} matching "${purgeScan.keyword}".`,
        'success'
      );
      setConfirmPurgeOpen(false);
      setPurgeScan(null);
      setPurgeKeyword('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to purge records.', 'error');
    } finally {
      setExecutingPurge(false);
    }
  };

  const resolvedVapid = (notifPrefs.vapidPublicKey || ENV_VAPID_KEY || '').trim();
  const activeLogoPreview = logoUrl.trim() || '/assets/aistudio/emglogo0_fdf409c7.png';

  if (loading) {
    return <TableSkeleton rows={6} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace Settings"
        description="Configure company branding, invoice defaults, subscription packages, Africa/Nairobi notification rules, Web Push (FCM), and admin permissions."
        meta={
          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/[0.05] text-zinc-400">
            {firebaseProjectInfo.projectId}
          </span>
        }
        actions={
          (activeTab === 'general' || activeTab === 'packages' || activeTab === 'notifications') && (
            <button
              type="button"
              disabled={savingSettings}
              onClick={() => void saveWorkspaceSettings()}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {savingSettings ? 'Saving...' : 'Save Changes'}
            </button>
          )
        }
      />

      {/* Mobile Tab Bar */}
      <div className="lg:hidden">
        <SegmentedTabs
          value={activeTab}
          onChange={setActiveTab}
          options={settingsTabs.map((t) => ({ id: t.id, label: t.label }))}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Desktop Vertical Settings Rail */}
        <aside className="hidden lg:block lg:col-span-3 space-y-4 sticky top-20">
          <nav
            aria-label="Settings sections"
            className="bg-[#111216] border border-white/[0.08] rounded-xl p-1.5 space-y-0.5"
          >
            {settingsTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isCleanup = tab.id === 'cleanup';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors text-left ${
                    isActive
                      ? 'bg-white/[0.08] text-white'
                      : isCleanup
                      ? 'text-red-400/80 hover:text-red-300 hover:bg-red-500/[0.06]'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
                  }`}
                >
                  {isActive && (
                    <span
                      className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r ${
                        isCleanup ? 'bg-red-500' : 'bg-blue-500'
                      }`}
                    />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive
                        ? isCleanup
                          ? 'text-red-400'
                          : 'text-blue-400'
                        : isCleanup
                        ? 'text-red-400/70'
                        : 'text-zinc-500'
                    }`}
                  />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Compact Brand Card Preview */}
          <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-4 space-y-3">
            <div className="bg-white rounded-lg p-2.5 flex items-center justify-center">
              <img
                src={activeLogoPreview}
                alt={businessName || 'EMG Web Solutions'}
                className="h-10 w-auto object-contain"
              />
            </div>
            <div className="text-xs space-y-0.5">
              <p className="font-medium text-white truncate">{businessName}</p>
              <p className="font-mono-tabular text-[11px] text-zinc-500">
                {currency} · Prefix {invoicePrefix}
              </p>
            </div>
          </div>
        </aside>

        {/* Active Tab Workspace */}
        <div className="lg:col-span-9 space-y-6">
          {activeTab === 'general' && (
            <section className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12]">
                <h3 className="text-sm font-medium text-white">Company Profile &amp; Invoicing Defaults</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Printed directly on client invoices and PDF exports. Leave optional fields blank to omit.
                </p>
              </div>

              <div className="p-6 space-y-5">
                {/* Brand Preview Row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-[#09090B] border border-white/[0.06]">
                  <div className="bg-white rounded-lg px-3 py-2 shrink-0 self-start">
                    <img
                      src={activeLogoPreview}
                      alt={businessName || 'EMG Web Solutions'}
                      className="h-11 w-auto object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-medium text-white">Official Invoice &amp; Workspace Logo</p>
                    <p className="text-[11px] text-zinc-400">
                      Uses your configured custom Logo URL or falls back to the built-in EMG Web Solutions mark.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Business Name *
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.businessNameMax}
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Logo URL (Optional)
                    </label>
                    <input
                      type="url"
                      maxLength={500}
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="/assets/aistudio/emglogo0_fdf409c7.png or https://..."
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Business Email
                    </label>
                    <input
                      type="email"
                      maxLength={FIELD_LIMITS.emailMax}
                      value={businessEmail}
                      onChange={(e) => setBusinessEmail(e.target.value)}
                      placeholder="billing@emgwebsolutions.co.ke"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Business Phone
                    </label>
                    <input
                      type="text"
                      maxLength={60}
                      value={businessPhone}
                      onChange={(e) => setBusinessPhone(e.target.value)}
                      placeholder="+254 ..."
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Business Address
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                      placeholder="Office location / P.O. Box"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-white/[0.06]">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">Currency *</label>
                    <input
                      type="text"
                      maxLength={8}
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Default Grace Period (Days) *
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={graceDays}
                      onChange={(e) => setGraceDays(Number(e.target.value) || 0)}
                      className={`${INPUT_CLASS} font-mono-tabular`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Invoice Prefix *
                    </label>
                    <input
                      type="text"
                      maxLength={16}
                      value={invoicePrefix}
                      onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Next Invoice # *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={nextInvoiceSeq}
                      onChange={(e) => setNextInvoiceSeq(Number(e.target.value) || 1)}
                      className={`${INPUT_CLASS} font-mono-tabular`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Default Invoice Payment Instructions
                  </label>
                  <textarea
                    rows={3}
                    maxLength={FIELD_LIMITS.paymentNotesMax}
                    value={paymentInstructions}
                    onChange={(e) => setPaymentInstructions(e.target.value)}
                    placeholder="Enter your official M-Pesa Paybill/Till, Bank Account, or PayPal payment instructions..."
                    className="w-full px-3.5 py-2.5 text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={() => void saveWorkspaceSettings()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[40px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {savingSettings ? 'Saving Settings...' : 'Save Company & Invoice Settings'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'packages' && (
            <section className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12] flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-white">Subscription Packages</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Standard monthly hosting &amp; website management tiers selectable across clients and billing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddPackage}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white rounded-lg transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Package
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  {packages.map((pkg, idx) => (
                    <div
                      key={pkg.id}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-4 rounded-xl bg-[#09090B] border border-white/[0.06] items-center"
                    >
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-zinc-400 mb-1">Package Name *</label>
                        <input
                          type="text"
                          value={pkg.name}
                          onChange={(e) => handleUpdatePackage(idx, { name: e.target.value })}
                          className="w-full px-3 py-2 min-h-[38px] text-sm bg-[#111216] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          Monthly Price ({currency}) *
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={pkg.monthlyPrice}
                          onChange={(e) =>
                            handleUpdatePackage(idx, { monthlyPrice: Number(e.target.value) || 0 })
                          }
                          className="w-full px-3 py-2 min-h-[38px] text-sm font-mono-tabular bg-[#111216] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] text-zinc-400 mb-1">Description</label>
                        <input
                          type="text"
                          value={pkg.description}
                          onChange={(e) => handleUpdatePackage(idx, { description: e.target.value })}
                          className="w-full px-3 py-2 min-h-[38px] text-sm bg-[#111216] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end pt-2 sm:pt-4">
                        <button
                          type="button"
                          onClick={() => handleRemovePackage(idx)}
                          title="Remove package"
                          aria-label={`Remove package ${pkg.name}`}
                          className="p-2 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-3 border-t border-white/[0.06]">
                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={() => void saveWorkspaceSettings()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[40px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {savingSettings ? 'Saving Packages...' : 'Save Subscription Packages'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'notifications' && (
            <section className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12]">
                <h3 className="text-sm font-medium text-white">
                  Smart Notification Rules &amp; Automation (Africa/Nairobi)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure reminder lead times, enabled alert categories, and Web Push priority thresholds.
                </p>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Grace Alert Days Remaining
                    </label>
                    <input
                      type="text"
                      value={graceDaysInput}
                      onChange={(e) => setGraceDaysInput(e.target.value)}
                      placeholder="7, 3, 1"
                      className={`${INPUT_CLASS} font-mono`}
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">Comma-separated (e.g. 7, 3, 1)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Subscription Renewal Lead
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
                      className={`${INPUT_CLASS} font-mono-tabular`}
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">Days before renewal date</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Website Renewal Lead
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
                      className={`${INPUT_CLASS} font-mono-tabular`}
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">Days before domain/hosting due</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Demo Feedback Delay
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
                      className={`${INPUT_CLASS} font-mono-tabular`}
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">Days after demo delivery</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/[0.06] space-y-3">
                  <p className="text-xs font-medium text-zinc-300">Enabled Notification Categories</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        ['subscriptions', 'Subscriptions & Grace Period Deadlines'],
                        ['payments', 'Unpaid Payments & Open Invoices'],
                        ['leads', 'Lead Follow-ups & Demo Feedback'],
                        ['websites', 'Websites & Domain Renewals'],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-3 p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] cursor-pointer text-xs text-zinc-200 hover:border-white/[0.14] transition-colors"
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
                          className="rounded border-white/20 bg-[#111216] text-blue-600"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/[0.06] space-y-4">
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
                      <span className="text-zinc-400">Push priorities:</span>
                      {(['Critical', 'Warning', 'Info'] as NotificationPriority[]).map((prio) => (
                        <label
                          key={prio}
                          className="inline-flex items-center gap-1.5 text-zinc-200 cursor-pointer"
                        >
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
                </div>

                <div className="flex justify-end pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={() => void saveWorkspaceSettings()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[40px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {savingSettings ? 'Saving Rules...' : 'Save Notification Rules'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'webpush' && (
            <section className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-white">
                    System Web Push Devices (FCM HTTP v1)
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Receive Chromebook and mobile browser notifications even when the dashboard is closed.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleEnableBrowserPush()}
                    disabled={enablingPush}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    {enablingPush ? 'Registering...' : 'Enable Push on Device'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTestLocalNotification()}
                    disabled={testingPush}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Local Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTestCloudFunctionPush()}
                    disabled={testingPush || fcmTokens.filter((t) => t.enabled).length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-lg disabled:opacity-40"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Live FCM Push
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* 3-Metric Hairline Strip */}
                <div className="bg-[#09090B] border border-white/[0.07] rounded-xl grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07] text-xs">
                  <div className="p-4 flex items-center gap-3">
                    {browserPermission === 'granted' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <p className="text-zinc-400">Browser Permission</p>
                      <p className="font-semibold text-white capitalize mt-0.5">{browserPermission}</p>
                    </div>
                  </div>

                  <div className="p-4 flex items-center gap-3">
                    {resolvedVapid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <p className="text-zinc-400">VAPID Public Key</p>
                      <p className="font-semibold text-white mt-0.5">
                        {resolvedVapid ? 'Configured' : 'Optional / Not set'}
                      </p>
                    </div>
                  </div>

                  <div className="p-4 flex items-center gap-3">
                    <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />
                    <div>
                      <p className="text-zinc-400">Registered Devices</p>
                      <p className="font-semibold text-white font-mono-tabular mt-0.5">
                        {fcmTokens.filter((t) => t.enabled).length} active / {fcmTokens.length} total
                      </p>
                    </div>
                  </div>
                </div>

                {/* Public VAPID Input */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-zinc-300">
                    Firebase Web Push Certificate (Public VAPID Key)
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
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
                        className={`${INPUT_CLASS} pl-9 font-mono text-xs`}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={savingSettings}
                      onClick={() => void saveWorkspaceSettings()}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 shrink-0"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingSettings ? 'Saving...' : 'Save Key'}
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Public VAPID keys are safe browser identifiers. Core dashboard alerts remain fully operational even without VAPID configured.
                  </p>
                </div>

                {/* Registered Device Tokens */}
                {fcmTokens.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-300">Registered Device Tokens</p>
                    <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#09090B]">
                      {fcmTokens.map((tok) => (
                        <div
                          key={tok.id}
                          className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-white">{tok.deviceLabel}</p>
                            <p className="font-mono text-[11px] text-zinc-400 truncate mt-0.5">
                              {tok.adminEmail} · Token: {tok.token.slice(0, 22)}...
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => void toggleFcmTokenEnabled(tok.id, !tok.enabled)}
                              className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-colors ${
                                tok.enabled
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-white/[0.04] text-zinc-400 border-white/[0.08]'
                              }`}
                            >
                              {tok.enabled ? 'Enabled' : 'Paused'}
                            </button>
                            {tok.adminUid === user?.uid && (
                              <button
                                type="button"
                                onClick={() => void deleteFcmToken(tok.id)}
                                className="p-1.5 text-zinc-400 hover:text-red-400 rounded transition-colors"
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
                  </div>
                )}

                {/* HTTP v1 Setup Guide */}
                <div className="p-4 rounded-xl bg-[#09090B] border border-white/[0.06] text-xs text-zinc-300 space-y-2">
                  <p className="font-semibold text-white">
                    FCM HTTP v1 &amp; VAPID Deployment Setup (Project:{' '}
                    <span className="font-mono text-blue-400">{firebaseProjectInfo.projectId}</span>)
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-zinc-400 leading-relaxed">
                    <li>
                      In Firebase Console &rarr; Project Settings &rarr;{' '}
                      <span className="text-zinc-200">Cloud Messaging</span>, confirm{' '}
                      <span className="text-zinc-200">Firebase Cloud Messaging API (V1)</span> is enabled (this dashboard uses HTTP v1 SDKs and VAPID tokens exclusively).
                    </li>
                    <li>
                      Under <span className="text-zinc-200">Web Push certificates</span>, click{' '}
                      <span className="text-zinc-200">Generate key pair</span>, paste the public VAPID key above (or set{' '}
                      <code className="font-mono text-zinc-200">VITE_FIREBASE_VAPID_KEY</code>), and save.
                    </li>
                    <li>
                      Click <span className="text-zinc-200">Enable Push on Device</span> on your Chromebook or mobile browser to register an HTTP v1 token.
                    </li>
                    <li>
                      Deploy Cloud Functions with{' '}
                      <code className="font-mono text-zinc-200">
                        FIRESTORE_DATABASE_ID={firebaseProjectInfo.databaseId}
                      </code>{' '}
                      via <code className="font-mono text-zinc-200">firebase deploy --only functions</code> for automated 07:00 EAT background alerts.
                    </li>
                  </ol>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'admins' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <form
                onSubmit={(e) => void handleSaveMyProfile(e)}
                className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col"
              >
                <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-white">Your Administrator Profile</h3>
                </div>

                <div className="p-6 space-y-4 flex-1">
                  <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.06] text-xs space-y-1">
                    <p className="text-zinc-400">
                      Email: <span className="font-mono text-zinc-200">{user?.email}</span>
                    </p>
                    <p className="text-zinc-400 break-all">
                      UID: <span className="font-mono text-zinc-500">{user?.uid}</span>
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Display Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={myDisplayName}
                      onChange={(e) => setMyDisplayName(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">Phone</label>
                    <input
                      type="text"
                      value={myPhone}
                      onChange={(e) => setMyPhone(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="px-4 py-2 min-h-[40px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {savingProfile ? 'Updating...' : 'Update Profile'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12] flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-white">Authorized Administrators</h3>
                </div>

                <div className="p-6 space-y-5">
                  <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#09090B]">
                    {admins.map((a) => (
                      <div key={a.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{a.displayName}</p>
                          <p className="font-mono text-zinc-400 truncate mt-0.5">{a.email}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              a.active ? 'bg-emerald-400' : 'bg-zinc-500'
                            }`}
                          />
                          <span className="text-zinc-300 capitalize">
                            {a.role.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <form
                    onSubmit={(e) => void handleAddAdmin(e)}
                    className="space-y-3 pt-4 border-t border-white/[0.06]"
                  >
                    <p className="text-xs font-medium text-zinc-300">
                      Authorize Another Firebase Auth User
                    </p>
                    <input
                      type="text"
                      placeholder="Firebase Auth UID"
                      value={newAdminUid}
                      onChange={(e) => setNewAdminUid(e.target.value)}
                      className={`${INPUT_CLASS} font-mono text-xs`}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="email"
                        placeholder="Admin Email"
                        value={newAdminEmail}
                        onChange={(e) => setNewAdminEmail(e.target.value)}
                        className={`${INPUT_CLASS} text-xs`}
                      />
                      <input
                        type="text"
                        placeholder="Full Name"
                        value={newAdminName}
                        onChange={(e) => setNewAdminName(e.target.value)}
                        className={`${INPUT_CLASS} text-xs`}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <select
                        value={newAdminRole}
                        onChange={(e) => setNewAdminRole(e.target.value as AdminRole)}
                        aria-label="Administrator role"
                        className="px-3 py-2 min-h-[38px] text-xs bg-[#09090B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                      <button
                        type="submit"
                        disabled={addingAdmin}
                        className="px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {addingAdmin ? 'Adding...' : 'Authorize Admin'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cleanup' && isSuperAdmin && (
            <section className="bg-[#111216] border border-red-500/20 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/[0.06] bg-[#0D0E12] flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-white flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-400" />
                    Data Cleanup &amp; Test Record Purge
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Super-admin utility to scan and permanently erase test data (e.g., &ldquo;Gikicho&rdquo;) across all 9 business collections.
                  </p>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <form onSubmit={(e) => void handleScanPurge(e)} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={purgeKeyword}
                      onChange={(e) => {
                        setPurgeKeyword(e.target.value);
                        if (purgeScan) setPurgeScan(null);
                      }}
                      aria-label="Keyword or business name to scan"
                      placeholder="Enter keyword or test business name (e.g. Gikicho)..."
                      className={`${INPUT_CLASS} pl-9`}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={scanningPurge || executingPurge || purgeKeyword.trim().length < 2}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2 min-h-[40px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 shrink-0"
                  >
                    <Search className="w-3.5 h-3.5" />
                    {scanningPurge ? 'Scanning Firestore...' : 'Scan Firestore'}
                  </button>
                </form>

                <div className="p-4 rounded-xl bg-[#09090B] border border-white/[0.07] text-xs text-zinc-400 leading-relaxed">
                  Scanning checks <span className="text-zinc-200">clients, leads, websites, subscriptions, invoices, payments, payment references, notifications,</span> and <span className="text-zinc-200">activity logs</span>, including cascading records linked by <code className="font-mono text-zinc-300">clientId</code> or <code className="font-mono text-zinc-300">recordId</code>. Admin accounts and settings are never affected.
                </div>

                {purgeScan && (
                  <div className="space-y-5 pt-2 border-t border-white/[0.07]">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          Scan Results for &ldquo;{purgeScan.keyword}&rdquo;
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5 font-mono-tabular">
                          {purgeScan.totalMatched} total Firestore document{purgeScan.totalMatched === 1 ? '' : 's'} queued for removal
                        </p>
                      </div>
                      {purgeScan.totalMatched > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmPurgeOpen(true)}
                          disabled={executingPurge}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[40px] text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Purge All Matching Records ({purgeScan.totalMatched})
                        </button>
                      )}
                    </div>

                    {/* 9-Collection Breakdown */}
                    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
                      {(
                        [
                          ['Clients', purgeScan.counts.clients],
                          ['Leads', purgeScan.counts.leads],
                          ['Websites', purgeScan.counts.websites],
                          ['Subs', purgeScan.counts.subscriptions],
                          ['Invoices', purgeScan.counts.invoices],
                          ['Payments', purgeScan.counts.payments],
                          ['Pay Refs', purgeScan.counts.paymentReferences],
                          ['Alerts', purgeScan.counts.notifications],
                          ['Logs', purgeScan.counts.activityLogs],
                        ] as const
                      ).map(([label, count]) => (
                        <div
                          key={label}
                          className="p-2.5 rounded-lg bg-[#09090B] border border-white/[0.07] text-center"
                        >
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
                          <p
                            className={`mt-1 font-mono-tabular text-sm font-semibold ${
                              count > 0 ? 'text-red-400' : 'text-zinc-500'
                            }`}
                          >
                            {count}
                          </p>
                        </div>
                      ))}
                    </div>

                    {purgeScan.items.length > 0 ? (
                      <div className="border border-white/[0.08] rounded-xl bg-[#09090B] overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[#0D0E12] flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                          <span>Matched Document Preview</span>
                          <span className="font-mono-tabular">
                            Showing {Math.min(50, purgeScan.items.length)} of {purgeScan.items.length}
                          </span>
                        </div>
                        <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.06]">
                          {purgeScan.items.slice(0, 50).map((item) => (
                            <div
                              key={`${item.collection}-${item.id}`}
                              className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-white truncate">{item.label}</p>
                                {item.detail && (
                                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">{item.detail}</p>
                                )}
                              </div>
                              <span className="px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[10px] font-medium text-zinc-300 shrink-0">
                                {item.collection}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 rounded-xl bg-[#09090B] border border-white/[0.07] text-center text-xs text-zinc-400">
                        Zero records found matching &ldquo;{purgeScan.keyword}&rdquo;.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmPurgeOpen}
        title="Confirm Permanent Data Purge"
        description={
          purgeScan
            ? `This will permanently delete ${purgeScan.totalMatched} Firestore document${purgeScan.totalMatched === 1 ? '' : 's'} matching "${purgeScan.keyword}" across all selected collections (${purgeScan.counts.clients} clients, ${purgeScan.counts.leads} leads, ${purgeScan.counts.websites} websites, ${purgeScan.counts.subscriptions} subscriptions, ${purgeScan.counts.invoices} invoices, ${purgeScan.counts.payments} payments, ${purgeScan.counts.notifications} alerts, ${purgeScan.counts.activityLogs} logs). This cannot be undone.`
            : ''
        }
        confirmLabel="Purge All Permanently"
        tone="danger"
        requireConfirmText="DELETE"
        busy={executingPurge}
        onConfirm={handleExecutePurge}
        onCancel={() => setConfirmPurgeOpen(false)}
      />
    </div>
  );
}
