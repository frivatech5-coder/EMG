import { useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  AlertTriangle,
  Clock,
  Info,
  Check,
  CheckCheck,
  RefreshCw,
  ArrowRight,
  Search,
  Phone,
  CalendarClock,
  User,
  Settings,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../components/ui/ToastContext';
import { ErrorState, TableSkeleton } from '../components/ui/EmptyState';
import { PaginationBar, useTablePagination } from '../components/ui/DataTableControls';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationsEngine';
import {
  enableBrowserPushNotifications,
  getBrowserNotificationPermission,
  sendLocalBrowserNotificationPreview,
} from '../lib/messaging';
import { ENV_VAPID_KEY } from '../lib/firebase';
import { formatDisplayDate, formatKES, NAIROBI_TIMEZONE } from '../lib/validation';
import type {
  NavSection,
  NotificationCategory,
  NotificationItem,
  NotificationPriority,
} from '../types/domain';

interface RemindersPageProps {
  onNavigate: (section: NavSection, recordId?: string) => void;
}

type NotificationFilter =
  | 'ALL'
  | 'UNREAD'
  | 'CRITICAL'
  | 'payments'
  | 'subscriptions'
  | 'leads'
  | 'websites';

function formatTimestampNairobi(ts: NotificationItem['createdAt']): string {
  if (!ts || typeof ts.toDate !== 'function') return 'Just now';
  try {
    return ts.toDate().toLocaleString('en-KE', {
      timeZone: NAIROBI_TIMEZONE,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Recent';
  }
}

export function RemindersPage({ onNavigate }: RemindersPageProps) {
  const {
    notifications,
    fcmTokens,
    settings,
    metrics,
    loading,
    syncError,
    retrySync,
    runNotificationSync,
  } = useData();
  const { showToast } = useToast();

  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('ALL');
  const [historyMode, setHistoryMode] = useState<'active' | 'history'>('active');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);

  const currency = settings.currency || 'KES';
  const permission = getBrowserNotificationPermission();
  const activeTokens = fcmTokens.filter((t) => t.enabled);
  const vapidConfigured = Boolean(
    settings.notificationPreferences?.vapidPublicKey || ENV_VAPID_KEY
  );

  const unreadCount = metrics.unreadNotificationsCount;

  const filterCounts = useMemo(() => {
    const base =
      historyMode === 'history'
        ? notifications.filter((n) => n.read)
        : notifications;
    return {
      ALL: base.length,
      UNREAD: notifications.filter((n) => !n.read).length,
      CRITICAL: base.filter((n) => n.priority === 'Critical').length,
      payments: base.filter((n) => n.category === 'payments').length,
      subscriptions: base.filter((n) => n.category === 'subscriptions').length,
      leads: base.filter((n) => n.category === 'leads').length,
      websites: base.filter((n) => n.category === 'websites').length,
    };
  }, [notifications, historyMode]);

  const filteredNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications.filter((item) => {
      if (historyMode === 'history' && !item.read) return false;
      if (activeFilter === 'UNREAD' && item.read) return false;
      if (activeFilter === 'CRITICAL' && item.priority !== 'Critical') return false;
      if (
        (activeFilter === 'payments' ||
          activeFilter === 'subscriptions' ||
          activeFilter === 'leads' ||
          activeFilter === 'websites') &&
        item.category !== activeFilter
      ) {
        return false;
      }

      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q) ||
        (item.clientName || '').toLowerCase().includes(q) ||
        (item.phone || '').toLowerCase().includes(q)
      );
    });
  }, [notifications, activeFilter, historyMode, search]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    totalPages,
    paginatedItems,
  } = useTablePagination(filteredNotifications, 10);

  const handleRunCheck = async () => {
    setSyncing(true);
    try {
      const created = await runNotificationSync();
      showToast(
        created > 0
          ? `Notification check complete: ${created} new alert${created === 1 ? '' : 's'} generated.`
          : 'Notification check complete: all alerts are up to date.',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Notification check failed.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(unreadIds);
      showToast(`Marked ${unreadIds.length} notification${unreadIds.length === 1 ? '' : 's'} as read.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to mark notifications read.', 'error');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleMarkOneRead = async (id: string) => {
    try {
      await markNotificationRead(id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update notification.', 'error');
    }
  };

  const handleOpenRecord = (item: NotificationItem, overrideSection?: NavSection, overrideId?: string) => {
    if (!item.read) {
      void markNotificationRead(item.id).catch(() => undefined);
    }
    onNavigate(overrideSection || item.targetSection, overrideId || item.recordId);
  };

  const handleQuickEnablePush = async () => {
    setEnablingPush(true);
    try {
      const result = await enableBrowserPushNotifications({
        vapidPublicKey: settings.notificationPreferences?.vapidPublicKey,
      });
      if (result.ok) {
        showToast(result.message, 'success');
      } else if (result.reason === 'missing_vapid_key') {
        showToast(result.message, 'info');
        onNavigate('settings');
      } else {
        showToast(result.message, 'error');
      }
    } finally {
      setEnablingPush(false);
    }
  };

  const handlePreviewSystemNotification = async () => {
    const topAlert = notifications.find((n) => !n.read) || notifications[0];
    const res = await sendLocalBrowserNotificationPreview({
      title: topAlert ? topAlert.title : 'EMG Web Solutions Notification Test',
      body: topAlert
        ? topAlert.message
        : 'Browser notification delivery is working on this device.',
      targetSection: topAlert?.targetSection || 'reminders',
      recordId: topAlert?.recordId || '',
    });
    showToast(res.message, res.ok ? 'success' : 'error');
  };

  const priorityIndicator = (priority: NotificationPriority) => {
    if (priority === 'Critical') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Critical
        </span>
      );
    }
    if (priority === 'Warning') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Warning
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400">
        <Info className="w-3.5 h-3.5 shrink-0" />
        Info
      </span>
    );
  };

  const categoryLabel = (category: NotificationCategory) => {
    const map: Record<NotificationCategory, string> = {
      subscriptions: 'Subscription',
      payments: 'Payment / Invoice',
      leads: 'CRM Lead',
      websites: 'Website / Domain',
    };
    return map[category];
  };

  const filterTabs: Array<{ id: NotificationFilter; label: string; count: number }> = [
    { id: 'ALL', label: 'All', count: filterCounts.ALL },
    { id: 'UNREAD', label: 'Unread', count: filterCounts.UNREAD },
    { id: 'CRITICAL', label: 'Critical', count: filterCounts.CRITICAL },
    { id: 'payments', label: 'Payments', count: filterCounts.payments },
    { id: 'subscriptions', label: 'Subscriptions', count: filterCounts.subscriptions },
    { id: 'leads', label: 'Leads', count: filterCounts.leads },
    { id: 'websites', label: 'Websites', count: filterCounts.websites },
  ];

  return (
    <div className="space-y-6">
      {/* Header Summary & Push Status Strip */}
      <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <BellRing className="w-5 h-5 text-blue-400 shrink-0" />
            <h2 className="text-base font-semibold text-white">
              Smart Notification & Reminder Centre
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Evaluated in Africa/Nairobi (EAT) with automatic duplicate prevention.{' '}
            {loading ? (
              <span>Syncing live alert stream...</span>
            ) : (
              <>
                <span className="font-mono-tabular text-slate-200">{unreadCount}</span> unread alert
                {unreadCount === 1 ? '' : 's'}
                {metrics.criticalUnreadCount > 0
                  ? ` (${metrics.criticalUnreadCount} critical)`
                  : ''}
                .
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleRunCheck()}
            disabled={syncing || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Checking...' : 'Run Check Now'}
          </button>

          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={markingAll || loading || unreadCount === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg transition-colors disabled:opacity-40"
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
            Mark All Read
          </button>

          {permission === 'granted' && activeTokens.length > 0 ? (
            <button
              type="button"
              onClick={() => void handlePreviewSystemNotification()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg transition-colors"
            >
              <Bell className="w-3.5 h-3.5" />
              Test Browser Notification
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleQuickEnablePush()}
              disabled={enablingPush}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <BellRing className="w-3.5 h-3.5" />
              {enablingPush
                ? 'Enabling Push...'
                : vapidConfigured
                ? 'Enable Web Push'
                : 'Configure Web Push'}
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium text-slate-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] rounded-lg transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Preferences
          </button>
        </div>
      </div>

      {/* Filters, Search & View Mode */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterTabs.map((tab) => {
              const active = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors border ${
                    active
                      ? 'bg-blue-600/20 text-blue-300 border-blue-500/35'
                      : 'bg-[#11131A] text-slate-300 hover:text-white border-white/[0.08] hover:bg-white/[0.04]'
                  }`}
                >
                  <span>{tab.label}</span>
                  {!loading && (
                    <span className="font-mono-tabular text-[11px] opacity-80">{tab.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-[#11131A] border border-white/[0.08] p-0.5">
              <button
                type="button"
                onClick={() => setHistoryMode('active')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  historyMode === 'active'
                    ? 'bg-white/[0.1] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Stream
              </button>
              <button
                type="button"
                onClick={() => setHistoryMode('history')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  historyMode === 'history'
                    ? 'bg-white/[0.1] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Read History
              </button>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search notifications"
            placeholder="Search client, phone, title, or alert details..."
            className="w-full pl-9 pr-3 py-2 min-h-[40px] text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Notification List */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : syncError && notifications.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredNotifications.length === 0 ? (
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-10 text-center space-y-2">
          <Bell className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-medium text-white">No notifications match this filter</p>
          <p className="text-xs text-slate-400">
            {historyMode === 'history'
              ? 'Notifications marked as read will appear here in your audit history.'
              : 'Your business deadlines, subscriptions, invoices, and leads are clear for this view.'}
          </p>
        </div>
      ) : (
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="divide-y divide-white/[0.06]">
            {paginatedItems.map((item) => (
              <div
                key={item.id}
                className={`p-4 sm:p-5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  item.read ? 'bg-transparent opacity-75' : 'bg-white/[0.015]'
                }`}
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {priorityIndicator(item.priority)}
                    <span className="text-[11px] text-slate-600">·</span>
                    <span className="text-[11px] font-medium text-slate-400">
                      {categoryLabel(item.category)}
                    </span>
                    <span className="text-[11px] text-slate-600">·</span>
                    <span className="text-[11px] text-slate-400">
                      {formatTimestampNairobi(item.createdAt)}
                    </span>
                    {!item.read && (
                      <span className="text-[11px] font-semibold text-blue-400">Unread</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenRecord(item)}
                    className="text-left block group"
                  >
                    <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{item.message}</p>
                  </button>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-400">
                    {item.clientName && (
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        {item.clientName}
                      </span>
                    )}
                    {typeof item.amount === 'number' && item.amount > 0 && (
                      <span className="font-mono-tabular font-semibold text-slate-200">
                        {formatKES(item.amount, currency)}
                      </span>
                    )}
                    {item.dueDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="w-3.5 h-3.5 text-slate-500" />
                        Deadline: {formatDisplayDate(item.dueDate)}
                      </span>
                    )}
                    {item.phone && (
                      <span className="inline-flex items-center gap-1 font-mono-tabular">
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                        {item.phone}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {!item.read && (
                    <button
                      type="button"
                      onClick={() => void handleMarkOneRead(item.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Mark Read
                    </button>
                  )}

                  {item.clientId && item.entityType === 'subscription' && (
                    <button
                      type="button"
                      onClick={() => handleOpenRecord(item, 'clients', item.clientId)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors"
                    >
                      View Client
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenRecord(item)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] text-xs font-semibold text-blue-300 hover:text-white bg-blue-600/15 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg transition-colors"
                  >
                    Open Record
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <PaginationBar
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </div>
  );
}
