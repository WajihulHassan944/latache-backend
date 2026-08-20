# Realtime contract

Latache keeps REST/Prisma as the source of truth. Socket.IO pushes committed state changes, ephemeral typing indicators, and transient WebRTC signaling. Audio/video media never passes through the NestJS API.

## Connection

- Namespace: `/realtime`
- Socket.IO path: `/socket.io`
- Transport: `websocket`
- Authentication: `auth.token = <access JWT>` or `Authorization: Bearer <access JWT>`
- Discovery: `GET /api/realtime/session`

A socket is accepted only while both the access token and its database-backed auth session are active. Revoked/expired sessions and suspended/deactivated accounts are disconnected by a periodic session sweep.

## Reliability

Persisted push events use the `RealtimeOutboxEvents` transactional outbox. Domain state and its realtime event are committed in the same PostgreSQL transaction wherever the underlying mutation is transactional. Delivery is at-least-once. Clients must de-duplicate persisted events by `eventId` and can always refetch REST state after reconnecting.

## Rooms and privacy

- `user:{userId}` — private notifications for that identity.
- `booking:{bookingId}` — booking lifecycle, timer and Tasker location. Booking participants can join; Admin/Super Admin needs `bookings.read`.
- `conversation:{bookingId}` — private Customer/Tasker booking messages/read receipts/typing. Only the two booking participants can join. Admin booking access does not grant chat access.
- `support:{ticketId}:public` — participant-visible support messages, read receipts, ticket state, and public typing.
- `support:{ticketId}:admins` — Support Admin/Super Admin internal notes and internal typing. Participants never join it.

The client subscribes to a booking with `booking:subscribe`. A participant joins both the booking-state and private conversation rooms. An administrator joins only the booking-state room.

## Server events

- `notification:created`
- `notification:read`
- `notifications:read_all`
- `conversation:message`
- `conversation:read`
- `conversation:typing`
- `support:message`
- `support:read`
- `support:ticket_updated`
- `support:typing`
- `booking:updated`
- `booking:location`
- `booking:timer`
- `referral:updated`
- `call:incoming`
- `call:state`
- `call:offer`
- `call:answer`
- `call:ice_candidate`
- `call:media_state`
- `call:error`
- `auth:session_invalid`

Persisted events use an envelope:

```json
{
  "eventId": "outbox-id",
  "occurredAt": "2026-08-10T10:00:00.000Z",
  "data": {}
}
```

Typing events are intentionally ephemeral and do not use the outbox.

## Client events

- `booking:subscribe` `{ "bookingId": 123 }`
- `booking:unsubscribe` `{ "bookingId": 123 }`
- `support:subscribe` `{ "ticketId": 123 }`
- `support:unsubscribe` `{ "ticketId": 123 }`
- `conversation:typing` `{ "bookingId": 123, "isTyping": true }`
- `support:typing` `{ "ticketId": 123, "isTyping": true, "scope": "public|internal" }` (`scope` defaults to `public`; `internal` requires `support.manage`)
- `call:initiate` `{ "bookingId": 123, "type": "voice|video", "clientRequestId": "uuid" }`
- `call:accept` / `call:reject` / `call:cancel` / `call:end` `{ "callId": "...", "reason": "optional" }`
- `call:offer` / `call:answer` `{ "callId": "...", "description": { "type": "offer|answer", "sdp": "..." } }`
- `call:ice_candidate` `{ "callId": "...", "candidate": { "candidate": "..." } }`
- `call:media_state` `{ "callId": "...", "microphoneEnabled": true, "cameraEnabled": false }`

Persisted writes still go through the existing REST APIs. There is deliberately no second WebSocket mutation path for messages, notifications, bookings, referrals, disputes, payments, or support records. Referral attribution, qualification, reward release, reversal, expiry and administrative revocation publish durable `referral:updated` events to the affected users' private rooms.

Persisted message events include the client-generated idempotency identifier when one was supplied. Public support state is emitted once to the public room, which support administrators also join; internal-note activity is emitted only to the Admin room. This avoids duplicate semantic events while preserving internal-note privacy.

## Voice/video call signaling

Calls use WebRTC media transport and the existing Socket.IO namespace only for authenticated signaling.

Client events:

- `call:initiate`
- `call:accept`
- `call:reject`
- `call:cancel`
- `call:end`
- `call:offer`
- `call:answer`
- `call:ice_candidate`
- `call:media_state`

Server events:

- `call:incoming`
- `call:state`
- `call:offer`
- `call:answer`
- `call:ice_candidate`
- `call:media_state`
- `call:error`

`call:incoming` and `call:state` are durable lifecycle events. SDP, ICE candidates, media state, and errors are transient. Media never passes through or gets recorded by the API. The ICE server configuration is returned by `GET /api/realtime/session`.

## WebRTC calls

Calls are one-to-one between the Customer and Tasker attached to the same eligible booking. Durable lifecycle events (`call:incoming`, `call:state`) use the transactional outbox; SDP, ICE candidates and media-state events are transient and are never stored.

Frontend flow:

1. Fetch `GET /api/realtime/session` and use the returned `calls.iceConfiguration` when constructing `RTCPeerConnection`.
2. Connect to namespace `/realtime` with the access token.
3. Initiator emits `call:initiate`.
4. Recipient receives `call:incoming` and emits `call:accept` or `call:reject`.
5. After acceptance, peers exchange `call:offer`, `call:answer` and `call:ice_candidate`.
6. Either participant emits `call:end`; persisted history is available through `/api/conversations/:bookingId/calls`.

TURN is required for dependable production connectivity across restrictive NAT/firewall environments. Configure either `WEBRTC_TURN_SHARED_SECRET` for coturn-style expiring credentials or a static username/credential pair.
