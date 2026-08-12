import type { ConversationCallListView, ConversationCallView } from '../realtime/realtime.types';
import type { ConversationAttachmentReference } from '../uploads/uploads.types';

export interface PersonSummaryView {
  id: string;
  name: string;
  avatar: string;
  role: 'customer' | 'tasker';
  phoneCountryCode?: string;
  phoneNumber?: string;
}

export interface ConversationMessageView {
  id: string;
  bookingId: string;
  senderId: string;
  isMine: boolean;
  body: string;
  attachments: ConversationAttachmentReference[];
  readAt: string | null;
  createdAt: string;
}

export interface ConversationView {
  bookingId: string;
  otherParty: PersonSummaryView;
  service: {
    id: string;
    slug: string;
    name: string;
    icon: string;
  };
  bookingStatus: string;
  lastMessage: ConversationMessageView | null;
  unreadCount: number;
}

export interface ConversationListView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: ConversationView[];
}

export interface MessageListView {
  bookingId: string;
  otherParty: PersonSummaryView;
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  nextCursor: string | null;
  hasMore: boolean;
  items: ConversationMessageView[];
}

export interface ConversationCapabilitiesView {
  attachments: {
    uploadFolder: string;
    singleUploadEndpoint: string;
    multipleUploadEndpoint: string;
    maxFilesPerMessage: number;
    maxFileSizeBytes: number;
    maxTotalSizeBytes: number;
    allowedMimeTypes: string[];
  };
  calls: {
    enabled: boolean;
    provider: string;
    mediaTransport: string;
    supportedTypes: readonly ['voice', 'video'];
    oneToOneOnly: boolean;
    recordingSupported: boolean;
    ringTimeoutSeconds: number;
    maxDurationSeconds: number;
    allowedBookingStatuses: string[];
    signaling: {
      persistedLifecycleEvents: string[];
      transientEvents: string[];
    };
    sessionEndpoint: string;
    listHistoryEndpoint: string;
    detailEndpoint: string;
  };
}

export type { ConversationCallListView, ConversationCallView };
