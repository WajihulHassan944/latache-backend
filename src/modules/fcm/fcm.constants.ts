/** Data-only push that stops a ringing call (caller cancelled / callee rejected). */
export const CALL_ENDED_NOTIFICATION_TYPE = 'call_ended';

/**
 * Notification types that exist only to carry an FCM push. Their rows are stored as
 * read and never appear in the in-app notification list or unread counts.
 */
export const PUSH_ONLY_NOTIFICATION_TYPES: readonly string[] = [CALL_ENDED_NOTIFICATION_TYPE];
