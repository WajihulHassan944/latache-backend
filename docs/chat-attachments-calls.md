# Conversation attachments and WebRTC calls — v3.13.0

## Scope

Customer and Tasker booking conversations support text, one or multiple verified Cloudinary attachments, persisted call history, and one-to-one WebRTC voice/video signaling. The NestJS server does not carry, inspect, or record the audio/video stream.

## Attachment workflow

1. Upload through the existing shared upload resource:
   - `POST /api/uploads/single`
   - `POST /api/uploads/multiple`
2. Use `folder=conversation-attachments`.
3. Send the returned asset references in:
   - `POST /api/conversations/:bookingId/messages`

Capability and limit discovery:

- `GET /api/conversations/capabilities`

Default limits:

- 5 attachments per message
- 10 MiB per attachment
- 25 MiB total per message

Allowed formats:

- JPEG, PNG, WEBP
- PDF, TXT, CSV, RTF
- DOC, DOCX
- XLS, XLSX
- PPT, PPTX

The backend verifies Cloudinary ownership, role/user folder, resource type, file size, MIME type, and duplicate references. A message must contain text or at least one valid attachment.

## Call history REST APIs

- `GET /api/conversations/:bookingId/calls`
- `GET /api/conversations/:bookingId/calls/:callId`

The history endpoint supports `type`, `status`, `page`, and `limit` filters.

## Signaling transport

- Socket.IO namespace: `/realtime`
- Socket.IO path: `/socket.io`
- Discovery/configuration: `GET /api/realtime/session`

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

Lifecycle events are persisted and dispatched through the transactional realtime outbox. SDP, ICE candidates, and local microphone/camera/speaker state are transient and are not stored.

## Authorization

Only the Customer and Tasker assigned to the booking can initiate, receive, signal, or inspect calls. Calls are limited to configured booking statuses, defaulting to `confirmed`, `en_route`, `arrived`, and `in_progress`.

The backend prevents:

- multiple active calls for the same booking;
- a participant joining two active calls at once;
- acceptance/rejection by anyone other than the recipient;
- cancellation by anyone other than the initiator;
- signaling by non-participants;
- reuse of one `clientRequestId` for a different call.

## TURN requirement

STUN-only WebRTC is not sufficiently reliable for production because some NAT/firewall combinations require relay transport. Configure TURN using either:

- `WEBRTC_TURN_SHARED_SECRET` for coturn-compatible temporary credentials; or
- `WEBRTC_TURN_USERNAME` and `WEBRTC_TURN_CREDENTIAL` for static credentials.

The authenticated realtime session endpoint returns the current `RTCIceServer` configuration to the frontend.
