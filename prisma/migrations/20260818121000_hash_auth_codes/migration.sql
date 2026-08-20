ALTER TABLE "Users"
  ADD COLUMN "otpHash" VARCHAR(64),
  ADD COLUMN "passwordResetCodeHash" VARCHAR(64);

-- Existing unexpired integer codes remain readable only for the deployment
-- transition. Every newly issued code writes the keyed hash and clears the
-- legacy integer; successful verification clears both representations.
