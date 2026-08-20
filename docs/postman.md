# Postman setup

Latache's OpenAPI document is canonical. In local development it is available at:

- Swagger UI: `http://localhost:8080/api/docs`
- OpenAPI JSON: `http://localhost:8080/api/docs-json`

## Recommended import

`postman/Latache-v3.21.1.postman_collection.json` remains the **last validated historical snapshot** included with the source release. It does not contain the new v3.22.0 participant dispute action/satisfaction operations. Import it only as a baseline, together with `postman/Latache-Local.postman_environment.json`.

For v3.22.0, start the updated backend after running Prisma generation/migrations and generate/import the current collection from `/api/docs-json`. The v3.22.0 route/OpenAPI count was intentionally not regenerated during this handoff because validation commands were not run at the requester's instruction. The Stripe webhook remains unsuitable for unsigned Postman calls because its signature is verified against the exact raw body.

The collection uses `{{baseUrl}}/api/...`; therefore `baseUrl` is the origin only:

```text
http://localhost:8080
```

## Regenerate from the running API

Postman can also generate a collection from `http://localhost:8080/api/docs-json`. If a Postman client cannot import a localhost link, save the JSON to disk first. The OpenAPI document declares `APP_BASE_URL` as its server origin and includes valid item schemas for every array.

## Authentication

Set collection authorization to **Bearer Token** with `{{accessToken}}`. Login responses contain tokens at `data.tokens.accessToken` and `data.tokens.refreshToken`. The supplied environment keeps separate secret variables for Customer, Tasker, Admin, and Super Admin sessions; it contains no credentials or real tokens.

Public/authentication requests may use **No Auth**. Protected requests should inherit collection authorization. Never put real tokens, passwords, Stripe keys, SMTP credentials, or provider secrets into an exported shared collection.
