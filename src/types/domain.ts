import type { Timestamp } from 'firebase/firestore';

export type AdminRole = 'super_admin' | 'admin';

export interface AdminUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  phone?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type ClientStatus = 'Prospect' | 'Demo Presented' | 'Active' | 'Inactive' | 'Cancelled';

export const CLIENT_STATUSES: ClientStatus[] = [
  'Prospect',
  'Demo Presented',
  'Active',
  'Inactive',
  'Cancelled',
];

export interface Client {
  id: string;
  clientCode: string;
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
  archived: boolean;
  registeredAt: string; // YYYY-MM-DD
  sourceLeadId?: string;
  notes?: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type WebsiteDeploymentStatus =
  | 'In Development'
  | 'Preview'
  | 'Live'
  | 'Suspended'
  | 'Archived';

export const WEBSITE_STATUSES: WebsiteDeploymentStatus[] = [
  'In Development',
  'Preview',
  'Live',
  'Suspended',
  'Archived',
];

export interface Website {
  id: string;
  websiteCode: string;
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
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type SubscriptionStatus = 'Active' | 'Pending' | 'Overdue' | 'Suspended' | 'Cancelled';

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'Active',
  'Pending',
  'Overdue',
  'Suspended',
  'Cancelled',
];

export interface Subscription {
  id: string;
  subscriptionCode: string;
  clientId: string;
  clientName: string;
  packageName: string;
  monthlyAmount: number;
  startDate: string;
  nextPaymentDate: string;
  lastPaymentDate?: string;
  status: SubscriptionStatus;
  gracePeriodDays: number;
  gracePeriodEndDate: string;
  cancelledAt?: string;
  notes?: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type PaymentMethod = 'M-Pesa' | 'Bank' | 'PayPal' | 'Other';
export const PAYMENT_METHODS: PaymentMethod[] = ['M-Pesa', 'Bank', 'PayPal', 'Other'];

export type PaymentStatus = 'Pending' | 'Paid' | 'Failed' | 'Refunded';
export const PAYMENT_STATUSES: PaymentStatus[] = ['Pending', 'Paid', 'Failed', 'Refunded'];

export type PaymentVerificationSource = 'manual_admin' | 'mpesa_daraja_callback';

export interface Payment {
  id: string;
  paymentCode: string;
  clientId: string;
  clientName: string;
  subscriptionId?: string;
  invoiceId?: string;
  amount: number;
  method: PaymentMethod;
  transactionReference: string;
  normalizedReference: string;
  paymentDate: string;
  status: PaymentStatus;
  verificationSource: PaymentVerificationSource;
  notes?: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type InvoiceStatus = 'Draft' | 'Unpaid' | 'Paid' | 'Overdue' | 'Cancelled';
export const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Unpaid', 'Paid', 'Overdue', 'Cancelled'];

export interface Invoice {
  id: string;
  invoiceNumber: string;
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
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type LeadChannel =
  | 'Facebook'
  | 'WhatsApp'
  | 'Phone Call'
  | 'Instagram'
  | 'Referral'
  | 'Walk-in'
  | 'Other';

export const LEAD_CHANNELS: LeadChannel[] = [
  'Facebook',
  'WhatsApp',
  'Phone Call',
  'Instagram',
  'Referral',
  'Walk-in',
  'Other',
];

export type LeadInterest = 'Low' | 'Medium' | 'High';
export const LEAD_INTERESTS: LeadInterest[] = ['Low', 'Medium', 'High'];

export type LeadStatus =
  | 'New Lead'
  | 'Contacted'
  | 'Interested'
  | 'Demo Prepared'
  | 'Demo Presented'
  | 'Negotiation'
  | 'Converted'
  | 'Lost';

export const LEAD_STATUSES: LeadStatus[] = [
  'New Lead',
  'Contacted',
  'Interested',
  'Demo Prepared',
  'Demo Presented',
  'Negotiation',
  'Converted',
  'Lost',
];

export interface Lead {
  id: string;
  leadCode: string;
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
  convertedClientId?: string;
  notes?: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type ActivityEntityType =
  | 'client'
  | 'website'
  | 'subscription'
  | 'payment'
  | 'invoice'
  | 'lead'
  | 'notification'
  | 'settings'
  | 'admin';

export interface ActivityLog {
  id: string;
  actionType: string;
  entityType: ActivityEntityType;
  recordId: string;
  summary: string;
  adminId: string;
  adminEmail?: string;
  createdAt?: Timestamp | null;
}

export type NotificationCategory = 'subscriptions' | 'payments' | 'leads' | 'websites';
export type NotificationPriority = 'Critical' | 'Warning' | 'Info';
export type NotificationEntityType =
  | 'client'
  | 'website'
  | 'subscription'
  | 'payment'
  | 'invoice'
  | 'lead'
  | 'system';

export interface NotificationItem {
  id: string;
  dedupeKey: string;
  eventType: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  read: boolean;
  readAt?: string;
  entityType: NotificationEntityType;
  recordId: string;
  clientId?: string;
  clientName?: string;
  phone?: string;
  amount?: number;
  dueDate?: string;
  targetSection: NavSection;
  pushDispatched?: boolean;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface FcmDeviceToken {
  id: string;
  token: string;
  adminUid: string;
  adminEmail: string;
  deviceLabel: string;
  userAgent?: string;
  enabled: boolean;
  lastUsedAt?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface NotificationPreferences {
  enabledCategories: {
    subscriptions: boolean;
    payments: boolean;
    leads: boolean;
    websites: boolean;
  };
  graceReminderDays: number[];
  renewalReminderDays: number;
  websiteRenewalReminderDays: number;
  demoFeedbackReminderDays: number;
  leadFollowUpEnabled: boolean;
  websiteAlertsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  pushPriorities: NotificationPriority[];
  vapidPublicKey?: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
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
  vapidPublicKey: '',
};

export interface SubscriptionPackage {
  id: string;
  name: string;
  monthlyPrice: number;
  description: string;
}

export interface BusinessSettings {
  id: string;
  businessName: string;
  logoUrl?: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  currency: string;
  defaultGracePeriodDays: number;
  invoicePrefix: string;
  nextInvoiceSequence: number;
  paymentInstructions?: string;
  packages: SubscriptionPackage[];
  notificationPreferences?: NotificationPreferences;
  updatedBy: string;
  updatedAt?: Timestamp | null;
}

export type NavSection =
  | 'dashboard'
  | 'clients'
  | 'websites'
  | 'subscriptions'
  | 'payments'
  | 'invoices'
  | 'leads'
  | 'reminders'
  | 'reports'
  | 'activity'
  | 'settings';
