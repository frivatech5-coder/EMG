import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SlideOverModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

export function SlideOverModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: SlideOverModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative z-10 w-full ${
          wide ? 'max-w-3xl' : 'max-w-xl'
        } bg-[#111216] border-l border-white/[0.1] h-full flex flex-col shadow-2xl animate-slide-in-right`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-white/[0.08] bg-[#0D0E12] shrink-0">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-semibold text-white truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline font-mono text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5">
              ESC
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="p-2 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
