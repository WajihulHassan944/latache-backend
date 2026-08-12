# Elite Tasker Program API — v3.8.0

This module implements the Elite Tasker Management flows shown in the supplied Super Admin/Admin designs without creating a separate endpoint for every tab or card. The UI designs are treated as product direction; eligibility, earnings, bookings, complaints, ratings, permissions and audit events come from existing Latache data.

## Access and permissions

Administrator routes require an active `admin` or `super_admin` session.

- `elite.read` allows Elite dashboard, members, queues, detail, performance and reports.
- `elite.manage` allows tier-policy changes, request decisions, manual tier changes, benefit configuration and badge management.
- `super_admin` bypasses permission-key checks as in the rest of Latache RBAC.

Operations Admin receives `elite.read` + `elite.manage`; Analytics Admin receives `elite.read`. Existing custom RBAC roles can be configured with either permission.

Taskers have a small self-service surface under `/api/tasker-dashboard/elite`; they never choose another Tasker ID.

## Consolidated admin API

### Dashboard

`GET /api/admin/elite-taskers/overview`

Returns in one response:

- total Elite members;
- Gold, Platinum and Diamond counts;
- pending application/upgrade/downgrade counts;
- configured benefit and badge counts;
- tier-growth series based on real tier transitions;
- recent Elite request activity.

Existing Taskers that had `isElite=true` before v3.8 are conservatively assigned Gold by the migration. Historical tier transitions are not invented, so responses disclose that transition history is complete from `2026-08-10` onward.

### One list API for all management tabs

`GET /api/admin/elite-taskers`

The same endpoint powers all of these screens:

| Screen               | Query                        |
| -------------------- | ---------------------------- |
| All Elite members    | `view=members`               |
| Gold members         | `view=members&tier=gold`     |
| Platinum members     | `view=members&tier=platinum` |
| Diamond members      | `view=members&tier=diamond`  |
| Pending applications | `view=applications`          |
| Upgrade requests     | `view=upgrade_requests`      |
| Downgrade requests   | `view=downgrade_requests`    |

Pagination, search, request status and sorting are shared rather than copied into seven endpoints.

Application/request rows include the immutable metrics and tier-requirements snapshots captured when the Tasker submitted the request. If administrators configured tier requirements, the API returns a calculated eligibility score and per-rule pass/fail checks. No score is returned when no requirements exist.

### Tasker detail

`GET /api/admin/elite-taskers/:taskerId`

Returns the current tier, real Tasker metrics, settled earnings, services/rates, benefits, awarded badges, requests and transition history.

## Tier policy and eligibility

`GET /api/admin/elite-taskers/program` returns all tier, benefit and badge configuration in a single settings payload.

`PATCH /api/admin/elite-taskers/program/tiers/:tierCode` updates an individual tier description and optional eligibility requirements:

```json
{
  "requirements": {
    "minRating": 4.8,
    "minCompletedTasks": 50,
    "minCompletionRate": 95,
    "maxOpenComplaints": 0,
    "minSettledEarnings": 5000
  }
}
```

No default business thresholds are seeded. Requirements start unset because those values are product policy, not something the backend should guess.

The score is the equal-weight average of fulfillment percentages for configured requirements, capped at 100 per rule. `eligible=true` only when every configured requirement passes. The score is advisory for administrator review; it never auto-approves a Tasker.

## Applications, upgrades and downgrades

Tasker endpoints:

- `GET /api/tasker-dashboard/elite`
- `POST /api/tasker-dashboard/elite/requests`
- `DELETE /api/tasker-dashboard/elite/requests/:requestId`

One request endpoint accepts `kind=application|upgrade|downgrade`. The backend derives the valid sequential target tier instead of accepting an arbitrary target from the client.

Before accepting a request, Latache requires the Tasker to be active, verified, document-verified and onboarding-approved. A partial unique database index also guarantees at most one pending Elite request per Tasker under concurrency.

Administrator decision:

`POST /api/admin/elite-taskers/requests/:requestId/decision`

One endpoint approves or rejects applications, upgrades and downgrades. Approval changes the tier, creates a transition, audits the decision and notifies the Tasker in one consistent workflow. Rejection requires a reason.

Manual correction path:

`PATCH /api/admin/elite-taskers/:taskerId/tier`

This exists for genuine administrative corrections. It cancels stale pending requests and records an audit event rather than silently editing `Users.isElite`.

## Benefits

`PUT /api/admin/elite-taskers/program/tiers/:tierCode/benefits`

This bulk endpoint replaces the tier's benefit configuration so the admin UI does not need one mutation per benefit row.

Benefits are persisted program configuration only. A reduced platform fee, queue priority, monthly bonus, revenue share, premium support or spotlight is **not** applied just because a label exists. Each effect must be explicitly integrated into the consuming booking/payment/support/marketing module before it changes real behavior.

## Badges

Badge definitions:

- `POST /api/admin/elite-taskers/program/badges`
- `PATCH /api/admin/elite-taskers/program/badges/:badgeId`
- `DELETE /api/admin/elite-taskers/program/badges/:badgeId` (soft-deactivate)

Tasker badge assignment:

- `POST /api/admin/elite-taskers/:taskerId/badges/:badgeId`
- `DELETE /api/admin/elite-taskers/:taskerId/badges/:badgeId`

Badge images reuse the existing authenticated Cloudinary upload API. Admins upload with folder `elite-badge-assets`, then persist the returned secure URL in the badge definition. JPEG, PNG and WEBP follow the existing upload validation; a second badge-upload API was deliberately not created.

Historical badge awards are retained when a definition or assignment is deactivated/revoked.

## Performance and reports

`GET /api/admin/elite-taskers/performance`

Uses actual current Elite members, bookings, cancellation/completion states, complaints, paid platform fees and settled Tasker wallet earnings.

`GET /api/admin/elite-taskers/reports`

Supported report types:

- `monthly_summary`
- `tier_transitions`
- `benefit_utilization`

Use `format=json|csv`. Benefit-utilization tracking returns `trackingAvailable=false` until explicit benefit-use events are introduced. It never fabricates utilization percentages from configuration alone.

## Database migration

Migration: `20260810070000_add_elite_tasker_program`

It adds:

- `EliteTiers`
- `EliteMembershipRequests`
- `EliteTierTransitions`
- `EliteBenefits`
- `EliteBadges`
- `EliteTaskerBadges`
- `Users.eliteTierId`
- `Users.eliteSince`
- `elite.read` / `elite.manage` RBAC permissions

The migration seeds only the structural Gold, Platinum and Diamond tier identities. It does not seed fake memberships, requests, earnings, benefits, badges, scores or historical transitions.
