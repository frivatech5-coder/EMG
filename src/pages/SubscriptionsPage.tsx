import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Pencil,
  RefreshCw,
  Ban,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
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
import { INPUT_CLASS, PageHeader, SegmentedTabs } from '../components/ui/PageHeader';
import {
  PaginationBar,
  SortableTh,
  useTablePagination,
  useTableSort,
} from '../components/ui/DataTableControls';
import {
  createSubscription,
  permanentlyDeleteSubscription,
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

type SubscriptionSortKey =
  | 'clientName'
  | 'monthlyAmount'
  | 'nextPaymentDate'
  | 'gracePeriodEndDate'
  | 'status';

export function SubscriptionsPage({
  focusedRecordId,
  onClearFocusedRecord,
}: SubscriptionsPageProps) {
  const { subscriptions, clients, settings, loading, syncError, retrySync } = useData();
  const { showToast } = useToast();
  const { isSuperAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const { sort, toggleSort } = useTableSort<SubscriptionSortKey>('nextPaymentDate', 'asc');
  const [formOpen, setFormOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [cancellingSub, setCancellingSub] = useState<Subscription | null>(null);
  const [deletingSub, setDeletingSub] = useState<Subscription | null>(null);
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

  const summary = useMemo(() => {
    let activeCount = 0;
    let activeMrr = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    let upcomingCount = 0;
    let cancelledCount = 0;
    for (const s of subscriptions) {
      const eff = getEffectiveSubscriptionStatus(s, today);
      if (eff === 'Active') {
        activeCount += 1;
        activeMrr += Number(s.monthlyAmount) || 0;
      }
      if (eff === 'Overdue') {
        overdueCount += 1;
        overdueAmount += Number(s.monthlyAmount) || 0;
      }
      if (eff === 'Cancelled') cancelledCount += 1;
      const diff = daysBetween(today, s.nextPaymentDate);
      if ((eff === 'Active' || eff === 'Pending') && diff >= 0 && diff <= 14) {
        upcomingCount += 1;
      }
    }
    return {
      activeCount,
      activeMrr,
      overdueCount,
      overdueAmount,
      upcomingCount,
      cancelledCount,
    };
  }, [subscriptions, today]);

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
        showToast(
          `Created ${formState.packageName} subscription for ${formState.clientName}.`,
          'success'
        );
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

  const handlePermanentDeleteSub = async () => {
    if (!deletingSub) return;
    setSubmitting(true);
    try {
      await permanentlyDeleteSubscription(deletingSub);
      showToast(`Permanently deleted subscription ${deletingSub.subscriptionCode}.`, 'success');
      setDeletingSub(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete subscription.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const renderCycleTimeline = (sub: Subscription, effStatus: string) => {
    if (effStatus === 'Cancelled') {
      return <span className="text-[11px] text-zinc-500">Ended</span>;
    }
    const daysToDue = daysBetween(today, sub.nextPaymentDate);
    const graceLeft = daysBetween(today, sub.gracePeriodEndDate);
    const pastGrace = isPastGracePeriod(sub, today);

    if (pastGrace) {
      return (
        <div className="space-y-1 min-w-[110px]">
          <span className="text-[11px] font-medium text-red-400 block">
            Grace elapsed ({Math.abs(graceLeft)}d)
          </span>
          <div className="h-1 w-full rounded-full bg-red-500/20 overflow-hidden">
            <div className="h-full w-full bg-red-500" />
          </div>
        </div>
      );
    }

    if (effStatus === 'Overdue') {
      const totalGrace = Math.max(1, sub.gracePeriodDays || 7);
      const pct = Math.max(10, Math.min(100, Math.round((graceLeft / totalGrace) * 100)));
      return (
        <div className="space-y-1 min-w-[110px]">
          <span className="text-[11px] font-medium text-amber-400 block">
            {graceLeft === 0 ? 'Grace ends today' : `${graceLeft}d grace left`}
          </span>
          <div className="h-1 w-full rounded-full bg-amber-500/20 overflow-hidden">
            <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }

    const cycleProgress = Math.max(8, Math.min(100, Math.round(((30 - Math.max(0, daysToDue)) / 30) * 100)));
    return (
      <div className="space-y-1 min-w-[110px]">
        <span className="text-[11px] text-zinc-400 block">
          {daysToDue === 0
            ? 'Due today'
            : daysToDue > 0
            ? `Due in ${daysToDue}d`
            : `${Math.abs(daysToDue)}d past due`}
        </span>
        <div className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${cycleProgress}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Recurring Subscriptions"
        description="Monitor monthly renewal schedules, package tiers, and grace-period deadlines."
        actions={
          <button
            type="button"
            onClick={openAddModal}
            disabled={activeClients.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            New Subscription
          </button>
        }
      />

      {/* Unified Billing Portfolio Strip */}
      {loading ? (
        <SummaryStripSkeleton cards={4} />
      ) : (
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Active Plans</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">
              {summary.activeCount}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Active Monthly Value</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-blue-400">
              {formatKES(summary.activeMrr, currency)}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Overdue Exposure</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-red-400">
              {summary.overdueCount} · {formatKES(summary.overdueAmount, currency)}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Upcoming Renewals (14d)</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-amber-400">
              {summary.upcomingCount}
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All', count: subscriptions.length },
            { id: 'Active', label: 'Active', count: summary.activeCount },
            { id: 'UPCOMING', label: 'Due 14d', count: summary.upcomingCount },
            { id: 'Overdue', label: 'Overdue', count: summary.overdueCount },
            { id: 'Cancelled', label: 'Cancelled', count: summary.cancelledCount },
          ]}
        />

        <div className="relative flex-1 min-w-[220px] lg:max-w-xs">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search subscriptions"
            placeholder="Search client, code, package..."
            className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs bg-[#111216] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
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
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
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
                      <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                        {sub.subscriptionCode} · {sub.packageName}
                      </p>
                    </div>
                    <StatusIndicator status={eff} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-zinc-500">Next Payment</p>
                      <p className="font-mono-tabular text-zinc-200">
                        {formatDisplayDate(sub.nextPaymentDate)}
                      </p>
                      <p className={`font-mono-tabular mt-0.5 ${pastGrace ? 'text-red-400' : 'text-zinc-400'}`}>
                        Grace: {formatDisplayDate(sub.gracePeriodEndDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-zinc-500">Monthly Rate</p>
                      <p className="font-mono-tabular font-semibold text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </p>
                      <div className="mt-1">{renderCycleTimeline(sub, eff)}</div>
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
                        className="px-3 py-2 text-xs font-medium text-amber-300 bg-amber-500/15 rounded-lg min-h-[38px]"
                      >
                        Cancel
                      </button>
                    )}
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setDeletingSub(sub)}
                        aria-label={`Permanently delete ${sub.subscriptionCode}`}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg min-h-[38px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop High-Density Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.07] bg-[#0D0E12]">
                  <SortableTh label="Client & Plan" sortKey="clientName" sort={sort} onSort={toggleSort} />
                  <SortableTh
                    label="Rate"
                    sortKey="monthlyAmount"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableTh label="Next Due" sortKey="nextPaymentDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Grace End" sortKey="gracePeriodEndDate" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Cycle Window
                  </th>
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {pagination.paginatedItems.map((sub) => {
                  const eff = getEffectiveSubscriptionStatus(sub, today);
                  const pastGrace = isPastGracePeriod(sub, today);
                  return (
                    <tr key={sub.id} className="hover:bg-white/[0.025] transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-medium text-white">{sub.clientName}</p>
                        <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                          {sub.subscriptionCode} · {sub.packageName}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular font-medium text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-xs text-zinc-200">
                        {formatDisplayDate(sub.nextPaymentDate)}
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-xs">
                        <span className={pastGrace ? 'text-red-400 font-semibold' : 'text-zinc-300'}>
                          {formatDisplayDate(sub.gracePeriodEndDate)}
                        </span>
                      </td>
                      <td className="py-3 px-4">{renderCycleTimeline(sub, eff)}</td>
                      <td className="py-3 px-4">
                        <StatusIndicator status={eff} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(sub)}
                            title="Edit Subscription"
                            aria-label={`Edit ${sub.subscriptionCode}`}
                            className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {sub.status !== 'Cancelled' && (
                            <button
                              type="button"
                              onClick={() => setCancellingSub(sub)}
                              title="Cancel Subscription"
                              aria-label={`Cancel ${sub.subscriptionCode}`}
                              className="p-2 text-zinc-400 hover:text-amber-400 hover:bg-white/[0.06] rounded-md transition-colors"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => setDeletingSub(sub)}
                              title="Permanently Delete Subscription"
                              aria-label={`Permanently delete ${sub.subscriptionCode}`}
                              className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
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
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Client *</label>
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
                className={INPUT_CLASS}
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
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Package *</label>
              <select
                value={
                  settings.packages.some((p) => p.name === formState.packageName)
                    ? formState.packageName
                    : 'CUSTOM'
                }
                onChange={(e) => handleSelectPackage(e.target.value)}
                className={INPUT_CLASS}
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
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Custom Package Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={formState.packageName}
                  onChange={(e) => setFormState({ ...formState, packageName: e.target.value })}
                  className={INPUT_CLASS}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
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
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Start Date *</label>
              <input
                type="date"
                required
                value={formState.startDate}
                onChange={(e) => setFormState({ ...formState, startDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Next Payment Date *
              </label>
              <input
                type="date"
                required
                value={formState.nextPaymentDate}
                onChange={(e) => setFormState({ ...formState, nextPaymentDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Last Payment Date
              </label>
              <input
                type="date"
                value={formState.lastPaymentDate || ''}
                onChange={(e) => setFormState({ ...formState, lastPaymentDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
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
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                Grace ends: {formatDisplayDate(addDaysIso(formState.nextPaymentDate, formState.gracePeriodDays))}
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Status *</label>
              <select
                value={formState.status}
                onChange={(e) =>
                  setFormState({ ...formState, status: e.target.value as SubscriptionStatus })
                }
                className={INPUT_CLASS}
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
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Notes</label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.notesMax}
              value={formState.notes || ''}
              onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white bg-white/[0.05] rounded-lg"
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
        tone="warning"
        busy={submitting}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancellingSub(null)}
      />

      <ConfirmModal
        open={Boolean(deletingSub)}
        title="Permanently Delete Subscription"
        description={
          deletingSub
            ? `Permanently delete subscription ${deletingSub.subscriptionCode} for ${deletingSub.clientName} and its linked alerts? This cannot be undone.`
            : ''
        }
        confirmLabel="Permanently Delete"
        tone="danger"
        requireConfirmText="DELETE"
        busy={submitting}
        onConfirm={handlePermanentDeleteSub}
        onCancel={() => setDeletingSub(null)}
      />
    </div>
  );
}
