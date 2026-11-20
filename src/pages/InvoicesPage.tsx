import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  FileText,
  Printer,
  Download,
  Pencil,
  X,
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
  createInvoice,
  permanentlyDeleteInvoice,
  updateInvoice,
  type InvoiceInput,
} from '../services/emgFirestore';
import {
  addDaysIso,
  FIELD_LIMITS,
  formatDisplayDate,
  formatKES,
  generateInvoicePdf,
  todayIso,
} from '../lib/validation';
import {
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceStatus,
} from '../types/domain';

interface InvoicesPageProps {
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
}

type InvoiceSortKey = 'invoiceNumber' | 'clientName' | 'dueDate' | 'amount' | 'status';

export function InvoicesPage({ focusedRecordId, onClearFocusedRecord }: InvoicesPageProps) {
  const { invoices, clients, subscriptions, settings, loading, syncError, retrySync } = useData();
  const { showToast } = useToast();
  const { isSuperAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState<Invoice | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { sort, toggleSort } = useTableSort<InvoiceSortKey>('dueDate', 'desc');

  useEffect(() => {
    if (!focusedRecordId || invoices.length === 0) return;
    const match = invoices.find((inv) => inv.id === focusedRecordId);
    if (match) {
      setPreviewInvoice(match);
      onClearFocusedRecord?.();
    }
  }, [focusedRecordId, invoices, onClearFocusedRecord]);

  useEffect(() => {
    if (!previewInvoice) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewInvoice(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewInvoice]);

  const today = todayIso();
  const currency = settings.currency || 'KES';

  const [formState, setFormState] = useState<InvoiceInput>({
    clientId: '',
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    clientLocation: '',
    subscriptionId: '',
    description: '',
    amount: 1000,
    issueDate: today,
    dueDate: addDaysIso(today, 7),
    status: 'Unpaid',
    paymentInstructions: settings.paymentInstructions || '',
    notes: '',
  });

  const summary = useMemo(() => {
    let paidAmount = 0;
    let unpaidAmount = 0;
    let overdueAmount = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let overdueCount = 0;
    let draftCount = 0;
    for (const inv of invoices) {
      const amt = Number(inv.amount) || 0;
      if (inv.status === 'Paid') {
        paidAmount += amt;
        paidCount += 1;
      } else if (inv.status === 'Unpaid') {
        unpaidAmount += amt;
        unpaidCount += 1;
      } else if (inv.status === 'Overdue') {
        overdueAmount += amt;
        overdueCount += 1;
      } else if (inv.status === 'Draft') {
        draftCount += 1;
      }
    }
    return {
      paidAmount,
      unpaidAmount,
      overdueAmount,
      paidCount,
      unpaidCount,
      overdueCount,
      draftCount,
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.description.toLowerCase().includes(q)
      );
    });

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case 'invoiceNumber':
          return a.invoiceNumber.localeCompare(b.invoiceNumber) * dir;
        case 'clientName':
          return a.clientName.localeCompare(b.clientName) * dir;
        case 'dueDate':
          return (a.dueDate || '').localeCompare(b.dueDate || '') * dir;
        case 'amount':
          return ((Number(a.amount) || 0) - (Number(b.amount) || 0)) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        default:
          return 0;
      }
    });
  }, [invoices, search, statusFilter, sort]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    totalPages,
    paginatedItems,
  } = useTablePagination(filteredInvoices, 10);

  const openCreateModal = () => {
    const firstClient = clients.find((c) => !c.archived) || clients[0];
    setEditingInvoice(null);
    setFormState({
      clientId: firstClient?.id || '',
      clientName: firstClient?.businessName || '',
      clientEmail: firstClient?.email || '',
      clientPhone: firstClient?.phone || '',
      clientLocation: firstClient?.location || '',
      subscriptionId: '',
      description: firstClient
        ? `Website hosting and management service for ${firstClient.businessName}`
        : '',
      amount: firstClient?.monthlyAmount || 1000,
      issueDate: todayIso(),
      dueDate: addDaysIso(todayIso(), 7),
      status: 'Unpaid',
      paymentInstructions: settings.paymentInstructions || '',
      notes: '',
    });
    setFormOpen(true);
  };

  const openEditModal = (inv: Invoice) => {
    setEditingInvoice(inv);
    setFormState({
      clientId: inv.clientId,
      clientName: inv.clientName,
      clientEmail: inv.clientEmail || '',
      clientPhone: inv.clientPhone || '',
      clientLocation: inv.clientLocation || '',
      subscriptionId: inv.subscriptionId || '',
      description: inv.description,
      amount: inv.amount,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      paymentInstructions: inv.paymentInstructions || settings.paymentInstructions || '',
      notes: inv.notes || '',
    });
    setFormOpen(true);
  };

  const clientSubs = useMemo(
    () => subscriptions.filter((s) => s.clientId === formState.clientId),
    [subscriptions, formState.clientId]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.clientId) {
      showToast('Select a client for this invoice.', 'error');
      return;
    }
    if (!formState.description.trim()) {
      showToast('Enter an invoice description.', 'error');
      return;
    }
    if (!formState.amount || formState.amount <= 0) {
      showToast('Invoice amount must be greater than zero.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (editingInvoice) {
        await updateInvoice(editingInvoice.id, formState);
        showToast(`Updated invoice ${editingInvoice.invoiceNumber}.`, 'success');
      } else {
        await createInvoice(formState, settings);
        showToast(`Generated invoice for ${formState.clientName}.`, 'success');
      }
      setFormOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save invoice.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePermanentDeleteInvoice = async () => {
    if (!deletingInvoice) return;
    setSubmitting(true);
    try {
      await permanentlyDeleteInvoice(deletingInvoice);
      showToast(`Permanently deleted invoice ${deletingInvoice.invoiceNumber}.`, 'success');
      if (previewInvoice?.id === deletingInvoice.id) {
        setPreviewInvoice(null);
      }
      setDeletingInvoice(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete invoice.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="no-print">
        <PageHeader
          title="Invoices & Statements"
          description="Generate numbered client invoices, preview branded sheets, print, or download PDFs."
          actions={
            <button
              type="button"
              onClick={openCreateModal}
              disabled={clients.length === 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Generate Invoice
            </button>
          }
        />
      </div>

      {/* Unified Receivables Summary Bar */}
      <div className="no-print">
        {loading ? (
          <SummaryStripSkeleton cards={4} />
        ) : (
          <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
            <div className="p-4 sm:p-5">
              <p className="text-xs text-zinc-400">Paid Invoices</p>
              <p className="mt-1 font-mono-tabular text-xl font-semibold text-emerald-400">
                {formatKES(summary.paidAmount, currency)}
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-xs text-zinc-400">Unpaid Receivables</p>
              <p className="mt-1 font-mono-tabular text-xl font-semibold text-amber-400">
                {formatKES(summary.unpaidAmount, currency)}
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-xs text-zinc-400">Overdue Invoices</p>
              <p className="mt-1 font-mono-tabular text-xl font-semibold text-red-400">
                {formatKES(summary.overdueAmount, currency)}
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-xs text-zinc-400">Total Issued</p>
              <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">
                {invoices.length}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="no-print flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All', count: invoices.length },
            { id: 'Unpaid', label: 'Unpaid', count: summary.unpaidCount },
            { id: 'Overdue', label: 'Overdue', count: summary.overdueCount },
            { id: 'Paid', label: 'Paid', count: summary.paidCount },
            { id: 'Draft', label: 'Draft', count: summary.draftCount },
          ]}
        />

        <div className="relative flex-1 min-w-[200px] xl:max-w-xs">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search invoices"
            placeholder="Search invoice #, client, description..."
            className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs bg-[#111216] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Table / Mobile Cards */}
      <div className="no-print">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : syncError && invoices.length === 0 ? (
          <ErrorState message={syncError} onRetry={retrySync} />
        ) : filteredInvoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={invoices.length === 0 ? 'No Invoices Generated Yet' : 'No Matching Invoices'}
            description={
              invoices.length === 0
                ? 'Generate numbered KSh invoices for client websites and subscriptions, preview them, print, or download as PDF.'
                : 'No invoices match your search or status filter.'
            }
            actionLabel={invoices.length === 0 && clients.length > 0 ? 'Generate First Invoice' : undefined}
            onAction={invoices.length === 0 && clients.length > 0 ? openCreateModal : undefined}
          />
        ) : (
          <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-white/[0.06]">
              {paginatedItems.map((inv) => (
                <div key={inv.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono-tabular text-sm font-semibold text-white">
                        {inv.invoiceNumber}
                      </p>
                      <p className="text-sm text-zinc-200 truncate">{inv.clientName}</p>
                    </div>
                    <StatusIndicator status={inv.status} />
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-2">{inv.description}</p>

                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-mono-tabular text-zinc-400">
                      Issued {formatDisplayDate(inv.issueDate)} · Due {formatDisplayDate(inv.dueDate)}
                    </span>
                    <span className="font-mono-tabular text-sm font-semibold text-white shrink-0">
                      {formatKES(inv.amount, currency)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPreviewInvoice(inv)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] rounded-lg transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => generateInvoicePdf(inv, settings)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-blue-300 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(inv)}
                      aria-label={`Edit invoice ${inv.invoiceNumber}`}
                      className="p-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setDeletingInvoice(inv)}
                        aria-label={`Permanently delete invoice ${inv.invoiceNumber}`}
                        className="p-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop High-Density Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.07] bg-[#0D0E12]">
                    <SortableTh label="Invoice #" sortKey="invoiceNumber" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Client" sortKey="clientName" sort={sort} onSort={toggleSort} />
                    <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                      Description
                    </th>
                    <SortableTh label="Issued / Due" sortKey="dueDate" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} align="right" />
                    <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                    <th className="py-3 px-4 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-sm">
                  {paginatedItems.map((inv) => (
                    <tr key={inv.id} className="hover:bg-white/[0.025] transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice(inv)}
                          className="font-mono-tabular font-medium text-white hover:text-blue-400 transition-colors"
                        >
                          {inv.invoiceNumber}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-zinc-200">{inv.clientName}</td>
                      <td className="py-3 px-4 text-zinc-400 max-w-xs truncate">
                        {inv.description}
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-xs text-zinc-300 whitespace-nowrap">
                        <p>{formatDisplayDate(inv.issueDate)}</p>
                        <p className="text-zinc-500 mt-0.5">
                          Due {formatDisplayDate(inv.dueDate)}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-white whitespace-nowrap">
                        {formatKES(inv.amount, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusIndicator status={inv.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setPreviewInvoice(inv)}
                            title="Preview & Print Invoice"
                            aria-label={`Preview invoice ${inv.invoiceNumber}`}
                            className="p-2 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => generateInvoicePdf(inv, settings)}
                            title="Download PDF"
                            aria-label={`Download PDF for ${inv.invoiceNumber}`}
                            className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(inv)}
                            title="Edit Invoice"
                            aria-label={`Edit invoice ${inv.invoiceNumber}`}
                            className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => setDeletingInvoice(inv)}
                              title="Permanently Delete Invoice"
                              aria-label={`Permanently delete invoice ${inv.invoiceNumber}`}
                              className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {/* Add/Edit Invoice SlideOver */}
      <SlideOverModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingInvoice ? `Edit ${editingInvoice.invoiceNumber}` : 'Generate New Invoice'}
        subtitle={
          editingInvoice
            ? `Client: ${editingInvoice.clientName}`
            : `Next auto-number: ${(settings.invoicePrefix || 'EMG-INV').toUpperCase()}-${settings.nextInvoiceSequence || 1001}`
        }
      >
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          {!editingInvoice && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Client *</label>
              <select
                required
                value={formState.clientId}
                onChange={(e) => {
                  const c = clients.find((item) => item.id === e.target.value);
                  setFormState({
                    ...formState,
                    clientId: e.target.value,
                    clientName: c?.businessName || '',
                    clientEmail: c?.email || '',
                    clientPhone: c?.phone || '',
                    clientLocation: c?.location || '',
                    subscriptionId: '',
                    amount: c?.monthlyAmount || formState.amount,
                    description: c
                      ? `Website hosting and management service for ${c.businessName}`
                      : formState.description,
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
          )}

          {clientSubs.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Link Subscription (Optional)
              </label>
              <select
                value={formState.subscriptionId || ''}
                onChange={(e) => {
                  const sub = clientSubs.find((s) => s.id === e.target.value);
                  setFormState({
                    ...formState,
                    subscriptionId: e.target.value,
                    amount: sub ? sub.monthlyAmount : formState.amount,
                    description: sub
                      ? `${sub.packageName} Website Hosting & Management Subscription (${sub.subscriptionCode})`
                      : formState.description,
                  });
                }}
                className={INPUT_CLASS}
              >
                <option value="">Custom Invoice</option>
                {clientSubs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.packageName} ({s.subscriptionCode}) — {formatKES(s.monthlyAmount, currency)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Description *
            </label>
            <textarea
              required
              rows={3}
              maxLength={FIELD_LIMITS.invoiceDescMax}
              value={formState.description}
              onChange={(e) => setFormState({ ...formState, description: e.target.value })}
              placeholder="Website design, domain setup, or monthly hosting subscription..."
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Status *</label>
              <select
                value={formState.status}
                onChange={(e) =>
                  setFormState({ ...formState, status: e.target.value as InvoiceStatus })
                }
                className={INPUT_CLASS}
              >
                {INVOICE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Issue Date *
              </label>
              <input
                type="date"
                required
                value={formState.issueDate}
                onChange={(e) => setFormState({ ...formState, issueDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Due Date *</label>
              <input
                type="date"
                required
                value={formState.dueDate}
                onChange={(e) => setFormState({ ...formState, dueDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Payment Instructions
            </label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.paymentNotesMax}
              value={formState.paymentInstructions || ''}
              onChange={(e) =>
                setFormState({ ...formState, paymentInstructions: e.target.value })
              }
              placeholder="Configured in Settings (e.g. M-Pesa Paybill / Till / Bank details)..."
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
              {submitting ? 'Saving...' : editingInvoice ? 'Save Invoice' : 'Generate Invoice'}
            </button>
          </div>
        </form>
      </SlideOverModal>

      {/* Printable Invoice Preview Modal */}
      {previewInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 overflow-y-auto animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl bg-white text-slate-900 rounded-xl shadow-2xl overflow-hidden print-only-sheet my-auto animate-scale-in">
            {/* Modal controls hidden on print */}
            <div className="no-print flex items-center justify-between gap-4 px-6 py-4 bg-[#0D0E12] text-white border-b border-white/10">
              <span className="text-sm font-semibold font-mono-tabular">
                Invoice Preview — {previewInvoice.invoiceNumber}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => generateInvoicePdf(previewInvoice, settings)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewInvoice(null)}
                  aria-label="Close preview"
                  className="p-1.5 text-zinc-300 hover:text-white rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Invoice Sheet Content */}
            <div className="p-8 sm:p-10 space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 pb-6 border-b border-slate-200">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <img
                      src={settings.logoUrl || '/assets/aistudio/emglogo0_fdf409c7.png'}
                      alt={settings.businessName || 'EMG WEB SOLUTIONS'}
                      referrerPolicy="no-referrer"
                      className="h-12 w-auto object-contain rounded"
                    />
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                      {settings.businessName || 'EMG WEB SOLUTIONS'}
                    </h2>
                  </div>
                  {(settings.businessEmail || settings.businessPhone || settings.businessAddress) && (
                    <div className="text-xs text-slate-600 space-y-0.5">
                      {settings.businessEmail && <p>{settings.businessEmail}</p>}
                      {settings.businessPhone && <p>{settings.businessPhone}</p>}
                      {settings.businessAddress && <p>{settings.businessAddress}</p>}
                    </div>
                  )}
                </div>

                <div className="sm:text-right space-y-1">
                  <p className="text-xs font-semibold tracking-wider text-blue-600 uppercase">
                    Invoice
                  </p>
                  <p className="font-mono-tabular text-lg font-bold text-slate-900">
                    {previewInvoice.invoiceNumber}
                  </p>
                  <p className="text-xs font-semibold text-slate-700">
                    Status: {previewInvoice.status}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Bill To</p>
                  <p className="font-semibold text-slate-900 text-base">
                    {previewInvoice.clientName}
                  </p>
                  {previewInvoice.clientPhone && (
                    <p className="text-slate-600">{previewInvoice.clientPhone}</p>
                  )}
                  {previewInvoice.clientEmail && (
                    <p className="text-slate-600">{previewInvoice.clientEmail}</p>
                  )}
                  {previewInvoice.clientLocation && (
                    <p className="text-slate-600">{previewInvoice.clientLocation}</p>
                  )}
                </div>
                <div className="sm:text-right space-y-1.5">
                  <div>
                    <span className="text-xs text-slate-500">Issue Date: </span>
                    <span className="font-mono-tabular font-medium text-slate-900">
                      {formatDisplayDate(previewInvoice.issueDate)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Due Date: </span>
                    <span className="font-mono-tabular font-medium text-slate-900">
                      {formatDisplayDate(previewInvoice.dueDate)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-sm text-slate-800">
                      <td className="py-4 px-4 whitespace-pre-wrap">{previewInvoice.description}</td>
                      <td className="py-4 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap">
                        {formatKES(previewInvoice.amount, currency)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td className="py-3.5 px-4 text-sm font-bold text-slate-900 text-right">
                        Total Amount
                      </td>
                      <td className="py-3.5 px-4 text-base font-bold font-mono-tabular text-slate-900 text-right whitespace-nowrap">
                        {formatKES(previewInvoice.amount, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {(previewInvoice.paymentInstructions || settings.paymentInstructions) && (
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-700 uppercase">
                    Payment Instructions
                  </p>
                  <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                    {previewInvoice.paymentInstructions || settings.paymentInstructions}
                  </p>
                </div>
              )}

              {previewInvoice.notes && (
                <p className="text-xs text-slate-500 italic">Notes: {previewInvoice.notes}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deletingInvoice)}
        title="Permanently Delete Invoice"
        description={
          deletingInvoice
            ? `Permanently delete invoice ${deletingInvoice.invoiceNumber} for ${deletingInvoice.clientName} and its linked alerts? This cannot be undone.`
            : ''
        }
        confirmLabel="Permanently Delete"
        tone="danger"
        requireConfirmText="DELETE"
        busy={submitting}
        onConfirm={handlePermanentDeleteInvoice}
        onCancel={() => setDeletingInvoice(null)}
      />
    </div>
  );
}
