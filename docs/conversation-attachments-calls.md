# Conversation attachments and WebRTC calls

## Document sharing

The backend reuses the canonical Cloudinary upload module rather than introducing a second chat uploader.

1. Upload through `POST /api/uploads/single` or `POST /api/uploads/multiple` with `folder=conversation-attachments`.
2. Pass the returned attachment references to `POST /api/conversations/:bookingId/messages`.
3. The backend verifies the Cloudinary resource, uploader ownership, MIME metadata, resource type, filename extension, size limits, duplicate references and aggregate message size before saving.

Default limits are five files, 10 MB per file and 25 MB combined per message. Supported types are JPEG, PNG, WEBP, PDF, TXT, CSV, RTF, DOC, DOCX, XLS, XLSX, PPT and PPTX. Runtime values are discoverable at `GET /api/conversations/capabilities`.

## Voice/video calling

- Namespace: `/realtime`
- Path: `/socket.io`
- Media: WebRTC peer-to-peer
- Signaling: authenticated Socket.IO
- History: PostgreSQL `ConversationCalls`
- ICE configuration: `GET /api/realtime/session`

Client events: `call:initiate`, `call:accept`, `call:reject`, `call:cancel`, `call:end`, `call:offer`, `call:answer`, `call:ice_candidate`, `call:media_state`.

Server events: `call:incoming`, `call:state`, `call:offer`, `call:answer`, `call:ice_candidate`, `call:media_state`, `call:error`.

The API does not record or proxy media. It persists only lifecycle/history metadata. Calls are limited to the authenticated Customer and Tasker on an eligible booking, one active call per booking/participant, and are protected by idempotency, transaction/advisory locks, ring expiry, maximum duration and signaling rate limits.

## Environment

```env
CHAT_ATTACHMENT_MAX_FILES=5
CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES=10485760
CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES=26214400

CHAT_CALLS_ENABLED=true
CHAT_CALL_RING_TIMEOUT_SECONDS=45
CHAT_CALL_MAX_DURATION_SECONDS=14400
CHAT_CALL_SWEEP_MS=5000
CHAT_CALL_SIGNAL_MAX_PER_MINUTE=300
CHAT_CALL_ALLOWED_BOOKING_STATUSES=confirmed,en_route,arrived,in_progress

WEBRTC_STUN_URLS=
WEBRTC_TURN_URLS=
WEBRTC_TURN_SHARED_SECRET=
WEBRTC_TURN_USERNAME=
WEBRTC_TURN_CREDENTIAL=
WEBRTC_TURN_CREDENTIAL_TTL_SECONDS=3600
```

Staging and production validation requires TURN URLs whenever calls are enabled.
