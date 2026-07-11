type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

function requiredEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Copy firebase-config-template.env to .env.development or .env.production.`
    );
  }
  return value;
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: requiredEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requiredEnv('VITE_FIREBASE_APP_ID'),
};

export const firebaseFunctionsRegion =
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1';

/** Build a 1st-gen Cloud Functions HTTPS URL for the active Firebase project. */
export function getCloudFunctionUrl(functionName: string): string {
  const configuredBase = import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL?.replace(/\/$/, '');
  if (configuredBase) {
    return `${configuredBase}/${functionName}`;
  }
  return `https://${firebaseFunctionsRegion}-${firebaseConfig.projectId}.cloudfunctions.net/${functionName}`;
}
