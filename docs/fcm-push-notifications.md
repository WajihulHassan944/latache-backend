# Firebase Cloud Messaging (FCM)

Latache supports Firebase Cloud Messaging for web, Android, and iOS push notifications. The existing database-backed notification remains the source of truth; FCM is an additional delivery channel.

## Architecture

1. The client initializes Firebase Messaging and obtains an FCM registration token.
2. The authenticated client registers the token through `POST /api/notifications/push-tokens`.
3. When Latache creates a notification, the same database transaction queues a delivery for every enabled token belonging to the recipient.
4. The existing BullMQ worker dispatches pending deliveries through the FCM HTTP v1 API.
5. Temporary failures are retried with exponential backoff. Invalid/unregistered tokens are disabled automatically.
6. Socket.IO/realtime notifications remain unchanged and continue to operate independently.

## APIs

### Register or refresh a token

`POST /api/notifications/push-tokens`

Authenticated with the normal bearer token.

```json
{
  "token": "FCM_REGISTRATION_TOKEN",
  "platform": "android",
  "deviceId": "optional-client-device-id"
}
```

`platform` must be `android`, `ios`, or `web`.

### Disable a token

`DELETE /api/notifications/push-tokens`

```json
{
  "token": "FCM_REGISTRATION_TOKEN"
}
```

## Environment

```env
FCM_ENABLED=true
FCM_PROJECT_ID=your-firebase-project-id
FCM_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-firebase-project.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FCM_POLL_MS=1000
FCM_BATCH_SIZE=50
FCM_LOCK_MS=30000
FCM_MAX_ATTEMPTS=8
FCM_RETRY_BASE_MS=2000
```

Never commit the private key. Configure it in the deployment secret manager/environment instead.

FCM uses the service account's Google OAuth JWT flow and the Firebase Cloud Messaging HTTP v1 API. No Firebase service-account JSON file is required by the backend.

## Worker requirement

FCM delivery is processed by the existing BullMQ maintenance worker. Production should keep the existing required Redis/jobs configuration enabled and run the worker process (`npm run start:worker`). The scheduler creates the FCM dispatch job automatically.

For local development, enable the existing Redis/BullMQ settings if you want automatic delivery. With `FCM_ENABLED=false`, the backend keeps its existing notification behavior and does not access Firebase or require FCM credentials.

## Security notes

- FCM tokens are hashed for uniqueness, while the token itself is retained only because Firebase requires it for delivery.
- Token registration requires the authenticated user's JWT; users cannot register tokens for another user.
- Invalid FCM tokens are automatically disabled after Firebase rejects them as unregistered/invalid.
- Firebase credentials are not included in source control, `.env` examples, or release ZIPs.
