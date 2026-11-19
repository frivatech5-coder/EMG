import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="border border-white/[0.08] bg-[#11131A] rounded-xl px-6 py-12 text-center flex flex-col items-center justify-center">
      <div className="w-11 h-11 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 mb-4">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="text-sm text-slate-400 max-w-md mt-1.5 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 px-4 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  title = 'Unable to Load Live Records',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="border border-red-500/25 bg-[#11131A] rounded-xl px-6 py-10 text-center flex flex-col items-center justify-center"
    >
      <div className="w-11 h-11 rounded-lg bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400 mb-4">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="text-sm text-slate-300 max-w-lg mt-1.5 leading-relaxed">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap"
        >
          <RotateCcw className="w-4 h-4" />
          Retry Firestore Sync
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading records"
      className="border border-white/[0.08] bg-[#11131A] rounded-xl overflow-hidden"
    >
      <div className="divide-y divide-white/[0.06]">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="px-5 py-4 flex items-center justify-between gap-4 animate-pulse">
            <div className="h-4 bg-white/[0.07] rounded w-1/4" />
            <div className="h-4 bg-white/[0.05] rounded w-1/5" />
            <div className="h-4 bg-white/[0.05] rounded w-1/6 hidden sm:block" />
            <div className="h-4 bg-white/[0.07] rounded w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SummaryStripSkeleton({ cards = 3 }: { cards?: 3 | 4 }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading summary metrics"
      className={`grid gap-4 ${
        cards === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'
      }`}
    >
      {Array.from({ length: cards }).map((_, idx) => (
        <div
          key={idx}
          className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4 space-y-2.5 animate-pulse"
        >
          <div className="h-3 bg-white/[0.06] rounded w-28" />
          <div className="h-6 bg-white/[0.09] rounded w-24" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard metrics" className="space-y-6 animate-pulse">
      <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4 h-20" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 space-y-3">
            <div className="h-3 bg-white/[0.06] rounded w-36" />
            <div className="h-7 bg-white/[0.1] rounded w-28" />
            <div className="h-3 bg-white/[0.05] rounded w-44" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4 space-y-2">
            <div className="h-3 bg-white/[0.06] rounded w-28" />
            <div className="h-6 bg-white/[0.09] rounded w-14" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#11131A] border border-white/[0.08] rounded-xl p-5 h-80" />
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 h-80" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 h-64" />
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 h-64" />
      </div>
    </div>
  );
}
