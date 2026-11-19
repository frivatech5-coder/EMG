import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDirection;
}

export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const isActive = sort.key === sortKey;
  const ariaSort = isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th
      aria-sort={ariaSort}
      className={`py-3.5 px-4 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
          isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        <span>{label}</span>
        {isActive ? (
          sort.dir === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5 text-blue-400" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-blue-400" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-50" />
        )}
      </button>
    </th>
  );
}

export function useTableSort<K extends string>(defaultKey: K, defaultDir: SortDirection = 'desc') {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir });

  const toggleSort = (key: K) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: key === 'amount' || key === 'monthlyAmount' || key === 'date' ? 'desc' : 'asc' };
    });
  };

  return { sort, toggleSort };
}

export function useTablePagination<T>(items: T[], defaultPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return {
    page,
    setPage,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
    totalItems,
    totalPages,
    paginatedItems,
  };
}

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (totalItems === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-white/[0.08] bg-[#0C0E14] text-xs text-slate-400">
      <div className="flex items-center justify-between sm:justify-start gap-3">
        <span className="font-mono-tabular">
          Showing <strong className="text-slate-200">{start}–{end}</strong> of{' '}
          <strong className="text-slate-200">{totalItems}</strong>
        </span>

        <label className="inline-flex items-center gap-1.5">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
            className="px-2 py-1 text-xs bg-[#11131A] border border-white/10 rounded-md text-slate-200"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
            className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-lg border border-white/[0.08] bg-[#11131A] text-slate-200 hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev
          </button>
          <span className="font-mono-tabular px-2 text-slate-300">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
            className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-lg border border-white/[0.08] bg-[#11131A] text-slate-200 hover:bg-white/[0.06] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
