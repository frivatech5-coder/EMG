import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  PauseCircle,
  Archive,
  FileText,
  Sparkles,
} from 'lucide-react';

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

const TONE_MAP: Record<string, { tone: StatusTone; Icon: typeof CheckCircle2 }> = {
  Active: { tone: 'success', Icon: CheckCircle2 },
  Live: { tone: 'success', Icon: CheckCircle2 },
  Paid: { tone: 'success', Icon: CheckCircle2 },
  Converted: { tone: 'success', Icon: CheckCircle2 },

  Pending: { tone: 'warning', Icon: Clock },
  Preview: { tone: 'info', Icon: Sparkles },
  'In Development': { tone: 'info', Icon: Clock },
  'Demo Prepared': { tone: 'info', Icon: FileText },
  'Demo Presented': { tone: 'info', Icon: FileText },
  Contacted: { tone: 'info', Icon: Clock },
  Interested: { tone: 'info', Icon: Sparkles },
  Negotiation: { tone: 'warning', Icon: Clock },
  Unpaid: { tone: 'warning', Icon: Clock },
  Draft: { tone: 'muted', Icon: FileText },
  'New Lead': { tone: 'info', Icon: Sparkles },
  Prospect: { tone: 'info', Icon: Clock },

  Overdue: { tone: 'danger', Icon: AlertTriangle },
  Failed: { tone: 'danger', Icon: XCircle },
  Suspended: { tone: 'danger', Icon: PauseCircle },
  Cancelled: { tone: 'muted', Icon: XCircle },
  Lost: { tone: 'muted', Icon: XCircle },
  Inactive: { tone: 'muted', Icon: PauseCircle },
  Archived: { tone: 'muted', Icon: Archive },
  Refunded: { tone: 'warning', Icon: AlertTriangle },
};

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
  info: 'text-blue-400',
  muted: 'text-zinc-400',
};

export function StatusIndicator({ status }: { status: string }) {
  const entry = TONE_MAP[status] || { tone: 'muted' as StatusTone, Icon: Clock };
  const Icon = entry.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[entry.tone]}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{status}</span>
    </span>
  );
}
