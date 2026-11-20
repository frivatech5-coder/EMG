import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  ExternalLink,
  Pencil,
  Globe,
  Info,
  LayoutGrid,
  List,
  History,
  Server,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/ToastContext';
import { SlideOverModal } from '../components/ui/SlideOverModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { StatusIndicator } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/EmptyState';
import { INPUT_CLASS, PageHeader, SegmentedTabs } from '../components/ui/PageHeader';
import {
  PaginationBar,
  SortableTh,
  useTablePagination,
  useTableSort,
} from '../components/ui/DataTableControls';
import {
  createWebsite,
  permanentlyDeleteWebsite,
  updateWebsite,
  type WebsiteInput,
} from '../services/emgFirestore';
import {
  FIELD_LIMITS,
  formatDisplayDate,
  isValidUrlOrEmpty,
} from '../lib/validation';
import {
  WEBSITE_STATUSES,
  type Website,
  type WebsiteDeploymentStatus,
} from '../types/domain';

interface WebsitesPageProps {
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
}

type WebsiteSortKey = 'websiteName' | 'businessName' | 'renewalDate' | 'deploymentStatus';

export function WebsitesPage({ focusedRecordId, onClearFocusedRecord }: WebsitesPageProps) {
  const { websites, clients, activityLogs, loading, syncError, retrySync } = useData();
  const { showToast } = useToast();
  const { isSuperAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const { sort, toggleSort } = useTableSort<WebsiteSortKey>('websiteName', 'asc');
  const [formOpen, setFormOpen] = useState(false);
  const [editingWebsite, setEditingWebsite] = useState<Website | null>(null);
  const [historyWebsite, setHistoryWebsite] = useState<Website | null>(null);
  const [deletingWebsite, setDeletingWebsite] = useState<Website | null>(null);
  const [pendingSuspend, setPendingSuspend] = useState<{
    website: Website;
    payload: WebsiteInput;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [formState, setFormState] = useState<WebsiteInput>({
    clientId: '',
    businessName: '',
    websiteName: '',
    domain: '',
    liveUrl: '',
    hostingProvider: 'Vercel',
    deploymentStatus: 'In Development',
    renewalDate: '',
    deploymentIntegrationStatus: 'none',
    deploymentErrorMessage: '',
    technicalNotes: '',
  });

  useEffect(() => {
    if (!focusedRecordId || websites.length === 0) return;
    const match = websites.find((w) => w.id === focusedRecordId);
    if (match) {
      setEditingWebsite(match);
      setFormState({
        clientId: match.clientId,
        businessName: match.businessName,
        websiteName: match.websiteName,
        domain: match.domain || '',
        liveUrl: match.liveUrl || '',
        hostingProvider: match.hostingProvider,
        deploymentStatus: match.deploymentStatus,
        renewalDate: match.renewalDate || '',
        deploymentIntegrationStatus: match.deploymentIntegrationStatus || 'none',
        deploymentErrorMessage: match.deploymentErrorMessage || '',
        technicalNotes: match.technicalNotes || '',
      });
      setFormOpen(true);
      onClearFocusedRecord?.();
    }
  }, [focusedRecordId, websites, onClearFocusedRecord]);

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archived),
    [clients]
  );

  const statusCounts = useMemo(
    () => ({
      ALL: websites.length,
      Live: websites.filter((w) => w.deploymentStatus === 'Live').length,
      Preview: websites.filter((w) => w.deploymentStatus === 'Preview').length,
      'In Development': websites.filter((w) => w.deploymentStatus === 'In Development').length,
      Suspended: websites.filter((w) => w.deploymentStatus === 'Suspended').length,
    }),
    [websites]
  );

  const filteredWebsites = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = websites.filter((w) => {
      if (statusFilter !== 'ALL' && w.deploymentStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        w.websiteName.toLowerCase().includes(q) ||
        w.businessName.toLowerCase().includes(q) ||
        w.websiteCode.toLowerCase().includes(q) ||
        (w.domain || '').toLowerCase().includes(q) ||
        w.hostingProvider.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'businessName') return a.businessName.localeCompare(b.businessName) * dir;
      if (sort.key === 'renewalDate')
        return (a.renewalDate || '9999').localeCompare(b.renewalDate || '9999') * dir;
      if (sort.key === 'deploymentStatus')
        return a.deploymentStatus.localeCompare(b.deploymentStatus) * dir;
      return a.websiteName.localeCompare(b.websiteName) * dir;
    });
  }, [websites, search, statusFilter, sort]);

  const pagination = useTablePagination(filteredWebsites, 12);

  const openAddModal = () => {
    const firstClient = activeClients[0];
    setEditingWebsite(null);
    setFormState({
      clientId: firstClient?.id || '',
      businessName: firstClient?.businessName || '',
      websiteName: firstClient ? `${firstClient.businessName} Website` : '',
      domain: firstClient?.domainName || '',
      liveUrl: firstClient?.websiteUrl || '',
      hostingProvider: 'Vercel',
      deploymentStatus: 'In Development',
      renewalDate: '',
      deploymentIntegrationStatus: 'none',
      deploymentErrorMessage: '',
      technicalNotes: '',
    });
    setFormOpen(true);
  };

  const openEditModal = (site: Website) => {
    setEditingWebsite(site);
    setFormState({
      clientId: site.clientId,
      businessName: site.businessName,
      websiteName: site.websiteName,
      domain: site.domain || '',
      liveUrl: site.liveUrl || '',
      hostingProvider: site.hostingProvider,
      deploymentStatus: site.deploymentStatus,
      renewalDate: site.renewalDate || '',
      deploymentIntegrationStatus: site.deploymentIntegrationStatus || 'none',
      deploymentErrorMessage: site.deploymentErrorMessage || '',
      technicalNotes: site.technicalNotes || '',
    });
    setFormOpen(true);
  };

  const handleClientSelect = (clientId: string) => {
    const found = clients.find((c) => c.id === clientId);
    setFormState((prev) => ({
      ...prev,
      clientId,
      businessName: found?.businessName || prev.businessName,
      domain: prev.domain || found?.domainName || '',
    }));
  };

  const commitWebsiteSave = async (payload: WebsiteInput) => {
    setSubmitting(true);
    try {
      if (editingWebsite) {
        await updateWebsite(editingWebsite.id, payload);
        showToast(`Updated website ${payload.websiteName}.`, 'success');
      } else {
        await createWebsite(payload);
        showToast(`Added website ${payload.websiteName}.`, 'success');
      }
      setFormOpen(false);
      setPendingSuspend(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save website.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.clientId) {
      showToast('Select a registered client to link this website.', 'error');
      return;
    }
    if (!formState.websiteName.trim() || !formState.hostingProvider.trim()) {
      showToast('Website name and hosting provider are required.', 'error');
      return;
    }
    if (!isValidUrlOrEmpty(formState.liveUrl || '')) {
      showToast('Live URL must start with http:// or https://', 'error');
      return;
    }

    if (
      editingWebsite &&
      editingWebsite.deploymentStatus !== 'Suspended' &&
      formState.deploymentStatus === 'Suspended'
    ) {
      setPendingSuspend({ website: editingWebsite, payload: formState });
      return;
    }

    await commitWebsiteSave(formState);
  };

  const handlePermanentDeleteWebsite = async () => {
    if (!deletingWebsite) return;
    setSubmitting(true);
    try {
      await permanentlyDeleteWebsite(deletingWebsite);
      showToast(`Permanently deleted website ${deletingWebsite.websiteName}.`, 'success');
      if (historyWebsite?.id === deletingWebsite.id) {
        setHistoryWebsite(null);
      }
      setDeletingWebsite(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete website.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const siteLogs = useMemo(() => {
    if (!historyWebsite) return [];
    return activityLogs.filter(
      (log) => log.entityType === 'website' && log.recordId === historyWebsite.id
    );
  }, [historyWebsite, activityLogs]);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Website Deployments"
        description="Track client domains, hosting providers, domain renewals, and live deployment status."
        meta={
          !loading && (
            <span className="font-mono-tabular text-xs text-zinc-400">
              ({statusCounts.Live} live of {websites.length})
            </span>
          )
        }
        actions={
          <>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-[#111216] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                aria-label="Card view"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'cards' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-label="Table view"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'table' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Table
              </button>
            </div>

            <button
              type="button"
              onClick={openAddModal}
              disabled={activeClients.length === 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Website
            </button>
          </>
        }
      />

      <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-[#111216] border border-white/[0.08] text-xs text-zinc-400 leading-relaxed">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p>
          Deployment statuses track your manual hosting operations across Vercel, cPanel, and Cloudflare. Updating a status records the state in Firestore without taking external hosting offline automatically.
        </p>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'ALL', label: 'All Sites', count: statusCounts.ALL },
            { id: 'Live', label: 'Live', count: statusCounts.Live },
            { id: 'Preview', label: 'Preview', count: statusCounts.Preview },
            { id: 'In Development', label: 'Building', count: statusCounts['In Development'] },
            { id: 'Suspended', label: 'Suspended', count: statusCounts.Suspended },
          ]}
        />

        <div className="relative flex-1 min-w-[220px] lg:max-w-xs">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search websites"
            placeholder="Search site, client, domain, host..."
            className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs bg-[#111216] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {activeClients.length === 0 && !loading && (
        <div className="p-4 rounded-xl border border-amber-500/25 bg-amber-500/10 text-xs text-amber-200">
          Add at least one client in the Clients section before registering a website.
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} />
      ) : syncError && websites.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredWebsites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={websites.length === 0 ? 'No Websites Registered' : 'No Matching Websites'}
          description={
            websites.length === 0
              ? 'Register client websites, domains, hosting providers, and renewal schedules.'
              : 'No websites match your current search or deployment filter.'
          }
          actionLabel={websites.length === 0 && activeClients.length > 0 ? 'Add Website' : undefined}
          onAction={websites.length === 0 && activeClients.length > 0 ? openAddModal : undefined}
        />
      ) : viewMode === 'cards' ? (
        /* Vercel-style Project Deployment Cards Grid */
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pagination.paginatedItems.map((site) => (
              <div
                key={site.id}
                className="bg-[#111216] border border-white/[0.08] hover:border-white/[0.15] rounded-xl flex flex-col justify-between overflow-hidden transition-colors"
              >
                <div className="p-5 space-y-4">
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[#09090B] border border-white/[0.08] flex items-center justify-center shrink-0">
                        <Globe className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-semibold text-white truncate">
                          {site.websiteName}
                        </h3>
                        <p className="text-xs text-zinc-400 truncate mt-0.5">
                          {site.businessName}
                        </p>
                      </div>
                    </div>
                    <StatusIndicator status={site.deploymentStatus} />
                  </div>

                  {/* Domain & Host Meta */}
                  <div className="px-3.5 py-2.5 rounded-lg bg-[#0D0E12] border border-white/[0.06] space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">Domain</span>
                      {site.liveUrl ? (
                        <a
                          href={site.liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-blue-400 hover:text-blue-300 truncate inline-flex items-center gap-1"
                        >
                          <span className="truncate">{site.domain || site.liveUrl}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="font-mono text-zinc-300 truncate">
                          {site.domain || 'Not assigned'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">Provider</span>
                      <span className="text-zinc-200 inline-flex items-center gap-1">
                        <Server className="w-3 h-3 text-zinc-500" />
                        {site.hostingProvider}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-500">Renewal</span>
                      <span className="font-mono-tabular text-zinc-300">
                        {formatDisplayDate(site.renewalDate)}
                      </span>
                    </div>
                  </div>

                  {/* Build Integration Note */}
                  {site.deploymentIntegrationStatus === 'failed' ? (
                    <div className="flex items-start gap-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="truncate">
                        {site.deploymentErrorMessage || 'Build integration failed'}
                      </span>
                    </div>
                  ) : site.deploymentIntegrationStatus === 'healthy' ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Verified build healthy</span>
                    </div>
                  ) : null}
                </div>

                {/* Card Footer */}
                <div className="px-4 py-3 border-t border-white/[0.07] bg-[#0D0E12] flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-zinc-500">{site.websiteCode}</span>
                  <div className="flex items-center gap-1.5">
                    {site.liveUrl && (
                      <a
                        href={site.liveUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Visit
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setHistoryWebsite(site)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                    >
                      <History className="w-3.5 h-3.5" />
                      Logs
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(site)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 rounded-md transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setDeletingWebsite(site)}
                        title="Permanently Delete Website"
                        aria-label={`Permanently delete ${site.websiteName}`}
                        className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
            <PaginationBar
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              pageSize={pagination.pageSize}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          </div>
        </div>
      ) : (
        /* Table View */
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.07] bg-[#0D0E12]">
                  <SortableTh label="Website" sortKey="websiteName" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Client" sortKey="businessName" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Domain & Host
                  </th>
                  <SortableTh label="Renewal" sortKey="renewalDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="deploymentStatus" sort={sort} onSort={toggleSort} />
                  <th className="py-3 px-4 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {pagination.paginatedItems.map((site) => (
                  <tr key={site.id} className="hover:bg-white/[0.025] transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-white">{site.websiteName}</p>
                      <p className="font-mono-tabular text-xs text-zinc-400 mt-0.5">
                        {site.websiteCode}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-zinc-200">{site.businessName}</td>
                    <td className="py-3 px-4">
                      <p className="text-zinc-200 font-mono text-xs">{site.domain || '—'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{site.hostingProvider}</p>
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-zinc-300">
                      {formatDisplayDate(site.renewalDate)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusIndicator status={site.deploymentStatus} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {site.liveUrl && (
                          <a
                            href={site.liveUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open Live Website"
                            aria-label={`Open live site for ${site.websiteName}`}
                            className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-md transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setHistoryWebsite(site)}
                          className="px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                        >
                          Logs
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(site)}
                          title="Edit Website"
                          aria-label={`Edit ${site.websiteName}`}
                          className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-md transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => setDeletingWebsite(site)}
                            title="Permanently Delete Website"
                            aria-label={`Permanently delete ${site.websiteName}`}
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
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>
      )}

      {/* Add/Edit Website SlideOver */}
      <SlideOverModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingWebsite ? `Edit ${editingWebsite.websiteName}` : 'Add Website'}
        subtitle={
          editingWebsite
            ? `Website ID: ${editingWebsite.websiteCode}`
            : 'Link a website project to an existing client.'
        }
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Client *</label>
            <select
              required
              value={formState.clientId}
              onChange={(e) => handleClientSelect(e.target.value)}
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

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Website Name *
            </label>
            <input
              type="text"
              required
              maxLength={FIELD_LIMITS.businessNameMax}
              value={formState.websiteName}
              onChange={(e) => setFormState({ ...formState, websiteName: e.target.value })}
              placeholder="e.g. Savanna Hardware Corporate Portal"
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Domain</label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.domainMax}
                value={formState.domain || ''}
                onChange={(e) => setFormState({ ...formState, domain: e.target.value })}
                placeholder="savannahardware.co.ke"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Hosting Provider *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.locationMax}
                value={formState.hostingProvider}
                onChange={(e) => setFormState({ ...formState, hostingProvider: e.target.value })}
                placeholder="Vercel, Truehost, Namecheap..."
                className={INPUT_CLASS}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Live Website URL
              </label>
              <input
                type="url"
                maxLength={FIELD_LIMITS.urlMax}
                value={formState.liveUrl || ''}
                onChange={(e) => setFormState({ ...formState, liveUrl: e.target.value })}
                placeholder="https://savannahardware.co.ke"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Deployment Status *
              </label>
              <select
                value={formState.deploymentStatus}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    deploymentStatus: e.target.value as WebsiteDeploymentStatus,
                  })
                }
                className={INPUT_CLASS}
              >
                {WEBSITE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Domain / Hosting Renewal Date
              </label>
              <input
                type="date"
                value={formState.renewalDate || ''}
                onChange={(e) => setFormState({ ...formState, renewalDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Deployment Integration Status
              </label>
              <select
                value={formState.deploymentIntegrationStatus || 'none'}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    deploymentIntegrationStatus: e.target.value as 'none' | 'healthy' | 'failed',
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="none">No Build Webhook Connected</option>
                <option value="healthy">Verified Build Healthy</option>
                <option value="failed">Deployment Failed (Trigger Alert)</option>
              </select>
            </div>

            {formState.deploymentIntegrationStatus === 'failed' && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Deployment Error Summary
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={formState.deploymentErrorMessage || ''}
                  onChange={(e) =>
                    setFormState({ ...formState, deploymentErrorMessage: e.target.value })
                  }
                  placeholder="e.g. Vercel build failed on main branch"
                  className="w-full px-3.5 py-2 min-h-[40px] text-sm bg-[#09090B] border border-red-500/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Technical Notes
            </label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.notesMax}
              value={formState.technicalNotes || ''}
              onChange={(e) => setFormState({ ...formState, technicalNotes: e.target.value })}
              placeholder="DNS registrar, SSL expiry, deployment branch, repository link..."
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
              {submitting ? 'Saving...' : editingWebsite ? 'Save Changes' : 'Create Website'}
            </button>
          </div>
        </form>
      </SlideOverModal>

      {/* Website History SlideOver */}
      <SlideOverModal
        open={Boolean(historyWebsite)}
        onClose={() => setHistoryWebsite(null)}
        title={historyWebsite?.websiteName || 'Website History'}
        subtitle={
          historyWebsite
            ? `${historyWebsite.websiteCode} · ${historyWebsite.businessName}`
            : undefined
        }
      >
        {historyWebsite && (
          <div className="space-y-5">
            <div className="border border-white/[0.08] bg-[#0D0E12] rounded-lg p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Domain</span>
                <span className="text-white font-mono text-xs">{historyWebsite.domain || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Hosting</span>
                <span className="text-white">{historyWebsite.hostingProvider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Status</span>
                <StatusIndicator status={historyWebsite.deploymentStatus} />
              </div>
              {historyWebsite.technicalNotes && (
                <div className="pt-2.5 border-t border-white/[0.06]">
                  <p className="text-xs text-zinc-400 mb-1">Technical Notes</p>
                  <p className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">
                    {historyWebsite.technicalNotes}
                  </p>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                Audit History
              </h3>
              {siteLogs.length === 0 ? (
                <p className="text-xs text-zinc-500">No update logs recorded yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg bg-[#0D0E12]">
                  {siteLogs.map((log) => (
                    <div key={log.id} className="p-3 text-xs space-y-1">
                      <p className="text-white font-medium">{log.summary}</p>
                      <p className="text-zinc-400">
                        {log.actionType} · {log.adminEmail || log.adminId}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SlideOverModal>

      <ConfirmModal
        open={Boolean(pendingSuspend)}
        title="Mark Website as Suspended"
        description={
          pendingSuspend
            ? `Confirm marking ${pendingSuspend.website.websiteName} as Suspended. Remember to manually apply the suspension on ${pendingSuspend.website.hostingProvider} as well.`
            : ''
        }
        confirmLabel="Confirm Suspend"
        tone="warning"
        busy={submitting}
        onConfirm={() =>
          pendingSuspend ? commitWebsiteSave(pendingSuspend.payload) : undefined
        }
        onCancel={() => setPendingSuspend(null)}
      />

      <ConfirmModal
        open={Boolean(deletingWebsite)}
        title="Permanently Delete Website"
        description={
          deletingWebsite
            ? `Permanently delete ${deletingWebsite.websiteName} (${deletingWebsite.websiteCode}) and its linked alerts? This cannot be undone.`
            : ''
        }
        confirmLabel="Permanently Delete"
        tone="danger"
        requireConfirmText="DELETE"
        busy={submitting}
        onConfirm={handlePermanentDeleteWebsite}
        onCancel={() => setDeletingWebsite(null)}
      />
    </div>
  );
}
