import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  ExternalLink,
  Pencil,
  Globe,
  Info,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../components/ui/ToastContext';
import { SlideOverModal } from '../components/ui/SlideOverModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { StatusIndicator } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/EmptyState';
import {
  PaginationBar,
  SortableTh,
  useTablePagination,
  useTableSort,
} from '../components/ui/DataTableControls';
import {
  createWebsite,
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

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const { sort, toggleSort } = useTableSort<WebsiteSortKey>('websiteName', 'asc');
  const [formOpen, setFormOpen] = useState(false);
  const [editingWebsite, setEditingWebsite] = useState<Website | null>(null);
  const [historyWebsite, setHistoryWebsite] = useState<Website | null>(null);
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

  const pagination = useTablePagination(filteredWebsites, 10);

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

  const siteLogs = useMemo(() => {
    if (!historyWebsite) return [];
    return activityLogs.filter(
      (log) => log.entityType === 'website' && log.recordId === historyWebsite.id
    );
  }, [historyWebsite, activityLogs]);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/[0.06] border border-blue-500/20 text-xs text-slate-300 leading-relaxed">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p>
          Deployment statuses track your manual hosting operations across providers (Vercel, cPanel, Cloudflare, etc.). Updating a website status here records the operational state in Firestore and does not modify external hosting servers automatically.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search websites"
              placeholder="Search site name, client, domain, host..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by deployment status"
            className="px-3 py-2 text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Deployment Statuses</option>
            {WEBSITE_STATUSES.map((s) => (
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
          Add Website
        </button>
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
      ) : (
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {pagination.paginatedItems.map((site) => (
              <div key={site.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{site.websiteName}</p>
                    <p className="font-mono-tabular text-xs text-slate-400 mt-0.5">
                      {site.websiteCode} · {site.businessName}
                    </p>
                  </div>
                  <StatusIndicator status={site.deploymentStatus} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-slate-500">Domain &amp; Host</p>
                    <p className="text-slate-200 truncate">{site.domain || '—'}</p>
                    <p className="text-slate-400">{site.hostingProvider}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500">Renewal Date</p>
                    <p className="font-mono-tabular text-slate-200">
                      {formatDisplayDate(site.renewalDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                  {site.liveUrl && (
                    <a
                      href={site.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-300 bg-white/[0.04] rounded-lg min-h-[38px]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Visit
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setHistoryWebsite(site)}
                    className="px-3 py-2 text-xs font-medium text-slate-200 bg-white/[0.04] rounded-lg min-h-[38px]"
                  >
                    History
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(site)}
                    className="px-3 py-2 text-xs font-medium text-blue-300 bg-blue-600/15 rounded-lg min-h-[38px]"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-xs font-medium text-slate-400">
                  <SortableTh label="Website" sortKey="websiteName" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Client" sortKey="businessName" sort={sort} onSort={toggleSort} />
                  <th className="py-3.5 px-4">Domain & Host</th>
                  <SortableTh label="Renewal" sortKey="renewalDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="deploymentStatus" sort={sort} onSort={toggleSort} />
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {pagination.paginatedItems.map((site) => (
                  <tr key={site.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4">
                      <p className="font-medium text-white">{site.websiteName}</p>
                      <p className="font-mono-tabular text-xs text-slate-400 mt-0.5">
                        {site.websiteCode}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-slate-200">{site.businessName}</td>
                    <td className="py-3.5 px-4">
                      <p className="text-slate-200">{site.domain || '—'}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{site.hostingProvider}</p>
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-300">
                      {formatDisplayDate(site.renewalDate)}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusIndicator status={site.deploymentStatus} />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {site.liveUrl && (
                          <a
                            href={site.liveUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open Live Website"
                            aria-label={`Open live site for ${site.websiteName}`}
                            className="p-2 text-slate-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-lg transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setHistoryWebsite(site)}
                          className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(site)}
                          title="Edit Website"
                          aria-label={`Edit ${site.websiteName}`}
                          className="p-2 text-slate-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
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
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Client *</label>
            <select
              required
              value={formState.clientId}
              onChange={(e) => handleClientSelect(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
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
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Website Name *
            </label>
            <input
              type="text"
              required
              maxLength={FIELD_LIMITS.businessNameMax}
              value={formState.websiteName}
              onChange={(e) => setFormState({ ...formState, websiteName: e.target.value })}
              placeholder="e.g. Savanna Hardware Corporate Portal"
              className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Domain</label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.domainMax}
                value={formState.domain || ''}
                onChange={(e) => setFormState({ ...formState, domain: e.target.value })}
                placeholder="savannahardware.co.ke"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Hosting Provider *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.locationMax}
                value={formState.hostingProvider}
                onChange={(e) => setFormState({ ...formState, hostingProvider: e.target.value })}
                placeholder="Vercel, Truehost, Namecheap..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Live Website URL
              </label>
              <input
                type="url"
                maxLength={FIELD_LIMITS.urlMax}
                value={formState.liveUrl || ''}
                onChange={(e) => setFormState({ ...formState, liveUrl: e.target.value })}
                placeholder="https://savannahardware.co.ke"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
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
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {WEBSITE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Domain / Hosting Renewal Date
              </label>
              <input
                type="date"
                value={formState.renewalDate || ''}
                onChange={(e) => setFormState({ ...formState, renewalDate: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
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
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="none">No Build Webhook Connected</option>
                <option value="healthy">Verified Build Healthy</option>
                <option value="failed">Deployment Failed (Trigger Alert)</option>
              </select>
            </div>

            {formState.deploymentIntegrationStatus === 'failed' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
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
                  className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-red-500/30 rounded-lg text-white focus:outline-none focus:border-red-500"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Technical Notes
            </label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.notesMax}
              value={formState.technicalNotes || ''}
              onChange={(e) => setFormState({ ...formState, technicalNotes: e.target.value })}
              placeholder="DNS registrar, SSL expiry, deployment branch, repository link..."
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
            <div className="border border-white/[0.08] rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Domain</span>
                <span className="text-white">{historyWebsite.domain || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Hosting</span>
                <span className="text-white">{historyWebsite.hostingProvider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status</span>
                <StatusIndicator status={historyWebsite.deploymentStatus} />
              </div>
              {historyWebsite.technicalNotes && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <p className="text-xs text-slate-400 mb-1">Technical Notes</p>
                  <p className="text-xs text-slate-200 whitespace-pre-wrap">
                    {historyWebsite.technicalNotes}
                  </p>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-white mb-3">Audit History</h3>
              {siteLogs.length === 0 ? (
                <p className="text-xs text-slate-400">No update logs recorded yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg">
                  {siteLogs.map((log) => (
                    <div key={log.id} className="p-3 text-xs space-y-1">
                      <p className="text-white font-medium">{log.summary}</p>
                      <p className="text-slate-400">
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
    </div>
  );
}
