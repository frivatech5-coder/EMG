import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
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
import {
  exportToCsv,
  formatKES,
  getEffectiveSubscriptionStatus,
  todayIso,
} from '../lib/validation';

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
    const outstandingInvoices = invoices
      .filter((i) => i.status === 'Unpaid' || i.status === 'Overdue')
      .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);

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

  const packageBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; mrr: number }>();
    for (const s of subscriptions) {
      if (s.status === 'Cancelled') continue;
      const entry = map.get(s.packageName) || { count: 0, mrr: 0 };
      entry.count += 1;
      entry.mrr += Number(s.monthlyAmount) || 0;
      map.set(s.packageName, entry);
    }
    return Array.from(map.entries())
      .map(([pkg, data]) => ({ packageName: pkg, ...data }))
      .sort((a, b) => b.count - a.count);
  }, [subscriptions]);

  const handleExportPaymentsCsv = () => {
    exportToCsv(
      `emg-payments-${fromDate}-to-${toDate}.csv`,
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
      `emg-leads-${fromDate}-to-${toDate}.csv`,
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

  return (
    <div className="space-y-6">
      {/* Date Filter & CSV Exports */}
      <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="report-from" className="text-xs text-slate-400">
              From
            </label>
            <input
              id="report-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-1.5 min-h-[38px] text-sm bg-[#09090B] border border-white/10 rounded-lg text-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="report-to" className="text-xs text-slate-400">
              To
            </label>
            <input
              id="report-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-1.5 min-h-[38px] text-sm bg-[#09090B] border border-white/10 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={handleExportPaymentsCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white rounded-lg disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            Export Payments CSV
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleExportClientsCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white rounded-lg disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            Export Clients CSV
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleExportLeadsCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-white rounded-lg disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Export Leads CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
          <SummaryStripSkeleton cards={3} />
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-pulse">
            <div className="xl:col-span-2 bg-[#11131A] border border-white/[0.08] rounded-xl p-5 h-72" />
            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 h-72" />
          </div>
        </div>
      ) : syncError && payments.length === 0 && clients.length === 0 ? (
        <ErrorState message={syncError} onRetry={retrySync} />
      ) : (
        <>
          {/* Key Financial & Growth Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
              <p className="text-xs text-slate-400">Total Collected (Selected Period)</p>
              <p className="mt-1.5 font-mono-tabular text-2xl font-semibold text-white">
                {formatKES(reportMetrics.totalPayments, currency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">{filteredPayments.length} verified payments</p>
            </div>
            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
              <p className="text-xs text-slate-400">Outstanding Unpaid Invoices</p>
              <p className="mt-1.5 font-mono-tabular text-2xl font-semibold text-amber-400">
                {formatKES(reportMetrics.outstandingInvoices, currency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Across all open unpaid/overdue invoices</p>
            </div>
            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
              <p className="text-xs text-slate-400">Active / Cancelled Subscriptions</p>
              <p className="mt-1.5 font-mono-tabular text-2xl font-semibold text-white">
                {reportMetrics.activeSubs} / {reportMetrics.cancelledSubs}
              </p>
              <p className="text-xs text-slate-400 mt-1">Current portfolio status</p>
            </div>
            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
              <p className="text-xs text-slate-400">New Clients (Selected Period)</p>
              <p className="mt-1.5 font-mono-tabular text-2xl font-semibold text-white">
                {reportMetrics.newClients}
              </p>
            </div>
            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5">
              <p className="text-xs text-slate-400">Lead Conversion Rate (Period)</p>
              <p className="mt-1.5 font-mono-tabular text-2xl font-semibold text-emerald-400">
                {reportMetrics.conversionRate}%
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {reportMetrics.convertedLeads} converted out of {reportMetrics.totalLeads} leads
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-[#11131A] border border-white/[0.08] rounded-xl p-5 space-y-4 min-w-0">
              <h3 className="text-sm font-semibold text-white">Monthly Collected Revenue</h3>
              {monthlyRevenueData.length === 0 ? (
                <p className="text-xs text-slate-400 py-12 text-center">
                  No Paid payment records found within this date range.
                </p>
              ) : (
                <div className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyRevenueData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="month" stroke="#64748B" tick={{ fill: '#94A3B8', fontSize: 12 }} />
                      <YAxis stroke="#64748B" tick={{ fill: '#94A3B8', fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#09090B',
                          borderColor: 'rgba(255,255,255,0.12)',
                          borderRadius: '8px',
                          color: '#F8FAFC',
                          fontSize: '12px',
                        }}
                        formatter={(val) => [formatKES(Number(val), currency), 'Revenue']}
                      />
                      <Bar dataKey="amount" fill="#3B82F6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="bg-[#11131A] border border-white/[0.08] rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Most Popular Packages</h3>
              {packageBreakdown.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  Create subscriptions to see package distribution.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {packageBreakdown.map((item) => (
                    <div key={item.packageName} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item.packageName}</p>
                        <p className="text-xs text-slate-400">{item.count} subscriptions</p>
                      </div>
                      <p className="font-mono-tabular text-sm font-semibold text-blue-400">
                        {formatKES(item.mrr, currency)}/mo
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
