import { useMemo } from 'react';
import {
  Users,
  Globe,
  RefreshCw,
  CreditCard,
  AlertTriangle,
  Plus,
  UserPlus,
  FileText,
  Target,
  ArrowRight,
  Clock,
  History,
  RotateCcw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useData } from '../context/DataContext';
import {
  daysBetween,
  formatDisplayDate,
  formatKES,
  getEffectiveSubscriptionStatus,
  isPastGracePeriod,
  todayIso,
} from '../lib/validation';
import { StatusIndicator } from '../components/ui/StatusBadge';
import { DashboardSkeleton, ErrorState } from '../components/ui/EmptyState';
import type { NavSection } from '../types/domain';

interface DashboardPageProps {
  onNavigate: (section: NavSection, recordId?: string) => void;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const {
    clients,
    subscriptions,
    payments,
    invoices,
    leads,
    activityLogs,
    settings,
    metrics,
    loading,
    fromCache,
    syncError,
    retrySync,
  } = useData();
  const today = todayIso();

  // Build real 6-month revenue series from actual Paid payment records (Africa/Nairobi month anchor)
  const revenueSeries = useMemo(() => {
    const [year, month] = today.split('-').map(Number);
    const months: Array<{ key: string; label: string; collected: number; count: number }> = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(year, month - 1 - i, 15));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-KE', {
        timeZone: 'Africa/Nairobi',
        month: 'short',
        year: '2-digit',
      });
      months.push({ key, label, collected: 0, count: 0 });
    }
    for (const p of payments) {
      if (p.status !== 'Paid') continue;
      const monthKey = (p.paymentDate || '').slice(0, 7);
      const bucket = months.find((m) => m.key === monthKey);
      if (bucket) {
        bucket.collected += Number(p.amount) || 0;
        bucket.count += 1;
      }
    }
    return months;
  }, [payments, today]);

  const recentPayments = useMemo(() => payments.slice(0, 5), [payments]);
  const recentActivity = useMemo(() => activityLogs.slice(0, 5), [activityLogs]);

  const renewalReminders = useMemo(() => {
    const windowDays = settings.notificationPreferences?.renewalReminderDays ?? 14;
    return subscriptions
      .filter((s) => {
        const eff = getEffectiveSubscriptionStatus(s, today);
        return (
          eff === 'Overdue' ||
          ((eff === 'Active' || eff === 'Pending') &&
            daysBetween(today, s.nextPaymentDate) <= windowDays)
        );
      })
      .sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate))
      .slice(0, 6);
  }, [subscriptions, settings.notificationPreferences?.renewalReminderDays, today]);

  const graceDeadlines = useMemo(() => {
    return subscriptions
      .filter((s) => getEffectiveSubscriptionStatus(s, today) === 'Overdue')
      .sort((a, b) => a.gracePeriodEndDate.localeCompare(b.gracePeriodEndDate))
      .slice(0, 5);
  }, [subscriptions, today]);

  const unpaidInvoicesOverview = useMemo(() => {
    return invoices
      .filter((i) => i.status === 'Unpaid' || i.status === 'Overdue')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);
  }, [invoices]);

  const followUpReminders = useMemo(() => {
    return leads
      .filter(
        (l) =>
          l.status !== 'Converted' &&
          l.status !== 'Lost' &&
          Boolean(l.followUpDate) &&
          (l.followUpDate as string) <= today
      )
      .sort((a, b) => (a.followUpDate || '').localeCompare(b.followUpDate || ''))
      .slice(0, 5);
  }, [leads, today]);

  const currency = settings.currency || 'KES';

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (syncError && clients.length === 0 && subscriptions.length === 0 && payments.length === 0) {
    return <ErrorState message={syncError} onRetry={retrySync} />;
  }

  const verifiedThisMonthCount = payments.filter(
    (p) => p.status === 'Paid' && p.paymentDate.startsWith(today.slice(0, 7))
  ).length;

  const kpiCards = [
    {
      label: 'Monthly Recurring Revenue',
      value: formatKES(metrics.mrr, currency),
      meta: `${metrics.activeSubscriptions} active subscriptions`,
      icon: RefreshCw,
      accent: 'text-blue-400',
      target: 'subscriptions' as NavSection,
    },
    {
      label: 'Payments Received (This Month)',
      value: formatKES(metrics.paymentsThisMonth, currency),
      meta: `${verifiedThisMonthCount} verified payment${verifiedThisMonthCount === 1 ? '' : 's'}`,
      icon: CreditCard,
      accent: 'text-emerald-400',
      target: 'payments' as NavSection,
    },
    {
      label: 'Outstanding Payments',
      value: formatKES(metrics.outstandingPayments, currency),
      meta: `${metrics.overdueSubscriptionsCount} overdue · ${metrics.unpaidInvoicesCount} unpaid invoices`,
      icon: AlertTriangle,
      accent: metrics.outstandingPayments > 0 ? 'text-amber-400' : 'text-slate-400',
      target: 'invoices' as NavSection,
    },
    {
      label: 'Total / Active Clients',
      value: `${metrics.totalClients} / ${metrics.activeClients}`,
      meta: `${metrics.liveWebsites} live websites · ${metrics.upcomingRenewalsCount} renewals due`,
      icon: Users,
      accent: 'text-indigo-400',
      target: 'clients' as NavSection,
    },
  ];

  return (
    <div className="space-y-6">
      {syncError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 text-xs text-red-200"
        >
          <span>{syncError}</span>
          <button
            type="button"
            onClick={retrySync}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600/25 hover:bg-red-600/35 border border-red-500/30 rounded-lg text-white font-medium whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry Sync
          </button>
        </div>
      )}

      {/* Quick Actions Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#11131A] border border-white/[0.08] rounded-xl p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Operations Console</h2>
            {fromCache && (
              <span className="text-[11px] font-medium text-amber-300">
                · Cached snapshot (syncing live server)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            All revenue, billing, and CRM statistics are computed directly from Cloud Firestore records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('leads')}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <Target className="w-3.5 h-3.5 text-blue-400" />
            Add Lead
          </button>
          <button
            type="button"
            onClick={() => onNavigate('clients')}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
            Add Client
          </button>
          <button
            type="button"
            onClick={() => onNavigate('invoices')}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5 text-slate-300" />
            New Invoice
          </button>
          <button
            type="button"
            onClick={() => onNavigate('payments')}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Record Payment
          </button>
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onNavigate(card.target)}
              className="text-left bg-[#11131A] hover:bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between gap-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs font-medium text-slate-400">{card.label}</span>
                <Icon className={`w-4 h-4 shrink-0 ${card.accent}`} />
              </div>
              <div className="font-mono-tabular text-2xl font-semibold text-white tracking-tight">
                {card.value}
              </div>
              <p className="text-xs text-slate-400 truncate w-full">{card.meta}</p>
            </button>
          );
        })}
      </div>

      {/* Secondary Operational Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('websites')}
          className="text-left bg-[#11131A] hover:bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Active / Total Websites</span>
            <Globe className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <p className="mt-1.5 font-mono-tabular text-lg font-semibold text-white">
            {metrics.liveWebsites} / {metrics.totalWebsites}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('subscriptions')}
          className="text-left bg-[#11131A] hover:bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Overdue Subscriptions</span>
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          </div>
          <p className="mt-1.5 font-mono-tabular text-lg font-semibold text-white">
            {metrics.overdueSubscriptionsCount}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('subscriptions')}
          className="text-left bg-[#11131A] hover:bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Upcoming Renewals</span>
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="mt-1.5 font-mono-tabular text-lg font-semibold text-white">
            {metrics.upcomingRenewalsCount}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('leads')}
          className="text-left bg-[#11131A] hover:bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Follow-ups Due</span>
            <Target className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <p className="mt-1.5 font-mono-tabular text-lg font-semibold text-white">
            {metrics.dueFollowUpsCount}
          </p>
        </button>
      </div>

      {/* Revenue Chart + Upcoming Renewals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#11131A] border border-white/[0.08] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Collected Revenue (Last 6 Months)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Calculated from verified Paid entries in the payments ledger
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 whitespace-nowrap"
            >
              Full Reports
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueSeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="emgRevGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  stroke="#64748B"
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                />
                <YAxis
                  stroke="#64748B"
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickFormatter={(v: number) => `${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#09090B',
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [formatKES(Number(value), currency), 'Collected']}
                />
                <Area
                  type="monotone"
                  dataKey="collected"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  fill="url(#emgRevGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Upcoming Renewals & Overdue */}
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-semibold text-white">Upcoming Renewals</h3>
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              View All
            </button>
          </div>
          {renewalReminders.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center py-8">
              <p className="text-xs text-slate-400">
                No renewals due in the upcoming window or overdue subscriptions.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {renewalReminders.map((sub) => {
                const eff = getEffectiveSubscriptionStatus(sub, today);
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onNavigate('subscriptions', sub.id)}
                    className="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] rounded transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{sub.clientName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {sub.packageName} · Due {formatDisplayDate(sub.nextPaymentDate)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-tabular text-xs font-semibold text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </p>
                      <div className="mt-0.5 flex justify-end">
                        <StatusIndicator status={eff} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Unpaid Clients & Grace Deadlines + Lead Follow-up Reminders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">Unpaid Clients &amp; Grace Deadlines</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Subscriptions
            </button>
          </div>
          {graceDeadlines.length === 0 && unpaidInvoicesOverview.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              All subscriptions and invoices are currently settled.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {graceDeadlines.map((sub) => {
                const daysLeft = daysBetween(today, sub.gracePeriodEndDate);
                const elapsed = isPastGracePeriod(sub, today);
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onNavigate('subscriptions', sub.id)}
                    className="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{sub.clientName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {sub.packageName} · Grace ends {formatDisplayDate(sub.gracePeriodEndDate)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-tabular text-xs font-semibold text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </p>
                      <p
                        className={`text-[11px] font-medium mt-0.5 ${
                          elapsed ? 'text-red-400' : 'text-amber-400'
                        }`}
                      >
                        {elapsed
                          ? `Expired (${Math.abs(daysLeft)}d ago)`
                          : daysLeft === 0
                          ? 'Expires today'
                          : `${daysLeft}d left in grace`}
                      </p>
                    </div>
                  </button>
                );
              })}
              {unpaidInvoicesOverview.slice(0, 3).map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onNavigate('invoices', inv.id)}
                  className="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {inv.clientName}{' '}
                      <span className="font-mono-tabular text-xs text-slate-400">
                        ({inv.invoiceNumber})
                      </span>
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Invoice due {formatDisplayDate(inv.dueDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tabular text-xs font-semibold text-white">
                      {formatKES(inv.amount, currency)}
                    </p>
                    <div className="mt-0.5 flex justify-end">
                      <StatusIndicator status={inv.status} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Lead Follow-up Reminders</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('leads')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              CRM Pipeline
            </button>
          </div>
          {followUpReminders.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              No prospect follow-ups are due today or overdue.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {followUpReminders.map((lead) => {
                const overdueDays = daysBetween(lead.followUpDate || today, today);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => onNavigate('leads', lead.id)}
                    className="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{lead.businessName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {lead.contactPerson} · <span className="font-mono-tabular">{lead.phone}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusIndicator status={lead.status} />
                      <p className="text-[11px] text-amber-400 mt-0.5">
                        {overdueDays > 0 ? `${overdueDays}d overdue` : 'Due today'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Payments + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Recent Payments</h3>
            <button
              type="button"
              onClick={() => onNavigate('payments')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Ledger
            </button>
          </div>
          {recentPayments.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              No payments recorded yet. Use Record Payment to log an M-Pesa, Bank, or PayPal transaction.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {recentPayments.map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{p.clientName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {p.method} · <span className="font-mono">{p.transactionReference}</span> ·{' '}
                      {formatDisplayDate(p.paymentDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tabular text-sm font-semibold text-white">
                      {formatKES(p.amount, currency)}
                    </p>
                    <div className="mt-0.5 flex justify-end">
                      <StatusIndicator status={p.status} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Audit Log
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              Administrative activity logs appear automatically as records are created or updated.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {recentActivity.map((log) => {
                const ts = log.createdAt?.toDate ? log.createdAt.toDate() : null;
                return (
                  <div key={log.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white">{log.summary}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        <span className="font-mono text-blue-400">{log.actionType}</span> ·{' '}
                        {log.adminEmail || log.adminId}
                      </p>
                    </div>
                    <span className="font-mono-tabular text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                      {ts
                        ? ts.toLocaleDateString('en-KE', {
                            timeZone: 'Africa/Nairobi',
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Recent'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
