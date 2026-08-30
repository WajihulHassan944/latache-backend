-- Google / Apple social authentication identity mapping.
-- Additive only: existing Users, passwords, roles, sessions, and profiles are preserved.
CREATE TABLE "SocialAuthIdentities" (
    "id" VARCHAR(40) NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "providerSubject" VARCHAR(255) NOT NULL,
    "providerEmail" VARCHAR(254),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPrivateEmail" BOOLEAN NOT NULL DEFAULT false,
    "providerClientId" VARCHAR(255),
    "lastLoginAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialAuthIdentities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SocialAuthIdentities_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SocialAuthIdentities_provider_subject_key"
  ON "SocialAuthIdentities"("provider", "providerSubject");
CREATE UNIQUE INDEX "SocialAuthIdentities_provider_user_key"
  ON "SocialAuthIdentities"("provider", "userId");
CREATE INDEX "social_auth_identity_user_created_idx"
  ON "SocialAuthIdentities"("userId", "createdAt");
