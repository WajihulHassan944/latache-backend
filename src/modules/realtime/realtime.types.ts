import type { UserRole } from '../../common/enums/user-role.enum';

export interface RealtimeSocketIdentity {
  userId: number;
  sessionId: number;
  role: UserRole;
  permissions: string[];
}

export interface RealtimeEnvelope<T = unknown> {
  eventId: string;
  occurredAt: string;
  data: T;
}

export interface BookingSubscriptionPayload {
  bookingId: number;
}

export interface SupportSubscriptionPayload {
  ticketId: number;
}

export interface ConversationTypingPayload extends BookingSubscriptionPayload {
  isTyping: boolean;
}

export interface SupportTypingPayload extends SupportSubscriptionPayload {
  isTyping: boolean;
}

export type ConversationCallType = 'voice' | 'video';
export type ConversationCallStatus =
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'missed'
  | 'ended';

export interface CallInitiatePayload extends BookingSubscriptionPayload {
  type: ConversationCallType;
  clientRequestId: string;
}

export interface CallActionPayload {
  callId: string;
  reason?: string;
}

export interface CallSdpPayload {
  callId: string;
  description: {
    type: 'offer' | 'answer';
    sdp: string;
  };
}

export interface CallIceCandidatePayload {
  callId: string;
  candidate: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  };
}

export interface CallMediaStatePayload {
  callId: string;
  microphoneEnabled?: boolean;
  cameraEnabled?: boolean;
  speakerEnabled?: boolean;
}

export interface ListConversationCallsQuery {
  page?: number;
  limit?: number;
  type?: ConversationCallType;
  status?: ConversationCallStatus;
}

export interface ConversationCallView {
  id: string;
  bookingId: string;
  type: ConversationCallType;
  status: string;
  initiatorId: string;
  recipientId: string;
  isInitiator: boolean;
  otherParty: {
    id: string;
    name: string;
    avatar: string;
    role: string;
  };
  expiresAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
  actions: {
    accept: boolean;
    reject: boolean;
    cancel: boolean;
    end: boolean;
  };
}

export interface ConversationCallListView {
  bookingId: string;
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: ConversationCallView[];
}

export interface WebRtcIceServerView {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface WebRtcConfigurationView {
  iceServers: WebRtcIceServerView[];
  credentialExpiresAt: string | null;
  turnConfigured: boolean;
}
