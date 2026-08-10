import * as functions from 'firebase-functions';

/** Cloud Functions deploy region — Mumbai (closer to central India users). */
export const FUNCTION_REGION = 'asia-south1';

/**
 * Region-scoped Functions builder (1st gen).
 * Use for triggers: ff.https / ff.firestore / ff.pubsub / ff.runWith.
 * Keep using `functions.config()` and `functions.https.HttpsError` from firebase-functions.
 */
export const ff = functions.region(FUNCTION_REGION);
