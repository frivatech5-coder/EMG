import { useMemo, useState } from 'react';
import { Download, Calendar, TrendingUp, CreditCard, Layers } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useData } from '../context/DataContext';
import { ErrorState, SummaryStripSkeleton } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import {
  exportToCsv,
  formatKES,
  getEffectiveSubscriptionStatus,
  todayIso,
} from '../lib/validation';

type DatePreset = 'this_month' | 'last_3_months' | 'ytd' | 'all';

function shiftMonthsIso(anchorIso: string, deltaMonths: number): string {
  const [y, m] = anchorIso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function ReportsPage() {
  const {
    clients,
    subscriptions,
    payments,
    invoices,
    leads,
    settings,
    loading,
    syncError,
    retrySync,
  } = useData();
  const today = todayIso();
  const currency = settings.currency || 'KES';

  const defaultFrom = `${today.slice(0, 4)}-01-01`;
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);
  const [activePreset, setActivePreset] = useState<DatePreset>('ytd');

  const applyPreset = (preset: DatePreset) => {
    setActivePreset(preset);
    if (preset === 'this_month') {
      setFromDate(`${today.slice(0, 7)}-01`);
      setToDate(today);
    } else if (preset === 'last_3_months') {
      setFromDate(shiftMonthsIso(today, -2));
      setToDate(today);
    } else if (preset === 'ytd') {
      setFromDate(`${today.slice(0, 4)}-01-01`);
      setToDate(today);
    } else {
      setFromDate('');
      setToDate('');
    }
  };

  const filteredPayments = useMemo(
    () =>
      payments.filter(
        (p) =>
          p.status === 'Paid' &&
          (!fromDate || p.paymentDate >= fromDate) &&
          (!toDate || p.paymentDate <= toDate)
      ),
    [payments, fromDate, toDate]
  );

  const filteredClients = useMemo(
    () =>
      clients.filter(
        (c) =>
          (!fromDate || c.registeredAt >= fromDate) &&
          (!toDate || c.registeredAt <= toDate)
      ),
    [clients, fromDate, toDate]
  );

  const filteredLeads = useMemo(
    () =>
      leads.filter(
        (l) =>
          (!fromDate || l.dateContacted >= fromDate) &&
          (!toDate || l.dateContacted <= toDate)
      ),
    [leads, fromDate, toDate]
  );

  const reportMetrics = useMemo(() => {
    const totalPayments = filteredPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const openInvoices = invoices.filter((i) => i.status === 'Unpaid' || i.status === 'Overdue');
    const outstandingInvoices = openInvoices.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);

    const activeSubs = subscriptions.filter(
      (s) => getEffectiveSubscriptionStatus(s, today) === 'Active'
    ).length;
    const cancelledSubs = subscriptions.filter((s) => s.status === 'Cancelled').length;
    const convertedLeads = filteredLeads.filter((l) => l.status === 'Converted').length;
    const conversionRate =
      filteredLeads.length > 0
        ? Math.round((convertedLeads / filteredLeads.length) * 100)
        : 0;

    return {
      totalPayments,
      outstandingInvoices,
      openInvoicesCount: openInvoices.length,
      activeSubs,
      cancelledSubs,
      newClients: filteredClients.length,
      conversionRate,
      convertedLeads,
      totalLeads: filteredLeads.length,
    };
  }, [filteredPayments, filteredClients, filteredLeads, invoices, subscriptions, today]);

  const monthlyRevenueData = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filteredPayments) {
      const month = (p.paymentDate || '').slice(0, 7);
      if (!month) continue;
      map.set(month, (map.get(month) || 0) + (Number(p.amount) || 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }));
  }, [filteredPayments]);

  const methodBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const p of filteredPayments) {
      const key = p.method || 'Other';
      const current = map.get(key) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(p.amount) || 0;
      map.set(key, current);
    }
    const grandTotal = Array.from(map.values()).reduce((sum, item) => sum + item.total, 0);
    return Array.from(map.entries())
      .map(([method, data]) => ({
        method,
        count: data.count,
        total: data.total,
        percent: grandTotal > 0 ? Math.round((data.total / grandTotal) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredPayments]);

  const packageBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; mrr: number }>();
    for (const s of subscriptions) {
      if (s.status === 'Cancelled') continue;
      const entry = map.get(s.packageName) || { count: 0, mrr: 0 };
      entry.count += 1;
      entry.mrr += Number(s.monthlyAmount) || 0;
      map.set(s.packageName, entry);
    }
    const totalMrr = Array.from(map.values()).reduce((sum, item) => sum + item.mrr, 0);
    return Array.from(map.entries())
      .map(([pkg, data]) => ({
        packageName: pkg,
        ...data,
        share: totalMrr > 0 ? Math.round((data.mrr / totalMrr) * 100) : 0,
      }))
      .sort((a, b) => b.mrr - a.mrr);
  }, [subscriptions]);

  const handleExportPaymentsCsv = () => {
    exportToCsv(
      `emg-payments-${fromDate || 'all'}-to-${toDate || today}.csv`,
      ['Payment Code', 'Date', 'Client', 'Method', 'Transaction Ref', 'Amount', 'Status'],
      filteredPayments.map((p) => [
        p.paymentCode,
        p.paymentDate,
        p.clientName,
        p.method,
        p.transactionReference,
        p.amount,
        p.status,
      ])
    );
  };

  const handleExportClientsCsv = () => {
    exportToCsv(
      `emg-clients-${today}.csv`,
      ['Client Code', 'Business Name', 'Contact', 'Phone', 'Category', 'Location', 'Monthly Amount', 'Status', 'Registered'],
      clients.map((c) => [
        c.clientCode,
        c.businessName,
        c.contactName,
        c.phone,
        c.category,
        c.location,
        c.monthlyAmount,
        c.status,
        c.registeredAt,
      ])
    );
  };

  const handleExportLeadsCsv = () => {
    exportToCsv(
      `emg-leads-${fromDate || 'all'}-to-${toDate || today}.csv`,
      ['Lead Code', 'Business', 'Contact', 'Phone', 'Channel', 'City', 'Interest', 'Budget', 'Status', 'Date Contacted'],
      filteredLeads.map((l) => [
        l.leadCode,
        l.businessName,
        l.contactPerson,
        l.phone,
        l.contactChannel,
        l.location,
        l.interestLevel,
        l.estimatedBudget,
        l.status,
        l.dateContacted,
      ])
    );
  };

  const presetItems: Array<{ id: DatePreset; label: string }> = [
    { id: 'this_month', label: 'This Month' },
    { id: 'last_3_months', label: 'Last 3 Months' },
    { id: 'ytd', label: 'Year to Date' },
    { id: 'all', label: 'All Time' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial & Growth Reports"
        description="Live revenue collections, payment channels, package MRR share, and lead conversion analytics from Firestore."
        meta={
          <span className="font-mono-tabular text-[11px] px-2 py-0.5 rounded bg-white/[0.05] text-zinc-400">
            {currency}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={handleExportPaymentsCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              Payments CSV
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleExportClientsCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              Clients CSV
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleExportLeadsCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-[#111216] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              Leads CSV
            </button>
          </div>
        }
      />

      {/* Period Selector Bar */}
      <div className="bg-[#111216] border border-white/[0.08] rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#09090B] border border-white/[0.06] overflow-x-auto max-w-full">
          {presetItems.map((preset) => {
            const active = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={`px-3 py-1.5 min-h-[32px] rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white/[0.1] text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-zinc-500 hidden sm:block" />
            <label htmlFor="report-from" className="text-xs text-zinc-400">
              From
            </label>
            <input
              id="report-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setActivePreset('all');
              }}
              className="px-3 py-1.5 min-h-[36px] text-xs font-mono-tabular bg-[#09090B] border border-white/[0.08] rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="report-to" className="text-xs text-zinc-400">
              To
            </label>
            <input
              id="report-to"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setActivePreset('all');
              }}
              className="px-3 py-1.5 min-h-[36px] text-xs font-mono-tabular bg-[#09090B] border border-white/[0.08] rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
          <SummaryStripSkeleton cards={5} />
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 animate-pulse">
            <div className="xl:col-span-7 bg-[#111216] border border-white/[0.08] rounded-xl p-5 h-72" />
            <div className="xl:col-span-5 bg-[#111216] border border-white/[0.08] rounded-xl p-5 h-72" />
          </div>
        </div>
      ) : syncError && payments.length === 0 && clients.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : (
        <>
          {/* Unified Hairline-Divided Financial & Growth Strip */}
          <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07]">
            <div className="p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-wider font-medium text-zinc-500">
                Total Collected
              </p>
              <p className="mt-2 font-mono-tabular text-xl sm:text-2xl font-semibold text-white">
                {formatKES(reportMetrics.totalPayments, currency)}
              </p>
              <p className="mt-1 text-xs text-zinc-400 font-mono-tabular">
                {filteredPayments.length} verified receipts
              </p>
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-wider font-medium text-zinc-500">
                Outstanding Invoices
              </p>
              <p
                className={`mt-2 font-mono-tabular text-xl sm:text-2xl font-semibold ${
                  reportMetrics.outstandingInvoices > 0 ? 'text-amber-400' : 'text-white'
                }`}
              >
                {formatKES(reportMetrics.outstandingInvoices, currency)}
              </p>
              <p className="mt-1 text-xs text-zinc-400 font-mono-tabular">
                {reportMetrics.openInvoicesCount} unpaid or overdue
              </p>
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-wider font-medium text-zinc-500">
                Subscriptions
              </p>
              <p className="mt-2 font-mono-tabular text-xl sm:text-2xl font-semibold text-white">
                {reportMetrics.activeSubs}
                <span className="text-sm font-normal text-zinc-500">
                  {' '}
                  / {reportMetrics.cancelledSubs} cancelled
                </span>
              </p>
              <p className="mt-1 text-xs text-zinc-400">Active portfolio</p>
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-wider font-medium text-zinc-500">
                New Clients
              </p>
              <p className="mt-2 font-mono-tabular text-xl sm:text-2xl font-semibold text-white">
                {reportMetrics.newClients}
              </p>
              <p className="mt-1 text-xs text-zinc-400">Onboarded in period</p>
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[11px] uppercase tracking-wider font-medium text-zinc-500">
                Lead Conversion
              </p>
              <p className="mt-2 font-mono-tabular text-xl sm:text-2xl font-semibold text-emerald-400">
                {reportMetrics.conversionRate}%
              </p>
              <p className="mt-1 text-xs text-zinc-400 font-mono-tabular">
                {reportMetrics.convertedLeads} of {reportMetrics.totalLeads} prospects
              </p>
            </div>
          </div>

          {/* Revenue Chart + Payment Channels */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            <div className="xl:col-span-7 bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col min-w-0">
              <div className="px-5 py-3.5 border-b border-white/[0.06] bg-[#0D0E12] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-white">Monthly Collected Revenue</h3>
                </div>
                <span className="font-mono-tabular text-[11px] text-zinc-500">
                  {monthlyRevenueData.length} months
                </span>
              </div>

              <div className="p-5 flex-1">
                {monthlyRevenueData.length === 0 ? (
                  <div className="py-16 text-center text-xs text-zinc-400">
                    No Paid payment records found within this date range.
                  </div>
                ) : (
                  <div className="h-64 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyRevenueData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis
                          dataKey="month"
                          stroke="#52525B"
                          tick={{ fill: '#A1A1AA', fontSize: 12 }}
                          tickLine={false}
                        />
                        <YAxis
                          stroke="#52525B"
                          tick={{ fill: '#A1A1AA', fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                          contentStyle={{
                            backgroundColor: '#09090B',
                            borderColor: 'rgba(255,255,255,0.12)',
                            borderRadius: '8px',
                            color: '#F4F4F5',
                            fontSize: '12px',
                          }}
                          formatter={(val) => [formatKES(Number(val), currency), 'Collected']}
                        />
                        <Bar dataKey="amount" fill="#3B82F6" radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            <div className="xl:col-span-5 bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 border-b border-white/[0.06] bg-[#0D0E12] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-white">Payment Channels Breakdown</h3>
                </div>
                <span className="font-mono-tabular text-[11px] text-zinc-500">
                  {filteredPayments.length} receipts
                </span>
              </div>

              <div className="p-5 flex-1">
                {methodBreakdown.length === 0 ? (
                  <div className="py-16 text-center text-xs text-zinc-400">
                    No verified payments recorded in the selected date window.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {methodBreakdown.map((item) => (
                      <div key={item.method} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-white truncate">{item.method}</span>
                            <span className="font-mono-tabular text-[11px] text-zinc-500">
                              {item.count} tx
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 font-mono-tabular">
                            <span className="text-zinc-400">{item.percent}%</span>
                            <span className="font-semibold text-white">
                              {formatKES(item.total, currency)}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${Math.max(item.percent, 3)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subscription Package Revenue Distribution */}
          <div className="bg-[#111216] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.06] bg-[#0D0E12] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-medium text-white">Package MRR Distribution</h3>
              </div>
              <span className="text-[11px] text-zinc-500">Active &amp; non-cancelled plans</span>
            </div>

            {packageBreakdown.length === 0 ? (
              <p className="text-xs text-zinc-400 py-10 text-center">
                Create subscriptions to see package distribution.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {packageBreakdown.map((item) => (
                  <div
                    key={item.packageName}
                    className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="min-w-0 sm:w-1/3">
                      <p className="text-sm font-medium text-white truncate">{item.packageName}</p>
                      <p className="text-xs text-zinc-400 font-mono-tabular">
                        {item.count} {item.count === 1 ? 'subscription' : 'subscriptions'}
                      </p>
                    </div>
                    <div className="flex-1 max-w-md flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.max(item.share, 3)}%` }}
                        />
                      </div>
                      <span className="font-mono-tabular text-xs text-zinc-400 w-9 text-right">
                        {item.share}%
                      </span>
                    </div>
                    <p className="font-mono-tabular text-sm font-semibold text-white sm:text-right shrink-0">
                      {formatKES(item.mrr, currency)}
                      <span className="text-xs font-normal text-zinc-500">/mo</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
