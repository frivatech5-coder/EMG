import { useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import { useData } from '../context/DataContext';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/EmptyState';
import { PaginationBar, useTablePagination } from '../components/ui/DataTableControls';

const ENTITY_FILTERS = [
  'ALL',
  'client',
  'website',
  'subscription',
  'payment',
  'invoice',
  'lead',
  'notification',
  'settings',
  'admin',
];

export function ActivityLogsPage() {
  const { activityLogs, activityLoading, syncError, retrySync } = useData();
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('ALL');

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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search activity logs"
            placeholder="Search action, summary, record ID, admin..."
            className="w-full pl-9 pr-3 py-2 min-h-[40px] text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          aria-label="Filter by entity type"
          className="px-3 py-2 min-h-[40px] text-sm bg-[#11131A] border border-white/[0.08] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
        >
          {ENTITY_FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'ALL' ? 'All Categories' : f.charAt(0).toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
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
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {paginatedItems.map((log) => {
              const ts = log.createdAt?.toDate ? log.createdAt.toDate() : null;
              return (
                <div key={log.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-medium text-blue-400 break-all">
                      {log.actionType}
                    </span>
                    <span className="text-[11px] text-slate-500 capitalize shrink-0">
                      {log.entityType}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed">{log.summary}</p>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 pt-1">
                    <span className="truncate">{log.adminEmail || log.adminId}</span>
                    <span className="font-mono-tabular shrink-0">
                      {ts ? ts.toLocaleString('en-KE') : 'Pending'}
                    </span>
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
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4">Summary</th>
                  <th className="py-3.5 px-4">Record ID</th>
                  <th className="py-3.5 px-4">Administrator</th>
                  <th className="py-3.5 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {paginatedItems.map((log) => {
                  const ts = log.createdAt?.toDate ? log.createdAt.toDate() : null;
                  return (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-mono text-xs font-medium text-blue-400">
                          {log.actionType}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 capitalize">
                          {log.entityType}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-slate-200">{log.summary}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-400">
                        {log.recordId}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-300">
                        {log.adminEmail || log.adminId}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-xs text-slate-400 whitespace-nowrap">
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
