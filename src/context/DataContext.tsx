import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { DEFAULT_PACKAGES, ensureDefaultSettings } from '../services/emgFirestore';
import {
  resolveNotificationPreferences,
  syncSmartNotificationsToFirestore,
} from '../services/notificationsEngine';
import { subscribeForegroundPushMessages } from '../lib/messaging';
import { useToast } from '../components/ui/ToastContext';
import {
  daysBetween,
  getEffectiveSubscriptionStatus,
  todayIso,
} from '../lib/validation';
import { useAuth } from './AuthContext';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ActivityLog,
  type AdminUser,
  type BusinessSettings,
  type Client,
  type FcmDeviceToken,
  type Invoice,
  type Lead,
  type NotificationItem,
  type Payment,
  type Subscription,
  type Website,
} from '../types/domain';

interface DashboardMetrics {
  totalClients: number;
  activeClients: number;
  totalWebsites: number;
  liveWebsites: number;
  activeSubscriptions: number;
  mrr: number;
  paymentsThisMonth: number;
  outstandingPayments: number;
  overdueSubscriptionsCount: number;
  upcomingRenewalsCount: number;
  dueFollowUpsCount: number;
  unpaidInvoicesCount: number;
  websitesAttentionCount: number;
  totalRemindersCount: number;
  unreadNotificationsCount: number;
  criticalUnreadCount: number;
}

interface DataContextValue {
  clients: Client[];
  websites: Website[];
  subscriptions: Subscription[];
  payments: Payment[];
  invoices: Invoice[];
  leads: Lead[];
  activityLogs: ActivityLog[];
  notifications: NotificationItem[];
  fcmTokens: FcmDeviceToken[];
  admins: AdminUser[];
  settings: BusinessSettings;
  loading: boolean;
  activityLoading: boolean;
  fromCache: boolean;
  syncError: string | null;
  retrySync: () => void;
  metrics: DashboardMetrics;
  runNotificationSync: () => Promise<number>;
}

const FALLBACK_SETTINGS: BusinessSettings = {
  id: 'default',
  businessName: 'EMG WEB SOLUTIONS',
  logoUrl: '',
  businessEmail: '',
  businessPhone: '',
  businessAddress: '',
  currency: 'KES',
  defaultGracePeriodDays: 7,
  invoicePrefix: 'EMG-INV',
  nextInvoiceSequence: 1001,
  paymentInstructions: '',
  packages: DEFAULT_PACKAGES,
  notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
  updatedBy: '',
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { authReady, isAuthorizedAdmin } = useAuth();
  const { showToast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [fcmTokens, setFcmTokens] = useState<FcmDeviceToken[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<BusinessSettings>(FALLBACK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNonce, setSyncNonce] = useState(0);

  const syncingRef = useRef(false);
  const lastSyncFingerprintRef = useRef('');

  const retrySync = useCallback(() => {
    setSyncError(null);
    setSyncNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!authReady || !isAuthorizedAdmin) {
      setClients([]);
      setWebsites([]);
      setSubscriptions([]);
      setPayments([]);
      setInvoices([]);
      setLeads([]);
      setActivityLogs([]);
      setNotifications([]);
      setFcmTokens([]);
      setAdmins([]);
      setSettings(FALLBACK_SETTINGS);
      setNotificationsReady(false);
      setActivityLoading(false);
      setFromCache(false);
      setSyncError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setActivityLoading(true);
    setSyncError(null);
    void ensureDefaultSettings().catch((err) => {
      console.error('Failed to ensure default settings:', err);
    });

    const loadedFlags = {
      clients: false,
      websites: false,
      subscriptions: false,
      payments: false,
      invoices: false,
      leads: false,
      notifications: false,
      settings: false,
    };

    const cacheFlags: Record<string, boolean> = {};

    const updateCacheIndicator = (key: string, snapFromCache: boolean) => {
      cacheFlags[key] = snapFromCache;
      setFromCache(Object.values(cacheFlags).some(Boolean));
    };

    const markLoaded = (key: keyof typeof loadedFlags) => {
      loadedFlags[key] = true;
      if (Object.values(loadedFlags).every(Boolean)) {
        setLoading(false);
      }
    };

    const handleListenerFailure = (error: unknown, op: OperationType, path: string) => {
      try {
        handleFirestoreError(error, op, path);
      } catch (formatted) {
        const msg =
          error instanceof Error
            ? error.message
            : formatted instanceof Error
            ? formatted.message
            : `Failed syncing ${path}`;
        setSyncError(`Firestore sync issue (${path}): ${msg}`);
      }
    };

    const unsubscribers = [
      onSnapshot(
        query(collection(db, 'clients'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setClients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Client, 'id'>) })));
          updateCacheIndicator('clients', snap.metadata.fromCache);
          markLoaded('clients');
        },
        (error) => {
          markLoaded('clients');
          handleListenerFailure(error, OperationType.LIST, 'clients');
        }
      ),
      onSnapshot(
        query(collection(db, 'websites'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setWebsites(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Website, 'id'>) })));
          updateCacheIndicator('websites', snap.metadata.fromCache);
          markLoaded('websites');
        },
        (error) => {
          markLoaded('websites');
          handleListenerFailure(error, OperationType.LIST, 'websites');
        }
      ),
      onSnapshot(
        query(collection(db, 'subscriptions'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setSubscriptions(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subscription, 'id'>) }))
          );
          updateCacheIndicator('subscriptions', snap.metadata.fromCache);
          markLoaded('subscriptions');
        },
        (error) => {
          markLoaded('subscriptions');
          handleListenerFailure(error, OperationType.LIST, 'subscriptions');
        }
      ),
      onSnapshot(
        query(collection(db, 'payments'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payment, 'id'>) })));
          updateCacheIndicator('payments', snap.metadata.fromCache);
          markLoaded('payments');
        },
        (error) => {
          markLoaded('payments');
          handleListenerFailure(error, OperationType.LIST, 'payments');
        }
      ),
      onSnapshot(
        query(collection(db, 'invoices'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setInvoices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invoice, 'id'>) })));
          updateCacheIndicator('invoices', snap.metadata.fromCache);
          markLoaded('invoices');
        },
        (error) => {
          markLoaded('invoices');
          handleListenerFailure(error, OperationType.LIST, 'invoices');
        }
      ),
      onSnapshot(
        query(collection(db, 'leads'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setLeads(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lead, 'id'>) })));
          updateCacheIndicator('leads', snap.metadata.fromCache);
          markLoaded('leads');
        },
        (error) => {
          markLoaded('leads');
          handleListenerFailure(error, OperationType.LIST, 'leads');
        }
      ),
      onSnapshot(
        query(collection(db, 'activity_logs'), orderBy('createdAt', 'desc')),
        (snap) => {
          setActivityLogs(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityLog, 'id'>) }))
          );
          setActivityLoading(false);
        },
        (error) => {
          setActivityLoading(false);
          handleListenerFailure(error, OperationType.LIST, 'activity_logs');
        }
      ),
      onSnapshot(
        query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
        { includeMetadataChanges: true },
        (snap) => {
          setNotifications(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
          );
          updateCacheIndicator('notifications', snap.metadata.fromCache);
          setNotificationsReady(true);
          markLoaded('notifications');
        },
        (error) => {
          setNotificationsReady(true);
          markLoaded('notifications');
          handleListenerFailure(error, OperationType.LIST, 'notifications');
        }
      ),
      onSnapshot(
        collection(db, 'fcm_tokens'),
        (snap) => {
          setFcmTokens(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FcmDeviceToken, 'id'>) }))
          );
        },
        (error) => handleListenerFailure(error, OperationType.LIST, 'fcm_tokens')
      ),
      onSnapshot(
        collection(db, 'admins'),
        (snap) => {
          setAdmins(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminUser, 'id'>) })));
        },
        (error) => handleListenerFailure(error, OperationType.LIST, 'admins')
      ),
      onSnapshot(
        doc(db, 'settings', 'default'),
        { includeMetadataChanges: true },
        (snap) => {
          if (snap.exists()) {
            const raw = snap.data() as Omit<BusinessSettings, 'id'>;
            setSettings({
              id: snap.id,
              ...raw,
              notificationPreferences: resolveNotificationPreferences({
                id: snap.id,
                ...raw,
              }),
            });
          }
          updateCacheIndicator('settings', snap.metadata.fromCache);
          markLoaded('settings');
        },
        (error) => {
          markLoaded('settings');
          handleListenerFailure(error, OperationType.GET, 'settings/default');
        }
      ),
    ];

    let unsubForeground: () => void = () => undefined;
    void subscribeForegroundPushMessages((payload) => {
      const title = payload.notification?.title || payload.data?.title || 'EMG Alert';
      const body = payload.notification?.body || payload.data?.message || '';
      const priority = payload.data?.priority;
      showToast(
        body ? `${title} — ${body}` : title,
        priority === 'Critical' ? 'error' : 'info'
      );
    }).then((unsub) => {
      unsubForeground = unsub;
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      unsubForeground();
    };
  }, [authReady, isAuthorizedAdmin, showToast, syncNonce]);

  const runNotificationSync = useCallback(async (): Promise<number> => {
    if (!authReady || !isAuthorizedAdmin || loading || !notificationsReady || syncingRef.current) {
      return 0;
    }
    syncingRef.current = true;
    try {
      const { createdCount } = await syncSmartNotificationsToFirestore({
        existingNotifications: notifications,
        subscriptions,
        invoices,
        leads,
        websites,
        settings,
      });
      return createdCount;
    } finally {
      syncingRef.current = false;
    }
  }, [
    authReady,
    isAuthorizedAdmin,
    loading,
    notificationsReady,
    notifications,
    subscriptions,
    invoices,
    leads,
    websites,
    settings,
  ]);

  // Automatic deduplicated sync when core records change
  useEffect(() => {
    if (!authReady || !isAuthorizedAdmin || loading || !notificationsReady) return;
    const today = todayIso();
    const fingerprint = [
      today,
      subscriptions.map((s) => `${s.id}:${s.status}:${s.nextPaymentDate}:${s.gracePeriodEndDate}`).join('|'),
      invoices.map((i) => `${i.id}:${i.status}:${i.dueDate}`).join('|'),
      leads.map((l) => `${l.id}:${l.status}:${l.followUpDate || ''}`).join('|'),
      websites
        .map((w) => `${w.id}:${w.deploymentStatus}:${w.renewalDate || ''}:${w.deploymentIntegrationStatus || ''}`)
        .join('|'),
      JSON.stringify(settings.notificationPreferences || {}),
    ].join('::');

    if (fingerprint === lastSyncFingerprintRef.current) return;
    lastSyncFingerprintRef.current = fingerprint;

    void runNotificationSync().catch((err) => {
      console.error('Notification sync warning:', err);
    });
  }, [
    authReady,
    isAuthorizedAdmin,
    loading,
    notificationsReady,
    subscriptions,
    invoices,
    leads,
    websites,
    settings.notificationPreferences,
    runNotificationSync,
  ]);

  const metrics = useMemo<DashboardMetrics>(() => {
    const today = todayIso();
    const currentMonthPrefix = today.slice(0, 7);

    const nonArchivedClients = clients.filter((c) => !c.archived);
    const activeClients = nonArchivedClients.filter((c) => c.status === 'Active');

    const activeSubs = subscriptions.filter(
      (s) => getEffectiveSubscriptionStatus(s, today) === 'Active'
    );
    const overdueSubs = subscriptions.filter(
      (s) => getEffectiveSubscriptionStatus(s, today) === 'Overdue'
    );
    const renewalWindow = settings.notificationPreferences?.renewalReminderDays ?? 14;
    const upcomingRenewals = subscriptions.filter((s) => {
      const eff = getEffectiveSubscriptionStatus(s, today);
      if (eff !== 'Active' && eff !== 'Pending') return false;
      const diff = daysBetween(today, s.nextPaymentDate);
      return diff >= 0 && diff <= renewalWindow;
    });

    const mrr = subscriptions
      .filter((s) => {
        const eff = getEffectiveSubscriptionStatus(s, today);
        return eff === 'Active' || eff === 'Overdue';
      })
      .reduce((acc, s) => acc + (Number(s.monthlyAmount) || 0), 0);

    const paymentsThisMonth = payments
      .filter((p) => p.status === 'Paid' && p.paymentDate.startsWith(currentMonthPrefix))
      .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

    const unpaidInvoices = invoices.filter(
      (i) => i.status === 'Unpaid' || i.status === 'Overdue'
    );
    const unpaidInvoicesAmount = unpaidInvoices.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    const overdueSubAmount = overdueSubs.reduce((acc, s) => acc + (Number(s.monthlyAmount) || 0), 0);

    const invoicedSubIds = new Set(unpaidInvoices.map((i) => i.subscriptionId).filter(Boolean));
    const uninvoicedOverdueSubAmount = overdueSubs
      .filter((s) => !invoicedSubIds.has(s.id))
      .reduce((acc, s) => acc + (Number(s.monthlyAmount) || 0), 0);
    const outstandingPayments =
      unpaidInvoicesAmount > 0 || overdueSubAmount > 0
        ? unpaidInvoicesAmount + uninvoicedOverdueSubAmount
        : 0;

    const dueFollowUps = leads.filter(
      (l) =>
        l.status !== 'Converted' &&
        l.status !== 'Lost' &&
        Boolean(l.followUpDate) &&
        (l.followUpDate as string) <= today
    );

    const websitesAttention = websites.filter(
      (w) =>
        w.deploymentStatus === 'In Development' ||
        w.deploymentStatus === 'Suspended' ||
        w.deploymentIntegrationStatus === 'failed'
    );

    const unreadNotifications = notifications.filter((n) => !n.read);
    const criticalUnreadCount = unreadNotifications.filter((n) => n.priority === 'Critical').length;

    const totalRemindersCount =
      unreadNotifications.length > 0
        ? unreadNotifications.length
        : upcomingRenewals.length +
          overdueSubs.length +
          dueFollowUps.length +
          unpaidInvoices.length +
          websitesAttention.length;

    return {
      totalClients: nonArchivedClients.length,
      activeClients: activeClients.length,
      totalWebsites: websites.filter((w) => w.deploymentStatus !== 'Archived').length,
      liveWebsites: websites.filter((w) => w.deploymentStatus === 'Live').length,
      activeSubscriptions: activeSubs.length,
      mrr,
      paymentsThisMonth,
      outstandingPayments,
      overdueSubscriptionsCount: overdueSubs.length,
      upcomingRenewalsCount: upcomingRenewals.length,
      dueFollowUpsCount: dueFollowUps.length,
      unpaidInvoicesCount: unpaidInvoices.length,
      websitesAttentionCount: websitesAttention.length,
      totalRemindersCount,
      unreadNotificationsCount: unreadNotifications.length,
      criticalUnreadCount,
    };
  }, [clients, websites, subscriptions, payments, invoices, leads, notifications, settings]);

  return (
    <DataContext.Provider
      value={{
        clients,
        websites,
        subscriptions,
        payments,
        invoices,
        leads,
        activityLogs,
        notifications,
        fcmTokens,
        admins,
        settings,
        loading,
        activityLoading,
        fromCache,
        syncError,
        retrySync,
        metrics,
        runNotificationSync,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used inside DataProvider');
  }
  return ctx;
}
