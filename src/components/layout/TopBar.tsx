import { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Bell,
  CheckCheck,
  AlertTriangle,
  Info,
  Clock,
  ArrowRight,
  Search,
} from 'lucide-react';
import type { NavSection, NotificationItem } from '../../types/domain';
import { useData } from '../../context/DataContext';
import { markAllNotificationsRead, markNotificationRead } from '../../services/notificationsEngine';
import { formatKES } from '../../lib/validation';
import { PWAInstallButton } from '../pwa/PWAControls';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Executive Overview',
  clients: 'Clients',
  websites: 'Websites',
  subscriptions: 'Subscriptions',
  payments: 'Payments',
  invoices: 'Invoices',
  leads: 'Leads Pipeline',
  reminders: 'Inbox & Notifications',
  reports: 'Analytics & Reports',
  activity: 'Activity Log',
  settings: 'Settings',
};

interface TopBarProps {
  activeSection: NavSection;
  onOpenMobileMenu: () => void;
  onNavigate: (section: NavSection, recordId?: string) => void;
  onOpenCommand: () => void;
}

export function TopBar({
  activeSection,
  onOpenMobileMenu,
  onNavigate,
  onOpenCommand,
}: TopBarProps) {
  const { notifications, metrics, settings, loading, fromCache } = useData();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const unreadItems = notifications.filter((n) => !n.read);
  const previewItems = (unreadItems.length > 0 ? unreadItems : notifications).slice(0, 6);
  const currency = settings.currency || 'KES';

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleOutside);
      window.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  const handleOpenNotification = async (item: NotificationItem) => {
    setDropdownOpen(false);
    if (!item.read) {
      void markNotificationRead(item.id).catch((err) => {
        console.error('Failed to mark notification read:', err);
      });
    }
    onNavigate(item.targetSection, item.recordId);
  };

  const handleMarkAllRead = async () => {
    if (unreadItems.length === 0) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(unreadItems.map((n) => n.id));
    } finally {
      setMarkingAll(false);
    }
  };

  const priorityIcon = (priority: NotificationItem['priority']) => {
    if (priority === 'Critical') {
      return <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />;
    }
    if (priority === 'Warning') {
      return <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />;
    }
    return <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />;
  };

  return (
    <header className="no-print h-14 px-4 sm:px-6 lg:px-8 border-b border-white/[0.07] bg-[#09090B]/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open menu"
          className="lg:hidden p-2 -ml-2 min-h-[38px] min-w-[38px] flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav className="flex items-center gap-2 text-xs sm:text-sm min-w-0" aria-label="Breadcrumb">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="hidden sm:inline text-zinc-500 hover:text-zinc-300 transition-colors whitespace-nowrap"
          >
            EMG Studio
          </button>
          <span className="hidden sm:inline text-zinc-700" aria-hidden="true">
            /
          </span>
          <h1 className="font-display text-sm sm:text-base font-semibold text-white truncate">
            {SECTION_TITLES[activeSection]}
          </h1>
        </nav>
      </div>

      <div className="flex items-center gap-2 shrink-0 relative" ref={popoverRef}>
        {fromCache && !loading && (
          <span className="hidden xl:inline text-[11px] text-amber-300 whitespace-nowrap mr-1">
            Syncing cache
          </span>
        )}

        <button
          type="button"
          onClick={onOpenCommand}
          aria-label="Search records and commands"
          className="hidden md:inline-flex items-center gap-2 px-2.5 py-1.5 min-h-[34px] text-xs text-zinc-400 hover:text-zinc-200 bg-[#111216] hover:bg-white/[0.05] border border-white/[0.08] rounded-md transition-colors"
        >
          <Search className="w-3.5 h-3.5 text-zinc-500" />
          <span className="hidden lg:inline">Search...</span>
          <kbd className="font-mono text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={onOpenCommand}
          aria-label="Search workspace"
          className="md:hidden p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-300 hover:text-white bg-white/[0.04] border border-white/[0.08] rounded-md"
        >
          <Search className="w-4 h-4" />
        </button>

        <PWAInstallButton />

        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          aria-label="Toggle notifications menu"
          aria-expanded={dropdownOpen}
          className="relative inline-flex items-center gap-2 px-2.5 py-1.5 min-h-[36px] text-xs font-medium text-zinc-200 bg-[#111216] hover:bg-white/[0.07] border border-white/[0.08] rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <Bell
            className={`w-3.5 h-3.5 ${
              loading
                ? 'text-zinc-400'
                : metrics.criticalUnreadCount > 0
                ? 'text-red-400'
                : metrics.unreadNotificationsCount > 0
                ? 'text-amber-400'
                : 'text-zinc-300'
            }`}
          />
          <span className="hidden sm:inline">Inbox</span>
          {!loading && metrics.unreadNotificationsCount > 0 && (
            <span
              className={`font-mono-tabular px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                metrics.criticalUnreadCount > 0
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {metrics.unreadNotificationsCount}
            </span>
          )}
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-11 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-[#111216] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
            <div className="px-4 py-3 border-b border-white/[0.08] bg-[#0D0E12] flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-white">Notification Inbox</p>
                <p className="text-[11px] text-zinc-400">
                  {loading
                    ? 'Syncing alerts...'
                    : `${metrics.unreadNotificationsCount} unread${
                        metrics.criticalUnreadCount > 0
                          ? ` · ${metrics.criticalUnreadCount} critical`
                          : ''
                      }`}
                </p>
              </div>
              {!loading && unreadItems.length > 0 && (
                <button
                  type="button"
                  disabled={markingAll}
                  onClick={() => void handleMarkAllRead()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.06]">
              {loading ? (
                <div className="p-6 text-center text-xs text-zinc-400">
                  Loading notifications from Firestore...
                </div>
              ) : previewItems.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400">
                  Inbox zero. No active alerts or reminders.
                </div>
              ) : (
                previewItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleOpenNotification(item)}
                    className={`w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors flex items-start gap-2.5 ${
                      item.read ? 'opacity-60' : ''
                    }`}
                  >
                    {priorityIcon(item.priority)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                        {!item.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">
                        {item.message}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
                        <span className="uppercase tracking-wide">{item.category}</span>
                        {typeof item.amount === 'number' && item.amount > 0 && (
                          <span className="font-mono-tabular text-zinc-300">
                            {formatKES(item.amount, currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="px-4 py-2.5 bg-[#0D0E12] border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  onNavigate('reminders');
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 py-1"
              >
                Open Full Inbox
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
