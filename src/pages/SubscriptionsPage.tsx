import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Pencil,
  RefreshCw,
  Ban,
  AlertTriangle,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../components/ui/ToastContext';
import { SlideOverModal } from '../components/ui/SlideOverModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { StatusIndicator } from '../components/ui/StatusBadge';
import {
  EmptyState,
  ErrorState,
  SummaryStripSkeleton,
  TableSkeleton,
} from '../components/ui/EmptyState';
import {
  PaginationBar,
  SortableTh,
  useTablePagination,
  useTableSort,
} from '../components/ui/DataTableControls';
import {
  createSubscription,
  updateSubscription,
  type SubscriptionInput,
} from '../services/emgFirestore';
import {
  addDaysIso,
  addMonthsIso,
  daysBetween,
  FIELD_LIMITS,
  formatDisplayDate,
  formatKES,
  getEffectiveSubscriptionStatus,
  isPastGracePeriod,
  todayIso,
} from '../lib/validation';
import {
  SUBSCRIPTION_STATUSES,
  type Subscription,
  type SubscriptionStatus,
} from '../types/domain';

interface SubscriptionsPageProps {
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
}

type SubscriptionSortKey = 'clientName' | 'monthlyAmount' | 'nextPaymentDate' | 'gracePeriodEndDate' | 'status';

export function SubscriptionsPage({
  focusedRecordId,
  onClearFocusedRecord,
}: SubscriptionsPageProps) {
  const { subscriptions, clients, settings, loading, syncError, retrySync } = useData();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const { sort, toggleSort } = useTableSort<SubscriptionSortKey>('nextPaymentDate', 'asc');
  const [formOpen, setFormOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [cancellingSub, setCancellingSub] = useState<Subscription | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!focusedRecordId || subscriptions.length === 0) return;
    const match = subscriptions.find((s) => s.id === focusedRecordId);
    if (match) {
      setEditingSub(match);
      setFormState({
        clientId: match.clientId,
        clientName: match.clientName,
        packageName: match.packageName,
        monthlyAmount: match.monthlyAmount,
        startDate: match.startDate,
        nextPaymentDate: match.nextPaymentDate,
        lastPaymentDate: match.lastPaymentDate || '',
        status: match.status,
        gracePeriodDays: match.gracePeriodDays,
        notes: match.notes || '',
      });
      setFormOpen(true);
      onClearFocusedRecord?.();
    }
  }, [focusedRecordId, subscriptions, onClearFocusedRecord]);

  const today = todayIso();
  const currency = settings.currency || 'KES';

  const [formState, setFormState] = useState<SubscriptionInput>({
    clientId: '',
    clientName: '',
    packageName: settings.packages[0]?.name || 'BASIC',
    monthlyAmount: settings.packages[0]?.monthlyPrice || 500,
    startDate: today,
    nextPaymentDate: addMonthsIso(today, 1),
    lastPaymentDate: '',
    status: 'Active',
    gracePeriodDays: settings.defaultGracePeriodDays ?? 7,
    notes: '',
  });

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archived),
    [clients]
  );

  const filteredSubs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = subscriptions.filter((sub) => {
      const eff = getEffectiveSubscriptionStatus(sub, today);
      if (statusFilter === 'UPCOMING') {
        const diff = daysBetween(today, sub.nextPaymentDate);
        if (!((eff === 'Active' || eff === 'Pending') && diff >= 0 && diff <= 14)) return false;
      } else if (statusFilter !== 'ALL' && eff !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        sub.clientName.toLowerCase().includes(q) ||
        sub.subscriptionCode.toLowerCase().includes(q) ||
        sub.packageName.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'monthlyAmount') return (a.monthlyAmount - b.monthlyAmount) * dir;
      if (sort.key === 'clientName') return a.clientName.localeCompare(b.clientName) * dir;
      if (sort.key === 'gracePeriodEndDate')
        return a.gracePeriodEndDate.localeCompare(b.gracePeriodEndDate) * dir;
      if (sort.key === 'status') {
        return (
          getEffectiveSubscriptionStatus(a, today).localeCompare(
            getEffectiveSubscriptionStatus(b, today)
          ) * dir
        );
      }
      return a.nextPaymentDate.localeCompare(b.nextPaymentDate) * dir;
    });
  }, [subscriptions, search, statusFilter, today, sort]);

  const pagination = useTablePagination(filteredSubs, 10);

  const summary = useMemo(() => {
    let activeCount = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    let upcomingCount = 0;
    for (const s of subscriptions) {
      const eff = getEffectiveSubscriptionStatus(s, today);
      if (eff === 'Active') activeCount += 1;
      if (eff === 'Overdue') {
        overdueCount += 1;
        overdueAmount += Number(s.monthlyAmount) || 0;
      }
      const diff = daysBetween(today, s.nextPaymentDate);
      if ((eff === 'Active' || eff === 'Pending') && diff >= 0 && diff <= 14) {
        upcomingCount += 1;
      }
    }
    return { activeCount, overdueCount, overdueAmount, upcomingCount };
  }, [subscriptions, today]);

  const openAddModal = () => {
    const firstClient = activeClients[0];
    const defaultPkg = settings.packages[0];
    setEditingSub(null);
    setFormState({
      clientId: firstClient?.id || '',
      clientName: firstClient?.businessName || '',
      packageName: defaultPkg?.name || 'BASIC',
      monthlyAmount: defaultPkg?.monthlyPrice ?? 500,
      startDate: today,
      nextPaymentDate: addMonthsIso(today, 1),
      lastPaymentDate: '',
      status: 'Active',
      gracePeriodDays: settings.defaultGracePeriodDays ?? 7,
      notes: '',
    });
    setFormOpen(true);
  };

  const openEditModal = (sub: Subscription) => {
    setEditingSub(sub);
    setFormState({
      clientId: sub.clientId,
      clientName: sub.clientName,
      packageName: sub.packageName,
      monthlyAmount: sub.monthlyAmount,
      startDate: sub.startDate,
      nextPaymentDate: sub.nextPaymentDate,
      lastPaymentDate: sub.lastPaymentDate || '',
      status: sub.status,
      gracePeriodDays: sub.gracePeriodDays,
      notes: sub.notes || '',
    });
    setFormOpen(true);
  };

  const handleSelectPackage = (pkgName: string) => {
    if (pkgName === 'CUSTOM') {
      setFormState((prev) => ({ ...prev, packageName: 'CUSTOM' }));
      return;
    }
    const found = settings.packages.find((p) => p.name === pkgName);
    setFormState((prev) => ({
      ...prev,
      packageName: pkgName,
      monthlyAmount: found ? found.monthlyPrice : prev.monthlyAmount,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.clientId) {
      showToast('Select a client for this subscription.', 'error');
      return;
    }
    if (!formState.packageName.trim()) {
      showToast('Package name is required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      if (editingSub) {
        await updateSubscription(editingSub.id, formState);
        showToast(`Updated subscription ${editingSub.subscriptionCode}.`, 'success');
      } else {
        await createSubscription(formState);
        showToast(`Created ${formState.packageName} subscription for ${formState.clientName}.`, 'success');
      }
      setFormOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save subscription.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancellingSub) return;
    setSubmitting(true);
    try {
      await updateSubscription(cancellingSub.id, {
        status: 'Cancelled',
        cancelledAt: todayIso(),
      });
      showToast(`Cancelled subscription ${cancellingSub.subscriptionCode}.`, 'success');
      setCancellingSub(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to cancel subscription.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Package & Overdue Summary Strip */}
      {loading ? (
        <SummaryStripSkeleton cards={3} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Active Subscriptions</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">
              {summary.activeCount}
            </p>
          </div>
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Overdue Subscriptions</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-red-400">
              {summary.overdueCount} · {formatKES(summary.overdueAmount, currency)}
            </p>
          </div>
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Upcoming Renewals (14 days)</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-amber-400">
              {summary.upcomingCount}
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search subscriptions"
              placeholder="Search client, subscription ID, package..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by subscription status"
            className="px-3 py-2 text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="UPCOMING">Upcoming Renewals (14d)</option>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          disabled={activeClients.length === 0}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          New Subscription
        </button>
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : syncError && subscriptions.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredSubs.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={subscriptions.length === 0 ? 'No Subscriptions Created' : 'No Matching Subscriptions'}
          description={
            subscriptions.length === 0
              ? 'Create monthly hosting & management subscriptions using BASIC (KSh 500), BUSINESS (KSh 1,000), PREMIUM (KSh 1,500), or custom pricing.'
              : 'No subscriptions match your current search or filter.'
          }
          actionLabel={
            subscriptions.length === 0 && activeClients.length > 0
              ? 'Create First Subscription'
              : undefined
          }
          onAction={
            subscriptions.length === 0 && activeClients.length > 0 ? openAddModal : undefined
          }
        />
      ) : (
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {pagination.paginatedItems.map((sub) => {
              const eff = getEffectiveSubscriptionStatus(sub, today);
              const pastGrace = isPastGracePeriod(sub, today);
              return (
                <div key={sub.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{sub.clientName}</p>
                      <p className="font-mono-tabular text-xs text-slate-400 mt-0.5">
                        {sub.subscriptionCode} · {sub.packageName}
                      </p>
                    </div>
                    <StatusIndicator status={eff} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Next Payment</p>
                      <p className="font-mono-tabular text-slate-200">
                        {formatDisplayDate(sub.nextPaymentDate)}
                      </p>
                      <p className={`font-mono-tabular mt-0.5 ${pastGrace ? 'text-red-400' : 'text-slate-400'}`}>
                        Grace: {formatDisplayDate(sub.gracePeriodEndDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-500">Monthly Rate</p>
                      <p className="font-mono-tabular font-semibold text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </p>
                      {pastGrace && <p className="text-red-400 font-medium">Grace elapsed</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => openEditModal(sub)}
                      className="px-3 py-2 text-xs font-medium text-blue-300 bg-blue-600/15 rounded-lg min-h-[38px]"
                    >
                      Edit
                    </button>
                    {sub.status !== 'Cancelled' && (
                      <button
                        type="button"
                        onClick={() => setCancellingSub(sub)}
                        className="px-3 py-2 text-xs font-medium text-red-300 bg-red-500/15 rounded-lg min-h-[38px]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-xs font-medium text-slate-400">
                  <SortableTh label="Client & ID" sortKey="clientName" sort={sort} onSort={toggleSort} />
                  <th className="py-3.5 px-4">Package</th>
                  <SortableTh
                    label="Monthly"
                    sortKey="monthlyAmount"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableTh label="Next Payment" sortKey="nextPaymentDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Grace End" sortKey="gracePeriodEndDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {pagination.paginatedItems.map((sub) => {
                  const eff = getEffectiveSubscriptionStatus(sub, today);
                  const pastGrace = isPastGracePeriod(sub, today);
                  return (
                    <tr key={sub.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-white">{sub.clientName}</p>
                        <p className="font-mono-tabular text-xs text-slate-400 mt-0.5">
                          {sub.subscriptionCode} · Started {formatDisplayDate(sub.startDate)}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-200">{sub.packageName}</td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular font-medium text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </td>
                      <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-200">
                        {formatDisplayDate(sub.nextPaymentDate)}
                      </td>
                      <td className="py-3.5 px-4 font-mono-tabular text-xs">
                        <span className={pastGrace ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                          {formatDisplayDate(sub.gracePeriodEndDate)}
                        </span>
                        {pastGrace && (
                          <span className="block text-[11px] text-red-400 mt-0.5">
                            Grace elapsed
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusIndicator status={eff} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(sub)}
                            title="Edit Subscription"
                            aria-label={`Edit ${sub.subscriptionCode}`}
                            className="p-2 text-slate-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-lg transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {sub.status !== 'Cancelled' && (
                            <button
                              type="button"
                              onClick={() => setCancellingSub(sub)}
                              title="Cancel Subscription"
                              aria-label={`Cancel ${sub.subscriptionCode}`}
                              className="p-2 text-slate-400 hover:text-red-400 hover:bg-white/[0.06] rounded-lg transition-colors"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>
      )}

      {/* Add/Edit Subscription Modal */}
      <SlideOverModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingSub ? `Edit ${editingSub.subscriptionCode}` : 'Create Subscription'}
        subtitle="Changing a package updates this subscription; past payment records remain intact."
      >
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          {!editingSub && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Client *</label>
              <select
                required
                value={formState.clientId}
                onChange={(e) => {
                  const found = clients.find((c) => c.id === e.target.value);
                  setFormState({
                    ...formState,
                    clientId: e.target.value,
                    clientName: found?.businessName || '',
                  });
                }}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select client...</option>
                {activeClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.businessName} ({c.clientCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Package *</label>
              <select
                value={
                  settings.packages.some((p) => p.name === formState.packageName)
                    ? formState.packageName
                    : 'CUSTOM'
                }
                onChange={(e) => handleSelectPackage(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {settings.packages.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} — {formatKES(p.monthlyPrice, currency)}/mo
                  </option>
                ))}
                <option value="CUSTOM">Custom Package</option>
              </select>
            </div>

            {!settings.packages.some((p) => p.name === formState.packageName) && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Custom Package Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={formState.packageName}
                  onChange={(e) => setFormState({ ...formState, packageName: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Monthly Amount ({currency}) *
              </label>
              <input
                type="number"
                required
                min={0}
                max={FIELD_LIMITS.maxAmount}
                value={formState.monthlyAmount}
                onChange={(e) =>
                  setFormState({ ...formState, monthlyAmount: Number(e.target.value) || 0 })
                }
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Start Date *</label>
              <input
                type="date"
                required
                value={formState.startDate}
                onChange={(e) => setFormState({ ...formState, startDate: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Next Payment Date *
              </label>
              <input
                type="date"
                required
                value={formState.nextPaymentDate}
                onChange={(e) => setFormState({ ...formState, nextPaymentDate: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Last Payment Date
              </label>
              <input
                type="date"
                value={formState.lastPaymentDate || ''}
                onChange={(e) => setFormState({ ...formState, lastPaymentDate: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Grace Period (Days) *
              </label>
              <input
                type="number"
                min={0}
                max={90}
                required
                value={formState.gracePeriodDays}
                onChange={(e) =>
                  setFormState({ ...formState, gracePeriodDays: Number(e.target.value) || 0 })
                }
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Grace ends: {formatDisplayDate(addDaysIso(formState.nextPaymentDate, formState.gracePeriodDays))}
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Status *</label>
              <select
                value={formState.status}
                onChange={(e) =>
                  setFormState({ ...formState, status: e.target.value as SubscriptionStatus })
                }
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {formState.status === 'Suspended' && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Suspending a subscription does not automatically take down a client website.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Notes</label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.notesMax}
              value={formState.notes || ''}
              onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-white/[0.05] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
            >
              {submitting ? 'Saving...' : editingSub ? 'Save Changes' : 'Create Subscription'}
            </button>
          </div>
        </form>
      </SlideOverModal>

      <ConfirmModal
        open={Boolean(cancellingSub)}
        title="Cancel Subscription"
        description={
          cancellingSub
            ? `Are you sure you want to cancel ${cancellingSub.clientName}'s ${cancellingSub.packageName} subscription (${cancellingSub.subscriptionCode})? Past payments will remain in financial history.`
            : ''
        }
        confirmLabel="Cancel Subscription"
        tone="danger"
        busy={submitting}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancellingSub(null)}
      />
    </div>
  );
}
