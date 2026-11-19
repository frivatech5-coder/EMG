import assert from 'node:assert/strict';
import {
  addDaysIso,
  addMonthsIso,
  daysBetween,
  getNairobiDateIso,
  isValidIsoDate,
} from '../src/lib/validation';
import { evaluateNotificationCandidates } from '../src/services/notificationsEngine';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type BusinessSettings,
  type Invoice,
  type Lead,
  type Subscription,
  type Website,
} from '../src/types/domain';

function runTests() {
  // 1. Africa/Nairobi Timezone Date Tests
  // 2026-05-10T22:30:00Z is 2026-05-11 01:30 EAT (Africa/Nairobi is UTC+3)
  const lateUtc = new Date('2026-05-10T22:30:00.000Z');
  assert.equal(getNairobiDateIso(lateUtc), '2026-05-11', 'Africa/Nairobi should roll to next day after 21:00 UTC');

  assert.equal(addDaysIso('2026-05-11', 7), '2026-05-18');
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(daysBetween('2026-05-11', '2026-05-18'), 7);
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('invalid-date'), false);

  const today = '2026-06-15';
  const baseSettings: BusinessSettings = {
    id: 'default',
    businessName: 'EMG WEB SOLUTIONS',
    currency: 'KES',
    defaultGracePeriodDays: 7,
    invoicePrefix: 'EMG-INV',
    nextInvoiceSequence: 1001,
    packages: [{ id: 'basic', name: 'BASIC', monthlyPrice: 500, description: '' }],
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      graceReminderDays: [7, 3, 1],
      renewalReminderDays: 14,
      websiteRenewalReminderDays: 14,
      demoFeedbackReminderDays: 2,
    },
    updatedBy: 'admin_1',
  };

  // 2. Subscriptions: due today, upcoming, overdue + 7/3/1 grace, and grace expired
  const subscriptions: Subscription[] = [
    {
      id: 'sub_due',
      subscriptionCode: 'SUB-1',
      clientId: 'cl_1',
      clientName: 'Savanna Hardware',
      packageName: 'BASIC',
      monthlyAmount: 500,
      startDate: '2026-05-15',
      nextPaymentDate: '2026-06-15',
      status: 'Active',
      gracePeriodDays: 7,
      gracePeriodEndDate: '2026-06-22',
      createdBy: 'admin_1',
    },
    {
      id: 'sub_upcoming',
      subscriptionCode: 'SUB-2',
      clientId: 'cl_2',
      clientName: 'Kilimani Dental',
      packageName: 'BUSINESS',
      monthlyAmount: 1000,
      startDate: '2026-05-20',
      nextPaymentDate: '2026-06-20',
      status: 'Active',
      gracePeriodDays: 7,
      gracePeriodEndDate: '2026-06-27',
      createdBy: 'admin_1',
    },
    {
      id: 'sub_grace_3',
      subscriptionCode: 'SUB-3',
      clientId: 'cl_3',
      clientName: 'Mombasa Bistro',
      packageName: 'PREMIUM',
      monthlyAmount: 1500,
      startDate: '2026-05-11',
      nextPaymentDate: '2026-06-11',
      status: 'Active',
      gracePeriodDays: 7,
      gracePeriodEndDate: '2026-06-18', // 3 days left from 2026-06-15
      createdBy: 'admin_1',
    },
    {
      id: 'sub_grace_1',
      subscriptionCode: 'SUB-4',
      clientId: 'cl_4',
      clientName: 'Eldoret Agro',
      packageName: 'BASIC',
      monthlyAmount: 500,
      startDate: '2026-05-09',
      nextPaymentDate: '2026-06-09',
      status: 'Overdue',
      gracePeriodDays: 7,
      gracePeriodEndDate: '2026-06-16', // 1 day left
      createdBy: 'admin_1',
    },
    {
      id: 'sub_grace_expired',
      subscriptionCode: 'SUB-5',
      clientId: 'cl_5',
      clientName: 'Kisumu Pharmacy',
      packageName: 'BUSINESS',
      monthlyAmount: 1000,
      startDate: '2026-05-01',
      nextPaymentDate: '2026-06-01',
      status: 'Overdue',
      gracePeriodDays: 7,
      gracePeriodEndDate: '2026-06-08', // expired
      createdBy: 'admin_1',
    },
    {
      id: 'sub_bad_date',
      subscriptionCode: 'SUB-6',
      clientId: 'cl_6',
      clientName: 'Malformed Dates Co',
      packageName: 'BASIC',
      monthlyAmount: 500,
      startDate: '',
      nextPaymentDate: 'not-a-date',
      status: 'Active',
      gracePeriodDays: 7,
      gracePeriodEndDate: '',
      createdBy: 'admin_1',
    },
  ];

  const invoices: Invoice[] = [
    {
      id: 'inv_due',
      invoiceNumber: 'EMG-INV-1001',
      clientId: 'cl_1',
      clientName: 'Savanna Hardware',
      description: 'Monthly Hosting',
      amount: 500,
      issueDate: '2026-06-08',
      dueDate: '2026-06-15',
      status: 'Unpaid',
      createdBy: 'admin_1',
    },
    {
      id: 'inv_overdue',
      invoiceNumber: 'EMG-INV-1002',
      clientId: 'cl_3',
      clientName: 'Mombasa Bistro',
      description: 'Monthly Hosting',
      amount: 1500,
      issueDate: '2026-06-01',
      dueDate: '2026-06-10',
      status: 'Unpaid',
      createdBy: 'admin_1',
    },
  ];

  const leads: Lead[] = [
    {
      id: 'lead_due',
      leadCode: 'LD-1',
      businessName: 'Nyeri Logistics',
      category: 'Transport',
      contactPerson: 'Peter Mwangi',
      phone: '+254712345678',
      location: 'Nyeri',
      contactChannel: 'WhatsApp',
      dateContacted: '2026-06-10',
      interestLevel: 'High',
      estimatedBudget: 1500,
      followUpDate: '2026-06-15',
      status: 'Demo Presented',
      createdBy: 'admin_1',
    },
    {
      id: 'lead_overdue',
      leadCode: 'LD-2',
      businessName: 'Nakuru Clinic',
      category: 'Healthcare',
      contactPerson: 'Grace Wanjiku',
      phone: '+254722111222',
      location: 'Nakuru',
      contactChannel: 'Phone Call',
      dateContacted: '2026-06-05',
      interestLevel: 'Medium',
      estimatedBudget: 1000,
      followUpDate: '2026-06-12',
      status: 'Interested',
      createdBy: 'admin_1',
    },
    {
      id: 'lead_converted',
      leadCode: 'LD-3',
      businessName: 'Already Client',
      category: 'Retail',
      contactPerson: 'Jane',
      phone: '+254700000000',
      location: 'Nairobi',
      contactChannel: 'Referral',
      dateContacted: '2026-06-01',
      interestLevel: 'High',
      estimatedBudget: 1000,
      followUpDate: '2026-06-05',
      status: 'Converted',
      createdBy: 'admin_1',
    },
  ];

  const websites: Website[] = [
    {
      id: 'web_fail',
      websiteCode: 'WEB-1',
      clientId: 'cl_1',
      businessName: 'Savanna Hardware',
      websiteName: 'Savanna Storefront',
      hostingProvider: 'Vercel',
      deploymentStatus: 'Live',
      renewalDate: '2026-06-20',
      deploymentIntegrationStatus: 'failed',
      deploymentErrorMessage: 'Build command exited with code 1',
      createdBy: 'admin_1',
    },
    {
      id: 'web_susp',
      websiteCode: 'WEB-2',
      clientId: 'cl_5',
      businessName: 'Kisumu Pharmacy',
      websiteName: 'Kisumu Portal',
      hostingProvider: 'Truehost',
      deploymentStatus: 'Suspended',
      createdBy: 'admin_1',
    },
  ];

  const candidates = evaluateNotificationCandidates({
    subscriptions,
    invoices,
    leads,
    websites,
    settings: baseSettings,
    todayNairobi: today,
  });

  const keys = candidates.map((c) => c.dedupeKey);
  assert.equal(new Set(keys).size, keys.length, 'Every candidate dedupeKey must be unique');

  // Verify specific required notifications exist with expected priorities
  assert.ok(candidates.some((c) => c.eventType === 'SUBSCRIPTION_DUE_TODAY' && c.recordId === 'sub_due' && c.priority === 'Warning'));
  assert.ok(candidates.some((c) => c.eventType === 'SUBSCRIPTION_UPCOMING_RENEWAL' && c.recordId === 'sub_upcoming'));
  assert.ok(candidates.some((c) => c.eventType === 'SUBSCRIPTION_GRACE_WARNING' && c.recordId === 'sub_grace_3' && c.dedupeKey.includes('3d')));
  assert.ok(candidates.some((c) => c.eventType === 'SUBSCRIPTION_GRACE_WARNING' && c.recordId === 'sub_grace_1' && c.priority === 'Critical'));
  assert.ok(candidates.some((c) => c.eventType === 'SUBSCRIPTION_GRACE_EXPIRED' && c.recordId === 'sub_grace_expired' && c.priority === 'Critical'));

  assert.ok(candidates.some((c) => c.eventType === 'INVOICE_DUE_TODAY' && c.recordId === 'inv_due' && c.priority === 'Warning'));
  assert.ok(candidates.some((c) => c.eventType === 'INVOICE_OVERDUE' && c.recordId === 'inv_overdue' && c.priority === 'Critical'));

  assert.ok(candidates.some((c) => c.eventType === 'LEAD_FOLLOWUP_DUE' && c.recordId === 'lead_due' && c.phone === '+254712345678'));
  assert.ok(candidates.some((c) => c.eventType === 'LEAD_DEMO_AWAITING_FEEDBACK' && c.recordId === 'lead_due'));
  assert.ok(candidates.some((c) => c.eventType === 'LEAD_FOLLOWUP_OVERDUE' && c.recordId === 'lead_overdue' && c.priority === 'Critical'));
  assert.ok(!candidates.some((c) => c.recordId === 'lead_converted'), 'Converted leads must not generate follow-up alerts');

  assert.ok(candidates.some((c) => c.eventType === 'WEBSITE_DEPLOYMENT_FAILED' && c.recordId === 'web_fail' && c.priority === 'Critical'));
  assert.ok(candidates.some((c) => c.eventType === 'WEBSITE_RENEWAL_UPCOMING' && c.recordId === 'web_fail'));
  assert.ok(candidates.some((c) => c.eventType === 'WEBSITE_ATTENTION_REQUIRED' && c.recordId === 'web_susp'));

  // Verify category disable preferences work
  const leadsDisabled = evaluateNotificationCandidates({
    subscriptions,
    invoices,
    leads,
    websites,
    settings: {
      ...baseSettings,
      notificationPreferences: {
        ...baseSettings.notificationPreferences!,
        enabledCategories: { subscriptions: true, payments: true, leads: false, websites: false },
      },
    },
    todayNairobi: today,
  });
  assert.ok(!leadsDisabled.some((c) => c.category === 'leads' || c.category === 'websites'));

  // Verify deterministic re-run produces identical dedupeKeys (zero duplicates on repeat sync)
  const secondRun = evaluateNotificationCandidates({
    subscriptions,
    invoices,
    leads,
    websites,
    settings: baseSettings,
    todayNairobi: today,
  });
  assert.deepEqual(
    secondRun.map((c) => c.dedupeKey),
    keys,
    'Deterministic dedupeKeys must remain identical across repeated checks'
  );

  console.log(`ALL ${candidates.length} NOTIFICATION ENGINE ASSERTIONS PASSED`);
  process.exit(0);
}

runTests();
