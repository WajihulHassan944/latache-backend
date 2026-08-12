export const REALTIME_NAMESPACE = '/realtime';
export const REALTIME_PATH = '/socket.io';

export const realtimeRoom = {
  user: (userId: number): string => `user:${userId}`,
  booking: (bookingId: number): string => `booking:${bookingId}`,
  conversation: (bookingId: number): string => `conversation:${bookingId}`,
  supportPublic: (ticketId: number): string => `support:${ticketId}:public`,
  supportAdmins: (ticketId: number): string => `support:${ticketId}:admins`,
};

export const REALTIME_SERVER_EVENTS = [
  'notification:created',
  'notification:read',
  'notifications:read_all',
  'conversation:message',
  'conversation:read',
  'conversation:typing',
  'support:message',
  'support:read',
  'support:ticket_updated',
  'support:typing',
  'booking:updated',
  'booking:location',
  'booking:timer',
  'call:incoming',
  'call:state',
  'call:offer',
  'call:answer',
  'call:ice_candidate',
  'call:media_state',
  'call:error',
  'auth:session_invalid',
  'realtime:error',
] as const;

export const REALTIME_CLIENT_EVENTS = [
  'booking:subscribe',
  'booking:unsubscribe',
  'support:subscribe',
  'support:unsubscribe',
  'conversation:typing',
  'support:typing',
  'call:initiate',
  'call:accept',
  'call:reject',
  'call:cancel',
  'call:end',
  'call:offer',
  'call:answer',
  'call:ice_candidate',
  'call:media_state',
] as const;
