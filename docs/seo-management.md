# SEO Management

Latache SEO is database-backed and managed by Super Admins or RBAC administrators with `seo.read` / `seo.manage`.

## Public endpoints

- `GET /api/seo/meta?path=/&locale=en` resolves canonical metadata for a public route.
- `GET /api/seo/robots.txt` renders managed crawler rules and the sitemap location.
- `GET /api/seo/sitemap.xml` renders the current XML sitemap from published CMS pages, configured dynamic services/taskers, and explicit sitemap entries.

## Admin endpoints

- `GET/PATCH /api/admin/seo/settings`
- `GET /api/admin/seo/pages`
- `GET /api/admin/seo/pages/:id`
- `POST /api/admin/seo/pages`
- `DELETE /api/admin/seo/pages/:id`
- `GET /api/admin/seo/redirects`
- `POST /api/admin/seo/redirects`
- `DELETE /api/admin/seo/redirects/:id`
- `GET /api/admin/seo/sitemap-entries`
- `POST /api/admin/seo/sitemap-entries`
- `DELETE /api/admin/seo/sitemap-entries/:id`
- `GET /api/admin/seo/pages/:id/keywords`
- `POST /api/admin/seo/pages/:id/keywords`
- `PATCH /api/admin/seo/pages/:id/keywords/:keywordId`
- `DELETE /api/admin/seo/pages/:id/keywords/:keywordId`

SEO page records support localized title/description, canonical URLs, index/follow directives, Open Graph, Twitter cards, keywords, JSON-LD structured data, alternate-language metadata, sitemap priority/change frequency, and activation state.

`SeoPage.keywords` (flat string list) is what actually renders into the public `<meta name="keywords">` tag. Separately, each SEO page can carry managed `SeoKeyword` records — `term`, `priority` (high/medium/low), `status` (active/paused) — used by the Content Admin's target-keyword workflow. `GET /api/admin/seo/pages/:id/keywords` computes `usedInContent` on every read by checking whether each keyword's term appears in the body copy of the `ContentPage` linked to that SEO page's path (same `/` → `home`, `/slug` → `slug` convention `resolve()`/`sitemap()` already use), across all of that page's `ContentBlock` translations.

Global settings support site defaults, canonical base URL, default social image, Twitter metadata, robots rules, Organization/default structured data, and dynamic sitemap inclusion rules for active Services and public Taskers.

`SEO_PUBLIC_BASE_URL` should point to the public website origin. If omitted, the backend falls back to `APP_BASE_URL`; production should explicitly configure the public website origin when it differs from the API origin.

SEO mutations are audit logged and invalidate the platform-content cache. Redirect records are returned by SEO resolution; the public frontend/reverse proxy must apply the actual browser redirect because the API does not own the frontend route.
