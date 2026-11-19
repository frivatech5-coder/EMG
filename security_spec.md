# EMG Web Solutions — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Admin Boundary**: No unauthenticated user or non-admin signed-in user may read, list, create, update, or delete any business record (`clients`, `websites`, `subscriptions`, `payments`, `payment_references`, `invoices`, `leads`, `activity_logs`, `settings`, `notifications`, `fcm_tokens`).
2. **Verified Identity**: Admin privileges require `request.auth != null`, `request.auth.token.email_verified == true`, and either the bootstrapped primary admin email (`frivatech5@gmail.com`) or an active `/admins/{request.auth.uid}` document (`active == true`).
3. **Referential Integrity**:
   - A `website`, `subscription`, `payment`, or `invoice` cannot be created without an existing parent `clients/{clientId}` document.
   - An `invoice` or `payment` referencing a `subscriptionId` (when non-empty) must verify the subscription exists.
4. **Duplicate Transaction Reference & Notification Prevention**:
   - Creating a `payment` requires atomically writing `/payment_references/{normalizedReference}` (which cannot be overwritten).
   - Smart notifications use deterministic `dedupeKey` document IDs under `/notifications/{notificationId}` (`category`, `priority`, `entityType`, `read`, `pushDispatched`).
5. **Financial, Audit & Push Token Integrity**:
   - `activity_logs` are strictly append-only (no `update` or `delete`).
   - Historical `payments` cannot be deleted (refunds/corrections must update `status` to `'Refunded'` or `'Failed'`).
   - Archiving a `client` (`archived: true`) preserves all linked `subscriptions`, `payments`, `invoices`, and `websites`.
   - `fcm_tokens` are strictly admin-bound (`adminUid == request.auth.uid`) with validated token length and device metadata.
6. **Temporal & Authorship Integrity**: All `createdAt` and `updatedAt` fields must equal `request.time`; `createdBy` / `adminId` / `adminUid` must equal `request.auth.uid`; `createdAt` and `createdBy` are immutable on update.
7. **Shadow Field & Payload Poisoning Rejection**: Every write enforces `keys().hasAll(...) && keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update, `isValidId()` on all document IDs, and strict `.size()` bounds on every string and array.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: Anonymous client attempts `getDoc(doc(db, 'clients', 'c1'))`.
2. **Non-Admin User Read**: Authenticated user (`evil@example.com`, `email_verified: true`) attempts `getDocs(collection(db, 'clients'))`.
3. **Email Spoofing (Unverified Email)**: User with `email: 'frivatech5@gmail.com'` and `email_verified: false` attempts to read or write `/clients/c1`.
4. **Self-Privilege Escalation**: Non-admin user attempts `setDoc(doc(db, 'admins', request.auth.uid), { role: 'super_admin', active: true })`.
5. **Shadow Field Injection**: Admin attempts to create a `client` with an undeclared extra field `isVipBypass: true`.
6. **Document ID Poisoning**: Admin attempts to create `/clients/../../etc/passwd` or a 500-character ID.
7. **Orphaned Website Creation**: Admin attempts to create a `website` with non-existent `clientId: 'missing-client-999'`.
8. **Client-Spoofed Timestamp**: Admin attempts to create a `payment` with `createdAt: new Date('2020-01-01')` instead of `serverTimestamp()`.
9. **Identity Spoofing on Audit Log**: Admin attempts to create an `activity_logs` entry with `adminId: 'another-uid'`.
10. **Audit Log Tampering**: Admin attempts to `updateDoc` or `deleteDoc` on `/activity_logs/log1`.
11. **Financial History Deletion**: Admin attempts to `deleteDoc` on `/payments/pay1`.
12. **Unbounded String / Payload Exhaustion**: Admin attempts to write a `notes` string exceeding 4,000 characters or a `packages` array exceeding 20 entries.
