# Production chat system

Version 3.20 completes the backend chat contract without creating parallel resources. PostgreSQL remains authoritative, persisted realtime delivery uses the transactional outbox, Redis only distributes Socket.IO events across instances, and WebRTC media remains peer-to-peer or TURN-relayed.

## Actor and privacy matrix

| Actor       | Private booking conversation          | Public support conversation                      | Internal support notes                          | Voice/video signaling     |
| ----------- | ------------------------------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------- |
| Customer    | Own bookings only                     | Own tickets only                                 | Never                                           | Own eligible booking peer |
| Tasker      | Own bookings only                     | Own tickets only                                 | Never                                           | Own eligible booking peer |
| Admin       | Never, including with `bookings.read` | `support.read`; replies require `support.manage` | `support.read`; writes require `support.manage` | Never                     |
| Super Admin | Never                                 | Read/reply                                       | Read/write                                      | Never                     |

Private booking room membership is derived only from the booking's Customer and Tasker. Admin booking monitoring uses `booking:{bookingId}` and never grants access to `conversation:{bookingId}`.

## Retry safety and durable writes

- Booking messages and support messages accept an optional stable `clientMessageId` (8–80 characters).
- Support ticket creation accepts an optional stable `clientRequestId`.
- A retry with the same actor, identifier, target, content, and attachment public-ID order returns the original persisted record.
- Reusing an identifier with different content returns `409`; unique PostgreSQL indexes close concurrent retry races.
- Support message and ticket-state transitions lock the ticket row and revalidate its current state before mutation. Concurrent booking messages update the conversation activity timestamp monotonically.
- Message/ticket creation, related state changes, notifications, audit records, and persisted realtime events share a PostgreSQL transaction where they represent one mutation.
- Delivery from the outbox is at-least-once. Clients de-duplicate persisted events by `eventId` and reconcile through REST after reconnect.

## History, unread state, and read receipts

- Booking and support histories support bounded page sizes; high-growth history endpoints also support cursor pagination.
- Cursor responses are chronological within each returned window and include `nextCursor`/`hasMore`.
- Read mutations accept an optional visible `throughMessageId`, preventing a client from acknowledging messages newer than those it rendered.
- Participant support reads affect only public Admin/Super Admin replies. Admin support reads affect only public Customer/Tasker replies. Internal notes do not use the participant receipt.
- Conversation and support list responses expose per-resource unread counts; aggregate unread-count endpoints avoid fetching full histories.
- Booking conversation ordering uses the latest persisted message timestamp rather than unrelated booking lifecycle updates.

## Attachments and immutable evidence

The shared `/api/uploads/single` and `/api/uploads/multiple` endpoints remain canonical. Clients upload with `folder=conversation-attachments` or `folder=support-attachments` and then reference the returned asset.

Before a message or support ticket is persisted, the backend verifies the Cloudinary asset exists and that its public ID, secure URL, resource type, MIME type, original filename, byte size, owner namespace, and upload-folder context are consistent. Per-file, per-message total-size, count, type, ownership, and duplicate-reference limits are enforced.

An asset referenced by a booking message, support ticket, or support message cannot be independently deleted through the upload API. Message edit/delete routes are intentionally absent so dispute, safety, support, and audit history is not silently rewritten. Any future retention/deletion policy must be explicit, jurisdiction-approved, and coordinated with protected financial/provider/audit records.

## Realtime and internal-note isolation

- Namespace: `/realtime`
- Path: `/socket.io`
- Private booking chat: `conversation:{bookingId}`
- Public support: `support:{ticketId}:public`
- Internal support: `support:{ticketId}:admins`

Persisted messages, reads, ticket updates, notifications, and call lifecycle events use the outbox. Typing and WebRTC SDP/ICE/media-state signaling are transient. Public support state is emitted once to the public room, which authorized support administrators also join; internal-note messages, ticket activity, and typing are emitted only to the internal room.

## Production dependencies

No new environment variable was introduced by v3.20. Existing production requirements still apply: PostgreSQL runtime/migration URLs, required Redis and BullMQ API/worker services, Cloudinary credentials, independent JWT/OTP secrets, and production SMTP. Calls require production TURN credentials for dependable NAT/firewall traversal. APNs/FCM mobile push remains an external provider decision; persisted in-app notifications and realtime delivery do not claim mobile push delivery.

Deploy only with `prisma migrate deploy`; never reset an existing database. The additive migration is `20260818130000_complete_production_chat_system`.

## v3.24.0 completion audit

The production chat/support flow was re-audited without requiring a schema or route change. The canonical implementation remains Customer–Tasker private booking chat; Customer/Tasker–Admin/Super Admin support conversations; Admin/Super Admin internal support notes; verified immutable attachments; retry-safe message writes; unread/read state; durable transactional realtime events; and Customer–Tasker WebRTC signaling.
