import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  CreditCard,
  ShieldCheck,
  RotateCcw,
  Copy,
  Check,
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
  INPUT_CLASS,
  PageHeader,
  SELECT_CLASS,
  SegmentedTabs,
} from '../components/ui/PageHeader';
import {
  PaginationBar,
  SortableTh,
  useTablePagination,
  useTableSort,
} from '../components/ui/DataTableControls';
import {
  recordManualPayment,
  updatePaymentStatus,
  type PaymentInput,
} from '../services/emgFirestore';
import {
  FIELD_LIMITS,
  formatDisplayDate,
  formatKES,
  getEffectiveSubscriptionStatus,
  todayIso,
} from '../lib/validation';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
} from '../types/domain';

interface PaymentsPageProps {
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
}

type PaymentSortKey = 'clientName' | 'method' | 'paymentDate' | 'amount' | 'status';

export function PaymentsPage({ focusedRecordId, onClearFocusedRecord }: PaymentsPageProps) {
  const { payments, clients, subscriptions, invoices, settings, loading, syncError, retrySync } =
    useData();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const { sort, toggleSort } = useTableSort<PaymentSortKey>('paymentDate', 'desc');
  const [formOpen, setFormOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    payment: Payment;
    nextStatus: PaymentStatus;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!focusedRecordId || payments.length === 0) return;
    const match = payments.find((p) => p.id === focusedRecordId);
    if (match) {
      setSearch(match.paymentCode);
      setMethodFilter('ALL');
      setStatusFilter('ALL');
      onClearFocusedRecord?.();
    }
  }, [focusedRecordId, payments, onClearFocusedRecord]);

  const today = todayIso();
  const currency = settings.currency || 'KES';

  const [formState, setFormState] = useState<PaymentInput>({
    clientId: '',
    clientName: '',
    subscriptionId: '',
    invoiceId: '',
    amount: 500,
    method: 'M-Pesa',
    transactionReference: '',
    paymentDate: today,
    status: 'Paid',
    notes: '',
  });

  const paymentSummary = useMemo(() => {
    let paidTotal = 0;
    let mpesaTotal = 0;
    let otherPaidTotal = 0;
    let pendingTotal = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let refundedCount = 0;
    let failedCount = 0;
    for (const p of payments) {
      const amt = Number(p.amount) || 0;
      if (p.status === 'Paid') {
        paidTotal += amt;
        paidCount += 1;
        if (p.method === 'M-Pesa') mpesaTotal += amt;
        else otherPaidTotal += amt;
      } else if (p.status === 'Pending') {
        pendingTotal += amt;
        pendingCount += 1;
      } else if (p.status === 'Refunded') {
        refundedCount += 1;
      } else if (p.status === 'Failed') {
        failedCount += 1;
      }
    }
    return {
      paidTotal,
      mpesaTotal,
      otherPaidTotal,
      pendingTotal,
      paidCount,
      pendingCount,
      refundedCount,
      failedCount,
    };
  }, [payments]);

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = payments.filter((p) => {
      if (methodFilter !== 'ALL' && p.method !== methodFilter) return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.clientName.toLowerCase().includes(q) ||
        p.transactionReference.toLowerCase().includes(q) ||
        p.paymentCode.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'amount') return (a.amount - b.amount) * dir;
      if (sort.key === 'clientName') return a.clientName.localeCompare(b.clientName) * dir;
      if (sort.key === 'method') return a.method.localeCompare(b.method) * dir;
      if (sort.key === 'status') return a.status.localeCompare(b.status) * dir;
      return a.paymentDate.localeCompare(b.paymentDate) * dir;
    });
  }, [payments, search, methodFilter, statusFilter, sort]);

  const pagination = useTablePagination(filteredPayments, 10);

  const unpaidSubscriptions = useMemo(() => {
    return subscriptions.filter((s) => {
      const eff = getEffectiveSubscriptionStatus(s, today);
      return eff === 'Overdue' || eff === 'Pending';
    });
  }, [subscriptions, today]);

  const openRecordModal = (prefill?: {
    clientId: string;
    subscriptionId?: string;
    invoiceId?: string;
    amount?: number;
  }) => {
    const targetClient =
      clients.find((c) => c.id === prefill?.clientId) || clients.find((c) => !c.archived) || clients[0];
    setFormState({
      clientId: targetClient?.id || '',
      clientName: targetClient?.businessName || '',
      subscriptionId: prefill?.subscriptionId || '',
      invoiceId: prefill?.invoiceId || '',
      amount: prefill?.amount ?? targetClient?.monthlyAmount ?? 500,
      method: 'M-Pesa',
      transactionReference: '',
      paymentDate: todayIso(),
      status: 'Paid',
      notes: '',
    });
    setFormOpen(true);
  };

  const clientSubscriptions = useMemo(
    () => subscriptions.filter((s) => s.clientId === formState.clientId && s.status !== 'Cancelled'),
    [subscriptions, formState.clientId]
  );

  const clientUnpaidInvoices = useMemo(
    () =>
      invoices.filter(
        (i) => i.clientId === formState.clientId && (i.status === 'Unpaid' || i.status === 'Overdue')
      ),
    [invoices, formState.clientId]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.clientId) {
      showToast('Select a client before recording a payment.', 'error');
      return;
    }
    if (!formState.transactionReference.trim() || formState.transactionReference.trim().length < 2) {
      showToast('Enter a valid M-Pesa/Bank/PayPal transaction reference.', 'error');
      return;
    }
    if (!formState.amount || formState.amount <= 0) {
      showToast('Payment amount must be greater than zero.', 'error');
      return;
    }

    const linkedSub = subscriptions.find((s) => s.id === formState.subscriptionId);
    const linkedInv = invoices.find((i) => i.id === formState.invoiceId);

    setSubmitting(true);
    try {
      await recordManualPayment(formState, linkedSub, linkedInv);
      showToast(
        `Recorded ${formState.method} payment (${formState.transactionReference}) for ${formState.clientName}.`,
        'success'
      );
      setFormOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record payment.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmStatusUpdate = async () => {
    if (!statusTarget) return;
    setSubmitting(true);
    try {
      const linkedSub = statusTarget.payment.subscriptionId
        ? subscriptions.find((s) => s.id === statusTarget.payment.subscriptionId)
        : undefined;
      const linkedInv = statusTarget.payment.invoiceId
        ? invoices.find((i) => i.id === statusTarget.payment.invoiceId)
        : undefined;
      await updatePaymentStatus(
        statusTarget.payment.id,
        statusTarget.nextStatus,
        undefined,
        linkedSub,
        linkedInv
      );
      showToast(
        `Updated payment ${statusTarget.payment.paymentCode} to ${statusTarget.nextStatus}.`,
        'success'
      );
      setStatusTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update payment status.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyRef = (id: string, ref: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(ref).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
      });
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Payments Ledger"
        description="Verify incoming M-Pesa, bank, cash, and PayPal collections with duplicate-reference protection."
        actions={
          <button
            type="button"
            onClick={() => openRecordModal()}
            disabled={clients.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Record Payment
          </button>
        }
      />

      {/* Unified Financial Summary Bar */}
      {loading ? (
        <SummaryStripSkeleton cards={4} />
      ) : (
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Verified Collections</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">
              {formatKES(paymentSummary.paidTotal, currency)}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">M-Pesa Verified</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-emerald-400">
              {formatKES(paymentSummary.mpesaTotal, currency)}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Bank / PayPal / Cash</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-blue-400">
              {formatKES(paymentSummary.otherPaidTotal, currency)}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Pending Verification</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-amber-400">
              {formatKES(paymentSummary.pendingTotal, currency)}
            </p>
          </div>
        </div>
      )}

      {/* Honest M-Pesa Daraja Architecture Note */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-[#111216] border border-white/[0.08] text-xs text-zinc-400 leading-relaxed">
        <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p>
          <span className="font-semibold text-zinc-200">Manual Verification Mode:</span> Every entry uses atomic duplicate-reference protection. M-Pesa Daraja webhook handlers (<code className="font-mono text-blue-400">mpesaDarajaCallback</code>) remain staged until Safaricom credentials are provisioned.
        </p>
      </div>

      {/* Unpaid Subscriptions Quick Action Strip */}
      {!loading && unpaidSubscriptions.length > 0 && (
        <div className="bg-[#111216] border border-amber-500/25 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-amber-300">
              Quick Settle: Overdue &amp; Due Subscriptions ({unpaidSubscriptions.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {unpaidSubscriptions.slice(0, 6).map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#09090B] border border-white/[0.07]"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{sub.clientName}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {sub.packageName} · Due {formatDisplayDate(sub.nextPaymentDate)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    openRecordModal({
                      clientId: sub.clientId,
                      subscriptionId: sub.id,
                      amount: sub.monthlyAmount,
                    })
                  }
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md whitespace-nowrap shrink-0 min-h-[34px]"
                >
                  Log {formatKES(sub.monthlyAmount, currency)}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All', count: payments.length },
            { id: 'Paid', label: 'Paid', count: paymentSummary.paidCount },
            { id: 'Pending', label: 'Pending', count: paymentSummary.pendingCount },
            { id: 'Refunded', label: 'Refunded', count: paymentSummary.refundedCount },
            { id: 'Failed', label: 'Failed', count: paymentSummary.failedCount },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px] sm:w-64">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search payments"
              placeholder="Search client, transaction ref, ID..."
              className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs bg-[#111216] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            aria-label="Filter by payment method"
            className={`${SELECT_CLASS} !min-h-[38px] !py-1.5 text-xs`}
          >
            <option value="ALL">All Methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : syncError && payments.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredPayments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={payments.length === 0 ? 'No Payments Recorded Yet' : 'No Matching Payments'}
          description={
            payments.length === 0
              ? 'Record verified M-Pesa, Bank, or PayPal payments. Duplicate transaction references are automatically blocked.'
              : 'No payment records match your search or filters.'
          }
          actionLabel={payments.length === 0 && clients.length > 0 ? 'Record First Payment' : undefined}
          onAction={payments.length === 0 && clients.length > 0 ? () => openRecordModal() : undefined}
        />
      ) : (
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {pagination.paginatedItems.map((payment) => (
              <div key={payment.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{payment.clientName}</p>
                    <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                      {payment.transactionReference} · {payment.paymentCode}
                    </p>
                  </div>
                  <StatusIndicator status={payment.status} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">
                    {payment.method} · {formatDisplayDate(payment.paymentDate)}
                  </span>
                  <span className="font-mono-tabular text-sm font-semibold text-white">
                    {formatKES(payment.amount, currency)}
                  </span>
                </div>
                {(payment.status === 'Paid' || payment.status === 'Pending') && (
                  <div className="flex justify-end pt-2 border-t border-white/[0.06]">
                    {payment.status === 'Paid' ? (
                      <button
                        type="button"
                        onClick={() => setStatusTarget({ payment, nextStatus: 'Refunded' })}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg min-h-[38px]"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Refund
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setStatusTarget({ payment, nextStatus: 'Paid' })}
                        className="px-3 py-2 text-xs font-medium text-emerald-300 bg-emerald-500/15 rounded-lg min-h-[38px]"
                      >
                        Mark Paid
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop High-Density Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.07] bg-[#0D0E12]">
                  <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Reference & ID
                  </th>
                  <SortableTh label="Client" sortKey="clientName" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Method" sortKey="method" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Date" sortKey="paymentDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} align="right" />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {pagination.paginatedItems.map((payment) => (
                  <tr key={payment.id} className="hover:bg-white/[0.025] transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-tabular font-medium text-white">
                          {payment.transactionReference}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyRef(payment.id, payment.transactionReference)}
                          title="Copy reference"
                          aria-label={`Copy reference ${payment.transactionReference}`}
                          className="p-1 text-zinc-500 hover:text-white rounded transition-colors"
                        >
                          {copiedId === payment.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <p className="font-mono-tabular text-xs text-zinc-500 mt-0.5">
                        {payment.paymentCode}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-zinc-200">{payment.clientName}</td>
                    <td className="py-3 px-4 text-zinc-300">{payment.method}</td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-zinc-300">
                      {formatDisplayDate(payment.paymentDate)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-white">
                      {formatKES(payment.amount, currency)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusIndicator status={payment.status} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      {payment.status === 'Paid' ? (
                        <button
                          type="button"
                          onClick={() => setStatusTarget({ payment, nextStatus: 'Refunded' })}
                          title="Mark Refunded"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-amber-400 hover:bg-white/[0.06] rounded-md transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Refund
                        </button>
                      ) : payment.status === 'Pending' ? (
                        <button
                          type="button"
                          onClick={() => setStatusTarget({ payment, nextStatus: 'Paid' })}
                          className="px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-colors"
                        >
                          Mark Paid
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
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

      {/* Record Manual Payment Modal */}
      <SlideOverModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Record Manual Payment"
        subtitle="Duplicate transaction references are checked and blocked automatically."
      >
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
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
                  subscriptionId: '',
                  invoiceId: '',
                  amount: found?.monthlyAmount || formState.amount,
                });
              }}
              className={INPUT_CLASS}
            >
              <option value="">Select client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessName} ({c.clientCode})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Link Subscription (Optional)
              </label>
              <select
                value={formState.subscriptionId || ''}
                onChange={(e) => {
                  const sub = clientSubscriptions.find((s) => s.id === e.target.value);
                  setFormState({
                    ...formState,
                    subscriptionId: e.target.value,
                    amount: sub ? sub.monthlyAmount : formState.amount,
                  });
                }}
                className={INPUT_CLASS}
              >
                <option value="">None / General Payment</option>
                {clientSubscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.packageName} ({s.subscriptionCode}) — {formatKES(s.monthlyAmount, currency)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Link Unpaid Invoice (Optional)
              </label>
              <select
                value={formState.invoiceId || ''}
                onChange={(e) => {
                  const inv = clientUnpaidInvoices.find((i) => i.id === e.target.value);
                  setFormState({
                    ...formState,
                    invoiceId: e.target.value,
                    amount: inv ? inv.amount : formState.amount,
                  });
                }}
                className={INPUT_CLASS}
              >
                <option value="">None</option>
                {clientUnpaidInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {formatKES(inv.amount, currency)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Payment Method *
              </label>
              <select
                value={formState.method}
                onChange={(e) =>
                  setFormState({ ...formState, method: e.target.value as PaymentMethod })
                }
                className={INPUT_CLASS}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Amount ({currency}) *
              </label>
              <input
                type="number"
                required
                min={1}
                max={FIELD_LIMITS.maxAmount}
                step="0.01"
                value={formState.amount}
                onChange={(e) =>
                  setFormState({ ...formState, amount: Number(e.target.value) || 0 })
                }
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Transaction Reference *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.txRefMax}
                value={formState.transactionReference}
                onChange={(e) =>
                  setFormState({ ...formState, transactionReference: e.target.value })
                }
                placeholder="e.g. SLK8A92B1C"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Payment Date *
              </label>
              <input
                type="date"
                required
                value={formState.paymentDate}
                onChange={(e) => setFormState({ ...formState, paymentDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Verification Status *
              </label>
              <select
                value={formState.status}
                onChange={(e) =>
                  setFormState({ ...formState, status: e.target.value as PaymentStatus })
                }
                className={INPUT_CLASS}
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-400 mt-1">
                Only mark Paid after confirming the transaction in M-Pesa/Bank statement. Linked subscriptions advance by 1 month automatically when Paid.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Notes</label>
            <textarea
              rows={2}
              maxLength={FIELD_LIMITS.paymentNotesMax}
              value={formState.notes || ''}
              onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
              placeholder="Sender phone number, bank slip details, or remarks..."
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
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
              {submitting ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </SlideOverModal>

      <ConfirmModal
        open={Boolean(statusTarget)}
        title={
          statusTarget?.nextStatus === 'Refunded'
            ? 'Mark Payment Refunded'
            : 'Verify Payment as Paid'
        }
        description={
          statusTarget
            ? `Update payment ${statusTarget.payment.paymentCode} (Ref: ${statusTarget.payment.transactionReference}) to ${statusTarget.nextStatus}?`
            : ''
        }
        confirmLabel={statusTarget?.nextStatus === 'Refunded' ? 'Mark Refunded' : 'Mark Paid'}
        tone={statusTarget?.nextStatus === 'Refunded' ? 'warning' : 'primary'}
        busy={submitting}
        onConfirm={handleConfirmStatusUpdate}
        onCancel={() => setStatusTarget(null)}
      />
    </div>
  );
}
