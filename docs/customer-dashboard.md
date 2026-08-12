# Customer dashboard API

Version 3.6 maps the supplied customer dashboard/booking designs to the existing Latache domain model. Shared resources are role-aware: customers and taskers use the same booking, conversation, notification, review, timer and navigation resources whenever the underlying data is the same.

## Screen-to-API mapping

| Customer design                     | Backend API                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------- | -------- |
| Services                            | `GET /api/services`                                                                   |
| Service sub-options                 | `GET /api/services/:serviceId/options`                                                |
| Location/tasker discovery/filtering | `GET /api/taskers`                                                                    |
| Tasker profile                      | `GET /api/taskers/:id`                                                                |
| Public Tasker reviews               | `GET /api/taskers/:id/reviews`                                                        |
| Tasker availability/date/time       | `GET /api/taskers/:id/availability`                                                   |
| Estimated price                     | `POST /api/bookings/quote`                                                            |
| Project details/attachments         | Cloudinary `/api/uploads/*`, then `POST /api/bookings`                                |
| Saved cards                         | `/api/payments/setup-intent`, `/api/payments/methods`                                 |
| Confirm booking                     | `POST /api/bookings`                                                                  |
| Dashboard home                      | `GET /api/dashboard/overview`                                                         |
| Task management                     | `GET /api/bookings?bucket=booked                                                      | ongoing | history` |
| Task detail                         | `GET /api/bookings/:bookingId`                                                        |
| Reschedule/cancel                   | `/api/bookings/:bookingId/reschedule`, `/cancel`                                      |
| Track Tasker                        | `GET /api/bookings/:bookingId/navigation`                                             |
| Task timer                          | `GET /api/bookings/:bookingId/timer`                                                  |
| Extend time                         | `POST /api/bookings/:bookingId/extend`                                                |
| Complaint/dispute                   | `POST /api/bookings/:bookingId/disputes`                                              |
| Chat                                | `/api/conversations/*`                                                                |
| Notifications                       | `/api/notifications/*`                                                                |
| Favorite Taskers                    | `/api/favorites/taskers/*`                                                            |
| Ratings/reviews                     | `/api/reviews/*`                                                                      |
| Wallet/balance                      | `/api/payments/wallet*`                                                               |
| Payment history                     | `GET /api/payments/transactions`                                                      |
| Mark task complete                  | `POST /api/bookings/:bookingId/complete` (Customer or Tasker, stopped timer required) |
| Completed-task payment              | `GET /api/payments/bookings/:bookingId` and provider webhook state                    |

## Shared role-aware resources

The following resources deliberately do not have separate customer/tasker copies:

```text
GET  /api/dashboard/overview
GET  /api/bookings
GET  /api/bookings/:bookingId
GET  /api/bookings/next
GET  /api/bookings/:bookingId/navigation
GET  /api/bookings/:bookingId/timer
POST /api/bookings/:bookingId/cancel
POST /api/bookings/:bookingId/disputes

GET/POST /api/conversations/...
GET/POST /api/notifications/...
GET/POST/PATCH/DELETE /api/reviews/...
```

Authorization derives the customer/tasker identity from the JWT. Callers do not submit another user's identity to select dashboard data.

## Booking flow

1. Browse the persistent service catalogue.
2. Read persistent service options. An unconfigured service returns `[]`.
3. Search approved Taskers using the existing location/service/elite/price/sort filters.
4. Read the selected Tasker's profile and real future availability.
5. Request a live quote using the selected Tasker, service and slot.
6. Upload any real project attachment through the existing Cloudinary API.
7. Save/select a Stripe card or select the Latache customer wallet.
8. Create the booking. Slot claiming is transactional; concurrent claims cannot both win.
9. Use the shared conversation and booking APIs through the task lifecycle.
10. At Tasker completion, final billing uses persisted task duration and the customer's explicit extension authorization.
11. Payment success is accepted only from the real customer-wallet ledger transaction or verified Stripe state/webhook.
12. Customer may review/favorite the Tasker using shared review and favorite resources.

## Honest external-integration boundaries

- Route distance, route geometry and ETA are `null` until a real maps/routing provider is connected.
- Tax is not invented; the quote explicitly reports that tax is uncalculated until tax rules/provider integration exist.
- Service options are persistent administrator-managed rows; no Figma placeholder options are inserted.
- Promo-code state is not fabricated. A promotion-management business policy was not defined in the supplied backend, so this release does not invent campaign codes or discounts.
- Donation amount, Tasker tip and donation-dropoff request are persisted on the real booking.
- Support/AI conversations are not seeded; conversations are booking-participant data only.
