# Changelog

## 3.0.1

- Fixed the Nodemailer TypeScript overload error by using a standard `SMTPTransport.Options` transport.
- Removed optional SMTP pooling settings to keep the email integration simple and type-safe.
- Added optional `DIRECT_URL` support for Prisma migrations against Neon.
- Added sanitized Neon and Gmail SMTP environment examples.
- No database or SMTP credentials are included in the repository.
