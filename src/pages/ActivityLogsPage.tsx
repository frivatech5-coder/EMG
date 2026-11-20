import { useMemo, useState } from 'react';
import { History, Search, Clock } from 'lucide-react';
import { useData } from '../context/DataContext';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/EmptyState';
import { PaginationBar, useTablePagination } from '../components/ui/DataTableControls';
import { INPUT_CLASS, PageHeader, SegmentedTabs } from '../components/ui/PageHeader';

const ENTITY_FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'client', label: 'Clients' },
  { id: 'website', label: 'Websites' },
  { id: 'subscription', label: 'Subscriptions' },
  { id: 'payment', label: 'Payments' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'lead', label: 'Leads' },
  { id: 'notification', label: 'Alerts' },
  { id: 'settings', label: 'Settings' },
  { id: 'admin', label: 'Admins' },
] as const;

type EntityFilter = (typeof ENTITY_FILTERS)[number]['id'];

export function ActivityLogsPage() {
  const { activityLogs, activityLoading, syncError, retrySync } = useData();
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('ALL');

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: activityLogs.length };
    for (const log of activityLogs) {
      map[log.entityType] = (map[log.entityType] || 0) + 1;
    }
    return map;
  }, [activityLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activityLogs.filter((log) => {
      if (entityFilter !== 'ALL' && log.entityType !== entityFilter) return false;
      if (!q) return true;
      return (
        log.summary.toLowerCase().includes(q) ||
        log.actionType.toLowerCase().includes(q) ||
        log.recordId.toLowerCase().includes(q) ||
        (log.adminEmail || '').toLowerCase().includes(q)
      );
    });
  }, [activityLogs, search, entityFilter]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    totalPages,
    paginatedItems,
  } = useTablePagination(filteredLogs, 25);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit & Activity Logs"
        description="Immutable Firestore ledger recording every administrative update across billing, clients, websites, and settings."
        meta={
          <span className="font-mono-tabular text-[11px] px-2 py-0.5 rounded bg-white/[0.05] text-zinc-400">
            {filteredLogs.length} {filteredLogs.length === 1 ? 'event' : 'events'}
          </span>
        }
      />

      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <SegmentedTabs
          value={entityFilter}
          onChange={setEntityFilter}
          options={ENTITY_FILTERS.map((f) => ({
            id: f.id,
            label: f.label,
            count: counts[f.id] ?? 0,
          }))}
        />

        <div className="relative w-full xl:max-w-xs">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search activity logs"
            placeholder="Search action, summary, ID, admin..."
            className={`${INPUT_CLASS} pl-9`}
          />
        </div>
      </div>

      {activityLoading ? (
        <TableSkeleton rows={6} />
      ) : syncError && activityLogs.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : filteredLogs.length === 0 ? (
        <EmptyState
          icon={History}
          title={activityLogs.length === 0 ? 'No Activity Logs Recorded' : 'No Matching Activity Logs'}
          description={
            activityLogs.length === 0
              ? 'Administrative actions (clients, websites, subscriptions, payments, invoices, lead conversions) are logged immutably here.'
              : 'No activity entries match your current search or category filter.'
          }
        />
      ) : (
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Timeline Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {paginatedItems.map((log) => {
              const ts = log.createdAt?.toDate ? log.createdAt.toDate() : null;
              return (
                <div key={log.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span className="font-mono text-xs font-medium text-blue-400 break-all">
                        {log.actionType}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-500 capitalize shrink-0">
                      {log.entityType}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed">{log.summary}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 pt-1">
                    <span className="truncate">{log.adminEmail || log.adminId}</span>
                    <span className="inline-flex items-center gap-1 font-mono-tabular shrink-0 text-zinc-500">
                      <Clock className="w-3 h-3" />
                      {ts ? ts.toLocaleString('en-KE') : 'Pending'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop High-Density Ledger Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.07] bg-[#0D0E12] text-[11px] uppercase tracking-wider font-medium text-zinc-500">
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Summary</th>
                  <th className="py-3 px-4">Record ID</th>
                  <th className="py-3 px-4">Administrator</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {paginatedItems.map((log) => {
                  const ts = log.createdAt?.toDate ? log.createdAt.toDate() : null;
                  return (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 align-top">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                          <span className="font-mono text-xs font-medium text-blue-400">
                            {log.actionType}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5 pl-3.5 capitalize">
                          {log.entityType}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-zinc-200 align-top max-w-md">{log.summary}</td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-400 align-top whitespace-nowrap">
                        {log.recordId}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-300 align-top whitespace-nowrap">
                        {log.adminEmail || log.adminId}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-xs text-zinc-400 align-top whitespace-nowrap">
                        {ts ? ts.toLocaleString('en-KE') : 'Pending'}
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
    </div>
  );
}
