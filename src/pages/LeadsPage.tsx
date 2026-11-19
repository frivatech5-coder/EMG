import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Pencil,
  Target,
  UserCheck,
  ExternalLink,
  CalendarClock,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useToast } from '../components/ui/ToastContext';
import { SlideOverModal } from '../components/ui/SlideOverModal';
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
  convertLeadToClient,
  createLead,
  updateLead,
  type ConvertLeadOptions,
  type LeadInput,
} from '../services/emgFirestore';
import {
  addDaysIso,
  FIELD_LIMITS,
  formatDisplayDate,
  formatKES,
  isValidUrlOrEmpty,
  todayIso,
} from '../lib/validation';
import {
  LEAD_CHANNELS,
  LEAD_INTERESTS,
  LEAD_STATUSES,
  type Lead,
  type LeadChannel,
  type LeadInterest,
  type LeadStatus,
} from '../types/domain';

interface LeadsPageProps {
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
}

type LeadSortKey = 'businessName' | 'estimatedBudget' | 'followUpDate' | 'status';

export function LeadsPage({ focusedRecordId, onClearFocusedRecord }: LeadsPageProps) {
  const { leads, settings, loading, syncError, retrySync } = useData();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');

  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { sort, toggleSort } = useTableSort<LeadSortKey>('followUpDate', 'asc');

  useEffect(() => {
    if (!focusedRecordId || leads.length === 0) return;
    const match = leads.find((l) => l.id === focusedRecordId);
    if (match) {
      setEditingLead(match);
      setFormState({
        businessName: match.businessName,
        category: match.category,
        contactPerson: match.contactPerson,
        phone: match.phone,
        location: match.location,
        socialLink: match.socialLink || '',
        existingWebsite: match.existingWebsite || '',
        previewUrl: match.previewUrl || '',
        contactChannel: match.contactChannel,
        dateContacted: match.dateContacted,
        interestLevel: match.interestLevel,
        estimatedBudget: match.estimatedBudget,
        followUpDate: match.followUpDate || '',
        status: match.status,
        notes: match.notes || '',
      });
      setFormOpen(true);
      onClearFocusedRecord?.();
    }
  }, [focusedRecordId, leads, onClearFocusedRecord]);

  const today = todayIso();
  const currency = settings.currency || 'KES';

  const [formState, setFormState] = useState<LeadInput>({
    businessName: '',
    category: '',
    contactPerson: '',
    phone: '',
    location: '',
    socialLink: '',
    existingWebsite: '',
    previewUrl: '',
    contactChannel: 'WhatsApp',
    dateContacted: today,
    interestLevel: 'Medium',
    estimatedBudget: 1000,
    followUpDate: addDaysIso(today, 2),
    status: 'New Lead',
    notes: '',
  });

  const [convertOpts, setConvertOpts] = useState<ConvertLeadOptions>({
    packageId: settings.packages[0]?.id || 'basic',
    packageName: settings.packages[0]?.name || 'BASIC',
    monthlyAmount: settings.packages[0]?.monthlyPrice ?? 500,
    email: '',
    domainName: '',
    websiteUrl: '',
    createWebsite: true,
    hostingProvider: 'Vercel',
    createSubscription: true,
    gracePeriodDays: settings.defaultGracePeriodDays ?? 7,
  });

  const stats = useMemo(() => {
    const total = leads.length;
    const converted = leads.filter((l) => l.status === 'Converted').length;
    const lost = leads.filter((l) => l.status === 'Lost').length;
    const active = total - converted - lost;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;
    const followUpsDue = leads.filter(
      (l) =>
        l.status !== 'Converted' &&
        l.status !== 'Lost' &&
        Boolean(l.followUpDate) &&
        (l.followUpDate as string) <= today
    );
    return { total, converted, active, conversionRate, followUpsDue };
  }, [leads, today]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = leads.filter((l) => {
      if (statusFilter === 'DUE_TODAY') {
        if (
          l.status === 'Converted' ||
          l.status === 'Lost' ||
          !l.followUpDate ||
          l.followUpDate > today
        ) {
          return false;
        }
      } else if (statusFilter !== 'ALL' && l.status !== statusFilter) {
        return false;
      }
      if (channelFilter !== 'ALL' && l.contactChannel !== channelFilter) return false;
      if (!q) return true;
      return (
        l.businessName.toLowerCase().includes(q) ||
        l.contactPerson.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        l.location.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q) ||
        l.leadCode.toLowerCase().includes(q)
      );
    });

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case 'businessName':
          return a.businessName.localeCompare(b.businessName) * dir;
        case 'estimatedBudget':
          return ((Number(a.estimatedBudget) || 0) - (Number(b.estimatedBudget) || 0)) * dir;
        case 'followUpDate': {
          const da = a.followUpDate || '9999-12-31';
          const db = b.followUpDate || '9999-12-31';
          return da.localeCompare(db) * dir;
        }
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        default:
          return 0;
      }
    });
  }, [leads, search, statusFilter, channelFilter, today, sort]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    totalPages,
    paginatedItems,
  } = useTablePagination(filteredLeads, 10);

  const openAddModal = () => {
    setEditingLead(null);
    setFormState({
      businessName: '',
      category: '',
      contactPerson: '',
      phone: '',
      location: '',
      socialLink: '',
      existingWebsite: '',
      previewUrl: '',
      contactChannel: 'WhatsApp',
      dateContacted: todayIso(),
      interestLevel: 'Medium',
      estimatedBudget: 1000,
      followUpDate: addDaysIso(todayIso(), 2),
      status: 'New Lead',
      notes: '',
    });
    setFormOpen(true);
  };

  const openEditModal = (lead: Lead) => {
    setEditingLead(lead);
    setFormState({
      businessName: lead.businessName,
      category: lead.category,
      contactPerson: lead.contactPerson,
      phone: lead.phone,
      location: lead.location,
      socialLink: lead.socialLink || '',
      existingWebsite: lead.existingWebsite || '',
      previewUrl: lead.previewUrl || '',
      contactChannel: lead.contactChannel,
      dateContacted: lead.dateContacted,
      interestLevel: lead.interestLevel,
      estimatedBudget: lead.estimatedBudget,
      followUpDate: lead.followUpDate || '',
      status: lead.status,
      notes: lead.notes || '',
    });
    setFormOpen(true);
  };

  const openConvertModal = (lead: Lead) => {
    const matchedPkg =
      settings.packages.find((p) => p.monthlyPrice === lead.estimatedBudget) ||
      settings.packages[0];
    setConvertingLead(lead);
    setConvertOpts({
      packageId: matchedPkg?.id || 'basic',
      packageName: matchedPkg?.name || 'BASIC',
      monthlyAmount: matchedPkg?.monthlyPrice ?? (lead.estimatedBudget || 500),
      email: '',
      domainName: '',
      websiteUrl: lead.previewUrl || lead.existingWebsite || '',
      createWebsite: true,
      hostingProvider: 'Vercel',
      createSubscription: true,
      gracePeriodDays: settings.defaultGracePeriodDays ?? 7,
    });
  };

  const handleSaveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !formState.businessName.trim() ||
      !formState.contactPerson.trim() ||
      !formState.phone.trim() ||
      !formState.category.trim() ||
      !formState.location.trim()
    ) {
      showToast('Business name, category, contact person, phone, and location are required.', 'error');
      return;
    }
    if (
      !isValidUrlOrEmpty(formState.socialLink || '') ||
      !isValidUrlOrEmpty(formState.existingWebsite || '') ||
      !isValidUrlOrEmpty(formState.previewUrl || '')
    ) {
      showToast('Social, website, and preview URLs must start with http:// or https://', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (editingLead) {
        await updateLead(editingLead.id, formState);
        showToast(`Updated lead ${formState.businessName}.`, 'success');
      } else {
        await createLead(formState);
        showToast(`Added lead ${formState.businessName}.`, 'success');
      }
      setFormOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save lead.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertingLead) return;
    if (!isValidUrlOrEmpty(convertOpts.websiteUrl || '')) {
      showToast('Website URL must start with http:// or https://', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await convertLeadToClient(convertingLead, convertOpts);
      showToast(
        `Converted ${convertingLead.businessName} into an active Client while keeping lead history.`,
        'success'
      );
      setConvertingLead(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to convert lead.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* CRM Conversion Stats */}
      {loading ? (
        <SummaryStripSkeleton cards={4} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Active Pipeline Leads</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-white">{stats.active}</p>
          </div>
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Follow-ups Due Today / Past</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-amber-400">
              {stats.followUpsDue.length}
            </p>
          </div>
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Converted to Clients</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-emerald-400">
              {stats.converted}
            </p>
          </div>
          <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
            <p className="text-xs text-slate-400">Lead Conversion Rate</p>
            <p className="mt-1 font-mono-tabular text-xl font-semibold text-blue-400">
              {stats.conversionRate}%
            </p>
          </div>
        </div>
      )}

      {/* Follow-ups Due Today Banner */}
      {!loading && stats.followUpsDue.length > 0 && (
        <div className="bg-[#11131A] border border-amber-500/25 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <CalendarClock className="w-4 h-4" />
            <span>Follow-ups Due Today or Overdue ({stats.followUpsDue.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {stats.followUpsDue.slice(0, 6).map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#09090B] border border-white/[0.06]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{lead.businessName}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">
                    {lead.contactChannel} · {lead.phone} · Due {formatDisplayDate(lead.followUpDate)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditModal(lead)}
                  className="px-3 py-1.5 min-h-[36px] text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-md whitespace-nowrap shrink-0"
                >
                  Update
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search leads"
              placeholder="Search business, contact, phone, city..."
              className="w-full pl-9 pr-3 py-2 min-h-[40px] text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by lead pipeline status"
            className="px-3 py-2 min-h-[40px] text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Pipeline Stages</option>
            <option value="DUE_TODAY">Follow-up Due Today/Past</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            aria-label="Filter by contact channel"
            className="px-3 py-2 min-h-[40px] text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Channels</option>
            {LEAD_CHANNELS.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[40px] text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Lead
        </button>
      </div>

      {/* Table / Mobile Cards */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : syncError && leads.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredLeads.length === 0 ? (
        <EmptyState
          icon={Target}
          title={leads.length === 0 ? 'No Prospects in Pipeline Yet' : 'No Matching Leads'}
          description={
            leads.length === 0
              ? 'Log Kenyan businesses contacted via Facebook, WhatsApp, Instagram, or phone calls, track demo previews, and convert them to paying clients.'
              : 'No leads match your current search or pipeline filter.'
          }
          actionLabel={leads.length === 0 ? 'Add First Lead' : undefined}
          onAction={leads.length === 0 ? openAddModal : undefined}
        />
      ) : (
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {paginatedItems.map((lead) => {
              const isDue =
                lead.status !== 'Converted' &&
                lead.status !== 'Lost' &&
                Boolean(lead.followUpDate) &&
                (lead.followUpDate as string) <= today;
              return (
                <div key={lead.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{lead.businessName}</p>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {lead.leadCode} · {lead.category} · {lead.location}
                      </p>
                    </div>
                    <StatusIndicator status={lead.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Contact</p>
                      <p className="text-slate-200 truncate">{lead.contactPerson}</p>
                      <p className="font-mono-tabular text-slate-400">
                        {lead.phone} · {lead.contactChannel}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-500">Follow-up & Budget</p>
                      <p className={`font-mono-tabular ${isDue ? 'text-amber-400 font-semibold' : 'text-slate-200'}`}>
                        {formatDisplayDate(lead.followUpDate)}
                      </p>
                      <p className="font-mono-tabular text-slate-400">
                        Est. {formatKES(lead.estimatedBudget, currency)} ({lead.interestLevel})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(lead)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    {lead.status !== 'Converted' && (
                      <button
                        type="button"
                        onClick={() => openConvertModal(lead)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-emerald-300 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 rounded-lg transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Convert
                      </button>
                    )}
                    {(lead.previewUrl || lead.socialLink) && (
                      <a
                        href={lead.previewUrl || lead.socialLink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open preview or social link for ${lead.businessName}`}
                        className="p-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-blue-400 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
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
                  <SortableTh label="Business & City" sortKey="businessName" sort={sort} onSort={toggleSort} />
                  <th className="py-3.5 px-4">Contact & Channel</th>
                  <SortableTh label="Interest / Budget" sortKey="estimatedBudget" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Follow-up" sortKey="followUpDate" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Stage" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {paginatedItems.map((lead) => {
                  const isDue =
                    lead.status !== 'Converted' &&
                    lead.status !== 'Lost' &&
                    Boolean(lead.followUpDate) &&
                    (lead.followUpDate as string) <= today;
                  return (
                    <tr key={lead.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-white">{lead.businessName}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {lead.leadCode} · {lead.category} · {lead.location}
                        </p>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="text-slate-200">{lead.contactPerson}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          <span className="font-mono-tabular">{lead.phone}</span> · {lead.contactChannel}
                        </p>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="text-xs font-medium text-slate-200">
                          {lead.interestLevel} Interest
                        </p>
                        <p className="font-mono-tabular text-xs text-slate-400 mt-0.5">
                          Est. {formatKES(lead.estimatedBudget, currency)}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-mono-tabular text-xs whitespace-nowrap">
                        <span className={isDue ? 'text-amber-400 font-semibold' : 'text-slate-300'}>
                          {formatDisplayDate(lead.followUpDate)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusIndicator status={lead.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          {(lead.previewUrl || lead.socialLink) && (
                            <a
                              href={lead.previewUrl || lead.socialLink}
                              target="_blank"
                              rel="noreferrer"
                              title="Open Preview or Social Link"
                              aria-label={`Open preview or social link for ${lead.businessName}`}
                              className="p-2 text-slate-400 hover:text-blue-400 hover:bg-white/[0.06] rounded-lg transition-colors"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(lead)}
                            title="Edit Lead"
                            aria-label={`Edit lead ${lead.businessName}`}
                            className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {lead.status !== 'Converted' && (
                            <button
                              type="button"
                              onClick={() => openConvertModal(lead)}
                              title="Convert Lead to Client"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Convert
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
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Add/Edit Lead Modal */}
      <SlideOverModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingLead ? `Edit Lead — ${editingLead.businessName}` : 'Add Prospect / Lead'}
        subtitle={
          editingLead
            ? `Lead ID: ${editingLead.leadCode}`
            : 'Track outreach from Facebook, WhatsApp, Instagram, or phone calls.'
        }
        wide
      >
        <form onSubmit={(e) => void handleSaveLead(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Name *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.businessNameMax}
                value={formState.businessName}
                onChange={(e) => setFormState({ ...formState, businessName: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Business Category *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.categoryMax}
                value={formState.category}
                onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                placeholder="e.g. Salon, Hardware, Dental Clinic"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Contact Person *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.contactNameMax}
                value={formState.contactPerson}
                onChange={(e) => setFormState({ ...formState, contactPerson: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Phone Number *
              </label>
              <input
                type="tel"
                required
                maxLength={FIELD_LIMITS.phoneMax}
                value={formState.phone}
                onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                placeholder="+254 7XX XXX XXX"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                City / Location *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.locationMax}
                value={formState.location}
                onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                placeholder="e.g. Nakuru, Mombasa, Nairobi"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Contact Channel *
              </label>
              <select
                value={formState.contactChannel}
                onChange={(e) =>
                  setFormState({ ...formState, contactChannel: e.target.value as LeadChannel })
                }
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {LEAD_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Facebook or Instagram Link
              </label>
              <input
                type="url"
                maxLength={FIELD_LIMITS.urlMax}
                value={formState.socialLink || ''}
                onChange={(e) => setFormState({ ...formState, socialLink: e.target.value })}
                placeholder="https://facebook.com/..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Existing Website (if any)
              </label>
              <input
                type="url"
                maxLength={FIELD_LIMITS.urlMax}
                value={formState.existingWebsite || ''}
                onChange={(e) => setFormState({ ...formState, existingWebsite: e.target.value })}
                placeholder="https://..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                EMG Website Demo / Preview URL
              </label>
              <input
                type="url"
                maxLength={FIELD_LIMITS.urlMax}
                value={formState.previewUrl || ''}
                onChange={(e) => setFormState({ ...formState, previewUrl: e.target.value })}
                placeholder="https://demo-preview.vercel.app"
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Date Contacted *
              </label>
              <input
                type="date"
                required
                value={formState.dateContacted}
                onChange={(e) => setFormState({ ...formState, dateContacted: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Follow-up Date
              </label>
              <input
                type="date"
                value={formState.followUpDate || ''}
                onChange={(e) => setFormState({ ...formState, followUpDate: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Interest Level *
              </label>
              <select
                value={formState.interestLevel}
                onChange={(e) =>
                  setFormState({ ...formState, interestLevel: e.target.value as LeadInterest })
                }
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {LEAD_INTERESTS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Estimated Budget ({currency}) *
              </label>
              <input
                type="number"
                required
                min={0}
                max={FIELD_LIMITS.maxAmount}
                value={formState.estimatedBudget}
                onChange={(e) =>
                  setFormState({ ...formState, estimatedBudget: Number(e.target.value) || 0 })
                }
                className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Pipeline Stage *
              </label>
              <select
                value={formState.status}
                onChange={(e) =>
                  setFormState({ ...formState, status: e.target.value as LeadStatus })
                }
                className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {LEAD_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Notes</label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.notesMax}
              value={formState.notes || ''}
              onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
              placeholder="Outreach conversation details, objections, or demo feedback..."
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
              {submitting ? 'Saving...' : editingLead ? 'Save Lead' : 'Create Lead'}
            </button>
          </div>
        </form>
      </SlideOverModal>

      {/* Convert Lead to Client Modal */}
      <SlideOverModal
        open={Boolean(convertingLead)}
        onClose={() => setConvertingLead(null)}
        title={`Convert Lead: ${convertingLead?.businessName || ''}`}
        subtitle="Creates a permanent Client record and links it back to this lead without erasing lead history."
      >
        {convertingLead && (
          <form onSubmit={(e) => void handleConvertSubmit(e)} className="space-y-4">
            <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-white">{convertingLead.businessName}</p>
              <p>
                {convertingLead.contactPerson} · {convertingLead.phone} · {convertingLead.location}
              </p>
              <p>
                Source: {convertingLead.contactChannel} ({convertingLead.leadCode})
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Subscription Package *
                </label>
                <select
                  value={convertOpts.packageId}
                  onChange={(e) => {
                    const pkg = settings.packages.find((p) => p.id === e.target.value);
                    setConvertOpts({
                      ...convertOpts,
                      packageId: e.target.value,
                      packageName: pkg ? pkg.name : 'CUSTOM',
                      monthlyAmount: pkg ? pkg.monthlyPrice : convertOpts.monthlyAmount,
                    });
                  }}
                  className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  {settings.packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatKES(p.monthlyPrice, currency)}/mo)
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Monthly Amount ({currency}) *
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={convertOpts.monthlyAmount}
                  onChange={(e) =>
                    setConvertOpts({
                      ...convertOpts,
                      monthlyAmount: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Client Email (Optional)
                </label>
                <input
                  type="email"
                  value={convertOpts.email || ''}
                  onChange={(e) => setConvertOpts({ ...convertOpts, email: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Domain Name (Optional)
                </label>
                <input
                  type="text"
                  value={convertOpts.domainName || ''}
                  onChange={(e) => setConvertOpts({ ...convertOpts, domainName: e.target.value })}
                  placeholder="client.co.ke"
                  className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Website URL (Optional)
                </label>
                <input
                  type="url"
                  value={convertOpts.websiteUrl || ''}
                  onChange={(e) => setConvertOpts({ ...convertOpts, websiteUrl: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={convertOpts.createWebsite}
                  onChange={(e) =>
                    setConvertOpts({ ...convertOpts, createWebsite: e.target.checked })
                  }
                  className="rounded border-white/20 bg-[#09090B] text-blue-600"
                />
                <span>Also create linked Website record</span>
              </label>

              {convertOpts.createWebsite && (
                <div className="pl-6">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Hosting Provider
                  </label>
                  <input
                    type="text"
                    value={convertOpts.hostingProvider}
                    onChange={(e) =>
                      setConvertOpts({ ...convertOpts, hostingProvider: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-sm bg-[#09090B] border border-white/10 rounded-lg text-white"
                  />
                </div>
              )}

              <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={convertOpts.createSubscription}
                  onChange={(e) =>
                    setConvertOpts({ ...convertOpts, createSubscription: e.target.checked })
                  }
                  className="rounded border-white/20 bg-[#09090B] text-blue-600"
                />
                <span>Also create initial monthly Subscription</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setConvertingLead(null)}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-white/[0.05] rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Converting...' : 'Confirm Conversion'}
              </button>
            </div>
          </form>
        )}
      </SlideOverModal>
    </div>
  );
}
