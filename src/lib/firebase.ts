import { initializeApp, getApps } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import bundledConfig from '../../firebase-applet-config.json';

interface FirebaseRuntimeConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  recaptchaSiteKey?: string;
}

const metaEnv: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env as Record<string, string | undefined>)
    : {};

const envConfig: Partial<FirebaseRuntimeConfig> = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY,
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: metaEnv.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
  recaptchaSiteKey: metaEnv.VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY,
};

export const ENV_VAPID_KEY = metaEnv.VITE_FIREBASE_VAPID_KEY || '';

export const firebaseWebConfig: FirebaseRuntimeConfig = {
  projectId: envConfig.projectId || bundledConfig.projectId,
  appId: envConfig.appId || bundledConfig.appId,
  apiKey: envConfig.apiKey || bundledConfig.apiKey,
  authDomain: envConfig.authDomain || bundledConfig.authDomain,
  firestoreDatabaseId: envConfig.firestoreDatabaseId || bundledConfig.firestoreDatabaseId,
  storageBucket: envConfig.storageBucket || bundledConfig.storageBucket,
  messagingSenderId: envConfig.messagingSenderId || bundledConfig.messagingSenderId,
  recaptchaSiteKey: envConfig.recaptchaSiteKey || bundledConfig.recaptchaSiteKey,
};

const firebaseConfig = firebaseWebConfig;

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.projectId !== 'remixed-project-id'
);

export const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const app = firebaseApp;

// Initialize App Check when a reCAPTCHA v3 site key is configured
if (typeof window !== 'undefined' && firebaseConfig.recaptchaSiteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(firebaseConfig.recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Ignore duplicate App Check initialization during hot reloads
  }
}

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);

// Ensure persistent authenticated sessions across refreshes
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore in restricted storage environments
});

export const BOOTSTRAP_ADMIN_EMAIL = 'frivatech5@gmail.com';
export const firebaseProjectInfo = {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
  authDomain: firebaseConfig.authDomain,
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
      return false;
    }
    // A permission-denied response confirms live network connectivity to Firestore
    return true;
  }
}

void testConnection();
