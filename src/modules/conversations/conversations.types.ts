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
  clientMessageId: string | null;
  conversationId: string;
  bookingId: string | null;
  senderId: string;
  isMine: boolean;
  body: string;
  attachments: ConversationAttachmentReference[];
  readAt: string | null;
  createdAt: string;
}

/**
 * A booking's context as surfaced inline on a conversation/message thread -
 * a conversation can span zero, one, or many bookings between the same
 * customer-tasker pair, so this is never the sole anchor for the thread.
 */
export interface BookingSummaryView {
  id: string;
  status: string;
  service: {
    id: string;
    slug: string;
    name: string;
    icon: string;
  };
  serviceOption: {
    id: string;
    name: string;
    slug: string;
  } | null;
  schedule: {
    date: string;
    startTime: string;
    endTime: string;
    estimatedDurationMinutes: number;
  };
  location: {
    label: string | null;
    lat: number | null;
    lng: number | null;
    city: string | null;
    area: string | null;
    venueAddress: string;
    apartmentSuite: string | null;
  };
  payment: {
    hourlyRate: number;
    currency: string;
    totalChargedAmount: number | null;
    paymentStatus: string;
  };
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  rescheduledAt: string | null;
  cancelledByRole: 'customer' | 'tasker' | 'system' | null;
  cancellationReason: string | null;
  pendingRescheduleProposal: {
    id: string;
    proposedByRole: string;
    proposedDate: string;
    proposedTime: string;
    note: string | null;
    createdAt: string;
  } | null;
}

/**
 * `id` is null only for a not-yet-created relationship (GET /conversations/with/:userId
 * before any message has ever been sent) - the conversation row is created lazily on
 * first send, not on read.
 */
export interface ConversationView {
  id: string | null;
  otherParty: PersonSummaryView;
  lastMessageAt: string | null;
  lastMessage: ConversationMessageView | null;
  unreadCount: number;
  activeBooking: BookingSummaryView | null;
  bookingHistory: BookingSummaryView[];
}

export interface ConversationListView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: ConversationView[];
}

export interface MessageListView {
  conversationId: string | null;
  otherParty: PersonSummaryView;
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  nextCursor: string | null;
  hasMore: boolean;
  items: ConversationMessageView[];
  activeBooking: BookingSummaryView | null;
  bookingHistory: BookingSummaryView[];
}

export interface ConversationUnreadCountView {
  unreadCount: number;
}

export interface ConversationReadResultView {
  updated: number;
  readAt: string | null;
  throughMessageId: string | null;
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
