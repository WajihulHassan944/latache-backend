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
  lastMessageAt: string | null;
  lastMessage: ConversationMessageView | null;
  unreadCount: number;
  metadata: ConversationMetadataView;
}

/**
 * Every conversation in this system is anchored to a booking, so `type` is
 * always 'booking' today. The discriminant is kept so clients (and any future
 * non-booking chat surface, e.g. support) can branch on it without a schema
 * change.
 */
export interface ConversationMetadataView {
  type: 'booking';
  booking: {
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
  };
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
  metadata: ConversationMetadataView;
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
