import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
  auth,
  db,
  BOOTSTRAP_ADMIN_EMAIL,
  OperationType,
  handleFirestoreError,
} from '../lib/firebase';
import {
  addDaysIso,
  addMonthsIso,
  clampString,
  FIELD_LIMITS,
  generateRecordCode,
  normalizeTransactionRef,
  todayIso,
} from '../lib/validation';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ActivityEntityType,
  type AdminRole,
  type AdminUser,
  type BusinessSettings,
  type Client,
  type ClientStatus,
  type Invoice,
  type InvoiceStatus,
  type Lead,
  type LeadChannel,
  type LeadInterest,
  type LeadStatus,
  type NotificationPreferences,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  type Subscription,
  type SubscriptionPackage,
  type SubscriptionStatus,
  type Website,
  type WebsiteDeploymentStatus,
} from '../types/domain';

function requireAdminAuth(): { uid: string; email: string } {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required. Please sign in.');
  }
  if (!user.emailVerified) {
    throw new Error('Your email address must be verified before modifying business records.');
  }
  return { uid: user.uid, email: user.email || '' };
}

function addActivityToBatch(
  batch: WriteBatch,
  actionType: string,
  entityType: ActivityEntityType,
  recordId: string,
  summary: string
): void {
  const { uid, email } = requireAdminAuth();
  const logRef = doc(collection(db, 'activity_logs'));
  batch.set(logRef, {
    actionType: clampString(actionType, 80),
    entityType,
    recordId: clampString(recordId, 128),
    summary: clampString(summary, 300),
    adminId: uid,
    adminEmail: clampString(email, FIELD_LIMITS.emailMax),
    createdAt: serverTimestamp(),
  });
}

export async function verifyAdminAccess(user: User): Promise<{ authorized: boolean; adminProfile: AdminUser | null; reason?: string }> {
  if (!user.emailVerified) {
    return {
      authorized: false,
      adminProfile: null,
      reason: 'Email address is not verified. Verify your email or sign in with Google.',
    };
  }

  const isBootstrapped = (user.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const adminRef = doc(db, 'admins', user.uid);

  try {
    const snap = await getDoc(adminRef);
    if (snap.exists()) {
      const data = snap.data() as Omit<AdminUser, 'id'>;
      const profile: AdminUser = { id: snap.id, ...data };
      if (!data.active && !isBootstrapped) {
        return {
          authorized: false,
          adminProfile: profile,
          reason: 'This administrator account is currently deactivated.',
        };
      }
      return { authorized: true, adminProfile: profile };
    }

    if (isBootstrapped) {
      const newAdminPayload = {
        uid: user.uid,
        email: clampString(user.email || BOOTSTRAP_ADMIN_EMAIL, FIELD_LIMITS.emailMax),
        displayName: clampString(user.displayName || 'EMG Administrator', FIELD_LIMITS.contactNameMax),
        role: 'super_admin' as AdminRole,
        active: true,
        phone: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(adminRef, newAdminPayload);
      const createdSnap = await getDoc(adminRef);
      const profile = createdSnap.exists()
        ? ({ id: createdSnap.id, ...createdSnap.data() } as AdminUser)
        : ({ id: user.uid, ...newAdminPayload, createdAt: null, updatedAt: null } as AdminUser);
      return { authorized: true, adminProfile: profile };
    }

    return {
      authorized: false,
      adminProfile: null,
      reason: 'Your account is not listed in authorized EMG Web Solutions administrators.',
    };
  } catch (error) {
    if (isBootstrapped) {
      return {
        authorized: true,
        adminProfile: {
          id: user.uid,
          uid: user.uid,
          email: user.email || BOOTSTRAP_ADMIN_EMAIL,
          displayName: user.displayName || 'EMG Administrator',
          role: 'super_admin',
          active: true,
        },
      };
    }
    handleFirestoreError(error, OperationType.GET, `admins/${user.uid}`);
  }
}

export const DEFAULT_PACKAGES: SubscriptionPackage[] = [
  {
    id: 'basic',
    name: 'BASIC',
    monthlyPrice: 500,
    description: 'Starter hosting, SSL monitoring, and monthly uptime check.',
  },
  {
    id: 'business',
    name: 'BUSINESS',
    monthlyPrice: 1000,
    description: 'Standard business hosting, backups, and minor content updates.',
  },
  {
    id: 'premium',
    name: 'PREMIUM',
    monthlyPrice: 1500,
    description: 'Priority support, weekly backups, SEO maintenance, and updates.',
  },
];

export async function ensureDefaultSettings(): Promise<void> {
  const { uid } = requireAdminAuth();
  const settingsRef = doc(db, 'settings', 'default');
  try {
    const snap = await getDoc(settingsRef);
    if (!snap.exists()) {
      await setDoc(settingsRef, {
        businessName: 'EMG WEB SOLUTIONS',
        logoUrl: '',
        businessEmail: '',
        businessPhone: '',
        businessAddress: '',
        currency: 'KES',
        defaultGracePeriodDays: 7,
        invoicePrefix: 'EMG-INV',
        nextInvoiceSequence: 1001,
        paymentInstructions: '',
        packages: DEFAULT_PACKAGES,
        notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/default');
  }
}

// ---------------------------------------------------------
// Clients
// ---------------------------------------------------------
export interface ClientInput {
  businessName: string;
  contactName: string;
  phone: string;
  email?: string;
  category: string;
  location: string;
  domainName?: string;
  websiteUrl?: string;
  packageId: string;
  monthlyAmount: number;
  status: ClientStatus;
  registeredAt: string;
  sourceLeadId?: string;
  notes?: string;
}

export async function createClient(input: ClientInput): Promise<string> {
  const { uid } = requireAdminAuth();
  const clientRef = doc(collection(db, 'clients'));
  const clientCode = generateRecordCode('CL');

  try {
    const batch = writeBatch(db);
    batch.set(clientRef, {
      clientCode,
      businessName: clampString(input.businessName, FIELD_LIMITS.businessNameMax),
      contactName: clampString(input.contactName, FIELD_LIMITS.contactNameMax),
      phone: clampString(input.phone, FIELD_LIMITS.phoneMax),
      email: clampString(input.email, FIELD_LIMITS.emailMax),
      category: clampString(input.category, FIELD_LIMITS.categoryMax),
      location: clampString(input.location, FIELD_LIMITS.locationMax),
      domainName: clampString(input.domainName, FIELD_LIMITS.domainMax),
      websiteUrl: clampString(input.websiteUrl, FIELD_LIMITS.urlMax),
      packageId: clampString(input.packageId, 64),
      monthlyAmount: Math.max(0, Number(input.monthlyAmount) || 0),
      status: input.status,
      archived: false,
      registeredAt: input.registeredAt || todayIso(),
      sourceLeadId: clampString(input.sourceLeadId, 128),
      notes: clampString(input.notes, FIELD_LIMITS.notesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    addActivityToBatch(
      batch,
      'CLIENT_CREATED',
      'client',
      clientRef.id,
      `Created client ${input.businessName} (${clientCode})`
    );
    await batch.commit();
    return clientRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `clients/${clientRef.id}`);
  }
}

export async function updateClient(clientId: string, input: Partial<ClientInput> & { archived?: boolean }): Promise<void> {
  requireAdminAuth();
  const clientRef = doc(db, 'clients', clientId);

  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (input.businessName !== undefined) payload.businessName = clampString(input.businessName, FIELD_LIMITS.businessNameMax);
    if (input.contactName !== undefined) payload.contactName = clampString(input.contactName, FIELD_LIMITS.contactNameMax);
    if (input.phone !== undefined) payload.phone = clampString(input.phone, FIELD_LIMITS.phoneMax);
    if (input.email !== undefined) payload.email = clampString(input.email, FIELD_LIMITS.emailMax);
    if (input.category !== undefined) payload.category = clampString(input.category, FIELD_LIMITS.categoryMax);
    if (input.location !== undefined) payload.location = clampString(input.location, FIELD_LIMITS.locationMax);
    if (input.domainName !== undefined) payload.domainName = clampString(input.domainName, FIELD_LIMITS.domainMax);
    if (input.websiteUrl !== undefined) payload.websiteUrl = clampString(input.websiteUrl, FIELD_LIMITS.urlMax);
    if (input.packageId !== undefined) payload.packageId = clampString(input.packageId, 64);
    if (input.monthlyAmount !== undefined) payload.monthlyAmount = Math.max(0, Number(input.monthlyAmount) || 0);
    if (input.status !== undefined) payload.status = input.status;
    if (input.archived !== undefined) payload.archived = input.archived;
    if (input.registeredAt !== undefined) payload.registeredAt = input.registeredAt;
    if (input.notes !== undefined) payload.notes = clampString(input.notes, FIELD_LIMITS.notesMax);

    batch.update(clientRef, payload);
    addActivityToBatch(
      batch,
      input.archived ? 'CLIENT_ARCHIVED' : 'CLIENT_UPDATED',
      'client',
      clientId,
      input.archived
        ? `Archived client ${input.businessName || clientId} (financial history retained)`
        : `Updated client ${input.businessName || clientId}`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
  }
}

export async function archiveClient(client: Client): Promise<void> {
  await updateClient(client.id, {
    businessName: client.businessName,
    archived: true,
    status: client.status === 'Cancelled' ? 'Cancelled' : 'Inactive',
  });
}

// ---------------------------------------------------------
// Websites
// ---------------------------------------------------------
export interface WebsiteInput {
  clientId: string;
  businessName: string;
  websiteName: string;
  domain?: string;
  liveUrl?: string;
  hostingProvider: string;
  deploymentStatus: WebsiteDeploymentStatus;
  renewalDate?: string;
  deploymentIntegrationStatus?: 'none' | 'healthy' | 'failed';
  deploymentErrorMessage?: string;
  technicalNotes?: string;
}

export async function createWebsite(input: WebsiteInput): Promise<string> {
  const { uid } = requireAdminAuth();
  const webRef = doc(collection(db, 'websites'));
  const websiteCode = generateRecordCode('WEB');

  try {
    const batch = writeBatch(db);
    batch.set(webRef, {
      websiteCode,
      clientId: input.clientId,
      businessName: clampString(input.businessName, FIELD_LIMITS.businessNameMax),
      websiteName: clampString(input.websiteName, FIELD_LIMITS.businessNameMax),
      domain: clampString(input.domain, FIELD_LIMITS.domainMax),
      liveUrl: clampString(input.liveUrl, FIELD_LIMITS.urlMax),
      hostingProvider: clampString(input.hostingProvider, FIELD_LIMITS.locationMax),
      deploymentStatus: input.deploymentStatus,
      renewalDate: clampString(input.renewalDate, 32),
      deploymentIntegrationStatus: input.deploymentIntegrationStatus || 'none',
      deploymentErrorMessage: clampString(input.deploymentErrorMessage, 500),
      technicalNotes: clampString(input.technicalNotes, FIELD_LIMITS.notesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    addActivityToBatch(
      batch,
      'WEBSITE_ADDED',
      'website',
      webRef.id,
      `Added website ${input.websiteName} (${websiteCode}) for ${input.businessName}`
    );
    await batch.commit();
    return webRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `websites/${webRef.id}`);
  }
}

export async function updateWebsite(websiteId: string, input: Partial<WebsiteInput>): Promise<void> {
  requireAdminAuth();
  const webRef = doc(db, 'websites', websiteId);

  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (input.clientId !== undefined) payload.clientId = input.clientId;
    if (input.businessName !== undefined) payload.businessName = clampString(input.businessName, FIELD_LIMITS.businessNameMax);
    if (input.websiteName !== undefined) payload.websiteName = clampString(input.websiteName, FIELD_LIMITS.businessNameMax);
    if (input.domain !== undefined) payload.domain = clampString(input.domain, FIELD_LIMITS.domainMax);
    if (input.liveUrl !== undefined) payload.liveUrl = clampString(input.liveUrl, FIELD_LIMITS.urlMax);
    if (input.hostingProvider !== undefined) payload.hostingProvider = clampString(input.hostingProvider, FIELD_LIMITS.locationMax);
    if (input.deploymentStatus !== undefined) payload.deploymentStatus = input.deploymentStatus;
    if (input.renewalDate !== undefined) payload.renewalDate = clampString(input.renewalDate, 32);
    if (input.deploymentIntegrationStatus !== undefined) payload.deploymentIntegrationStatus = input.deploymentIntegrationStatus;
    if (input.deploymentErrorMessage !== undefined) payload.deploymentErrorMessage = clampString(input.deploymentErrorMessage, 500);
    if (input.technicalNotes !== undefined) payload.technicalNotes = clampString(input.technicalNotes, FIELD_LIMITS.notesMax);

    batch.update(webRef, payload);
    addActivityToBatch(
      batch,
      'WEBSITE_UPDATED',
      'website',
      websiteId,
      `Updated website ${input.websiteName || websiteId} (${input.deploymentStatus || 'status updated'})`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `websites/${websiteId}`);
  }
}

// ---------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------
export interface SubscriptionInput {
  clientId: string;
  clientName: string;
  packageName: string;
  monthlyAmount: number;
  startDate: string;
  nextPaymentDate: string;
  lastPaymentDate?: string;
  status: SubscriptionStatus;
  gracePeriodDays: number;
  notes?: string;
}

export async function createSubscription(input: SubscriptionInput): Promise<string> {
  const { uid } = requireAdminAuth();
  const subRef = doc(collection(db, 'subscriptions'));
  const subscriptionCode = generateRecordCode('SUB');
  const graceDays = Math.max(0, Math.min(90, Math.round(Number(input.gracePeriodDays) || 0)));
  const gracePeriodEndDate = addDaysIso(input.nextPaymentDate, graceDays);

  try {
    const batch = writeBatch(db);
    batch.set(subRef, {
      subscriptionCode,
      clientId: input.clientId,
      clientName: clampString(input.clientName, FIELD_LIMITS.businessNameMax),
      packageName: clampString(input.packageName, 80),
      monthlyAmount: Math.max(0, Number(input.monthlyAmount) || 0),
      startDate: input.startDate,
      nextPaymentDate: input.nextPaymentDate,
      lastPaymentDate: clampString(input.lastPaymentDate, 32),
      status: input.status,
      gracePeriodDays: graceDays,
      gracePeriodEndDate,
      cancelledAt: input.status === 'Cancelled' ? todayIso() : '',
      notes: clampString(input.notes, FIELD_LIMITS.notesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    addActivityToBatch(
      batch,
      'SUBSCRIPTION_CREATED',
      'subscription',
      subRef.id,
      `Created ${input.packageName} subscription (${subscriptionCode}) for ${input.clientName}`
    );
    await batch.commit();
    return subRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `subscriptions/${subRef.id}`);
  }
}

export async function updateSubscription(
  subId: string,
  input: Partial<SubscriptionInput> & { cancelledAt?: string }
): Promise<void> {
  requireAdminAuth();
  const subRef = doc(db, 'subscriptions', subId);

  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (input.clientName !== undefined) payload.clientName = clampString(input.clientName, FIELD_LIMITS.businessNameMax);
    if (input.packageName !== undefined) payload.packageName = clampString(input.packageName, 80);
    if (input.monthlyAmount !== undefined) payload.monthlyAmount = Math.max(0, Number(input.monthlyAmount) || 0);
    if (input.startDate !== undefined) payload.startDate = input.startDate;
    if (input.nextPaymentDate !== undefined) payload.nextPaymentDate = input.nextPaymentDate;
    if (input.lastPaymentDate !== undefined) payload.lastPaymentDate = clampString(input.lastPaymentDate, 32);
    if (input.status !== undefined) payload.status = input.status;

    if (input.gracePeriodDays !== undefined || input.nextPaymentDate !== undefined) {
      let effectiveNextDate = input.nextPaymentDate;
      let effectiveGraceDays = input.gracePeriodDays;
      if (effectiveNextDate === undefined || effectiveGraceDays === undefined) {
        const existingSnap = await getDoc(subRef);
        if (existingSnap.exists()) {
          const existingData = existingSnap.data() as Subscription;
          effectiveNextDate = effectiveNextDate ?? existingData.nextPaymentDate;
          effectiveGraceDays = effectiveGraceDays ?? existingData.gracePeriodDays;
        }
      }
      const gd = Math.max(0, Math.min(90, Math.round(Number(effectiveGraceDays) || 0)));
      if (input.gracePeriodDays !== undefined) {
        payload.gracePeriodDays = gd;
      }
      if (effectiveNextDate) {
        payload.gracePeriodEndDate = addDaysIso(effectiveNextDate, gd);
      }
    }

    if (input.cancelledAt !== undefined) payload.cancelledAt = input.cancelledAt;
    if (input.notes !== undefined) payload.notes = clampString(input.notes, FIELD_LIMITS.notesMax);

    batch.update(subRef, payload);
    addActivityToBatch(
      batch,
      input.status === 'Cancelled' ? 'SUBSCRIPTION_CANCELLED' : 'SUBSCRIPTION_UPDATED',
      'subscription',
      subId,
      `Updated subscription ${subId}${input.status ? ` -> ${input.status}` : ''}`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `subscriptions/${subId}`);
  }
}

// ---------------------------------------------------------
// Payments (Manual Recording + Duplicate Reference Guard)
// ---------------------------------------------------------
export interface PaymentInput {
  clientId: string;
  clientName: string;
  subscriptionId?: string;
  invoiceId?: string;
  amount: number;
  method: PaymentMethod;
  transactionReference: string;
  paymentDate: string;
  status: PaymentStatus;
  notes?: string;
}

export async function recordManualPayment(
  input: PaymentInput,
  linkedSubscription?: Subscription,
  linkedInvoice?: Invoice
): Promise<string> {
  const { uid } = requireAdminAuth();
  const normalizedRef = normalizeTransactionRef(input.transactionReference);
  if (normalizedRef.length < 2) {
    throw new Error('Transaction reference must contain at least 2 alphanumeric characters.');
  }

  const refGuardRef = doc(db, 'payment_references', normalizedRef);
  try {
    const existingRefSnap = await getDoc(refGuardRef);
    if (existingRefSnap.exists()) {
      throw new Error(
        `Duplicate transaction reference "${input.transactionReference}". Reference ${normalizedRef} has already been recorded.`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Duplicate transaction reference')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `payment_references/${normalizedRef}`);
  }

  const paymentRef = doc(collection(db, 'payments'));
  const paymentCode = generateRecordCode('PAY');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(paymentRef, {
      paymentCode,
      clientId: input.clientId,
      clientName: clampString(input.clientName, FIELD_LIMITS.businessNameMax),
      subscriptionId: clampString(input.subscriptionId, 128),
      invoiceId: clampString(input.invoiceId, 128),
      amount,
      method: input.method,
      transactionReference: clampString(input.transactionReference, FIELD_LIMITS.txRefMax),
      normalizedReference: normalizedRef,
      paymentDate: input.paymentDate || todayIso(),
      status: input.status,
      verificationSource: 'manual_admin',
      notes: clampString(input.notes, FIELD_LIMITS.paymentNotesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(refGuardRef, {
      paymentId: paymentRef.id,
      transactionReference: clampString(input.transactionReference, FIELD_LIMITS.txRefMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
    });

    // If paid and linked to a subscription, advance renewal window cleanly
    if (input.status === 'Paid' && linkedSubscription) {
      const baseDate =
        linkedSubscription.nextPaymentDate > input.paymentDate
          ? linkedSubscription.nextPaymentDate
          : input.paymentDate;
      const nextDue = addMonthsIso(baseDate, 1);
      const graceEnd = addDaysIso(nextDue, linkedSubscription.gracePeriodDays);

      batch.update(doc(db, 'subscriptions', linkedSubscription.id), {
        lastPaymentDate: input.paymentDate,
        nextPaymentDate: nextDue,
        gracePeriodEndDate: graceEnd,
        status: 'Active',
        updatedAt: serverTimestamp(),
      });
    }

    // If paid and linked to an invoice, mark invoice Paid
    if (input.status === 'Paid' && linkedInvoice && linkedInvoice.status !== 'Paid') {
      batch.update(doc(db, 'invoices', linkedInvoice.id), {
        status: 'Paid',
        updatedAt: serverTimestamp(),
      });
    }

    if (input.status === 'Paid') {
      const notifId = `pay_rec_${paymentRef.id}`;
      batch.set(doc(db, 'notifications', notifId), {
        dedupeKey: notifId,
        eventType: 'PAYMENT_RECORDED',
        category: 'payments',
        priority: 'Info',
        title: `Payment recorded: ${input.clientName}`,
        message: `${input.method} payment of KES ${amount.toLocaleString()} (Ref: ${input.transactionReference}) recorded successfully.`,
        read: false,
        readAt: '',
        entityType: 'payment',
        recordId: paymentRef.id,
        clientId: input.clientId,
        clientName: clampString(input.clientName, FIELD_LIMITS.businessNameMax),
        phone: '',
        amount,
        dueDate: input.paymentDate || todayIso(),
        targetSection: 'payments',
        pushDispatched: false,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    addActivityToBatch(
      batch,
      'PAYMENT_RECORDED',
      'payment',
      paymentRef.id,
      `Recorded ${input.method} payment ${paymentCode} (Ref: ${input.transactionReference}) of KES ${amount.toLocaleString()} for ${input.clientName}`
    );

    await batch.commit();
    return paymentRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `payments/${paymentRef.id}`);
  }
}

export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  notes?: string,
  linkedSubscription?: Subscription,
  linkedInvoice?: Invoice
): Promise<void> {
  const { uid } = requireAdminAuth();
  const paymentRef = doc(db, 'payments', paymentId);
  try {
    const existingSnap = await getDoc(paymentRef);
    const existingPayment = existingSnap.exists() ? existingSnap.data() : null;
    const transitioningToPaid =
      status === 'Paid' && (!existingPayment || existingPayment.status !== 'Paid');

    let notifAlreadyExists = false;
    const notifId = `pay_rec_${paymentId}`;
    if (transitioningToPaid) {
      const notifSnap = await getDoc(doc(db, 'notifications', notifId));
      notifAlreadyExists = notifSnap.exists();
    }

    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (notes !== undefined) {
      payload.notes = clampString(notes, FIELD_LIMITS.paymentNotesMax);
    }
    batch.update(paymentRef, payload);

    if (transitioningToPaid && existingPayment) {
      const payDate = String(existingPayment.paymentDate || todayIso());
      if (linkedSubscription) {
        const baseDate =
          linkedSubscription.nextPaymentDate > payDate
            ? linkedSubscription.nextPaymentDate
            : payDate;
        const nextDue = addMonthsIso(baseDate, 1);
        const graceEnd = addDaysIso(nextDue, linkedSubscription.gracePeriodDays);
        batch.update(doc(db, 'subscriptions', linkedSubscription.id), {
          lastPaymentDate: payDate,
          nextPaymentDate: nextDue,
          gracePeriodEndDate: graceEnd,
          status: 'Active',
          updatedAt: serverTimestamp(),
        });
      }

      if (linkedInvoice && linkedInvoice.status !== 'Paid') {
        batch.update(doc(db, 'invoices', linkedInvoice.id), {
          status: 'Paid',
          updatedAt: serverTimestamp(),
        });
      }

      if (!notifAlreadyExists) {
        const amount = Number(existingPayment.amount) || 0;
        const clientName = String(existingPayment.clientName || 'Client');
        const method = String(existingPayment.method || 'Payment');
        const txRef = String(existingPayment.transactionReference || paymentId);
        batch.set(doc(db, 'notifications', notifId), {
          dedupeKey: notifId,
          eventType: 'PAYMENT_RECORDED',
          category: 'payments',
          priority: 'Info',
          title: `Payment verified: ${clientName}`,
          message: `${method} payment of KES ${amount.toLocaleString()} (Ref: ${txRef}) verified as Paid.`,
          read: false,
          readAt: '',
          entityType: 'payment',
          recordId: paymentId,
          clientId: String(existingPayment.clientId || ''),
          clientName: clampString(clientName, FIELD_LIMITS.businessNameMax),
          phone: '',
          amount,
          dueDate: payDate,
          targetSection: 'payments',
          pushDispatched: false,
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    addActivityToBatch(
      batch,
      'PAYMENT_STATUS_UPDATED',
      'payment',
      paymentId,
      `Updated payment ${paymentId} status to ${status}`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `payments/${paymentId}`);
  }
}

// ---------------------------------------------------------
// Invoices
// ---------------------------------------------------------
export interface InvoiceInput {
  invoiceNumber?: string;
  clientId: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  clientLocation?: string;
  subscriptionId?: string;
  description: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  paymentInstructions?: string;
  notes?: string;
}

export async function createInvoice(input: InvoiceInput, settings: BusinessSettings): Promise<string> {
  const { uid } = requireAdminAuth();
  const invRef = doc(collection(db, 'invoices'));
  const seq = settings.nextInvoiceSequence || 1001;
  const prefix = (settings.invoicePrefix || 'EMG-INV').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const invoiceNumber =
    (input.invoiceNumber || `${prefix}-${seq}`).toUpperCase().replace(/[^A-Z0-9-]/g, '');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invoice amount must be greater than zero.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(invRef, {
      invoiceNumber,
      clientId: input.clientId,
      clientName: clampString(input.clientName, FIELD_LIMITS.businessNameMax),
      clientEmail: clampString(input.clientEmail, FIELD_LIMITS.emailMax),
      clientPhone: clampString(input.clientPhone, FIELD_LIMITS.phoneMax),
      clientLocation: clampString(input.clientLocation, FIELD_LIMITS.locationMax),
      subscriptionId: clampString(input.subscriptionId, 128),
      description: clampString(input.description, FIELD_LIMITS.invoiceDescMax),
      amount,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      paymentInstructions: clampString(
        input.paymentInstructions ?? settings.paymentInstructions,
        FIELD_LIMITS.paymentNotesMax
      ),
      notes: clampString(input.notes, FIELD_LIMITS.paymentNotesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Advance invoice sequence in settings
    batch.update(doc(db, 'settings', 'default'), {
      nextInvoiceSequence: seq + 1,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });

    addActivityToBatch(
      batch,
      'INVOICE_GENERATED',
      'invoice',
      invRef.id,
      `Generated invoice ${invoiceNumber} for ${input.clientName} (KES ${amount.toLocaleString()})`
    );

    await batch.commit();
    return invRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `invoices/${invRef.id}`);
  }
}

export async function updateInvoice(invoiceId: string, input: Partial<InvoiceInput>): Promise<void> {
  requireAdminAuth();
  const invRef = doc(db, 'invoices', invoiceId);
  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (input.description !== undefined) payload.description = clampString(input.description, FIELD_LIMITS.invoiceDescMax);
    if (input.amount !== undefined) payload.amount = Math.max(1, Number(input.amount) || 1);
    if (input.issueDate !== undefined) payload.issueDate = input.issueDate;
    if (input.dueDate !== undefined) payload.dueDate = input.dueDate;
    if (input.status !== undefined) payload.status = input.status;
    if (input.paymentInstructions !== undefined) payload.paymentInstructions = clampString(input.paymentInstructions, FIELD_LIMITS.paymentNotesMax);
    if (input.notes !== undefined) payload.notes = clampString(input.notes, FIELD_LIMITS.paymentNotesMax);

    batch.update(invRef, payload);
    addActivityToBatch(
      batch,
      'INVOICE_UPDATED',
      'invoice',
      invoiceId,
      `Updated invoice ${invoiceId}${input.status ? ` -> ${input.status}` : ''}`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `invoices/${invoiceId}`);
  }
}

// ---------------------------------------------------------
// Leads (CRM)
// ---------------------------------------------------------
export interface LeadInput {
  businessName: string;
  category: string;
  contactPerson: string;
  phone: string;
  location: string;
  socialLink?: string;
  existingWebsite?: string;
  previewUrl?: string;
  contactChannel: LeadChannel;
  dateContacted: string;
  interestLevel: LeadInterest;
  estimatedBudget: number;
  followUpDate?: string;
  status: LeadStatus;
  notes?: string;
}

export async function createLead(input: LeadInput): Promise<string> {
  const { uid } = requireAdminAuth();
  const leadRef = doc(collection(db, 'leads'));
  const leadCode = generateRecordCode('LD');

  try {
    const batch = writeBatch(db);
    batch.set(leadRef, {
      leadCode,
      businessName: clampString(input.businessName, FIELD_LIMITS.businessNameMax),
      category: clampString(input.category, FIELD_LIMITS.categoryMax),
      contactPerson: clampString(input.contactPerson, FIELD_LIMITS.contactNameMax),
      phone: clampString(input.phone, FIELD_LIMITS.phoneMax),
      location: clampString(input.location, FIELD_LIMITS.locationMax),
      socialLink: clampString(input.socialLink, FIELD_LIMITS.urlMax),
      existingWebsite: clampString(input.existingWebsite, FIELD_LIMITS.urlMax),
      previewUrl: clampString(input.previewUrl, FIELD_LIMITS.urlMax),
      contactChannel: input.contactChannel,
      dateContacted: input.dateContacted || todayIso(),
      interestLevel: input.interestLevel,
      estimatedBudget: Math.max(0, Number(input.estimatedBudget) || 0),
      followUpDate: clampString(input.followUpDate, 32),
      status: input.status,
      convertedClientId: '',
      notes: clampString(input.notes, FIELD_LIMITS.notesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    addActivityToBatch(
      batch,
      'LEAD_CREATED',
      'lead',
      leadRef.id,
      `Added lead ${input.businessName} (${leadCode}) via ${input.contactChannel}`
    );
    await batch.commit();
    return leadRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `leads/${leadRef.id}`);
  }
}

export async function updateLead(leadId: string, input: Partial<LeadInput>): Promise<void> {
  requireAdminAuth();
  const leadRef = doc(db, 'leads', leadId);
  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (input.businessName !== undefined) payload.businessName = clampString(input.businessName, FIELD_LIMITS.businessNameMax);
    if (input.category !== undefined) payload.category = clampString(input.category, FIELD_LIMITS.categoryMax);
    if (input.contactPerson !== undefined) payload.contactPerson = clampString(input.contactPerson, FIELD_LIMITS.contactNameMax);
    if (input.phone !== undefined) payload.phone = clampString(input.phone, FIELD_LIMITS.phoneMax);
    if (input.location !== undefined) payload.location = clampString(input.location, FIELD_LIMITS.locationMax);
    if (input.socialLink !== undefined) payload.socialLink = clampString(input.socialLink, FIELD_LIMITS.urlMax);
    if (input.existingWebsite !== undefined) payload.existingWebsite = clampString(input.existingWebsite, FIELD_LIMITS.urlMax);
    if (input.previewUrl !== undefined) payload.previewUrl = clampString(input.previewUrl, FIELD_LIMITS.urlMax);
    if (input.contactChannel !== undefined) payload.contactChannel = input.contactChannel;
    if (input.dateContacted !== undefined) payload.dateContacted = input.dateContacted;
    if (input.interestLevel !== undefined) payload.interestLevel = input.interestLevel;
    if (input.estimatedBudget !== undefined) payload.estimatedBudget = Math.max(0, Number(input.estimatedBudget) || 0);
    if (input.followUpDate !== undefined) payload.followUpDate = clampString(input.followUpDate, 32);
    if (input.status !== undefined) payload.status = input.status;
    if (input.notes !== undefined) payload.notes = clampString(input.notes, FIELD_LIMITS.notesMax);

    batch.update(leadRef, payload);
    addActivityToBatch(
      batch,
      'LEAD_UPDATED',
      'lead',
      leadId,
      `Updated lead ${input.businessName || leadId}${input.status ? ` -> ${input.status}` : ''}`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `leads/${leadId}`);
  }
}

export interface ConvertLeadOptions {
  packageId: string;
  packageName: string;
  monthlyAmount: number;
  email?: string;
  domainName?: string;
  websiteUrl?: string;
  createWebsite: boolean;
  hostingProvider: string;
  createSubscription: boolean;
  gracePeriodDays: number;
}

export async function convertLeadToClient(lead: Lead, opts: ConvertLeadOptions): Promise<string> {
  const { uid } = requireAdminAuth();
  if (lead.status === 'Converted' && lead.convertedClientId) {
    throw new Error('This lead has already been converted to a client.');
  }

  const clientRef = doc(collection(db, 'clients'));
  const clientCode = generateRecordCode('CL');
  const today = todayIso();

  try {
    const batch = writeBatch(db);

    batch.set(clientRef, {
      clientCode,
      businessName: clampString(lead.businessName, FIELD_LIMITS.businessNameMax),
      contactName: clampString(lead.contactPerson, FIELD_LIMITS.contactNameMax),
      phone: clampString(lead.phone, FIELD_LIMITS.phoneMax),
      email: clampString(opts.email, FIELD_LIMITS.emailMax),
      category: clampString(lead.category, FIELD_LIMITS.categoryMax),
      location: clampString(lead.location, FIELD_LIMITS.locationMax),
      domainName: clampString(opts.domainName, FIELD_LIMITS.domainMax),
      websiteUrl: clampString(opts.websiteUrl || lead.previewUrl || lead.existingWebsite, FIELD_LIMITS.urlMax),
      packageId: clampString(opts.packageId, 64),
      monthlyAmount: Math.max(0, Number(opts.monthlyAmount) || 0),
      status: 'Active',
      archived: false,
      registeredAt: today,
      sourceLeadId: lead.id,
      notes: clampString(lead.notes, FIELD_LIMITS.notesMax),
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'leads', lead.id), {
      status: 'Converted',
      convertedClientId: clientRef.id,
      updatedAt: serverTimestamp(),
    });

    if (opts.createWebsite) {
      const webRef = doc(collection(db, 'websites'));
      batch.set(webRef, {
        websiteCode: generateRecordCode('WEB'),
        clientId: clientRef.id,
        businessName: clampString(lead.businessName, FIELD_LIMITS.businessNameMax),
        websiteName: clampString(`${lead.businessName} Website`, FIELD_LIMITS.businessNameMax),
        domain: clampString(opts.domainName, FIELD_LIMITS.domainMax),
        liveUrl: clampString(opts.websiteUrl || lead.previewUrl, FIELD_LIMITS.urlMax),
        hostingProvider: clampString(opts.hostingProvider || 'Vercel', FIELD_LIMITS.locationMax),
        deploymentStatus: opts.websiteUrl ? 'Live' : lead.previewUrl ? 'Preview' : 'In Development',
        renewalDate: addMonthsIso(today, 1),
        technicalNotes: `Converted from CRM lead ${lead.leadCode}`,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (opts.createSubscription) {
      const subRef = doc(collection(db, 'subscriptions'));
      const nextDue = addMonthsIso(today, 1);
      const graceDays = Math.max(0, Math.min(90, Math.round(opts.gracePeriodDays || 7)));
      batch.set(subRef, {
        subscriptionCode: generateRecordCode('SUB'),
        clientId: clientRef.id,
        clientName: clampString(lead.businessName, FIELD_LIMITS.businessNameMax),
        packageName: clampString(opts.packageName, 80),
        monthlyAmount: Math.max(0, Number(opts.monthlyAmount) || 0),
        startDate: today,
        nextPaymentDate: nextDue,
        lastPaymentDate: '',
        status: 'Pending',
        gracePeriodDays: graceDays,
        gracePeriodEndDate: addDaysIso(nextDue, graceDays),
        cancelledAt: '',
        notes: `Initial subscription created upon converting lead ${lead.leadCode}`,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    addActivityToBatch(
      batch,
      'LEAD_CONVERTED',
      'lead',
      lead.id,
      `Converted lead ${lead.businessName} (${lead.leadCode}) to client ${clientCode}`
    );

    await batch.commit();
    return clientRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `leads/${lead.id}`);
  }
}

// ---------------------------------------------------------
// Settings & Admin Management
// ---------------------------------------------------------
function sanitizeNotificationPreferences(
  prefs?: NotificationPreferences
): NotificationPreferences {
  const base = prefs || DEFAULT_NOTIFICATION_PREFERENCES;
  const graceDays = Array.isArray(base.graceReminderDays)
    ? Array.from(
        new Set(
          base.graceReminderDays
            .map((d) => Math.max(0, Math.min(90, Math.round(Number(d) || 0))))
            .filter((d) => d > 0)
        )
      ).sort((a, b) => b - a)
    : [7, 3, 1];

  return {
    enabledCategories: {
      subscriptions: base.enabledCategories?.subscriptions ?? true,
      payments: base.enabledCategories?.payments ?? true,
      leads: base.enabledCategories?.leads ?? true,
      websites: base.enabledCategories?.websites ?? true,
    },
    graceReminderDays: graceDays.length > 0 ? graceDays : [7, 3, 1],
    renewalReminderDays: Math.max(1, Math.min(90, Math.round(Number(base.renewalReminderDays) || 14))),
    websiteRenewalReminderDays: Math.max(1, Math.min(90, Math.round(Number(base.websiteRenewalReminderDays) || 14))),
    demoFeedbackReminderDays: Math.max(1, Math.min(60, Math.round(Number(base.demoFeedbackReminderDays) || 2))),
    leadFollowUpEnabled: base.leadFollowUpEnabled ?? true,
    websiteAlertsEnabled: base.websiteAlertsEnabled ?? true,
    pushNotificationsEnabled: base.pushNotificationsEnabled ?? true,
    pushPriorities:
      Array.isArray(base.pushPriorities) && base.pushPriorities.length > 0
        ? base.pushPriorities.filter(
            (p): p is 'Critical' | 'Warning' | 'Info' =>
              p === 'Critical' || p === 'Warning' || p === 'Info'
          )
        : ['Critical', 'Warning'],
    vapidPublicKey: clampString(base.vapidPublicKey, 240),
  };
}

export async function saveBusinessSettings(
  input: Omit<BusinessSettings, 'id' | 'updatedBy' | 'updatedAt'>
): Promise<void> {
  const { uid } = requireAdminAuth();
  const settingsRef = doc(db, 'settings', 'default');

  if (!input.packages || input.packages.length === 0) {
    throw new Error('At least one subscription package must be defined.');
  }

  try {
    const batch = writeBatch(db);
    batch.set(settingsRef, {
      businessName: clampString(input.businessName || 'EMG WEB SOLUTIONS', FIELD_LIMITS.businessNameMax),
      logoUrl: clampString(input.logoUrl, 500),
      businessEmail: clampString(input.businessEmail, FIELD_LIMITS.emailMax),
      businessPhone: clampString(input.businessPhone, 60),
      businessAddress: clampString(input.businessAddress, 300),
      currency: clampString(input.currency || 'KES', 8),
      defaultGracePeriodDays: Math.max(0, Math.min(90, Math.round(Number(input.defaultGracePeriodDays) || 0))),
      invoicePrefix: clampString(input.invoicePrefix || 'EMG-INV', 16),
      nextInvoiceSequence: Math.max(1, Math.round(Number(input.nextInvoiceSequence) || 1001)),
      paymentInstructions: clampString(input.paymentInstructions, FIELD_LIMITS.paymentNotesMax),
      packages: input.packages.slice(0, 20).map((pkg) => ({
        id: clampString(pkg.id, 64),
        name: clampString(pkg.name, 80),
        monthlyPrice: Math.max(0, Number(pkg.monthlyPrice) || 0),
        description: clampString(pkg.description, 300),
      })),
      notificationPreferences: sanitizeNotificationPreferences(input.notificationPreferences),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    addActivityToBatch(batch, 'SETTINGS_UPDATED', 'settings', 'default', 'Updated EMG Web Solutions business & notification settings');
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/default');
  }
}

export async function saveAdminProfile(adminData: {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  phone?: string;
}): Promise<void> {
  requireAdminAuth();
  const targetRef = doc(db, 'admins', adminData.uid);
  try {
    const existingSnap = await getDoc(targetRef);
    const batch = writeBatch(db);
    if (existingSnap.exists()) {
      batch.update(targetRef, {
        email: clampString(adminData.email, FIELD_LIMITS.emailMax),
        displayName: clampString(adminData.displayName, FIELD_LIMITS.contactNameMax),
        role: adminData.role,
        active: adminData.active,
        phone: clampString(adminData.phone, FIELD_LIMITS.phoneMax),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(targetRef, {
        uid: adminData.uid,
        email: clampString(adminData.email, FIELD_LIMITS.emailMax),
        displayName: clampString(adminData.displayName, FIELD_LIMITS.contactNameMax),
        role: adminData.role,
        active: adminData.active,
        phone: clampString(adminData.phone, FIELD_LIMITS.phoneMax),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    addActivityToBatch(
      batch,
      existingSnap.exists() ? 'ADMIN_UPDATED' : 'ADMIN_ADDED',
      'admin',
      adminData.uid,
      `${existingSnap.exists() ? 'Updated' : 'Added'} administrator ${adminData.email}`
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `admins/${adminData.uid}`);
  }
}

// ---------------------------------------------------------
// Permanent Deletion & Test Data Cleanup (Super Admin Only)
// ---------------------------------------------------------
async function commitDeleteRefsInChunks(
  refs: DocumentReference[],
  auditLog?: {
    actionType: string;
    entityType: ActivityEntityType;
    recordId: string;
    summary: string;
  }
): Promise<number> {
  requireAdminAuth();
  const uniqueRefs = Array.from(new Map(refs.map((r) => [r.path, r])).values());
  if (uniqueRefs.length === 0 && !auditLog) return 0;

  const CHUNK_SIZE = 400;
  for (let i = 0; i < uniqueRefs.length; i += CHUNK_SIZE) {
    const chunk = uniqueRefs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const ref of chunk) {
      batch.delete(ref);
    }
    const isLast = i + CHUNK_SIZE >= uniqueRefs.length;
    if (isLast && auditLog) {
      addActivityToBatch(
        batch,
        auditLog.actionType,
        auditLog.entityType,
        auditLog.recordId,
        auditLog.summary
      );
    }
    await batch.commit();
  }

  if (uniqueRefs.length === 0 && auditLog) {
    const batch = writeBatch(db);
    addActivityToBatch(
      batch,
      auditLog.actionType,
      auditLog.entityType,
      auditLog.recordId,
      auditLog.summary
    );
    await batch.commit();
  }

  return uniqueRefs.length;
}

export async function permanentlyDeleteClientCascade(
  client: Client,
  options?: { deleteRelatedLogs?: boolean; deleteSourceLead?: boolean }
): Promise<{ deletedCount: number; breakdown: Record<string, number> }> {
  requireAdminAuth();
  const deleteLogs = options?.deleteRelatedLogs ?? true;
  const deleteLead = options?.deleteSourceLead ?? true;

  try {
    const [webSnap, subSnap, invSnap, paySnap, notifClientSnap, leadSnap] = await Promise.all([
      getDocs(query(collection(db, 'websites'), where('clientId', '==', client.id))),
      getDocs(query(collection(db, 'subscriptions'), where('clientId', '==', client.id))),
      getDocs(query(collection(db, 'invoices'), where('clientId', '==', client.id))),
      getDocs(query(collection(db, 'payments'), where('clientId', '==', client.id))),
      getDocs(query(collection(db, 'notifications'), where('clientId', '==', client.id))),
      deleteLead
        ? getDocs(query(collection(db, 'leads'), where('convertedClientId', '==', client.id)))
        : Promise.resolve(null),
    ]);

    const refs: DocumentReference[] = [doc(db, 'clients', client.id)];
    const relatedIds = new Set<string>([client.id]);

    webSnap.docs.forEach((d) => {
      refs.push(d.ref);
      relatedIds.add(d.id);
    });
    subSnap.docs.forEach((d) => {
      refs.push(d.ref);
      relatedIds.add(d.id);
    });
    invSnap.docs.forEach((d) => {
      refs.push(d.ref);
      relatedIds.add(d.id);
    });
    let payRefCount = 0;
    paySnap.docs.forEach((d) => {
      refs.push(d.ref);
      relatedIds.add(d.id);
      const normRef = (d.data() as Partial<Payment>).normalizedReference;
      if (normRef && /^[a-zA-Z0-9_-]{1,128}$/.test(normRef)) {
        refs.push(doc(db, 'payment_references', normRef));
        payRefCount += 1;
      }
    });

    if (client.sourceLeadId && deleteLead) {
      relatedIds.add(client.sourceLeadId);
      refs.push(doc(db, 'leads', client.sourceLeadId));
    }
    let deletedLeadCount = 0;
    if (leadSnap) {
      leadSnap.docs.forEach((d) => {
        refs.push(d.ref);
        relatedIds.add(d.id);
        deletedLeadCount += 1;
      });
    }

    const notifIdsSeen = new Set<string>();
    notifClientSnap.docs.forEach((d) => {
      refs.push(d.ref);
      notifIdsSeen.add(d.id);
    });

    // Also catch notifications referencing any of the record IDs directly
    const allNotifsSnap = await getDocs(collection(db, 'notifications'));
    allNotifsSnap.docs.forEach((d) => {
      const data = d.data() as { recordId?: string; clientId?: string };
      if (
        !notifIdsSeen.has(d.id) &&
        ((data.recordId && relatedIds.has(data.recordId)) || data.clientId === client.id)
      ) {
        refs.push(d.ref);
        notifIdsSeen.add(d.id);
      }
    });

    let logsCount = 0;
    if (deleteLogs) {
      const logsSnap = await getDocs(collection(db, 'activity_logs'));
      const needleName = client.businessName.trim().toLowerCase();
      const needleCode = client.clientCode.trim().toLowerCase();
      logsSnap.docs.forEach((d) => {
        const data = d.data() as { recordId?: string; summary?: string };
        const summaryLower = (data.summary || '').toLowerCase();
        if (
          (data.recordId && relatedIds.has(data.recordId)) ||
          (needleName && summaryLower.includes(needleName)) ||
          (needleCode && summaryLower.includes(needleCode))
        ) {
          refs.push(d.ref);
          logsCount += 1;
        }
      });
    }

    const deletedCount = await commitDeleteRefsInChunks(
      refs,
      deleteLogs
        ? undefined
        : {
            actionType: 'CLIENT_DELETED_PERMANENTLY',
            entityType: 'client',
            recordId: client.id,
            summary: `Permanently deleted client ${client.businessName} (${client.clientCode}) and linked records`,
          }
    );

    return {
      deletedCount,
      breakdown: {
        clients: 1,
        websites: webSnap.size,
        subscriptions: subSnap.size,
        invoices: invSnap.size,
        payments: paySnap.size,
        paymentReferences: payRefCount,
        leads: deletedLeadCount + (client.sourceLeadId && deleteLead ? 1 : 0),
        notifications: notifIdsSeen.size,
        activityLogs: logsCount,
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `clients/${client.id}`);
  }
}

export async function permanentlyDeleteLead(
  lead: Lead,
  options?: { deleteRelatedLogs?: boolean }
): Promise<number> {
  requireAdminAuth();
  const deleteLogs = options?.deleteRelatedLogs ?? true;
  try {
    const refs: DocumentReference[] = [doc(db, 'leads', lead.id)];
    const notifsSnap = await getDocs(
      query(collection(db, 'notifications'), where('recordId', '==', lead.id))
    );
    notifsSnap.docs.forEach((d) => refs.push(d.ref));

    if (deleteLogs) {
      const logsSnap = await getDocs(
        query(collection(db, 'activity_logs'), where('recordId', '==', lead.id))
      );
      logsSnap.docs.forEach((d) => refs.push(d.ref));
    }

    return await commitDeleteRefsInChunks(
      refs,
      deleteLogs
        ? undefined
        : {
            actionType: 'LEAD_DELETED_PERMANENTLY',
            entityType: 'lead',
            recordId: lead.id,
            summary: `Permanently deleted lead ${lead.businessName} (${lead.leadCode})`,
          }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `leads/${lead.id}`);
  }
}

export async function permanentlyDeleteWebsite(website: Website): Promise<number> {
  requireAdminAuth();
  try {
    const refs: DocumentReference[] = [doc(db, 'websites', website.id)];
    const notifsSnap = await getDocs(
      query(collection(db, 'notifications'), where('recordId', '==', website.id))
    );
    notifsSnap.docs.forEach((d) => refs.push(d.ref));
    return await commitDeleteRefsInChunks(refs, {
      actionType: 'WEBSITE_DELETED_PERMANENTLY',
      entityType: 'website',
      recordId: website.id,
      summary: `Permanently deleted website ${website.websiteName} (${website.websiteCode})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `websites/${website.id}`);
  }
}

export async function permanentlyDeleteSubscription(sub: Subscription): Promise<number> {
  requireAdminAuth();
  try {
    const refs: DocumentReference[] = [doc(db, 'subscriptions', sub.id)];
    const notifsSnap = await getDocs(
      query(collection(db, 'notifications'), where('recordId', '==', sub.id))
    );
    notifsSnap.docs.forEach((d) => refs.push(d.ref));
    return await commitDeleteRefsInChunks(refs, {
      actionType: 'SUBSCRIPTION_DELETED_PERMANENTLY',
      entityType: 'subscription',
      recordId: sub.id,
      summary: `Permanently deleted subscription ${sub.subscriptionCode} for ${sub.clientName}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `subscriptions/${sub.id}`);
  }
}

export async function permanentlyDeleteInvoice(invoice: Invoice): Promise<number> {
  requireAdminAuth();
  try {
    const refs: DocumentReference[] = [doc(db, 'invoices', invoice.id)];
    const notifsSnap = await getDocs(
      query(collection(db, 'notifications'), where('recordId', '==', invoice.id))
    );
    notifsSnap.docs.forEach((d) => refs.push(d.ref));
    return await commitDeleteRefsInChunks(refs, {
      actionType: 'INVOICE_DELETED_PERMANENTLY',
      entityType: 'invoice',
      recordId: invoice.id,
      summary: `Permanently deleted invoice ${invoice.invoiceNumber} (${invoice.clientName})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `invoices/${invoice.id}`);
  }
}

export async function permanentlyDeletePayment(payment: Payment): Promise<number> {
  requireAdminAuth();
  try {
    const refs: DocumentReference[] = [doc(db, 'payments', payment.id)];
    if (payment.normalizedReference && /^[a-zA-Z0-9_-]{1,128}$/.test(payment.normalizedReference)) {
      refs.push(doc(db, 'payment_references', payment.normalizedReference));
    }
    const notifsSnap = await getDocs(
      query(collection(db, 'notifications'), where('recordId', '==', payment.id))
    );
    notifsSnap.docs.forEach((d) => refs.push(d.ref));
    return await commitDeleteRefsInChunks(refs, {
      actionType: 'PAYMENT_DELETED_PERMANENTLY',
      entityType: 'payment',
      recordId: payment.id,
      summary: `Permanently deleted payment ${payment.paymentCode} (${payment.transactionReference})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `payments/${payment.id}`);
  }
}

export async function permanentlyDeleteNotification(notificationId: string): Promise<void> {
  requireAdminAuth();
  try {
    await commitDeleteRefsInChunks([doc(db, 'notifications', notificationId)]);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `notifications/${notificationId}`);
  }
}

export interface PurgePreviewItem {
  collection: string;
  id: string;
  label: string;
  detail: string;
}

export interface PurgeScanResult {
  keyword: string;
  counts: {
    clients: number;
    leads: number;
    websites: number;
    subscriptions: number;
    invoices: number;
    payments: number;
    paymentReferences: number;
    notifications: number;
    activityLogs: number;
  };
  totalMatched: number;
  items: PurgePreviewItem[];
  refs: DocumentReference[];
}

export async function findMatchingRecordsForPurge(keyword: string): Promise<PurgeScanResult> {
  requireAdminAuth();
  const needle = keyword.trim().toLowerCase();
  if (needle.length < 2) {
    throw new Error('Enter at least 2 characters to scan records.');
  }

  try {
    const [
      clientsSnap,
      leadsSnap,
      websitesSnap,
      subsSnap,
      invoicesSnap,
      paymentsSnap,
      notifsSnap,
      logsSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'clients')),
      getDocs(collection(db, 'leads')),
      getDocs(collection(db, 'websites')),
      getDocs(collection(db, 'subscriptions')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'notifications')),
      getDocs(collection(db, 'activity_logs')),
    ]);

    const matchesText = (...fields: Array<string | undefined | null>) =>
      fields.some((f) => Boolean(f) && String(f).toLowerCase().includes(needle));

    const matchedClientIds = new Set<string>();
    const matchedRecordIds = new Set<string>();
    const refs: DocumentReference[] = [];
    const items: PurgePreviewItem[] = [];

    const counts = {
      clients: 0,
      leads: 0,
      websites: 0,
      subscriptions: 0,
      invoices: 0,
      payments: 0,
      paymentReferences: 0,
      notifications: 0,
      activityLogs: 0,
    };

    clientsSnap.docs.forEach((d) => {
      const c = d.data() as Client;
      if (
        matchesText(
          c.businessName,
          c.contactName,
          c.clientCode,
          c.domainName,
          c.websiteUrl,
          c.email,
          c.phone,
          c.notes
        )
      ) {
        matchedClientIds.add(d.id);
        matchedRecordIds.add(d.id);
        if (c.sourceLeadId) matchedRecordIds.add(c.sourceLeadId);
        refs.push(d.ref);
        counts.clients += 1;
        items.push({
          collection: 'Client',
          id: d.id,
          label: c.businessName,
          detail: `${c.clientCode} · ${c.contactName}`,
        });
      }
    });

    leadsSnap.docs.forEach((d) => {
      const l = d.data() as Lead;
      if (
        matchedRecordIds.has(d.id) ||
        (l.convertedClientId && matchedClientIds.has(l.convertedClientId)) ||
        matchesText(
          l.businessName,
          l.contactPerson,
          l.leadCode,
          l.phone,
          l.existingWebsite,
          l.previewUrl,
          l.socialLink,
          l.notes
        )
      ) {
        matchedRecordIds.add(d.id);
        refs.push(d.ref);
        counts.leads += 1;
        items.push({
          collection: 'Lead',
          id: d.id,
          label: l.businessName,
          detail: `${l.leadCode} · ${l.status}`,
        });
      }
    });

    websitesSnap.docs.forEach((d) => {
      const w = d.data() as Website;
      if (
        matchedClientIds.has(w.clientId) ||
        matchesText(w.businessName, w.websiteName, w.websiteCode, w.domain, w.liveUrl, w.technicalNotes)
      ) {
        matchedRecordIds.add(d.id);
        refs.push(d.ref);
        counts.websites += 1;
        items.push({
          collection: 'Website',
          id: d.id,
          label: w.websiteName,
          detail: `${w.websiteCode} · ${w.businessName}`,
        });
      }
    });

    subsSnap.docs.forEach((d) => {
      const s = d.data() as Subscription;
      if (
        matchedClientIds.has(s.clientId) ||
        matchesText(s.clientName, s.subscriptionCode, s.packageName, s.notes)
      ) {
        matchedRecordIds.add(d.id);
        refs.push(d.ref);
        counts.subscriptions += 1;
        items.push({
          collection: 'Subscription',
          id: d.id,
          label: `${s.clientName} (${s.packageName})`,
          detail: s.subscriptionCode,
        });
      }
    });

    invoicesSnap.docs.forEach((d) => {
      const inv = d.data() as Invoice;
      if (
        matchedClientIds.has(inv.clientId) ||
        matchesText(inv.clientName, inv.invoiceNumber, inv.description, inv.notes)
      ) {
        matchedRecordIds.add(d.id);
        refs.push(d.ref);
        counts.invoices += 1;
        items.push({
          collection: 'Invoice',
          id: d.id,
          label: `${inv.invoiceNumber} — ${inv.clientName}`,
          detail: inv.status,
        });
      }
    });

    paymentsSnap.docs.forEach((d) => {
      const p = d.data() as Payment;
      if (
        matchedClientIds.has(p.clientId) ||
        matchesText(p.clientName, p.paymentCode, p.transactionReference, p.notes)
      ) {
        matchedRecordIds.add(d.id);
        refs.push(d.ref);
        counts.payments += 1;
        if (p.normalizedReference && /^[a-zA-Z0-9_-]{1,128}$/.test(p.normalizedReference)) {
          refs.push(doc(db, 'payment_references', p.normalizedReference));
          counts.paymentReferences += 1;
        }
        items.push({
          collection: 'Payment',
          id: d.id,
          label: `${p.paymentCode} — ${p.clientName}`,
          detail: p.transactionReference,
        });
      }
    });

    notifsSnap.docs.forEach((d) => {
      const n = d.data() as {
        clientId?: string;
        recordId?: string;
        clientName?: string;
        title?: string;
        message?: string;
      };
      if (
        (n.clientId && matchedClientIds.has(n.clientId)) ||
        (n.recordId && matchedRecordIds.has(n.recordId)) ||
        matchesText(n.clientName, n.title, n.message)
      ) {
        refs.push(d.ref);
        counts.notifications += 1;
        items.push({
          collection: 'Notification',
          id: d.id,
          label: n.title || 'Alert',
          detail: n.clientName || n.recordId || '',
        });
      }
    });

    logsSnap.docs.forEach((d) => {
      const log = d.data() as { recordId?: string; actionType?: string; summary?: string };
      if (
        (log.recordId && matchedRecordIds.has(log.recordId)) ||
        matchesText(log.summary, log.recordId)
      ) {
        refs.push(d.ref);
        counts.activityLogs += 1;
        items.push({
          collection: 'Activity Log',
          id: d.id,
          label: log.actionType || 'LOG',
          detail: log.summary || '',
        });
      }
    });

    const uniqueRefs = Array.from(new Map(refs.map((r) => [r.path, r])).values());

    return {
      keyword: keyword.trim(),
      counts,
      totalMatched: uniqueRefs.length,
      items,
      refs: uniqueRefs,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'purge_scan');
  }
}

export async function executePurgeMatch(scan: PurgeScanResult): Promise<number> {
  requireAdminAuth();
  try {
    return await commitDeleteRefsInChunks(scan.refs);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'purge_execute');
  }
}
