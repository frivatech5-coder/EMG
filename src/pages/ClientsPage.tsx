import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  ExternalLink,
  Archive,
  Pencil,
  Eye,
  Users,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/ToastContext';
import { SlideOverModal } from '../components/ui/SlideOverModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { StatusIndicator } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/EmptyState';
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
  archiveClient,
  createClient,
  permanentlyDeleteClientCascade,
  updateClient,
  type ClientInput,
} from '../services/emgFirestore';
import {
  FIELD_LIMITS,
  formatDisplayDate,
  formatKES,
  getEffectiveSubscriptionStatus,
  isValidUrlOrEmpty,
  todayIso,
} from '../lib/validation';
import { CLIENT_STATUSES, type Client, type ClientStatus } from '../types/domain';

interface ClientsPageProps {
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
}

type ClientSortKey = 'businessName' | 'monthlyAmount' | 'status' | 'registeredAt';

export function ClientsPage({ focusedRecordId, onClearFocusedRecord }: ClientsPageProps) {
  const {
    clients,
    websites,
    subscriptions,
    payments,
    invoices,
    settings,
    loading,
    syncError,
    retrySync,
  } = useData();
  const { showToast } = useToast();
  const { isSuperAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [packageFilter, setPackageFilter] = useState<string>('ALL');
  const [showArchived, setShowArchived] = useState(false);

  const { sort, toggleSort } = useTableSort<ClientSortKey>('registeredAt', 'desc');

  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [archivingClient, setArchivingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!focusedRecordId || clients.length === 0) return;
    const match = clients.find((c) => c.id === focusedRecordId);
    if (match) {
      setViewingClient(match);
      onClearFocusedRecord?.();
    }
  }, [focusedRecordId, clients, onClearFocusedRecord]);

  const [formState, setFormState] = useState<ClientInput>({
    businessName: '',
    contactName: '',
    phone: '',
    email: '',
    category: '',
    location: '',
    domainName: '',
    websiteUrl: '',
    packageId: settings.packages[0]?.id || 'basic',
    monthlyAmount: settings.packages[0]?.monthlyPrice || 500,
    status: 'Active',
    registeredAt: todayIso(),
    notes: '',
  });

  const statusCounts = useMemo(() => {
    const visible = clients.filter((c) => showArchived || !c.archived);
    return {
      ALL: visible.length,
      Active: visible.filter((c) => c.status === 'Active').length,
      Prospect: visible.filter((c) => c.status === 'Prospect').length,
      'Demo Presented': visible.filter((c) => c.status === 'Demo Presented').length,
      Inactive: visible.filter((c) => c.status === 'Inactive').length,
      Cancelled: visible.filter((c) => c.status === 'Cancelled').length,
    };
  }, [clients, showArchived]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.filter((c) => {
      if (!showArchived && c.archived) return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (packageFilter !== 'ALL' && c.packageId !== packageFilter) return false;
      if (!q) return true;
      return (
        c.businessName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.clientCode.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q) ||
        (c.domainName || '').toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'monthlyAmount') {
        return (a.monthlyAmount - b.monthlyAmount) * dir;
      }
      if (sort.key === 'businessName') {
        return a.businessName.localeCompare(b.businessName) * dir;
      }
      if (sort.key === 'status') {
        return a.status.localeCompare(b.status) * dir;
      }
      return (a.registeredAt || '').localeCompare(b.registeredAt || '') * dir;
    });
  }, [clients, search, statusFilter, packageFilter, showArchived, sort]);

  const pagination = useTablePagination(filteredClients, 10);

  const openAddModal = () => {
    const defaultPkg = settings.packages[0];
    setEditingClient(null);
    setFormState({
      businessName: '',
      contactName: '',
      phone: '',
      email: '',
      category: '',
      location: '',
      domainName: '',
      websiteUrl: '',
      packageId: defaultPkg?.id || 'basic',
      monthlyAmount: defaultPkg?.monthlyPrice ?? 500,
      status: 'Active',
      registeredAt: todayIso(),
      notes: '',
    });
    setFormOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setFormState({
      businessName: client.businessName,
      contactName: client.contactName,
      phone: client.phone,
      email: client.email || '',
      category: client.category,
      location: client.location,
      domainName: client.domainName || '',
      websiteUrl: client.websiteUrl || '',
      packageId: client.packageId,
      monthlyAmount: client.monthlyAmount,
      status: client.status,
      registeredAt: client.registeredAt,
      notes: client.notes || '',
    });
    setFormOpen(true);
  };

  const handlePackageChange = (pkgId: string) => {
    if (pkgId === 'custom') {
      setFormState((prev) => ({ ...prev, packageId: 'custom' }));
      return;
    }
    const found = settings.packages.find((p) => p.id === pkgId);
    setFormState((prev) => ({
      ...prev,
      packageId: pkgId,
      monthlyAmount: found ? found.monthlyPrice : prev.monthlyAmount,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.businessName.trim() || !formState.contactName.trim() || !formState.phone.trim()) {
      showToast('Business name, contact name, and phone number are required.', 'error');
      return;
    }
    if (!formState.category.trim() || !formState.location.trim()) {
      showToast('Business category and location are required.', 'error');
      return;
    }
    if (!isValidUrlOrEmpty(formState.websiteUrl || '')) {
      showToast('Website URL must start with http:// or https://', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (editingClient) {
        await updateClient(editingClient.id, formState);
        showToast(`Updated client ${formState.businessName}.`, 'success');
      } else {
        await createClient(formState);
        showToast(`Added client ${formState.businessName}.`, 'success');
      }
      setFormOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save client.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archivingClient) return;
    setSubmitting(true);
    try {
      await archiveClient(archivingClient);
      showToast(
        `Archived ${archivingClient.businessName}. Financial and subscription history retained.`,
        'success'
      );
      if (viewingClient?.id === archivingClient.id) {
        setViewingClient(null);
      }
      setArchivingClient(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to archive client.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestoreClient = async (client: Client) => {
    try {
      await updateClient(client.id, {
        businessName: client.businessName,
        archived: false,
        status: 'Active',
      });
      showToast(`Restored ${client.businessName} to Active.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to restore client.', 'error');
    }
  };

  const handlePermanentDeleteClient = async () => {
    if (!deletingClient) return;
    setSubmitting(true);
    try {
      const { deletedCount } = await permanentlyDeleteClientCascade(deletingClient, {
        deleteRelatedLogs: true,
        deleteSourceLead: true,
      });
      showToast(
        `Permanently deleted ${deletingClient.businessName} and ${Math.max(0, deletedCount - 1)} linked record${deletedCount - 1 === 1 ? '' : 's'}.`,
        'success'
      );
      if (viewingClient?.id === deletingClient.id) {
        setViewingClient(null);
      }
      setDeletingClient(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to permanently delete client.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const currency = settings.currency || 'KES';

  const profileWebsites = useMemo(
    () => (viewingClient ? websites.filter((w) => w.clientId === viewingClient.id) : []),
    [viewingClient, websites]
  );
  const profileSubscriptions = useMemo(
    () => (viewingClient ? subscriptions.filter((s) => s.clientId === viewingClient.id) : []),
    [viewingClient, subscriptions]
  );
  const profilePayments = useMemo(
    () => (viewingClient ? payments.filter((p) => p.clientId === viewingClient.id) : []),
    [viewingClient, payments]
  );
  const profileInvoices = useMemo(
    () => (viewingClient ? invoices.filter((i) => i.clientId === viewingClient.id) : []),
    [viewingClient, invoices]
  );

  const profilePaidTotal = useMemo(
    () =>
      profilePayments
        .filter((p) => p.status === 'Paid')
        .reduce((acc, p) => acc + (Number(p.amount) || 0), 0),
    [profilePayments]
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Client Accounts"
        description="Manage business contacts, active subscription tiers, domains, and account lifecycle."
        meta={
          !loading && (
            <span className="font-mono-tabular text-xs text-zinc-400">
              ({clients.filter((c) => !c.archived).length} active)
            </span>
          )
        }
        actions={
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </button>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All', count: statusCounts.ALL },
            { id: 'Active', label: 'Active', count: statusCounts.Active },
            { id: 'Prospect', label: 'Prospect', count: statusCounts.Prospect },
            { id: 'Demo Presented', label: 'Demo', count: statusCounts['Demo Presented'] },
            { id: 'Inactive', label: 'Inactive', count: statusCounts.Inactive },
            { id: 'Cancelled', label: 'Cancelled', count: statusCounts.Cancelled },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] sm:w-64">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search clients"
              placeholder="Search name, code, phone, domain..."
              className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs bg-[#111216] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={packageFilter}
            onChange={(e) => setPackageFilter(e.target.value)}
            aria-label="Filter by package"
            className={`${SELECT_CLASS} !min-h-[38px] !py-1.5 text-xs`}
          >
            <option value="ALL">All Packages</option>
            {settings.packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>

          <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none px-3 py-2 min-h-[38px] rounded-lg bg-[#111216] border border-white/[0.08] hover:bg-white/[0.04]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-white/20 bg-[#09090B] text-blue-600 focus:ring-blue-500"
            />
            <span>Archived</span>
          </label>
        </div>
      </div>

      {/* Table / Mobile Cards */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : syncError && clients.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredClients.length === 0 ? (
        <EmptyState
          icon={Users}
          title={clients.length === 0 ? 'No Clients Registered Yet' : 'No Matching Clients'}
          description={
            clients.length === 0
              ? 'Register your first EMG Web Solutions client to link websites, subscriptions, payments, and invoices.'
              : 'Adjust your search query or filters to view matching clients.'
          }
          actionLabel={clients.length === 0 ? 'Add First Client' : undefined}
          onAction={clients.length === 0 ? openAddModal : undefined}
        />
      ) : (
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Card Layout */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {pagination.paginatedItems.map((client) => {
              const pkgName =
                settings.packages.find((p) => p.id === client.packageId)?.name ||
                (client.packageId === 'custom' ? 'CUSTOM' : client.packageId.toUpperCase());
              return (
                <div key={client.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setViewingClient(client)}
                      className="text-left min-w-0"
                    >
                      <p className="font-medium text-white truncate">{client.businessName}</p>
                      <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                        {client.clientCode}
                        {client.domainName ? ` · ${client.domainName}` : ''}
                      </p>
                    </button>
                    <StatusIndicator status={client.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-zinc-500">Contact</p>
                      <p className="text-zinc-200 truncate">{client.contactName}</p>
                      <p className="font-mono-tabular text-zinc-400">{client.phone}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-zinc-500">{pkgName}</p>
                      <p className="font-mono-tabular font-semibold text-white">
                        {formatKES(client.monthlyAmount, currency)}/mo
                      </p>
                      <p className="text-zinc-400 truncate">{client.location}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setViewingClient(client)}
                      className="px-3 py-2 text-xs font-medium text-zinc-200 bg-white/[0.04] hover:bg-white/[0.08] rounded-lg min-h-[38px]"
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(client)}
                      className="px-3 py-2 text-xs font-medium text-blue-300 bg-blue-600/15 hover:bg-blue-600/25 rounded-lg min-h-[38px]"
                    >
                      Edit
                    </button>
                    {client.archived ? (
                      <button
                        type="button"
                        onClick={() => void handleRestoreClient(client)}
                        className="px-3 py-2 text-xs font-medium text-emerald-300 bg-emerald-500/15 rounded-lg min-h-[38px]"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setArchivingClient(client)}
                        className="px-3 py-2 text-xs font-medium text-amber-300 bg-amber-500/10 rounded-lg min-h-[38px]"
                      >
                        Archive
                      </button>
                    )}
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setDeletingClient(client)}
                        aria-label={`Permanently delete ${client.businessName}`}
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
                  <SortableTh label="Client" sortKey="businessName" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Contact
                  </th>
                  <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Category & Location
                  </th>
                  <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Plan
                  </th>
                  <SortableTh
                    label="Monthly"
                    sortKey="monthlyAmount"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {pagination.paginatedItems.map((client) => {
                  const pkgName =
                    settings.packages.find((p) => p.id === client.packageId)?.name ||
                    (client.packageId === 'custom' ? 'CUSTOM' : client.packageId.toUpperCase());
                  return (
                    <tr key={client.id} className="hover:bg-white/[0.025] transition-colors">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => setViewingClient(client)}
                          className="text-left group"
                        >
                          <p className="font-medium text-white group-hover:text-blue-400 transition-colors">
                            {client.businessName}
                          </p>
                          <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                            {client.clientCode}
                            {client.domainName ? ` · ${client.domainName}` : ''}
                          </p>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-zinc-200">{client.contactName}</p>
                        <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                          {client.phone}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-zinc-300">
                        <p>{client.category}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{client.location}</p>
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-zinc-200">
                        {pkgName}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular font-medium text-white">
                        {formatKES(client.monthlyAmount, currency)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <StatusIndicator status={client.status} />
                          {client.archived && (
                            <span className="text-[11px] text-zinc-500">Archived</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingClient(client)}
                            title="Inspect Client 360"
                            aria-label={`View ${client.businessName} profile`}
                            className="p-2 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(client)}
                            title="Edit Client"
                            aria-label={`Edit ${client.businessName}`}
                            className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {client.archived ? (
                            <button
                              type="button"
                              onClick={() => void handleRestoreClient(client)}
                              title="Restore Client"
                              aria-label={`Restore ${client.businessName}`}
                              className="p-2 text-zinc-400 hover:text-emerald-400 hover:bg-white/[0.06] rounded-md transition-colors"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setArchivingClient(client)}
                              title="Archive Client"
                              aria-label={`Archive ${client.businessName}`}
                              className="p-2 text-zinc-400 hover:text-amber-400 hover:bg-white/[0.06] rounded-md transition-colors"
                            >
                              <Archive className="w-4 h-4" />
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => setDeletingClient(client)}
                              title="Permanently Delete Client & Linked Records"
                              aria-label={`Permanently delete ${client.businessName}`}
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

      {/* Add / Edit SlideOver */}
      <SlideOverModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingClient ? `Edit ${editingClient.businessName}` : 'Add New Client'}
        subtitle={
          editingClient
            ? `Client ID: ${editingClient.clientCode}`
            : 'Client ID will be automatically generated upon save.'
        }
      >
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Business Name *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.businessNameMax}
                value={formState.businessName}
                onChange={(e) => setFormState({ ...formState, businessName: e.target.value })}
                placeholder="e.g. Savanna Hardware Ltd"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Owner / Contact Name *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.contactNameMax}
                value={formState.contactName}
                onChange={(e) => setFormState({ ...formState, contactName: e.target.value })}
                placeholder="Full name"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Phone Number *
              </label>
              <input
                type="tel"
                required
                maxLength={FIELD_LIMITS.phoneMax}
                value={formState.phone}
                onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                placeholder="+254 7XX XXX XXX"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                maxLength={FIELD_LIMITS.emailMax}
                value={formState.email || ''}
                onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                placeholder="owner@business.co.ke"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Business Category *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.categoryMax}
                value={formState.category}
                onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                placeholder="e.g. Clinic, Retail, Salon, Logistics"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Business Location *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.locationMax}
                value={formState.location}
                onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                placeholder="e.g. Nairobi, Westlands"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Date Registered *
              </label>
              <input
                type="date"
                required
                value={formState.registeredAt}
                onChange={(e) => setFormState({ ...formState, registeredAt: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Domain Name
              </label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.domainMax}
                value={formState.domainName || ''}
                onChange={(e) => setFormState({ ...formState, domainName: e.target.value })}
                placeholder="example.co.ke"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Website URL
              </label>
              <input
                type="url"
                maxLength={FIELD_LIMITS.urlMax}
                value={formState.websiteUrl || ''}
                onChange={(e) => setFormState({ ...formState, websiteUrl: e.target.value })}
                placeholder="https://example.co.ke"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Package *
              </label>
              <select
                value={formState.packageId}
                onChange={(e) => handlePackageChange(e.target.value)}
                className={INPUT_CLASS}
              >
                {settings.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatKES(p.monthlyPrice, currency)}/mo)
                  </option>
                ))}
                <option value="custom">Custom Price</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Monthly Amount ({currency}) *
              </label>
              <input
                type="number"
                min={0}
                max={FIELD_LIMITS.maxAmount}
                step="1"
                required
                value={formState.monthlyAmount}
                onChange={(e) =>
                  setFormState({ ...formState, monthlyAmount: Number(e.target.value) || 0 })
                }
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Client Status *
              </label>
              <select
                value={formState.status}
                onChange={(e) =>
                  setFormState({ ...formState, status: e.target.value as ClientStatus })
                }
                className={INPUT_CLASS}
              >
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Additional Notes
              </label>
              <textarea
                rows={3}
                maxLength={FIELD_LIMITS.notesMax}
                value={formState.notes || ''}
                onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                placeholder="Requirements, account context, or billing preferences..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
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
              {submitting ? 'Saving...' : editingClient ? 'Save Changes' : 'Create Client'}
            </button>
          </div>
        </form>
      </SlideOverModal>

      {/* Client 360 Quick-Inspector Drawer */}
      <SlideOverModal
        open={Boolean(viewingClient)}
        onClose={() => setViewingClient(null)}
        title={viewingClient?.businessName || 'Client Profile'}
        subtitle={
          viewingClient
            ? `${viewingClient.clientCode} · Registered ${formatDisplayDate(viewingClient.registeredAt)}`
            : undefined
        }
        wide
      >
        {viewingClient && (
          <div className="space-y-6">
            {/* Quick Actions Bar + Metrics */}
            <div className="bg-[#0D0E12] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-white/[0.07]">
                <div className="p-3.5">
                  <p className="text-[11px] text-zinc-500">Monthly Plan</p>
                  <p className="font-mono-tabular text-base font-semibold text-white mt-0.5">
                    {formatKES(viewingClient.monthlyAmount, currency)}
                  </p>
                </div>
                <div className="p-3.5">
                  <p className="text-[11px] text-zinc-500">Lifetime Paid</p>
                  <p className="font-mono-tabular text-base font-semibold text-emerald-400 mt-0.5">
                    {formatKES(profilePaidTotal, currency)}
                  </p>
                </div>
                <div className="p-3.5">
                  <p className="text-[11px] text-zinc-500">Status</p>
                  <div className="mt-1">
                    <StatusIndicator status={viewingClient.status} />
                  </div>
                </div>
              </div>
              <div className="px-4 py-2.5 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2">
                {viewingClient.websiteUrl ? (
                  <a
                    href={viewingClient.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
                  >
                    <span>{viewingClient.websiteUrl}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-xs text-zinc-500">No website URL attached</span>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(viewingClient)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-white/[0.06] hover:bg-white/[0.1] rounded-md"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Client
                  </button>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => setDeletingClient(viewingClient)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Contact Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5 border-b border-white/[0.08]">
              <div className="space-y-1">
                <p className="text-xs text-zinc-500">Primary Contact</p>
                <p className="text-sm font-medium text-white">{viewingClient.contactName}</p>
                <p className="text-xs font-mono-tabular text-zinc-300">
                  {viewingClient.phone}
                  {viewingClient.email ? ` · ${viewingClient.email}` : ''}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-500">Sector & Location</p>
                <p className="text-sm font-medium text-white">
                  {viewingClient.category} · {viewingClient.location}
                </p>
                {viewingClient.domainName && (
                  <p className="text-xs text-zinc-400 font-mono">{viewingClient.domainName}</p>
                )}
              </div>
              {viewingClient.notes && (
                <div className="sm:col-span-2 pt-2">
                  <p className="text-xs text-zinc-500 mb-1">Account Notes</p>
                  <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {viewingClient.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Linked Websites */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
                Websites ({profileWebsites.length})
              </h3>
              {profileWebsites.length === 0 ? (
                <p className="text-xs text-zinc-500">No websites linked to this client yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg bg-[#0D0E12]">
                  {profileWebsites.map((w) => (
                    <div key={w.id} className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{w.websiteName}</p>
                        <p className="text-xs text-zinc-400">
                          {w.domain || 'No domain'} · {w.hostingProvider}
                        </p>
                      </div>
                      <StatusIndicator status={w.deploymentStatus} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Linked Subscriptions */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
                Subscriptions ({profileSubscriptions.length})
              </h3>
              {profileSubscriptions.length === 0 ? (
                <p className="text-xs text-zinc-500">No subscriptions recorded for this client.</p>
              ) : (
                <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg bg-[#0D0E12]">
                  {profileSubscriptions.map((s) => (
                    <div key={s.id} className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {s.packageName} · {s.subscriptionCode}
                        </p>
                        <p className="text-xs text-zinc-400">
                          Start {formatDisplayDate(s.startDate)} · Next due{' '}
                          {formatDisplayDate(s.nextPaymentDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono-tabular text-xs font-semibold text-white">
                          {formatKES(s.monthlyAmount, currency)}
                        </p>
                        <StatusIndicator status={getEffectiveSubscriptionStatus(s)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payment & Invoice History */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
                  Payments ({profilePayments.length})
                </h3>
                {profilePayments.length === 0 ? (
                  <p className="text-xs text-zinc-500">No payments recorded.</p>
                ) : (
                  <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg bg-[#0D0E12]">
                    {profilePayments.map((p) => (
                      <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-mono-tabular text-xs font-medium text-white">
                            {p.transactionReference}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {p.method} · {formatDisplayDate(p.paymentDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono-tabular text-xs font-semibold text-white">
                            {formatKES(p.amount, currency)}
                          </p>
                          <StatusIndicator status={p.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
                  Invoices ({profileInvoices.length})
                </h3>
                {profileInvoices.length === 0 ? (
                  <p className="text-xs text-zinc-500">No invoices issued.</p>
                ) : (
                  <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg bg-[#0D0E12]">
                    {profileInvoices.map((inv) => (
                      <div key={inv.id} className="p-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-mono-tabular text-xs font-medium text-white">
                            {inv.invoiceNumber}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            Due {formatDisplayDate(inv.dueDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono-tabular text-xs font-semibold text-white">
                            {formatKES(inv.amount, currency)}
                          </p>
                          <StatusIndicator status={inv.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </SlideOverModal>

      <ConfirmModal
        open={Boolean(archivingClient)}
        title="Archive Client"
        description={
          archivingClient
            ? `Archiving ${archivingClient.businessName} moves them out of the active directory while preserving all payment, subscription, website, and invoice records.`
            : ''
        }
        confirmLabel="Archive Client"
        tone="warning"
        busy={submitting}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchivingClient(null)}
      />

      <ConfirmModal
        open={Boolean(deletingClient)}
        title="Permanently Delete Client"
        description={
          deletingClient
            ? `This will permanently erase ${deletingClient.businessName} (${deletingClient.clientCode}) along with all linked websites, subscriptions, invoices, payments, payment references, notifications, source lead, and activity logs. This action cannot be undone.`
            : ''
        }
        confirmLabel="Permanently Delete"
        tone="danger"
        requireConfirmText="DELETE"
        busy={submitting}
        onConfirm={handlePermanentDeleteClient}
        onCancel={() => setDeletingClient(null)}
      />
    </div>
  );
}
