-- Latache Prisma baseline.
-- Fresh databases apply this migration normally.
-- Existing Sequelize databases must mark it as applied after schema verification.

CREATE TABLE "Users" (
  "id" SERIAL NOT NULL,
  "firstName" VARCHAR(255) DEFAULT '',
  "lastName" VARCHAR(255) DEFAULT '',
  "email" VARCHAR(255) NOT NULL,
  "phoneNumber" VARCHAR(255) DEFAULT '',
  "otp" INTEGER,
  "otpExpires" TIMESTAMPTZ(6),
  "password" VARCHAR(255),
  "zipCode" VARCHAR(255),
  "passwordResetCode" INTEGER,
  "passwordResetCodeExpires" TIMESTAMPTZ(6),
  "profilePicture" VARCHAR(255) DEFAULT '',
  "role" VARCHAR(255) NOT NULL DEFAULT '',
  "bio" TEXT,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  "isProfilePublic" BOOLEAN NOT NULL DEFAULT false,
  "isDocVerified" BOOLEAN NOT NULL DEFAULT false,
  "authType" VARCHAR(255) DEFAULT '',
  "docType" VARCHAR(255) DEFAULT '',
  "dateOfBirth" VARCHAR(255) DEFAULT '',
  "yearsOfExperience" INTEGER,
  "idType" VARCHAR(255),
  "identityDocument" JSONB,
  "serviceAreaLabel" VARCHAR(255),
  "serviceAreaLat" DECIMAL(9,6),
  "serviceAreaLng" DECIMAL(9,6),
  "serviceAreaRadiusKm" DECIMAL(6,2),
  "serviceAreaCity" VARCHAR(255),
  "serviceAreaArea" VARCHAR(255),
  "onboardingStatus" VARCHAR(255),
  "submittedAt" TIMESTAMPTZ(6),
  "rating" DECIMAL(2,1) NOT NULL DEFAULT 0,
  "reviewsCount" INTEGER NOT NULL DEFAULT 0,
  "completedTasks" INTEGER NOT NULL DEFAULT 0,
  "vehicles" VARCHAR(255)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(255)[],
  "workImages" VARCHAR(255)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(255)[],
  "isElite" BOOLEAN NOT NULL DEFAULT false,
  "aboutMe" TEXT,
  "skills" VARCHAR(255)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(255)[],
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Services" (
  "id" SERIAL NOT NULL,
  "name" VARCHAR(255),
  "description" VARCHAR(255),
  "slug" VARCHAR(255),
  "icon" VARCHAR(255),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshTokens" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenHash" VARCHAR(255) NOT NULL,
  "device" VARCHAR(255),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "replacedByTokenHash" VARCHAR(255),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshTokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserServices" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "hourlyRate" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserServices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserAvailabilities" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "date" DATE NOT NULL,
  "startTime" VARCHAR(255) NOT NULL,
  "endTime" VARCHAR(255) NOT NULL,
  "isBooked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserAvailabilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bookings" (
  "id" SERIAL NOT NULL,
  "customerId" INTEGER NOT NULL,
  "taskerId" INTEGER NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "availabilityId" INTEGER NOT NULL,
  "hourlyRate" DECIMAL(10,2) NOT NULL,
  "bookingDate" DATE NOT NULL,
  "startTime" VARCHAR(255) NOT NULL,
  "endTime" VARCHAR(255) NOT NULL,
  "venueAddress" VARCHAR(255) NOT NULL,
  "apartmentSuite" VARCHAR(255),
  "description" TEXT NOT NULL,
  "attachments" JSONB,
  "locationLabel" VARCHAR(255) NOT NULL,
  "locationLat" DECIMAL(9,6) NOT NULL,
  "locationLng" DECIMAL(9,6) NOT NULL,
  "locationCity" VARCHAR(255),
  "locationArea" VARCHAR(255),
  "status" VARCHAR(255) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bookings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");
CREATE UNIQUE INDEX "RefreshTokens_tokenHash_key" ON "RefreshTokens"("tokenHash");
CREATE UNIQUE INDEX "user_services_user_id_service_id_unique" ON "UserServices"("userId", "serviceId");
CREATE UNIQUE INDEX "Bookings_availabilityId_key" ON "Bookings"("availabilityId");
CREATE INDEX "user_availabilities_user_id_date" ON "UserAvailabilities"("userId", "date");
CREATE INDEX "refresh_tokens_user_revoked_idx" ON "RefreshTokens"("userId", "revokedAt");
CREATE INDEX "user_services_service_rate_idx" ON "UserServices"("serviceId", "hourlyRate");
CREATE INDEX "user_availabilities_open_slot_idx" ON "UserAvailabilities"("userId", "date", "isBooked");
CREATE INDEX "bookings_customer_date_idx" ON "Bookings"("customerId", "bookingDate");
CREATE INDEX "bookings_tasker_date_idx" ON "Bookings"("taskerId", "bookingDate");
CREATE INDEX "users_role_onboarding_idx" ON "Users"("role", "onboardingStatus");

ALTER TABLE "RefreshTokens" ADD CONSTRAINT "RefreshTokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserServices" ADD CONSTRAINT "UserServices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserServices" ADD CONSTRAINT "UserServices_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAvailabilities" ADD CONSTRAINT "UserAvailabilities_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookings" ADD CONSTRAINT "Bookings_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookings" ADD CONSTRAINT "Bookings_taskerId_fkey"
  FOREIGN KEY ("taskerId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookings" ADD CONSTRAINT "Bookings_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookings" ADD CONSTRAINT "Bookings_availabilityId_fkey"
  FOREIGN KEY ("availabilityId") REFERENCES "UserAvailabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
