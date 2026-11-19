import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, OperationType, handleFirestoreError } from '../lib/firebase';
import {
  clampString,
  daysBetween,
  FIELD_LIMITS,
  formatDisplayDate,
  formatKES,
  getEffectiveSubscriptionStatus,
  getNairobiDateIso,
  isPastGracePeriod,
  isValidIsoDate,
} from '../lib/validation';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type BusinessSettings,
  type Invoice,
  type Lead,
  type NavSection,
  type NotificationCategory,
  type NotificationEntityType,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationPriority,
  type Subscription,
  type Website,
} from '../types/domain';

export interface NotificationCandidate {
  dedupeKey: string;
  eventType: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  recordId: string;
  clientId?: string;
  clientName?: string;
  phone?: string;
  amount?: number;
  dueDate?: string;
  targetSection: NavSection;
}

export function resolveNotificationPreferences(
  settings?: BusinessSettings
): NotificationPreferences {
  const prefs = settings?.notificationPreferences;
  if (!prefs) return DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    enabledCategories: {
      subscriptions: prefs.enabledCategories?.subscriptions ?? true,
      payments: prefs.enabledCategories?.payments ?? true,
      leads: prefs.enabledCategories?.leads ?? true,
      websites: prefs.enabledCategories?.websites ?? true,
    },
    graceReminderDays:
      Array.isArray(prefs.graceReminderDays) && prefs.graceReminderDays.length > 0
        ? prefs.graceReminderDays.filter((n) => Number.isFinite(n) && n >= 0 && n <= 90)
        : [7, 3, 1],
    renewalReminderDays:
      typeof prefs.renewalReminderDays === 'number' && prefs.renewalReminderDays >= 0
        ? Math.min(90, prefs.renewalReminderDays)
        : 14,
    websiteRenewalReminderDays:
      typeof prefs.websiteRenewalReminderDays === 'number' && prefs.websiteRenewalReminderDays >= 0
        ? Math.min(90, prefs.websiteRenewalReminderDays)
        : 14,
    demoFeedbackReminderDays:
      typeof prefs.demoFeedbackReminderDays === 'number' && prefs.demoFeedbackReminderDays >= 0
        ? Math.min(60, prefs.demoFeedbackReminderDays)
        : 2,
    leadFollowUpEnabled: prefs.leadFollowUpEnabled ?? true,
    websiteAlertsEnabled: prefs.websiteAlertsEnabled ?? true,
    pushNotificationsEnabled: prefs.pushNotificationsEnabled ?? true,
    pushPriorities:
      Array.isArray(prefs.pushPriorities) && prefs.pushPriorities.length > 0
        ? prefs.pushPriorities
        : ['Critical', 'Warning'],
    vapidPublicKey: prefs.vapidPublicKey || '',
  };
}

function sanitizeDedupeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

/**
 * Pure deterministic evaluator for all EMG Smart Notification rules in Africa/Nairobi timezone.
 * Safely ignores missing/invalid dates and never fabricates downtime or payment statuses.
 */
export function evaluateNotificationCandidates(params: {
  subscriptions: Subscription[];
  invoices: Invoice[];
  leads: Lead[];
  websites: Website[];
  settings?: BusinessSettings;
  todayNairobi?: string;
}): NotificationCandidate[] {
  const today = params.todayNairobi || getNairobiDateIso();
  const currency = params.settings?.currency || 'KES';
  const prefs = resolveNotificationPreferences(params.settings);
  const candidates: NotificationCandidate[] = [];

  // 1. Subscription & Grace Period Alerts
  if (prefs.enabledCategories.subscriptions) {
    for (const sub of params.subscriptions) {
      if (sub.status === 'Cancelled' || sub.status === 'Suspended') continue;
      if (!isValidIsoDate(sub.nextPaymentDate)) continue;

      const effective = getEffectiveSubscriptionStatus(sub, today);
      const daysUntilDue = daysBetween(today, sub.nextPaymentDate);
      const amountText = formatKES(Number(sub.monthlyAmount) || 0, currency);

      // Payment due today
      if (daysUntilDue === 0 && (effective === 'Active' || effective === 'Pending')) {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`sub_due_${sub.id}_${sub.nextPaymentDate}`),
          eventType: 'SUBSCRIPTION_DUE_TODAY',
          category: 'subscriptions',
          priority: 'Warning',
          title: `Subscription payment due today: ${sub.clientName}`,
          message: `${sub.packageName} renewal of ${amountText} is due today (${formatDisplayDate(sub.nextPaymentDate)}).`,
          entityType: 'subscription',
          recordId: sub.id,
          clientId: sub.clientId,
          clientName: sub.clientName,
          amount: Number(sub.monthlyAmount) || 0,
          dueDate: sub.nextPaymentDate,
          targetSection: 'subscriptions',
        });
      } else if (
        daysUntilDue > 0 &&
        daysUntilDue <= prefs.renewalReminderDays &&
        (effective === 'Active' || effective === 'Pending')
      ) {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`sub_upcoming_${sub.id}_${sub.nextPaymentDate}`),
          eventType: 'SUBSCRIPTION_UPCOMING_RENEWAL',
          category: 'subscriptions',
          priority: daysUntilDue <= 3 ? 'Warning' : 'Info',
          title: `Upcoming renewal in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}: ${sub.clientName}`,
          message: `${sub.packageName} (${amountText}) renews on ${formatDisplayDate(sub.nextPaymentDate)}.`,
          entityType: 'subscription',
          recordId: sub.id,
          clientId: sub.clientId,
          clientName: sub.clientName,
          amount: Number(sub.monthlyAmount) || 0,
          dueDate: sub.nextPaymentDate,
          targetSection: 'subscriptions',
        });
      }

      // Payment overdue & grace period countdown / expiry
      if (effective === 'Overdue') {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`sub_overdue_${sub.id}_${sub.nextPaymentDate}`),
          eventType: 'SUBSCRIPTION_OVERDUE',
          category: 'subscriptions',
          priority: 'Critical',
          title: `Overdue subscription: ${sub.clientName}`,
          message: `${amountText} (${sub.packageName}) was due on ${formatDisplayDate(sub.nextPaymentDate)}.${
            isValidIsoDate(sub.gracePeriodEndDate)
              ? ` Grace deadline: ${formatDisplayDate(sub.gracePeriodEndDate)}.`
              : ''
          }`,
          entityType: 'subscription',
          recordId: sub.id,
          clientId: sub.clientId,
          clientName: sub.clientName,
          amount: Number(sub.monthlyAmount) || 0,
          dueDate: isValidIsoDate(sub.gracePeriodEndDate)
            ? sub.gracePeriodEndDate
            : sub.nextPaymentDate,
          targetSection: 'subscriptions',
        });

        if (isValidIsoDate(sub.gracePeriodEndDate)) {
          const graceDaysLeft = daysBetween(today, sub.gracePeriodEndDate);

          if (graceDaysLeft > 0 && prefs.graceReminderDays.includes(graceDaysLeft)) {
            candidates.push({
              dedupeKey: sanitizeDedupeId(
                `sub_grace_${graceDaysLeft}d_${sub.id}_${sub.gracePeriodEndDate}`
              ),
              eventType: 'SUBSCRIPTION_GRACE_WARNING',
              category: 'subscriptions',
              priority: graceDaysLeft <= 1 ? 'Critical' : 'Warning',
              title: `Grace period: ${graceDaysLeft} day${graceDaysLeft === 1 ? '' : 's'} left for ${sub.clientName}`,
              message: `Outstanding ${amountText} must be settled by ${formatDisplayDate(sub.gracePeriodEndDate)} before grace expires.`,
              entityType: 'subscription',
              recordId: sub.id,
              clientId: sub.clientId,
              clientName: sub.clientName,
              amount: Number(sub.monthlyAmount) || 0,
              dueDate: sub.gracePeriodEndDate,
              targetSection: 'subscriptions',
            });
          } else if (isPastGracePeriod(sub, today)) {
            candidates.push({
              dedupeKey: sanitizeDedupeId(
                `sub_grace_expired_${sub.id}_${sub.gracePeriodEndDate}`
              ),
              eventType: 'SUBSCRIPTION_GRACE_EXPIRED',
              category: 'subscriptions',
              priority: 'Critical',
              title: `Grace period expired: ${sub.clientName}`,
              message: `Grace deadline (${formatDisplayDate(sub.gracePeriodEndDate)}) passed with ${amountText} outstanding. Manual admin review required.`,
              entityType: 'subscription',
              recordId: sub.id,
              clientId: sub.clientId,
              clientName: sub.clientName,
              amount: Number(sub.monthlyAmount) || 0,
              dueDate: sub.gracePeriodEndDate,
              targetSection: 'subscriptions',
            });
          }
        }
      }
    }
  }

  // 2. Unpaid & Overdue Invoice Alerts
  if (prefs.enabledCategories.payments) {
    for (const inv of params.invoices) {
      if (inv.status !== 'Unpaid' && inv.status !== 'Overdue') continue;
      if (!isValidIsoDate(inv.dueDate)) continue;

      const amountText = formatKES(Number(inv.amount) || 0, currency);
      const diff = daysBetween(today, inv.dueDate);

      if (inv.dueDate < today || inv.status === 'Overdue') {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`inv_overdue_${inv.id}_${inv.dueDate}`),
          eventType: 'INVOICE_OVERDUE',
          category: 'payments',
          priority: 'Critical',
          title: `Overdue invoice ${inv.invoiceNumber}: ${inv.clientName}`,
          message: `Unpaid balance of ${amountText} was due on ${formatDisplayDate(inv.dueDate)}.`,
          entityType: 'invoice',
          recordId: inv.id,
          clientId: inv.clientId,
          clientName: inv.clientName,
          amount: Number(inv.amount) || 0,
          dueDate: inv.dueDate,
          targetSection: 'invoices',
        });
      } else if (diff === 0) {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`inv_due_today_${inv.id}_${inv.dueDate}`),
          eventType: 'INVOICE_DUE_TODAY',
          category: 'payments',
          priority: 'Warning',
          title: `Invoice due today (${inv.invoiceNumber}): ${inv.clientName}`,
          message: `Invoice for ${amountText} is due today (${formatDisplayDate(inv.dueDate)}).`,
          entityType: 'invoice',
          recordId: inv.id,
          clientId: inv.clientId,
          clientName: inv.clientName,
          amount: Number(inv.amount) || 0,
          dueDate: inv.dueDate,
          targetSection: 'invoices',
        });
      } else {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`inv_unpaid_${inv.id}_${inv.dueDate}`),
          eventType: 'INVOICE_UNPAID',
          category: 'payments',
          priority: 'Info',
          title: `Unpaid invoice ${inv.invoiceNumber}: ${inv.clientName}`,
          message: `${amountText} pending · Due ${formatDisplayDate(inv.dueDate)} (in ${diff} day${diff === 1 ? '' : 's'}).`,
          entityType: 'invoice',
          recordId: inv.id,
          clientId: inv.clientId,
          clientName: inv.clientName,
          amount: Number(inv.amount) || 0,
          dueDate: inv.dueDate,
          targetSection: 'invoices',
        });
      }
    }
  }

  // 3. Lead Follow-Up & Demo Feedback Reminders
  if (prefs.enabledCategories.leads && prefs.leadFollowUpEnabled) {
    for (const lead of params.leads) {
      if (lead.status === 'Converted' || lead.status === 'Lost') continue;

      const leadLabel = `${lead.businessName} (${lead.contactPerson})`;

      if (isValidIsoDate(lead.followUpDate)) {
        if (lead.followUpDate === today) {
          candidates.push({
            dedupeKey: sanitizeDedupeId(`lead_followup_due_${lead.id}_${lead.followUpDate}`),
            eventType: 'LEAD_FOLLOWUP_DUE',
            category: 'leads',
            priority: 'Warning',
            title: `Follow-up due today: ${lead.businessName}`,
            message: `Prospect: ${leadLabel} · Phone: ${lead.phone} · Status: ${lead.status}.`,
            entityType: 'lead',
            recordId: lead.id,
            clientName: lead.businessName,
            phone: lead.phone,
            dueDate: lead.followUpDate,
            targetSection: 'leads',
          });
        } else if (lead.followUpDate < today) {
          candidates.push({
            dedupeKey: sanitizeDedupeId(`lead_followup_overdue_${lead.id}_${lead.followUpDate}`),
            eventType: 'LEAD_FOLLOWUP_OVERDUE',
            category: 'leads',
            priority: 'Critical',
            title: `Overdue follow-up: ${lead.businessName}`,
            message: `Prospect: ${leadLabel} · Phone: ${lead.phone} · Status: ${lead.status} · Scheduled ${formatDisplayDate(lead.followUpDate)}.`,
            entityType: 'lead',
            recordId: lead.id,
            clientName: lead.businessName,
            phone: lead.phone,
            dueDate: lead.followUpDate,
            targetSection: 'leads',
          });
        }
      }

      if (lead.status === 'Demo Presented' && isValidIsoDate(lead.dateContacted)) {
        const elapsed = daysBetween(lead.dateContacted, today);
        if (elapsed >= prefs.demoFeedbackReminderDays) {
          candidates.push({
            dedupeKey: sanitizeDedupeId(`lead_demo_feedback_${lead.id}_${lead.dateContacted}`),
            eventType: 'LEAD_DEMO_AWAITING_FEEDBACK',
            category: 'leads',
            priority: 'Info',
            title: `Demo awaiting feedback: ${lead.businessName}`,
            message: `Prospect: ${leadLabel} · Phone: ${lead.phone} · Status: Demo Presented (${elapsed}d since contact).`,
            entityType: 'lead',
            recordId: lead.id,
            clientName: lead.businessName,
            phone: lead.phone,
            dueDate: lead.followUpDate || lead.dateContacted,
            targetSection: 'leads',
          });
        }
      }
    }
  }

  // 4. Website & Domain Alerts
  if (prefs.enabledCategories.websites && prefs.websiteAlertsEnabled) {
    for (const site of params.websites) {
      if (site.deploymentStatus === 'Archived') continue;

      if (site.deploymentIntegrationStatus === 'failed') {
        candidates.push({
          dedupeKey: sanitizeDedupeId(`web_deploy_fail_${site.id}_${today}`),
          eventType: 'WEBSITE_DEPLOYMENT_FAILED',
          category: 'websites',
          priority: 'Critical',
          title: `Deployment failed: ${site.websiteName}`,
          message:
            site.deploymentErrorMessage ||
            `${site.businessName} (${site.hostingProvider}) reported a failed deployment build.`,
          entityType: 'website',
          recordId: site.id,
          clientId: site.clientId,
          clientName: site.businessName,
          targetSection: 'websites',
        });
      }

      if (isValidIsoDate(site.renewalDate)) {
        const daysToRenewal = daysBetween(today, site.renewalDate);
        if (daysToRenewal < 0) {
          candidates.push({
            dedupeKey: sanitizeDedupeId(`web_renewal_past_${site.id}_${site.renewalDate}`),
            eventType: 'WEBSITE_RENEWAL_UPCOMING',
            category: 'websites',
            priority: 'Critical',
            title: `Domain/hosting renewal date passed: ${site.websiteName}`,
            message: `${site.businessName} (${site.domain || site.hostingProvider}) renewal date was ${formatDisplayDate(site.renewalDate)}.`,
            entityType: 'website',
            recordId: site.id,
            clientId: site.clientId,
            clientName: site.businessName,
            dueDate: site.renewalDate,
            targetSection: 'websites',
          });
        } else if (daysToRenewal <= prefs.websiteRenewalReminderDays) {
          candidates.push({
            dedupeKey: sanitizeDedupeId(`web_renewal_${site.id}_${site.renewalDate}`),
            eventType: 'WEBSITE_RENEWAL_UPCOMING',
            category: 'websites',
            priority: daysToRenewal <= 3 ? 'Critical' : 'Warning',
            title: `Upcoming domain/hosting renewal (${daysToRenewal}d): ${site.websiteName}`,
            message: `${site.businessName} (${site.domain || site.hostingProvider}) renews on ${formatDisplayDate(site.renewalDate)}.`,
            entityType: 'website',
            recordId: site.id,
            clientId: site.clientId,
            clientName: site.businessName,
            dueDate: site.renewalDate,
            targetSection: 'websites',
          });
        }
      }

      if (site.deploymentStatus === 'In Development' || site.deploymentStatus === 'Suspended') {
        const statusSlug = site.deploymentStatus.toLowerCase().replace(/\s+/g, '_');
        candidates.push({
          dedupeKey: sanitizeDedupeId(`web_attention_${site.id}_${statusSlug}`),
          eventType: 'WEBSITE_ATTENTION_REQUIRED',
          category: 'websites',
          priority: site.deploymentStatus === 'Suspended' ? 'Warning' : 'Info',
          title: `Website ${site.deploymentStatus}: ${site.websiteName}`,
          message:
            site.deploymentStatus === 'Suspended'
              ? `${site.businessName} is marked Suspended on ${site.hostingProvider}. Review client billing or hosting status.`
              : `${site.businessName} website is currently In Development on ${site.hostingProvider}.`,
          entityType: 'website',
          recordId: site.id,
          clientId: site.clientId,
          clientName: site.businessName,
          targetSection: 'websites',
        });
      }
    }
  }

  return candidates;
}

/**
 * Synchronizes evaluated candidates into Firestore /notifications/{dedupeKey} without duplicates.
 */
export async function syncSmartNotificationsToFirestore(params: {
  existingNotifications: NotificationItem[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  leads: Lead[];
  websites: Website[];
  settings?: BusinessSettings;
}): Promise<{ createdCount: number }> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return { createdCount: 0 };
  }

  const candidates = evaluateNotificationCandidates({
    subscriptions: params.subscriptions,
    invoices: params.invoices,
    leads: params.leads,
    websites: params.websites,
    settings: params.settings,
  });

  const existingKeys = new Set(params.existingNotifications.map((n) => n.dedupeKey || n.id));
  const missing = candidates.filter((c) => !existingKeys.has(c.dedupeKey));
  if (missing.length === 0) {
    return { createdCount: 0 };
  }

  let createdCount = 0;
  // Write in chunks of 400 to stay comfortably under Firestore's 500-write batch limit
  for (let i = 0; i < missing.length; i += 400) {
    const chunk = missing.slice(i, i + 400);
    const batch = writeBatch(db);

    for (const item of chunk) {
      const notifRef = doc(db, 'notifications', item.dedupeKey);
      const payload: Record<string, unknown> = {
        dedupeKey: item.dedupeKey,
        eventType: clampString(item.eventType, 80),
        category: item.category,
        priority: item.priority,
        title: clampString(item.title, 200),
        message: clampString(item.message, 1000),
        read: false,
        readAt: '',
        entityType: item.entityType,
        recordId: clampString(item.recordId, 128),
        clientId: clampString(item.clientId, 128),
        clientName: clampString(item.clientName, FIELD_LIMITS.businessNameMax),
        phone: clampString(item.phone, FIELD_LIMITS.phoneMax),
        dueDate: clampString(item.dueDate, 32),
        targetSection: item.targetSection,
        pushDispatched: false,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount >= 0) {
        payload.amount = Math.min(FIELD_LIMITS.maxAmount, item.amount);
      }
      batch.set(notifRef, payload);
      createdCount += 1;
    }

    await batch.commit();
  }

  return { createdCount };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Verified administrator authentication required.');
  }
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      read: true,
      readAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export async function markAllNotificationsRead(unreadIds: string[]): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Verified administrator authentication required.');
  }
  if (unreadIds.length === 0) return;

  try {
    const readAt = new Date().toISOString();
    for (let i = 0; i < unreadIds.length; i += 400) {
      const chunk = unreadIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.update(doc(db, 'notifications', id), {
          read: true,
          readAt,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'notifications/batch_mark_read');
  }
}

export function buildTokenDocId(uid: string, token: string): string {
  // Simple deterministic FNV-1a 32-bit hex hash + uid prefix -> guaranteed valid Firestore doc ID <= 128 chars
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${uid.slice(0, 24)}_${hex}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function saveFcmToken(token: string, deviceLabel: string): Promise<string> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Verified administrator authentication required.');
  }
  const tokenId = buildTokenDocId(user.uid, token);
  const tokenRef = doc(db, 'fcm_tokens', tokenId);
  try {
    const existingSnap = await getDoc(tokenRef);
    const nowIso = new Date().toISOString();
    const userAgent =
      typeof navigator !== 'undefined' ? clampString(navigator.userAgent, 400) : '';

    if (existingSnap.exists()) {
      await updateDoc(tokenRef, {
        deviceLabel: clampString(deviceLabel || 'Web Browser', 160),
        userAgent,
        enabled: true,
        lastUsedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(tokenRef, {
        token: clampString(token, 512),
        adminUid: user.uid,
        adminEmail: clampString(user.email || '', FIELD_LIMITS.emailMax),
        deviceLabel: clampString(deviceLabel || 'Web Browser', 160),
        userAgent,
        enabled: true,
        lastUsedAt: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return tokenId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `fcm_tokens/${tokenId}`);
  }
}

export async function toggleFcmTokenEnabled(tokenId: string, enabled: boolean): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Verified administrator authentication required.');
  }
  try {
    await updateDoc(doc(db, 'fcm_tokens', tokenId), {
      enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `fcm_tokens/${tokenId}`);
  }
}

export async function deleteFcmToken(tokenId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('Verified administrator authentication required.');
  }
  try {
    await deleteDoc(doc(db, 'fcm_tokens', tokenId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `fcm_tokens/${tokenId}`);
  }
}
