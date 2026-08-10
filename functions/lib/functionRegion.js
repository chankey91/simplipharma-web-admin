"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ff = exports.FUNCTION_REGION = void 0;
const functions = require("firebase-functions");
/** Cloud Functions deploy region — Mumbai (closer to central India users). */
exports.FUNCTION_REGION = 'asia-south1';
/**
 * Region-scoped Functions builder (1st gen).
 * Use for triggers: ff.https / ff.firestore / ff.pubsub / ff.runWith.
 * Keep using `functions.config()` and `functions.https.HttpsError` from firebase-functions.
 */
exports.ff = functions.region(exports.FUNCTION_REGION);
//# sourceMappingURL=functionRegion.js.map