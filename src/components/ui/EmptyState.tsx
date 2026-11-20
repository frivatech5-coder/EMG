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
    <div className="border border-white/[0.08] bg-[#111216] rounded-xl px-6 py-14 text-center flex flex-col items-center justify-center">
      <div className="w-11 h-11 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-400 mb-4">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="font-display text-base font-semibold text-white">{title}</h3>
      <p className="text-sm text-zinc-400 max-w-md mt-1.5 leading-relaxed">{description}</p>
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
      className="border border-red-500/25 bg-[#111216] rounded-xl px-6 py-10 text-center flex flex-col items-center justify-center"
    >
      <div className="w-11 h-11 rounded-lg bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400 mb-4">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <h3 className="font-display text-base font-semibold text-white">{title}</h3>
      <p className="text-sm text-zinc-300 max-w-lg mt-1.5 leading-relaxed">{message}</p>
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
      className="border border-white/[0.08] bg-[#111216] rounded-xl overflow-hidden"
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

export function SummaryStripSkeleton({ cards = 3 }: { cards?: 3 | 4 | 5 }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading summary metrics"
      className={`border border-white/[0.08] bg-[#111216] rounded-xl overflow-hidden grid divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07] ${
        cards === 5
          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5'
          : cards === 4
          ? 'grid-cols-2 lg:grid-cols-4'
          : 'grid-cols-1 sm:grid-cols-3'
      }`}
    >
      {Array.from({ length: cards }).map((_, idx) => (
        <div key={idx} className="p-4 sm:p-5 space-y-2.5 animate-pulse">
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
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 bg-white/[0.08] rounded w-48" />
          <div className="h-3.5 bg-white/[0.05] rounded w-72" />
        </div>
        <div className="h-10 bg-white/[0.08] rounded-lg w-36" />
      </div>
      <div className="bg-[#111216] border border-white/[0.08] rounded-xl grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="p-5 space-y-3">
            <div className="h-3 bg-white/[0.06] rounded w-32" />
            <div className="h-7 bg-white/[0.1] rounded w-28" />
            <div className="h-3 bg-white/[0.05] rounded w-40" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#111216] border border-white/[0.08] rounded-xl p-5 h-80" />
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-5 h-80" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-5 h-64" />
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-5 h-64" />
      </div>
    </div>
  );
}
