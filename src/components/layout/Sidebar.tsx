import { useEffect } from 'react';
import {
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
  LogOut,
  X,
} from 'lucide-react';
import type { NavSection } from '../../types/domain';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

interface SidebarProps {
  activeSection: NavSection;
  onSelect: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }>;
}> = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'reminders', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'leads', label: 'Leads CRM', icon: Target },
      { id: 'clients', label: 'Clients', icon: Users },
      { id: 'websites', label: 'Websites', icon: Globe },
      { id: 'subscriptions', label: 'Subscriptions', icon: RefreshCw },
    ],
  },
  {
    label: 'Finance & Admin',
    items: [
      { id: 'payments', label: 'Payments', icon: CreditCard },
      { id: 'invoices', label: 'Invoices', icon: FileText },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'activity', label: 'Activity Logs', icon: History },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar({
  activeSection,
  onSelect,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { adminProfile, user, logout } = useAuth();
  const { settings, metrics, loading } = useData();

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const handleNav = (id: NavSection) => {
    onSelect(id);
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0C0E14] border-r border-white/[0.08] w-64 select-none">
      {/* Brand header */}
      <div className="px-5 h-16 flex items-center justify-between border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-white rounded-lg p-1 border border-white/15 shrink-0 flex items-center justify-center">
            <img
              src={settings.logoUrl || '/assets/aistudio/emglogo0_fdf409c7.png'}
              alt={settings.businessName || 'EMG WEB SOLUTIONS'}
              referrerPolicy="no-referrer"
              className="h-8 w-12 object-contain"
            />
          </div>
          <div className="min-w-0">
            <span className="block font-display font-bold text-sm tracking-tight text-white truncate">
              {settings.businessName || 'EMG WEB SOLUTIONS'}
            </span>
            <span className="block text-[10px] text-slate-500 truncate">
              Management Console
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg min-h-[40px] min-w-[40px] flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6" aria-label="Primary navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-2 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const badgeCount =
                  item.id === 'reminders' && !loading ? metrics.totalRemindersCount : 0;

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleNav(item.id)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 min-h-[42px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600/15 text-blue-300 border border-blue-500/25'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-blue-400' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {badgeCount > 0 && (
                      <span
                        className={`font-mono-tabular text-xs font-semibold ${
                          metrics.criticalUnreadCount > 0 ? 'text-red-400' : 'text-amber-400'
                        }`}
                      >
                        {badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Admin Footer */}
      <div className="p-3 border-t border-white/[0.08] shrink-0">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs font-medium text-white truncate">
            {adminProfile?.displayName || user?.displayName || 'Administrator'}
          </p>
          <p className="text-[11px] text-slate-400 truncate">
            {adminProfile?.email || user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[40px] text-sm font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] rounded-lg transition-colors whitespace-nowrap"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="no-print hidden lg:block shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div
          className="no-print fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
