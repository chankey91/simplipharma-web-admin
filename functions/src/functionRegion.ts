import * as functions from 'firebase-functions';

/** Cloud Functions deploy region — Mumbai (closer to central India users). */
export const FUNCTION_REGION = 'asia-south1';

/**
 * Region-scoped Functions builder (1st gen).
 * Use for triggers: ff.https / ff.firestore / ff.pubsub / ff.runWith.
 * Runtime secrets/config: prefer process.env via `runtimeConfig.ts` (legacy functions.config() fallback).
 */
export const ff = functions.region(FUNCTION_REGION);
