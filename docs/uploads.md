# Cloudinary uploads

Latache uses the official Cloudinary Node.js SDK for server-side uploads. The API secret remains on the backend and is never returned to mobile or web clients.

## Environment

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
CLOUDINARY_FOLDER=latache
CLOUDINARY_MAX_FILE_SIZE_BYTES=10485760
```

## Routes

| Method | Route                       | Access                                         | Purpose                                                                  |
| ------ | --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/uploads/registration` | Public, rate-limited                           | Upload restricted customer/tasker signup assets before an account exists |
| POST   | `/api/uploads/single`       | Active registration or verified bearer session | Upload one role-scoped asset                                             |
| POST   | `/api/uploads/multiple`     | Active registration or verified bearer session | Upload up to five role-scoped assets                                     |
| DELETE | `/api/uploads`              | Active registration or verified bearer session | Delete an owned asset; super-admin can delete any Latache asset          |

All upload endpoints use `multipart/form-data`. The file fields are `file` for single/registration uploads and `files` for multiple uploads.

## Folder policy

- Customer: `customer-profiles`, `booking-attachments`
- Tasker: `tasker-profiles`, `tasker-identity-documents`, `tasker-work-images`, `booking-attachments`
- Admin: `admin-profiles`, `service-images`
- Super admin: every folder
- Public registration: `customer-profiles`, `tasker-profiles`, `tasker-identity-documents`, `tasker-work-images`

Profile, work, and service folders accept JPEG, PNG, and WEBP. Tasker identity documents and booking attachments also accept PDF.

## Ownership

Authenticated uploads are written under:

```text
<CLOUDINARY_FOLDER>/<logical-folder>/<role>/<user-id>/<uuid>
```

Deletion checks this namespace before calling Cloudinary. Customers, taskers, and admins cannot delete another account's assets. The super administrator can delete any asset below the configured Latache root.

Public signup uploads are stored below `pending-registration`. Their returned `secureUrl` can be submitted in the customer/tasker registration payload. Periodic cleanup of abandoned pending-registration assets should be configured in Cloudinary or added as a scheduled maintenance job.
