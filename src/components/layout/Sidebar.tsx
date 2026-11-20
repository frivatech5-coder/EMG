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
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
import type { NavSection } from '../../types/domain';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

interface SidebarProps {
  activeSection: NavSection;
  onSelect: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenCommand: () => void;
}

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }>;
}> = [
  {
    label: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { id: 'reminders', label: 'Inbox & Alerts', icon: Bell },
    ],
  },
  {
    label: 'CRM & Delivery',
    items: [
      { id: 'leads', label: 'Leads Pipeline', icon: Target },
      { id: 'clients', label: 'Clients', icon: Users },
      { id: 'websites', label: 'Websites', icon: Globe },
      { id: 'subscriptions', label: 'Subscriptions', icon: RefreshCw },
    ],
  },
  {
    label: 'Finance & System',
    items: [
      { id: 'payments', label: 'Payments', icon: CreditCard },
      { id: 'invoices', label: 'Invoices', icon: FileText },
      { id: 'reports', label: 'Analytics', icon: BarChart3 },
      { id: 'activity', label: 'Activity Log', icon: History },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar({
  activeSection,
  onSelect,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapse,
  onOpenCommand,
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

  const displayName = adminProfile?.displayName || user?.displayName || 'Administrator';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('');

  const renderNavContent = (isCollapsed: boolean) => (
    <div
      className={`flex flex-col h-full bg-[#0B0C10] border-r border-white/[0.08] select-none transition-[width] duration-200 ease-out ${
        isCollapsed ? 'w-[68px]' : 'w-[244px]'
      }`}
    >
      {/* Workspace Header */}
      <div className="px-3 h-14 flex items-center justify-between border-b border-white/[0.07] shrink-0">
        <button
          type="button"
          onClick={() => handleNav('dashboard')}
          className={`flex items-center gap-2.5 min-w-0 text-left ${
            isCollapsed ? 'mx-auto' : ''
          }`}
          title={settings.businessName || 'EMG WEB SOLUTIONS'}
        >
          <div className="bg-white rounded-md p-1 border border-white/15 shrink-0 flex items-center justify-center shadow-xs">
            <img
              src={settings.logoUrl || '/assets/aistudio/emglogo0_fdf409c7.png'}
              alt={settings.businessName || 'EMG WEB SOLUTIONS'}
              referrerPolicy="no-referrer"
              className="h-6 w-9 object-contain"
            />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <span className="block font-display font-semibold text-xs tracking-tight text-white truncate">
                {settings.businessName || 'EMG WEB SOLUTIONS'}
              </span>
              <span className="block text-[10px] text-zinc-500 truncate">
                Admin Workspace
              </span>
            </div>
          )}
        </button>

        {/* Mobile close or Desktop collapse */}
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-2 text-zinc-400 hover:text-white rounded-lg min-h-[36px] min-w-[36px] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Command Trigger */}
      <div className="px-2.5 pt-3 pb-1 shrink-0">
        {isCollapsed ? (
          <button
            type="button"
            onClick={onOpenCommand}
            title="Search workspace (⌘K)"
            aria-label="Search workspace"
            className="w-full h-9 flex items-center justify-center rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] text-zinc-400 hover:text-white transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenCommand}
            className="w-full h-9 px-2.5 flex items-center justify-between gap-2 rounded-lg bg-[#111216] hover:bg-white/[0.05] border border-white/[0.08] text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className="truncate">Quick jump...</span>
            </span>
            <kbd className="font-mono text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5 shrink-0">
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav
        className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5"
        aria-label="Primary navigation"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {!isCollapsed && (
              <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                {group.label}
              </p>
            )}
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
                    title={isCollapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleNav(item.id)}
                    className={`relative w-full flex items-center ${
                      isCollapsed ? 'justify-center px-0' : 'justify-between px-2.5'
                    } py-2 min-h-[38px] rounded-md text-[13px] font-medium transition-colors whitespace-nowrap group ${
                      isActive
                        ? 'bg-white/[0.08] text-white'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]'
                    }`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-blue-500"
                      />
                    )}
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive
                            ? 'text-blue-400'
                            : 'text-zinc-500 group-hover:text-zinc-300'
                        }`}
                      />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </span>
                    {!isCollapsed && badgeCount > 0 && (
                      <span
                        className={`font-mono-tabular text-[11px] font-semibold ${
                          metrics.criticalUnreadCount > 0 ? 'text-red-400' : 'text-amber-400'
                        }`}
                      >
                        {badgeCount}
                      </span>
                    )}
                    {isCollapsed && badgeCount > 0 && (
                      <span
                        aria-hidden="true"
                        className={`absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full ${
                          metrics.criticalUnreadCount > 0 ? 'bg-red-500' : 'bg-amber-500'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse Toggle & Admin Footer */}
      <div className="p-2.5 border-t border-white/[0.07] space-y-1.5 shrink-0">
        {!isCollapsed ? (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-md bg-white/[0.02]">
            <div className="w-7 h-7 rounded-md bg-blue-600/20 border border-blue-500/30 text-blue-300 font-display text-[11px] font-bold flex items-center justify-center shrink-0">
              {initials || 'AD'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">{displayName}</p>
              <p className="text-[10px] text-zinc-500 truncate">
                {adminProfile?.email || user?.email}
              </p>
            </div>
          </div>
        ) : null}

        <div className={`flex items-center ${isCollapsed ? 'flex-col gap-1' : 'gap-1'}`}>
          <button
            type="button"
            onClick={() => void logout()}
            title="Sign Out"
            aria-label="Sign Out"
            className={`flex-1 flex items-center ${
              isCollapsed ? 'justify-center w-full' : 'gap-2 px-2.5'
            } py-2 min-h-[36px] text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] rounded-md transition-colors whitespace-nowrap`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!isCollapsed && <span>Sign out</span>}
          </button>

          <button
            type="button"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:flex items-center justify-center p-2 min-h-[36px] min-w-[36px] text-zinc-500 hover:text-white hover:bg-white/[0.05] rounded-md transition-colors"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent collapsible rail */}
      <aside className="no-print hidden lg:block shrink-0 h-screen sticky top-0">
        {renderNavContent(collapsed)}
      </aside>

      {/* Mobile slide-over drawer (always expanded) */}
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
          <div className="relative z-10 h-full">{renderNavContent(false)}</div>
        </div>
      )}
    </>
  );
}
