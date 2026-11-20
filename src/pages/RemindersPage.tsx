import { useEffect, useMemo, useState } from 'react';
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
  Trash2,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/ToastContext';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorState, TableSkeleton } from '../components/ui/EmptyState';
import { PaginationBar, useTablePagination } from '../components/ui/DataTableControls';
import { PageHeader, SegmentedTabs } from '../components/ui/PageHeader';
import { permanentlyDeleteNotification } from '../services/emgFirestore';
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
  const { isSuperAdmin } = useAuth();

  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('ALL');
  const [historyMode, setHistoryMode] = useState<'active' | 'history'>('active');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [deletingNotification, setDeletingNotification] = useState<NotificationItem | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

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
  } = useTablePagination(filteredNotifications, 12);

  useEffect(() => {
    if (paginatedItems.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !paginatedItems.some((item) => item.id === selectedId)) {
      setSelectedId(paginatedItems[0].id);
    }
  }, [paginatedItems, selectedId]);

  const selectedItem = useMemo(
    () => paginatedItems.find((i) => i.id === selectedId) || paginatedItems[0] || null,
    [paginatedItems, selectedId]
  );

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

  const handlePermanentDeleteNotification = async () => {
    if (!deletingNotification) return;
    setDeletingBusy(true);
    try {
      await permanentlyDeleteNotification(deletingNotification.id);
      showToast('Permanently deleted notification.', 'success');
      if (selectedId === deletingNotification.id) {
        setSelectedId(null);
      }
      setDeletingNotification(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete notification.', 'error');
    } finally {
      setDeletingBusy(false);
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
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Critical
        </span>
      );
    }
    if (priority === 'Warning') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Warning
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400">
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
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Notification Inbox"
        description={`Evaluated in Africa/Nairobi (EAT) with duplicate suppression · ${
          loading
            ? 'Syncing alerts...'
            : `${unreadCount} unread${
                metrics.criticalUnreadCount > 0 ? ` (${metrics.criticalUnreadCount} critical)` : ''
              }`
        }`}
        actions={
          <>
            <button
              type="button"
              onClick={() => void handleRunCheck()}
              disabled={syncing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] text-white border border-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Checking...' : 'Run Check'}
            </button>

            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={markingAll || loading || unreadCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] text-white border border-white/[0.08] rounded-lg transition-colors disabled:opacity-40"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
              Mark All Read
            </button>

            {permission === 'granted' && activeTokens.length > 0 ? (
              <button
                type="button"
                onClick={() => void handlePreviewSystemNotification()}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg transition-colors"
              >
                <Bell className="w-3.5 h-3.5" />
                Test Push
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
                  ? 'Enabling...'
                  : vapidConfigured
                  ? 'Enable Web Push'
                  : 'Setup Web Push'}
              </button>
            )}

            <button
              type="button"
              onClick={() => onNavigate('settings')}
              aria-label="Notification preferences"
              className="p-2 min-h-[38px] min-w-[38px] inline-flex items-center justify-center text-zinc-400 hover:text-white bg-[#111216] hover:bg-white/[0.06] border border-white/[0.08] rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </>
        }
      />

      {/* Filter & Search Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <SegmentedTabs
            value={activeFilter}
            onChange={setActiveFilter}
            options={filterTabs.map((t) => ({
              id: t.id,
              label: t.label,
              count: loading ? undefined : t.count,
            }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px] sm:w-64">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search notifications"
              placeholder="Search client, phone, alert..."
              className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs bg-[#111216] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <SegmentedTabs
            value={historyMode}
            onChange={setHistoryMode}
            options={[
              { id: 'active', label: 'Inbox' },
              { id: 'history', label: 'Read History' },
            ]}
          />
        </div>
      </div>

      {/* Linear-style Master-Detail Inbox */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : syncError && notifications.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredNotifications.length === 0 ? (
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-12 text-center space-y-2">
          <Bell className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="font-display text-sm font-semibold text-white">
            {historyMode === 'history' ? 'No read alerts in history' : 'Inbox zero'}
          </p>
          <p className="text-xs text-zinc-400">
            {historyMode === 'history'
              ? 'Notifications marked as read will appear here.'
              : 'Your business deadlines, subscriptions, invoices, and leads are clear for this view.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left Master List */}
          <div className="xl:col-span-7 bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="divide-y divide-white/[0.06]">
              {paginatedItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`p-4 transition-colors ${
                      isSelected
                        ? 'bg-blue-600/[0.08]'
                        : item.read
                        ? 'opacity-70 hover:bg-white/[0.025]'
                        : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="w-full text-left space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {!item.read && (
                            <span
                              className="w-2 h-2 rounded-full bg-blue-500 shrink-0"
                              aria-label="Unread alert"
                            />
                          )}
                          {priorityIndicator(item.priority)}
                          <span className="text-[11px] text-zinc-600">·</span>
                          <span className="text-[11px] text-zinc-400 truncate">
                            {categoryLabel(item.category)}
                          </span>
                        </div>
                        <span className="font-mono-tabular text-[11px] text-zinc-500 whitespace-nowrap shrink-0">
                          {formatTimestampNairobi(item.createdAt)}
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                      <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                        {item.message}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-zinc-400">
                        {item.clientName && <span>{item.clientName}</span>}
                        {typeof item.amount === 'number' && item.amount > 0 && (
                          <span className="font-mono-tabular font-semibold text-zinc-200">
                            {formatKES(item.amount, currency)}
                          </span>
                        )}
                        {item.dueDate && (
                          <span className="font-mono-tabular text-zinc-400">
                            Due {formatDisplayDate(item.dueDate)}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Mobile / Compact Quick Actions */}
                    <div className="xl:hidden flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
                      {!item.read && (
                        <button
                          type="button"
                          onClick={() => void handleMarkOneRead(item.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-200 bg-white/[0.05] rounded-md"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Mark Read
                        </button>
                      )}
                      {item.clientId && item.entityType === 'subscription' && (
                        <button
                          type="button"
                          onClick={() => handleOpenRecord(item, 'clients', item.clientId)}
                          className="px-3 py-1.5 text-xs font-medium text-zinc-200 bg-white/[0.05] rounded-md"
                        >
                          View Client
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenRecord(item)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-300 bg-blue-600/20 rounded-md ml-auto"
                      >
                        Open Record
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => setDeletingNotification(item)}
                          aria-label={`Delete notification ${item.title}`}
                          className="p-1.5 text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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

          {/* Right Focused Detail Inspector (Desktop) */}
          {selectedItem && (
            <div className="hidden xl:block xl:col-span-5 bg-[#111216] border border-white/[0.08] rounded-xl p-6 sticky top-20 space-y-5">
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/[0.07]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {priorityIndicator(selectedItem.priority)}
                    <span className="text-xs text-zinc-600">·</span>
                    <span className="text-xs text-zinc-400">
                      {categoryLabel(selectedItem.category)}
                    </span>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-white">
                    {selectedItem.title}
                  </h3>
                </div>
                {!selectedItem.read && (
                  <span className="text-[11px] font-semibold text-blue-400">Unread</span>
                )}
              </div>

              <p className="text-sm text-zinc-300 leading-relaxed">{selectedItem.message}</p>

              <div className="rounded-lg bg-[#0D0E12] border border-white/[0.07] divide-y divide-white/[0.06] text-xs">
                {selectedItem.clientName && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-zinc-500 inline-flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" />
                      Client / Account
                    </span>
                    <span className="font-medium text-white">{selectedItem.clientName}</span>
                  </div>
                )}
                {typeof selectedItem.amount === 'number' && selectedItem.amount > 0 && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-zinc-500">Amount Involved</span>
                    <span className="font-mono-tabular font-semibold text-white">
                      {formatKES(selectedItem.amount, currency)}
                    </span>
                  </div>
                )}
                {selectedItem.dueDate && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-zinc-500 inline-flex items-center gap-1.5">
                      <CalendarClock className="w-3.5 h-3.5" />
                      Deadline
                    </span>
                    <span className="font-mono-tabular text-zinc-200">
                      {formatDisplayDate(selectedItem.dueDate)}
                    </span>
                  </div>
                )}
                {selectedItem.phone && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-zinc-500 inline-flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5" />
                      Contact Phone
                    </span>
                    <span className="font-mono-tabular text-zinc-200">{selectedItem.phone}</span>
                  </div>
                )}
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Generated (EAT)</span>
                  <span className="font-mono-tabular text-zinc-300">
                    {formatTimestampNairobi(selectedItem.createdAt)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleOpenRecord(selectedItem)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                >
                  Open Linked Record
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                {selectedItem.clientId && selectedItem.entityType === 'subscription' && (
                  <button
                    type="button"
                    onClick={() =>
                      handleOpenRecord(selectedItem, 'clients', selectedItem.clientId)
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] rounded-lg transition-colors"
                  >
                    View Client Profile
                  </button>
                )}

                {!selectedItem.read && (
                  <button
                    type="button"
                    onClick={() => void handleMarkOneRead(selectedItem.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Mark Read
                  </button>
                )}

                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => setDeletingNotification(selectedItem)}
                    title="Permanently Delete Notification"
                    aria-label={`Delete notification ${selectedItem.title}`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(deletingNotification)}
        title="Permanently Delete Notification"
        description={
          deletingNotification
            ? `Permanently delete alert "${deletingNotification.title}"? Note: if the underlying overdue client/subscription record still exists, automated alert checks may regenerate active deadline alerts.`
            : ''
        }
        confirmLabel="Permanently Delete"
        tone="danger"
        requireConfirmText="DELETE"
        busy={deletingBusy}
        onConfirm={handlePermanentDeleteNotification}
        onCancel={() => setDeletingNotification(null)}
      />
    </div>
  );
}
