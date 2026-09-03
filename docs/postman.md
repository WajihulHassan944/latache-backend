# Postman setup

Latache's OpenAPI document is canonical. In local development it is available at:

- Swagger UI: `http://localhost:8080/api/docs`
- OpenAPI JSON: `http://localhost:8080/api/docs-json`

## Recommended import

`postman/Latache-API-v3.34.0-Vercel.postman_collection.json` is the current collection, generated from the live OpenAPI document (`/api/docs-json`) served by the deployed backend. Import it together with `postman/Latache-Vercel.postman_environment.json`.

The collection uses `{{baseUrl}}/api/...`; therefore `baseUrl` is the origin only. The bundled environment points it at:

```text
https://latache-backend.vercel.app
```

To point the same collection at a local backend instead, duplicate the environment in Postman and change `baseUrl` to `http://localhost:8080`. The Stripe webhook remains unsuitable for unsigned Postman calls because its signature is verified against the exact raw body.

## Regenerate from the running API

Postman can also generate a collection from `http://localhost:8080/api/docs-json`. If a Postman client cannot import a localhost link, save the JSON to disk first. The OpenAPI document declares `APP_BASE_URL` as its server origin and includes valid item schemas for every array.

## Authentication

Collection authorization is set to **Bearer Token** with `{{accessToken}}`. Login responses contain tokens at `data.tokens.accessToken` and `data.tokens.refreshToken`; paste the `accessToken` value into the environment's `accessToken` variable (typed as `secret`) after logging in. The environment ships with no credentials or real tokens.

Public/authentication requests may use **No Auth**. Protected requests should inherit collection authorization. Never put real tokens, passwords, Stripe keys, SMTP credentials, or provider secrets into an exported shared collection.
