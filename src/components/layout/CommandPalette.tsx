import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  LayoutDashboard,
  Users,
  Globe,
  RefreshCw,
  CreditCard,
  FileText,
  Target,
  Bell,
  BarChart3,
  History,
  Settings,
  ArrowRight,
  X,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { formatKES } from '../../lib/validation';
import type { NavSection } from '../../types/domain';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (section: NavSection, recordId?: string) => void;
}

interface CommandEntry {
  id: string;
  group: string;
  label: string;
  meta?: string;
  section: NavSection;
  recordId?: string;
  icon: typeof LayoutDashboard;
}

const SECTION_COMMANDS: CommandEntry[] = [
  { id: 'nav-dashboard', group: 'Workspace', label: 'Dashboard Overview', meta: 'Executive summary & KPIs', section: 'dashboard', icon: LayoutDashboard },
  { id: 'nav-reminders', group: 'Workspace', label: 'Notifications Inbox', meta: 'Alerts & reminders', section: 'reminders', icon: Bell },
  { id: 'nav-leads', group: 'Workspace', label: 'Leads CRM Pipeline', meta: 'Prospect stages & follow-ups', section: 'leads', icon: Target },
  { id: 'nav-clients', group: 'Workspace', label: 'Clients Directory', meta: 'Accounts & profiles', section: 'clients', icon: Users },
  { id: 'nav-websites', group: 'Workspace', label: 'Websites Registry', meta: 'Domains & deployments', section: 'websites', icon: Globe },
  { id: 'nav-subscriptions', group: 'Workspace', label: 'Subscriptions & Renewals', meta: 'Recurring billing & grace periods', section: 'subscriptions', icon: RefreshCw },
  { id: 'nav-payments', group: 'Workspace', label: 'Payments Ledger', meta: 'M-Pesa, bank & PayPal transactions', section: 'payments', icon: CreditCard },
  { id: 'nav-invoices', group: 'Workspace', label: 'Invoices & Statements', meta: 'Billing documents & PDFs', section: 'invoices', icon: FileText },
  { id: 'nav-reports', group: 'Workspace', label: 'Reports & Exports', meta: 'Analytics & CSV exports', section: 'reports', icon: BarChart3 },
  { id: 'nav-activity', group: 'Workspace', label: 'Activity Audit Logs', meta: 'Immutable system history', section: 'activity', icon: History },
  { id: 'nav-settings', group: 'Workspace', label: 'Settings & Web Push', meta: 'Company, packages, FCM & admins', section: 'settings', icon: Settings },
];

export function CommandPalette({ open, onClose, onNavigate }: CommandPaletteProps) {
  const { clients, websites, subscriptions, invoices, leads, settings } = useData();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currency = settings.currency || 'KES';

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo<CommandEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return SECTION_COMMANDS;
    }

    const matches: CommandEntry[] = [];

    for (const nav of SECTION_COMMANDS) {
      if (
        nav.label.toLowerCase().includes(q) ||
        (nav.meta || '').toLowerCase().includes(q)
      ) {
        matches.push(nav);
      }
    }

    for (const c of clients) {
      if (
        c.businessName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.clientCode.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      ) {
        matches.push({
          id: `client-${c.id}`,
          group: 'Clients',
          label: c.businessName,
          meta: `${c.clientCode} · ${c.contactName} · ${c.status}`,
          section: 'clients',
          recordId: c.id,
          icon: Users,
        });
      }
      if (matches.length >= 20) break;
    }

    for (const w of websites) {
      if (
        w.websiteName.toLowerCase().includes(q) ||
        (w.domain || '').toLowerCase().includes(q) ||
        w.businessName.toLowerCase().includes(q)
      ) {
        matches.push({
          id: `web-${w.id}`,
          group: 'Websites',
          label: w.websiteName,
          meta: `${w.domain || w.hostingProvider} · ${w.deploymentStatus}`,
          section: 'websites',
          recordId: w.id,
          icon: Globe,
        });
      }
      if (matches.length >= 25) break;
    }

    for (const inv of invoices) {
      if (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q)
      ) {
        matches.push({
          id: `inv-${inv.id}`,
          group: 'Invoices',
          label: `${inv.invoiceNumber} — ${inv.clientName}`,
          meta: `${formatKES(inv.amount, currency)} · ${inv.status}`,
          section: 'invoices',
          recordId: inv.id,
          icon: FileText,
        });
      }
      if (matches.length >= 30) break;
    }

    for (const sub of subscriptions) {
      if (
        sub.clientName.toLowerCase().includes(q) ||
        sub.subscriptionCode.toLowerCase().includes(q)
      ) {
        matches.push({
          id: `sub-${sub.id}`,
          group: 'Subscriptions',
          label: `${sub.clientName} (${sub.packageName})`,
          meta: `${sub.subscriptionCode} · ${formatKES(sub.monthlyAmount, currency)}/mo`,
          section: 'subscriptions',
          recordId: sub.id,
          icon: RefreshCw,
        });
      }
      if (matches.length >= 34) break;
    }

    for (const l of leads) {
      if (
        l.businessName.toLowerCase().includes(q) ||
        l.contactPerson.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q)
      ) {
        matches.push({
          id: `lead-${l.id}`,
          group: 'Leads CRM',
          label: l.businessName,
          meta: `${l.contactPerson} · ${l.status}`,
          section: 'leads',
          recordId: l.id,
          icon: Target,
        });
      }
      if (matches.length >= 38) break;
    }

    return matches.slice(0, 14);
  }, [query, clients, websites, invoices, subscriptions, leads, currency]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) =>
          results.length > 0 ? (prev - 1 + results.length) % results.length : 0
        );
      } else if (e.key === 'Enter' && results[activeIndex]) {
        e.preventDefault();
        const item = results[activeIndex];
        onNavigate(item.section, item.recordId);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, results, activeIndex, onClose, onNavigate]);

  if (!open) return null;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/75 backdrop-blur-xs animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace command menu"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl bg-[#111216] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08]">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to module, client, website, invoice, or lead..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command menu"
            className="p-1 text-zinc-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-zinc-500">
              No workspace modules or records matching &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {results.map((entry, idx) => {
                const Icon = entry.icon;
                const selected = idx === activeIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onNavigate(entry.section, entry.recordId);
                      onClose();
                    }}
                    className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                      selected ? 'bg-blue-600/15 text-white' : 'text-zinc-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          selected ? 'text-blue-400' : 'text-zinc-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{entry.label}</p>
                        {entry.meta && (
                          <p className="text-[11px] text-zinc-400 truncate">{entry.meta}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                        {entry.group}
                      </span>
                      {selected && <ArrowRight className="w-3.5 h-3.5 text-blue-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-white/[0.07] bg-[#0D0E12] flex items-center justify-between text-[11px] text-zinc-500">
          <span>Navigate with ↑ ↓ and press Enter</span>
          <span className="font-mono">ESC to close</span>
        </div>
      </div>
    </div>
  );
}
