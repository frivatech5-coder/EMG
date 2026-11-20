import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider } from './components/ui/ToastContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { TableSkeleton } from './components/ui/EmptyState';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { CommandPalette } from './components/layout/CommandPalette';
import { OfflineIndicator, PWAUpdateBanner } from './components/pwa/PWAControls';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import type { NavSection } from './types/domain';

const ClientsPage = lazy(() =>
  import('./pages/ClientsPage').then((m) => ({ default: m.ClientsPage }))
);
const WebsitesPage = lazy(() =>
  import('./pages/WebsitesPage').then((m) => ({ default: m.WebsitesPage }))
);
const SubscriptionsPage = lazy(() =>
  import('./pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage }))
);
const PaymentsPage = lazy(() =>
  import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage }))
);
const InvoicesPage = lazy(() =>
  import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage }))
);
const LeadsPage = lazy(() =>
  import('./pages/LeadsPage').then((m) => ({ default: m.LeadsPage }))
);
const RemindersPage = lazy(() =>
  import('./pages/RemindersPage').then((m) => ({ default: m.RemindersPage }))
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const ActivityLogsPage = lazy(() =>
  import('./pages/ActivityLogsPage').then((m) => ({ default: m.ActivityLogsPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

const VALID_SECTIONS: NavSection[] = [
  'dashboard',
  'clients',
  'websites',
  'subscriptions',
  'payments',
  'invoices',
  'leads',
  'reminders',
  'reports',
  'activity',
  'settings',
];

function parseInitialDeepLink(): { section: NavSection; recordId: string | null } {
  if (typeof window === 'undefined') {
    return { section: 'dashboard', recordId: null };
  }
  const params = new URLSearchParams(window.location.search);
  const rawSection = params.get('section') as NavSection | null;
  const recordId = params.get('recordId');
  const section =
    rawSection && VALID_SECTIONS.includes(rawSection) ? rawSection : 'dashboard';
  return { section, recordId: recordId || null };
}

function AuthenticatedWorkspace() {
  const { authReady, isAuthorizedAdmin } = useAuth();
  const initial = parseInitialDeepLink();
  const [activeSection, setActiveSection] = useState<NavSection>(initial.section);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(initial.recordId);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('emg_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('emg_sidebar_collapsed', String(next));
      } catch {
        // Ignore storage restrictions
      }
      return next;
    });
  }, []);

  const navigateTo = useCallback((section: NavSection, recordId?: string) => {
    setActiveSection(section);
    setFocusedRecordId(recordId || null);
  }, []);

  const clearFocusedRecord = useCallback(() => {
    setFocusedRecordId(null);
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; targetSection?: string; recordId?: string }
        | undefined;
      if (data?.type === 'EMG_NOTIFICATION_CLICK' && data.targetSection) {
        const sec = VALID_SECTIONS.includes(data.targetSection as NavSection)
          ? (data.targetSection as NavSection)
          : 'reminders';
        navigateTo(sec, data.recordId || undefined);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSwMessage);
  }, [navigateTo]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#09090B] text-zinc-300 flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        <p className="text-xs font-medium text-zinc-400 tracking-wide">
          Verifying EMG administrator session...
        </p>
      </div>
    );
  }

  if (!isAuthorizedAdmin) {
    return <LoginPage />;
  }

  return (
    <DataProvider>
      <div className="min-h-screen bg-[#09090B] text-zinc-100 flex">
        <Sidebar
          activeSection={activeSection}
          onSelect={(sec) => navigateTo(sec)}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
          onOpenCommand={() => setCommandOpen(true)}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar
            activeSection={activeSection}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onNavigate={navigateTo}
            onOpenCommand={() => setCommandOpen(true)}
          />
          <OfflineIndicator />
          <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7 max-w-[1440px] w-full mx-auto">
            {activeSection === 'dashboard' && (
              <DashboardPage onNavigate={(sec, recordId) => navigateTo(sec, recordId)} />
            )}
            <Suspense fallback={<TableSkeleton rows={6} />}>
              {activeSection === 'clients' && (
                <ClientsPage
                  focusedRecordId={focusedRecordId}
                  onClearFocusedRecord={clearFocusedRecord}
                />
              )}
              {activeSection === 'websites' && (
                <WebsitesPage
                  focusedRecordId={focusedRecordId}
                  onClearFocusedRecord={clearFocusedRecord}
                />
              )}
              {activeSection === 'subscriptions' && (
                <SubscriptionsPage
                  focusedRecordId={focusedRecordId}
                  onClearFocusedRecord={clearFocusedRecord}
                />
              )}
              {activeSection === 'payments' && (
                <PaymentsPage
                  focusedRecordId={focusedRecordId}
                  onClearFocusedRecord={clearFocusedRecord}
                />
              )}
              {activeSection === 'invoices' && (
                <InvoicesPage
                  focusedRecordId={focusedRecordId}
                  onClearFocusedRecord={clearFocusedRecord}
                />
              )}
              {activeSection === 'leads' && (
                <LeadsPage
                  focusedRecordId={focusedRecordId}
                  onClearFocusedRecord={clearFocusedRecord}
                />
              )}
              {activeSection === 'reminders' && (
                <RemindersPage onNavigate={navigateTo} />
              )}
              {activeSection === 'reports' && <ReportsPage />}
              {activeSection === 'activity' && <ActivityLogsPage />}
              {activeSection === 'settings' && <SettingsPage />}
            </Suspense>
          </main>
        </div>

        <CommandPalette
          open={commandOpen}
          onClose={() => setCommandOpen(false)}
          onNavigate={navigateTo}
        />
      </div>
    </DataProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <AuthenticatedWorkspace />
          <PWAUpdateBanner />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
