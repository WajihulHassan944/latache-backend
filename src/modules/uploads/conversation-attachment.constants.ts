export const CONVERSATION_ATTACHMENT_MAX_FILES = 5;
export const CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const CONVERSATION_ATTACHMENT_MAX_TOTAL_SIZE_BYTES = 25 * 1024 * 1024;

export const CONVERSATION_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type ConversationAttachmentMimeType = (typeof CONVERSATION_ATTACHMENT_MIME_TYPES)[number];
