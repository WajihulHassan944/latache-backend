# Elite Tasker Program API — current implementation

This module implements the Elite Tasker Management flows shown in the supplied Super Admin/Admin designs without creating a separate endpoint for every tab or card. The UI designs are treated as product direction; eligibility, earnings, bookings, complaints, ratings, permissions and audit events come from existing Latache data.

## Access and permissions

Administrator routes require an active `admin` or `super_admin` session.

- `elite.read` allows Elite dashboard, members, queues, detail, performance and reports.
- `elite.manage` allows operational membership decisions, manual tier corrections, and badge administration.
- Only `super_admin` may change tier eligibility/automation policy or assign functional tier perks.
- `super_admin` bypasses permission-key checks as in the rest of Latache RBAC.

Operations Admin may receive `elite.read` + `elite.manage`; Analytics Admin may receive `elite.read`. Those permissions do not allow a non-Super-Admin to redefine Elite tier rules or functional perk assignment.

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

`GET /api/admin/elite-taskers/program` returns all tier, assigned-perk and badge configuration in one settings payload.

`GET /api/admin/elite-taskers/program/perk-catalog` returns the backend-defined functional perk catalog.

Only Super Admin may call `PATCH /api/admin/elite-taskers/program/tiers/:tierCode`. Tier rules support rating, completed tasks, completion rate, open complaints and settled earnings plus automatic promotion/demotion, retention grace and request cooldown.

The built-in tiers have production defaults when no earlier requirements were configured: Gold `4.5 / 20 completed tasks / 90% completion / 0 open complaints`, Platinum `4.7 / 75 / 94% / 0`, and Diamond `4.85 / 200 / 97% / 0`. Persisted Super-Admin policy remains authoritative after configuration.

The scheduled Elite maintenance flow evaluates real Tasker metrics, promotes eligible Taskers when enabled, marks members at risk when retention fails, applies the configured grace period, demotes after expiry, clears at-risk state after recovery, records `EliteEvaluation` history, updates automatic badges, audits transitions and notifies the Tasker.

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

## Functional perks

`PUT /api/admin/elite-taskers/program/tiers/:tierCode/benefits` is Super-Admin-only and assigns functional perks from the backend catalog. Unsupported arbitrary benefit codes are rejected.

Supported perks:

- `elite_profile_badge` — controls public Elite badge visibility and automatic built-in tier-badge entitlement.
- `search_priority_boost` — applies the tier rank as the default discovery boost. Explicit Customer sorts such as price/rating/completed tasks remain primary and the Elite boost is a tie-breaker.
- `tier_commission_policy` — applies the configured Gold/Platinum/Diamond commission and minimum-task-price rules. If the perk is not active for the tier, the Standard commission policy is used.

Perk assignment is authoritative. Removing or disabling a functional perk stops its consuming backend effect without removing the Tasker's tier membership.

Referral/Rewards and Commission values are commercial policy and are managed only by Super Admin through the canonical `PUT /api/admin/platform-settings` resource.

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
