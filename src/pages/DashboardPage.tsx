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
  ArrowUpRight,
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
import { PageHeader } from '../components/ui/PageHeader';
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
  const recentActivity = useMemo(() => activityLogs.slice(0, 6), [activityLogs]);

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
      .slice(0, 4);
  }, [subscriptions, today]);

  const unpaidInvoicesOverview = useMemo(() => {
    return invoices
      .filter((i) => i.status === 'Unpaid' || i.status === 'Overdue')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 4);
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
      .slice(0, 4);
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

  const sixMonthTotal = revenueSeries.reduce((acc, m) => acc + m.collected, 0);

  const primaryKpis = [
    {
      label: 'Monthly Recurring Revenue',
      value: formatKES(metrics.mrr, currency),
      meta: `${metrics.activeSubscriptions} active subscriptions`,
      icon: RefreshCw,
      accent: 'text-blue-400',
      target: 'subscriptions' as NavSection,
    },
    {
      label: 'Collected This Month',
      value: formatKES(metrics.paymentsThisMonth, currency),
      meta: `${verifiedThisMonthCount} verified payment${verifiedThisMonthCount === 1 ? '' : 's'}`,
      icon: CreditCard,
      accent: 'text-emerald-400',
      target: 'payments' as NavSection,
    },
    {
      label: 'Outstanding Balance',
      value: formatKES(metrics.outstandingPayments, currency),
      meta: `${metrics.overdueSubscriptionsCount} overdue · ${metrics.unpaidInvoicesCount} unpaid invoices`,
      icon: AlertTriangle,
      accent: metrics.outstandingPayments > 0 ? 'text-amber-400' : 'text-zinc-500',
      target: 'invoices' as NavSection,
    },
    {
      label: 'Active Clients',
      value: `${metrics.activeClients} / ${metrics.totalClients}`,
      meta: `${metrics.liveWebsites} live sites · ${metrics.upcomingRenewalsCount} renewals soon`,
      icon: Users,
      accent: 'text-zinc-300',
      target: 'clients' as NavSection,
    },
  ];

  const priorityCount =
    graceDeadlines.length + unpaidInvoicesOverview.length + followUpReminders.length;

  return (
    <div className="space-y-6 animate-fade-in">
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

      {/* Workspace Header & Quick Launch Actions */}
      <PageHeader
        title="Operations Overview"
        description="Live billing, client deployments, and pipeline telemetry synced from Cloud Firestore."
        meta={
          fromCache ? (
            <span className="text-[11px] font-medium text-amber-400">· Syncing cache</span>
          ) : undefined
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => onNavigate('leads')}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] border border-white/[0.09] text-zinc-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Target className="w-3.5 h-3.5 text-zinc-400" />
              Add Lead
            </button>
            <button
              type="button"
              onClick={() => onNavigate('clients')}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] border border-white/[0.09] text-zinc-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5 text-zinc-400" />
              Add Client
            </button>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] border border-white/[0.09] text-zinc-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              New Invoice
            </button>
            <button
              type="button"
              onClick={() => onNavigate('payments')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Record Payment
            </button>
          </>
        }
      />

      {/* Unified Stripe-style Metric Strip (Single elevated surface with hairline dividers) */}
      <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
          {primaryKpis.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate(item.target)}
                className="group text-left p-5 hover:bg-white/[0.025] transition-colors flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">
                    {item.label}
                  </span>
                  <Icon className={`w-4 h-4 shrink-0 ${item.accent}`} />
                </div>
                <div className="font-mono-tabular text-2xl sm:text-[26px] font-semibold text-white tracking-tight">
                  {item.value}
                </div>
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs text-zinc-500 truncate">{item.meta}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-blue-400 shrink-0 transition-colors" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Integrated Compact Health Footer Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-white/[0.07] bg-[#0D0E12] divide-x divide-white/[0.06] text-xs">
          <button
            type="button"
            onClick={() => onNavigate('websites')}
            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors text-left"
          >
            <span className="text-zinc-400 flex items-center gap-1.5 truncate">
              <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              Live Websites
            </span>
            <span className="font-mono-tabular font-semibold text-white">
              {metrics.liveWebsites}/{metrics.totalWebsites}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('subscriptions')}
            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors text-left"
          >
            <span className="text-zinc-400 truncate">Overdue Subs</span>
            <span
              className={`font-mono-tabular font-semibold ${
                metrics.overdueSubscriptionsCount > 0 ? 'text-red-400' : 'text-zinc-300'
              }`}
            >
              {metrics.overdueSubscriptionsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('subscriptions')}
            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors text-left border-t sm:border-t-0 border-white/[0.06]"
          >
            <span className="text-zinc-400 truncate">Renewals (14d)</span>
            <span
              className={`font-mono-tabular font-semibold ${
                metrics.upcomingRenewalsCount > 0 ? 'text-amber-400' : 'text-zinc-300'
              }`}
            >
              {metrics.upcomingRenewalsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('leads')}
            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors text-left border-t sm:border-t-0 border-white/[0.06]"
          >
            <span className="text-zinc-400 truncate">Due Follow-ups</span>
            <span
              className={`font-mono-tabular font-semibold ${
                metrics.dueFollowUpsCount > 0 ? 'text-blue-400' : 'text-zinc-300'
              }`}
            >
              {metrics.dueFollowUpsCount}
            </span>
          </button>
        </div>
      </div>

      {/* Main Asymmetric Split: 2/3 Revenue Chart + 1/3 Priority Action Queue */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#111216] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between gap-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Cash Flow Trend
              </p>
              <div className="flex items-baseline gap-3 mt-1">
                <h3 className="font-display text-lg font-semibold text-white">
                  {formatKES(sixMonthTotal, currency)}
                </h3>
                <span className="text-xs text-zinc-400">collected over last 6 months</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap self-start sm:self-center"
            >
              Detailed Analytics
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueSeries} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="emgRevGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#52525B"
                  tick={{ fill: '#A1A1AA', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickLine={false}
                />
                <YAxis
                  stroke="#52525B"
                  tick={{ fill: '#A1A1AA', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#09090B',
                    borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    color: '#FAFAFA',
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
                  activeDot={{ r: 4, fill: '#3B82F6', stroke: '#FAFAFA', strokeWidth: 1.5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Priority Action Queue (Deadlines + Invoices + Follow-ups) */}
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.07] bg-[#0D0E12] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="font-display text-sm font-semibold text-white">Priority Queue</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reminders')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Inbox ({metrics.unreadNotificationsCount})
            </button>
          </div>

          {priorityCount === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10">
              <p className="text-sm font-medium text-zinc-200">All urgent tasks cleared</p>
              <p className="text-xs text-zinc-500 mt-1">
                No expiring grace periods, overdue invoices, or overdue follow-ups.
              </p>
            </div>
          ) : (
            <div className="flex-1 divide-y divide-white/[0.06] overflow-y-auto max-h-[310px]">
              {graceDeadlines.map((sub) => {
                const daysLeft = daysBetween(today, sub.gracePeriodEndDate);
                const elapsed = isPastGracePeriod(sub, today);
                return (
                  <button
                    key={`grace-${sub.id}`}
                    type="button"
                    onClick={() => onNavigate('subscriptions', sub.id)}
                    className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{sub.clientName}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                        Grace deadline · {sub.packageName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-tabular text-xs font-semibold text-white">
                        {formatKES(sub.monthlyAmount, currency)}
                      </p>
                      <p
                        className={`text-[11px] font-medium ${
                          elapsed ? 'text-red-400' : 'text-amber-400'
                        }`}
                      >
                        {elapsed
                          ? `${Math.abs(daysLeft)}d past grace`
                          : daysLeft === 0
                          ? 'Expires today'
                          : `${daysLeft}d left`}
                      </p>
                    </div>
                  </button>
                );
              })}

              {unpaidInvoicesOverview.map((inv) => (
                <button
                  key={`inv-${inv.id}`}
                  type="button"
                  onClick={() => onNavigate('invoices', inv.id)}
                  className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">
                      {inv.clientName}{' '}
                      <span className="font-mono text-zinc-500">({inv.invoiceNumber})</span>
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Invoice due {formatDisplayDate(inv.dueDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tabular text-xs font-semibold text-white">
                      {formatKES(inv.amount, currency)}
                    </p>
                    <StatusIndicator status={inv.status} />
                  </div>
                </button>
              ))}

              {followUpReminders.map((lead) => {
                const overdueDays = daysBetween(lead.followUpDate || today, today);
                return (
                  <button
                    key={`lead-${lead.id}`}
                    type="button"
                    onClick={() => onNavigate('leads', lead.id)}
                    className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        {lead.businessName}
                      </p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                        Lead follow-up · {lead.contactPerson}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] font-medium text-blue-400">{lead.status}</p>
                      <p className="text-[11px] text-amber-400">
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

      {/* Bottom Operational Bento: Upcoming Renewals | Recent Payments | Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Renewals */}
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.07] bg-[#0D0E12] flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-white">Upcoming Renewals</h3>
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              View all
            </button>
          </div>
          {renewalReminders.length === 0 ? (
            <p className="text-xs text-zinc-500 py-10 px-5 text-center">
              No renewals scheduled in the upcoming window.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {renewalReminders.map((sub) => {
                const eff = getEffectiveSubscriptionStatus(sub, today);
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onNavigate('subscriptions', sub.id)}
                    className="w-full text-left px-5 py-3.5 hover:bg-white/[0.025] transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{sub.clientName}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {sub.packageName} · {formatDisplayDate(sub.nextPaymentDate)}
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

        {/* Recent Payments */}
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.07] bg-[#0D0E12] flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-white">Recent Payments</h3>
            <button
              type="button"
              onClick={() => onNavigate('payments')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Ledger
            </button>
          </div>
          {recentPayments.length === 0 ? (
            <p className="text-xs text-zinc-500 py-10 px-5 text-center">
              No payments logged yet. Click Record Payment to log an M-Pesa, bank, or PayPal entry.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {recentPayments.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onNavigate('payments', p.id)}
                  className="w-full text-left px-5 py-3.5 hover:bg-white/[0.025] transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{p.clientName}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                      {p.method} · <span className="font-mono">{p.transactionReference}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tabular text-xs font-semibold text-white">
                      {formatKES(p.amount, currency)}
                    </p>
                    <div className="mt-0.5 flex justify-end">
                      <StatusIndicator status={p.status} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recent Audit Activity */}
        <div className="bg-[#111216] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.07] bg-[#0D0E12] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-zinc-400" />
              <h3 className="font-display text-sm font-semibold text-white">Audit Stream</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Full log
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-xs text-zinc-500 py-10 px-5 text-center">
              Administrative activity appears here automatically as records change.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {recentActivity.map((log) => {
                const ts = log.createdAt?.toDate ? log.createdAt.toDate() : null;
                return (
                  <div key={log.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-200 leading-snug line-clamp-2">
                        {log.summary}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-1 truncate">
                        <span className="font-mono text-blue-400">{log.actionType}</span> ·{' '}
                        {log.adminEmail || log.adminId}
                      </p>
                    </div>
                    <span className="font-mono-tabular text-[10px] text-zinc-500 whitespace-nowrap shrink-0 mt-0.5">
                      {ts
                        ? ts.toLocaleDateString('en-KE', {
                            timeZone: 'Africa/Nairobi',
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Now'}
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
