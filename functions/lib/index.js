"use strict";
/**
 * EMG Web Solutions — Firebase Cloud Functions
 *
 * Server-side automation, Smart Notification & Reminder engine (Africa/Nairobi timezone),
 * Firebase Cloud Messaging (FCM) Web Push delivery, and M-Pesa Daraja callback readiness.
 *
 * Deploy independently with: firebase deploy --only functions
 *
 * IMPORTANT: Never store Daraja consumer keys, secrets, or passkeys in frontend code.
 * Configure them with Firebase Secret Manager:
 *   firebase functions:secrets:set MPESA_CONSUMER_KEY
 *   firebase functions:secrets:set MPESA_CONSUMER_SECRET
 *   firebase functions:secrets:set MPESA_PASSKEY
 *   firebase functions:secrets:set MPESA_CALLBACK_SECRET
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailySubscriptionStatusCheck = exports.onNotificationCreatedSendPush = exports.sendTestPushNotification = exports.getDarajaIntegrationStatus = exports.mpesaDarajaCallback = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_2 = require("firebase-functions/v2/firestore");
admin.initializeApp();
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || '(default)';
const NAIROBI_TIMEZONE = 'Africa/Nairobi';
const db = DATABASE_ID === '(default)'
    ? (0, firestore_1.getFirestore)()
    : (0, firestore_1.getFirestore)(DATABASE_ID);
const DEFAULT_PREFS = {
    enabledCategories: {
        subscriptions: true,
        payments: true,
        leads: true,
        websites: true,
    },
    graceReminderDays: [7, 3, 1],
    renewalReminderDays: 14,
    websiteRenewalReminderDays: 14,
    demoFeedbackReminderDays: 2,
    leadFollowUpEnabled: true,
    websiteAlertsEnabled: true,
    pushNotificationsEnabled: true,
    pushPriorities: ['Critical', 'Warning'],
};
function getNairobiTodayIso(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: NAIROBI_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}
function isValidIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (!Number.isNaN(dt.getTime()) &&
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d);
}
function daysBetween(fromIso, toIso) {
    if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso))
        return 0;
    const [y1, m1, d1] = fromIso.split('-').map(Number);
    const [y2, m2, d2] = toIso.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / (1000 * 60 * 60 * 24));
}
function formatAmount(amount, currency = 'KES') {
    const safe = Number.isFinite(amount) ? amount : 0;
    const prefix = currency === 'KES' ? 'KSh' : currency;
    return `${prefix} ${safe.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}
function sanitizeId(raw) {
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}
async function loadNotificationPreferences() {
    const snap = await db.collection('settings').doc('default').get();
    if (!snap.exists) {
        return { prefs: DEFAULT_PREFS, currency: 'KES' };
    }
    const data = snap.data() || {};
    const raw = (data.notificationPreferences || {});
    return {
        currency: typeof data.currency === 'string' && data.currency ? data.currency : 'KES',
        prefs: {
            enabledCategories: {
                subscriptions: raw.enabledCategories?.subscriptions ?? true,
                payments: raw.enabledCategories?.payments ?? true,
                leads: raw.enabledCategories?.leads ?? true,
                websites: raw.enabledCategories?.websites ?? true,
            },
            graceReminderDays: Array.isArray(raw.graceReminderDays) && raw.graceReminderDays.length > 0
                ? raw.graceReminderDays
                : [7, 3, 1],
            renewalReminderDays: typeof raw.renewalReminderDays === 'number' ? raw.renewalReminderDays : 14,
            websiteRenewalReminderDays: typeof raw.websiteRenewalReminderDays === 'number' ? raw.websiteRenewalReminderDays : 14,
            demoFeedbackReminderDays: typeof raw.demoFeedbackReminderDays === 'number' ? raw.demoFeedbackReminderDays : 2,
            leadFollowUpEnabled: raw.leadFollowUpEnabled ?? true,
            websiteAlertsEnabled: raw.websiteAlertsEnabled ?? true,
            pushNotificationsEnabled: raw.pushNotificationsEnabled ?? true,
            pushPriorities: Array.isArray(raw.pushPriorities) && raw.pushPriorities.length > 0
                ? raw.pushPriorities
                : ['Critical', 'Warning'],
        },
    };
}
async function assertCallerIsAdmin(uid, email, emailVerified) {
    if (!uid || !emailVerified) {
        throw new https_1.HttpsError('unauthenticated', 'Verified administrator authentication is required.');
    }
    if (email?.toLowerCase() === 'frivatech5@gmail.com') {
        return;
    }
    const adminSnap = await db.collection('admins').doc(uid).get();
    if (!adminSnap.exists || adminSnap.data()?.active !== true) {
        throw new https_1.HttpsError('permission-denied', 'Caller is not an active EMG Web Solutions administrator.');
    }
}
async function dispatchFcmPushToActiveAdmins(params) {
    const tokenSnap = await db.collection('fcm_tokens').where('enabled', '==', true).get();
    if (tokenSnap.empty) {
        return { successCount: 0, failureCount: 0 };
    }
    const docs = tokenSnap.docs;
    const tokens = docs.map((d) => String(d.data().token || '')).filter(Boolean);
    if (tokens.length === 0) {
        return { successCount: 0, failureCount: 0 };
    }
    const publicAppUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const relativeDeepLink = `/?section=${encodeURIComponent(params.targetSection)}&recordId=${encodeURIComponent(params.recordId)}`;
    const httpsDeepLink = publicAppUrl.startsWith('https://') ? `${publicAppUrl}${relativeDeepLink}` : '';
    const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
            title: params.title,
            body: params.body,
        },
        data: {
            title: params.title,
            message: params.body,
            priority: params.priority,
            dedupeKey: params.dedupeKey,
            targetSection: params.targetSection,
            recordId: params.recordId,
        },
        webpush: {
            headers: {
                Urgency: params.priority === 'Critical' ? 'high' : 'normal',
            },
            notification: {
                title: params.title,
                body: params.body,
                tag: params.dedupeKey,
                requireInteraction: params.priority === 'Critical',
            },
            ...(httpsDeepLink
                ? {
                    fcmOptions: {
                        link: httpsDeepLink,
                    },
                }
                : {}),
        },
    });
    // Clean up invalid / unregistered tokens automatically
    const cleanupBatch = db.batch();
    let cleanupCount = 0;
    response.responses.forEach((resp, index) => {
        if (!resp.success) {
            const code = resp.error?.code;
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                cleanupBatch.update(docs[index].ref, {
                    enabled: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                cleanupCount += 1;
            }
        }
    });
    if (cleanupCount > 0) {
        await cleanupBatch.commit();
    }
    return {
        successCount: response.successCount,
        failureCount: response.failureCount,
    };
}
/**
 * M-Pesa Daraja Callback Receiver (Architecture Ready)
 */
exports.mpesaDarajaCallback = (0, https_1.onRequest)(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }
    const configuredSecret = process.env.MPESA_CALLBACK_SECRET;
    const providedSecret = req.query.token || req.headers['x-callback-secret'];
    if (!configuredSecret || providedSecret !== configuredSecret) {
        res.status(403).json({ error: 'Unauthorized callback request' });
        return;
    }
    try {
        const stkCallback = req.body?.Body?.stkCallback;
        if (!stkCallback) {
            res.status(400).json({ error: 'Invalid Daraja callback payload' });
            return;
        }
        const resultCode = Number(stkCallback.ResultCode);
        const checkoutRequestId = String(stkCallback.CheckoutRequestID || '');
        if (!checkoutRequestId) {
            res.status(400).json({ error: 'Missing CheckoutRequestID' });
            return;
        }
        if (resultCode !== 0) {
            await db.collection('activity_logs').add({
                actionType: 'MPESA_CALLBACK_FAILED',
                entityType: 'payment',
                recordId: checkoutRequestId,
                summary: `M-Pesa STK payment failed or cancelled: ${String(stkCallback.ResultDesc || 'Unknown reason')}`,
                adminId: 'system_daraja_webhook',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
            return;
        }
        const items = stkCallback.CallbackMetadata?.Item || [];
        const receipt = String(items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value || '').trim();
        const amount = Number(items.find((i) => i.Name === 'Amount')?.Value || 0);
        if (!receipt || amount <= 0) {
            res.status(400).json({ error: 'Incomplete M-Pesa receipt metadata' });
            return;
        }
        const normalizedRef = receipt.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        await db.runTransaction(async (tx) => {
            const refDoc = db.collection('payment_references').doc(normalizedRef);
            const existingRef = await tx.get(refDoc);
            if (existingRef.exists) {
                return;
            }
            const pendingIntentSnap = await db
                .collection('payments')
                .where('transactionReference', '==', checkoutRequestId)
                .limit(1)
                .get();
            if (pendingIntentSnap.empty) {
                return;
            }
            const paymentDoc = pendingIntentSnap.docs[0];
            tx.update(paymentDoc.ref, {
                status: 'Paid',
                transactionReference: receipt,
                normalizedReference: normalizedRef,
                verificationSource: 'mpesa_daraja_callback',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            tx.set(refDoc, {
                paymentId: paymentDoc.id,
                transactionReference: receipt,
                createdBy: 'system_daraja_webhook',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    catch (err) {
        console.error('M-Pesa callback processing error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
/**
 * Privileged Admin Endpoint: Verify M-Pesa Daraja Configuration Status
 */
exports.getDarajaIntegrationStatus = (0, https_1.onCall)(async (request) => {
    await assertCallerIsAdmin(request.auth?.uid, request.auth?.token?.email, request.auth?.token?.email_verified);
    return {
        configured: Boolean(process.env.MPESA_CONSUMER_KEY &&
            process.env.MPESA_CONSUMER_SECRET &&
            process.env.MPESA_PASSKEY &&
            process.env.MPESA_SHORTCODE),
        environment: process.env.MPESA_ENV || 'not_configured',
        mode: 'manual_recording_active',
    };
});
/**
 * Privileged Admin Callable: Send Test FCM Push Notification to Calling Device
 */
exports.sendTestPushNotification = (0, https_1.onCall)(async (request) => {
    await assertCallerIsAdmin(request.auth?.uid, request.auth?.token?.email, request.auth?.token?.email_verified);
    const token = String(request.data?.token || '').trim();
    if (token.length < 20) {
        throw new https_1.HttpsError('invalid-argument', 'A valid FCM device token is required.');
    }
    const publicAppUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const httpsTestLink = publicAppUrl.startsWith('https://') ? `${publicAppUrl}/?section=reminders` : '';
    const messageId = await admin.messaging().send({
        token,
        notification: {
            title: 'EMG Web Solutions — Push Active',
            body: 'System-level Web Push notifications are configured and active on this device.',
        },
        data: {
            title: 'EMG Web Solutions — Push Active',
            message: 'System-level Web Push notifications are configured and active on this device.',
            priority: 'Info',
            dedupeKey: `test_push_${Date.now()}`,
            targetSection: 'reminders',
            recordId: '',
        },
        webpush: {
            headers: {
                Urgency: 'normal',
            },
            notification: {
                title: 'EMG Web Solutions — Push Active',
                body: 'System-level Web Push notifications are configured and active on this device.',
                tag: 'emg_test_push',
            },
            ...(httpsTestLink
                ? {
                    fcmOptions: {
                        link: httpsTestLink,
                    },
                }
                : {}),
        },
    });
    return { success: true, messageId };
});
/**
 * Firestore Trigger: Automatically delivers Web Push via FCM when a new notification is created.
 * Uses a transaction flag (`pushDispatched`) to ensure each alert triggers at most one push batch.
 */
exports.onNotificationCreatedSendPush = (0, firestore_2.onDocumentCreated)({
    document: 'notifications/{notificationId}',
    database: DATABASE_ID,
}, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    if (!data || data.pushDispatched === true)
        return;
    const { prefs } = await loadNotificationPreferences();
    if (!prefs.pushNotificationsEnabled)
        return;
    const priority = String(data.priority || 'Info');
    if (!prefs.pushPriorities.includes(priority))
        return;
    const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(snap.ref);
        if (!fresh.exists || fresh.data()?.pushDispatched === true) {
            return false;
        }
        tx.update(snap.ref, {
            pushDispatched: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
    });
    if (!claimed)
        return;
    await dispatchFcmPushToActiveAdmins({
        title: String(data.title || 'EMG Business Alert'),
        body: String(data.message || ''),
        priority,
        dedupeKey: String(data.dedupeKey || snap.id),
        targetSection: String(data.targetSection || 'reminders'),
        recordId: String(data.recordId || ''),
    });
});
/**
 * Daily Smart Notification & Subscription Scanner (Africa/Nairobi timezone)
 * Runs daily at 07:00 EAT:
 *  - Flags overdue Active/Pending subscriptions without ever auto-suspending websites.
 *  - Generates deduplicated notifications for subscriptions, grace periods (7, 3, 1, expired),
 *    unpaid/overdue invoices, lead follow-ups, demo feedback, and website renewals/attention.
 */
exports.dailySubscriptionStatusCheck = (0, scheduler_1.onSchedule)({
    schedule: 'every day 07:00',
    timeZone: NAIROBI_TIMEZONE,
}, async () => {
    const today = getNairobiTodayIso();
    const { prefs, currency } = await loadNotificationPreferences();
    const [subsSnap, invoicesSnap, leadsSnap, websitesSnap] = await Promise.all([
        db.collection('subscriptions').get(),
        db.collection('invoices').where('status', 'in', ['Unpaid', 'Overdue']).get(),
        db.collection('leads').get(),
        db.collection('websites').get(),
    ]);
    const statusBatch = db.batch();
    let statusUpdates = 0;
    const createNotificationIfNew = async (payload) => {
        const ref = db.collection('notifications').doc(payload.dedupeKey);
        try {
            await ref.create({
                dedupeKey: payload.dedupeKey,
                eventType: payload.eventType,
                category: payload.category,
                priority: payload.priority,
                title: payload.title.slice(0, 200),
                message: payload.message.slice(0, 1000),
                read: false,
                readAt: '',
                entityType: payload.entityType,
                recordId: payload.recordId,
                clientId: payload.clientId || '',
                clientName: (payload.clientName || '').slice(0, 160),
                phone: (payload.phone || '').slice(0, 40),
                ...(typeof payload.amount === 'number' ? { amount: payload.amount } : {}),
                dueDate: payload.dueDate || '',
                targetSection: payload.targetSection,
                pushDispatched: false,
                createdBy: 'system_scheduler',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        catch (err) {
            // Ignore ALREADY_EXISTS (gRPC code 6) for strict idempotency
            if (err?.code === 6)
                return;
            throw err;
        }
    };
    // 1. Subscriptions & Grace Periods
    for (const docSnap of subsSnap.docs) {
        const sub = docSnap.data();
        if (sub.status === 'Cancelled' || sub.status === 'Suspended')
            continue;
        if (!isValidIsoDate(sub.nextPaymentDate))
            continue;
        let effectiveStatus = String(sub.status);
        if ((effectiveStatus === 'Active' || effectiveStatus === 'Pending') && sub.nextPaymentDate < today) {
            effectiveStatus = 'Overdue';
            statusBatch.update(docSnap.ref, {
                status: 'Overdue',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            statusUpdates += 1;
        }
        if (!prefs.enabledCategories.subscriptions)
            continue;
        const amount = Number(sub.monthlyAmount) || 0;
        const amountText = formatAmount(amount, currency);
        const daysUntilDue = daysBetween(today, sub.nextPaymentDate);
        if (daysUntilDue === 0 && (effectiveStatus === 'Active' || effectiveStatus === 'Pending')) {
            await createNotificationIfNew({
                dedupeKey: sanitizeId(`sub_due_${docSnap.id}_${sub.nextPaymentDate}`),
                eventType: 'SUBSCRIPTION_DUE_TODAY',
                category: 'subscriptions',
                priority: 'Warning',
                title: `Subscription payment due today: ${sub.clientName}`,
                message: `${sub.packageName} renewal of ${amountText} is due today (${sub.nextPaymentDate}).`,
                entityType: 'subscription',
                recordId: docSnap.id,
                clientId: sub.clientId,
                clientName: sub.clientName,
                amount,
                dueDate: sub.nextPaymentDate,
                targetSection: 'subscriptions',
            });
        }
        else if (daysUntilDue > 0 &&
            daysUntilDue <= prefs.renewalReminderDays &&
            (effectiveStatus === 'Active' || effectiveStatus === 'Pending')) {
            await createNotificationIfNew({
                dedupeKey: sanitizeId(`sub_upcoming_${docSnap.id}_${sub.nextPaymentDate}`),
                eventType: 'SUBSCRIPTION_UPCOMING_RENEWAL',
                category: 'subscriptions',
                priority: daysUntilDue <= 3 ? 'Warning' : 'Info',
                title: `Upcoming renewal in ${daysUntilDue}d: ${sub.clientName}`,
                message: `${sub.packageName} (${amountText}) renews on ${sub.nextPaymentDate}.`,
                entityType: 'subscription',
                recordId: docSnap.id,
                clientId: sub.clientId,
                clientName: sub.clientName,
                amount,
                dueDate: sub.nextPaymentDate,
                targetSection: 'subscriptions',
            });
        }
        if (effectiveStatus === 'Overdue') {
            await createNotificationIfNew({
                dedupeKey: sanitizeId(`sub_overdue_${docSnap.id}_${sub.nextPaymentDate}`),
                eventType: 'SUBSCRIPTION_OVERDUE',
                category: 'subscriptions',
                priority: 'Critical',
                title: `Overdue subscription: ${sub.clientName}`,
                message: `${amountText} (${sub.packageName}) was due on ${sub.nextPaymentDate}.`,
                entityType: 'subscription',
                recordId: docSnap.id,
                clientId: sub.clientId,
                clientName: sub.clientName,
                amount,
                dueDate: isValidIsoDate(sub.gracePeriodEndDate) ? sub.gracePeriodEndDate : sub.nextPaymentDate,
                targetSection: 'subscriptions',
            });
            if (isValidIsoDate(sub.gracePeriodEndDate)) {
                const graceDaysLeft = daysBetween(today, sub.gracePeriodEndDate);
                if (graceDaysLeft > 0 && prefs.graceReminderDays.includes(graceDaysLeft)) {
                    await createNotificationIfNew({
                        dedupeKey: sanitizeId(`sub_grace_${graceDaysLeft}d_${docSnap.id}_${sub.gracePeriodEndDate}`),
                        eventType: 'SUBSCRIPTION_GRACE_WARNING',
                        category: 'subscriptions',
                        priority: graceDaysLeft <= 1 ? 'Critical' : 'Warning',
                        title: `Grace period: ${graceDaysLeft} day${graceDaysLeft === 1 ? '' : 's'} left (${sub.clientName})`,
                        message: `Outstanding ${amountText} must be settled by ${sub.gracePeriodEndDate}.`,
                        entityType: 'subscription',
                        recordId: docSnap.id,
                        clientId: sub.clientId,
                        clientName: sub.clientName,
                        amount,
                        dueDate: sub.gracePeriodEndDate,
                        targetSection: 'subscriptions',
                    });
                }
                else if (today > sub.gracePeriodEndDate) {
                    await createNotificationIfNew({
                        dedupeKey: sanitizeId(`sub_grace_expired_${docSnap.id}_${sub.gracePeriodEndDate}`),
                        eventType: 'SUBSCRIPTION_GRACE_EXPIRED',
                        category: 'subscriptions',
                        priority: 'Critical',
                        title: `Grace period expired: ${sub.clientName}`,
                        message: `Grace deadline (${sub.gracePeriodEndDate}) passed with ${amountText} outstanding.`,
                        entityType: 'subscription',
                        recordId: docSnap.id,
                        clientId: sub.clientId,
                        clientName: sub.clientName,
                        amount,
                        dueDate: sub.gracePeriodEndDate,
                        targetSection: 'subscriptions',
                    });
                }
            }
        }
    }
    if (statusUpdates > 0) {
        await statusBatch.commit();
    }
    // 2. Unpaid & Overdue Invoices
    if (prefs.enabledCategories.payments) {
        for (const invDoc of invoicesSnap.docs) {
            const inv = invDoc.data();
            if (!isValidIsoDate(inv.dueDate))
                continue;
            const amount = Number(inv.amount) || 0;
            const amountText = formatAmount(amount, currency);
            const diff = daysBetween(today, inv.dueDate);
            if (inv.dueDate < today || inv.status === 'Overdue') {
                await createNotificationIfNew({
                    dedupeKey: sanitizeId(`inv_overdue_${invDoc.id}_${inv.dueDate}`),
                    eventType: 'INVOICE_OVERDUE',
                    category: 'payments',
                    priority: 'Critical',
                    title: `Overdue invoice ${inv.invoiceNumber}: ${inv.clientName}`,
                    message: `Unpaid balance of ${amountText} was due on ${inv.dueDate}.`,
                    entityType: 'invoice',
                    recordId: invDoc.id,
                    clientId: inv.clientId,
                    clientName: inv.clientName,
                    amount,
                    dueDate: inv.dueDate,
                    targetSection: 'invoices',
                });
            }
            else if (diff === 0) {
                await createNotificationIfNew({
                    dedupeKey: sanitizeId(`inv_due_today_${invDoc.id}_${inv.dueDate}`),
                    eventType: 'INVOICE_DUE_TODAY',
                    category: 'payments',
                    priority: 'Warning',
                    title: `Invoice due today (${inv.invoiceNumber}): ${inv.clientName}`,
                    message: `Invoice for ${amountText} is due today (${inv.dueDate}).`,
                    entityType: 'invoice',
                    recordId: invDoc.id,
                    clientId: inv.clientId,
                    clientName: inv.clientName,
                    amount,
                    dueDate: inv.dueDate,
                    targetSection: 'invoices',
                });
            }
        }
    }
    // 3. Lead Follow-ups & Demo Feedback
    if (prefs.enabledCategories.leads && prefs.leadFollowUpEnabled) {
        for (const leadDoc of leadsSnap.docs) {
            const lead = leadDoc.data();
            if (lead.status === 'Converted' || lead.status === 'Lost')
                continue;
            if (isValidIsoDate(lead.followUpDate)) {
                if (lead.followUpDate === today) {
                    await createNotificationIfNew({
                        dedupeKey: sanitizeId(`lead_followup_due_${leadDoc.id}_${lead.followUpDate}`),
                        eventType: 'LEAD_FOLLOWUP_DUE',
                        category: 'leads',
                        priority: 'Warning',
                        title: `Follow-up due today: ${lead.businessName}`,
                        message: `Prospect: ${lead.contactPerson} · Phone: ${lead.phone} · Status: ${lead.status}.`,
                        entityType: 'lead',
                        recordId: leadDoc.id,
                        clientName: lead.businessName,
                        phone: lead.phone,
                        dueDate: lead.followUpDate,
                        targetSection: 'leads',
                    });
                }
                else if (lead.followUpDate < today) {
                    await createNotificationIfNew({
                        dedupeKey: sanitizeId(`lead_followup_overdue_${leadDoc.id}_${lead.followUpDate}`),
                        eventType: 'LEAD_FOLLOWUP_OVERDUE',
                        category: 'leads',
                        priority: 'Critical',
                        title: `Overdue follow-up: ${lead.businessName}`,
                        message: `Prospect: ${lead.contactPerson} · Phone: ${lead.phone} · Status: ${lead.status} (Due ${lead.followUpDate}).`,
                        entityType: 'lead',
                        recordId: leadDoc.id,
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
                    await createNotificationIfNew({
                        dedupeKey: sanitizeId(`lead_demo_feedback_${leadDoc.id}_${lead.dateContacted}`),
                        eventType: 'LEAD_DEMO_AWAITING_FEEDBACK',
                        category: 'leads',
                        priority: 'Info',
                        title: `Demo awaiting feedback: ${lead.businessName}`,
                        message: `Prospect: ${lead.contactPerson} · Phone: ${lead.phone} · Status: Demo Presented (${elapsed}d).`,
                        entityType: 'lead',
                        recordId: leadDoc.id,
                        clientName: lead.businessName,
                        phone: lead.phone,
                        dueDate: lead.followUpDate || lead.dateContacted,
                        targetSection: 'leads',
                    });
                }
            }
        }
    }
    // 4. Website Renewals & Attention Alerts
    if (prefs.enabledCategories.websites && prefs.websiteAlertsEnabled) {
        for (const webDoc of websitesSnap.docs) {
            const site = webDoc.data();
            if (site.deploymentStatus === 'Archived')
                continue;
            if (site.deploymentIntegrationStatus === 'failed') {
                await createNotificationIfNew({
                    dedupeKey: sanitizeId(`web_deploy_fail_${webDoc.id}_${today}`),
                    eventType: 'WEBSITE_DEPLOYMENT_FAILED',
                    category: 'websites',
                    priority: 'Critical',
                    title: `Deployment failed: ${site.websiteName}`,
                    message: site.deploymentErrorMessage || `${site.businessName} reported a failed deployment build.`,
                    entityType: 'website',
                    recordId: webDoc.id,
                    clientId: site.clientId,
                    clientName: site.businessName,
                    targetSection: 'websites',
                });
            }
            if (isValidIsoDate(site.renewalDate)) {
                const daysToRenewal = daysBetween(today, site.renewalDate);
                if (daysToRenewal <= prefs.websiteRenewalReminderDays) {
                    await createNotificationIfNew({
                        dedupeKey: sanitizeId(daysToRenewal < 0
                            ? `web_renewal_past_${webDoc.id}_${site.renewalDate}`
                            : `web_renewal_${webDoc.id}_${site.renewalDate}`),
                        eventType: 'WEBSITE_RENEWAL_UPCOMING',
                        category: 'websites',
                        priority: daysToRenewal <= 3 ? 'Critical' : 'Warning',
                        title: daysToRenewal < 0
                            ? `Website renewal passed: ${site.websiteName}`
                            : `Website/domain renewal in ${daysToRenewal}d: ${site.websiteName}`,
                        message: `${site.businessName} (${site.domain || site.hostingProvider}) renewal date: ${site.renewalDate}.`,
                        entityType: 'website',
                        recordId: webDoc.id,
                        clientId: site.clientId,
                        clientName: site.businessName,
                        dueDate: site.renewalDate,
                        targetSection: 'websites',
                    });
                }
            }
        }
    }
});
//# sourceMappingURL=index.js.map