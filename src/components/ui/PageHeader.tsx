import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-white/[0.07]">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-xl sm:text-2xl font-semibold text-white tracking-tight">
            {title}
          </h2>
          {meta}
        </div>
        {description && (
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#0D0E12] border border-white/[0.08] overflow-x-auto max-w-full"
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-white/[0.1] text-white shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
            }`}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={`font-mono-tabular text-[11px] ${
                  active ? 'text-blue-400' : 'text-zinc-500'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const INPUT_CLASS =
  'w-full px-3.5 py-2 min-h-[40px] text-sm bg-[#09090B] border border-white/[0.1] rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 transition-colors';

export const SELECT_CLASS =
  'px-3 py-2 min-h-[40px] text-sm bg-[#111216] border border-white/[0.08] rounded-lg text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors';
