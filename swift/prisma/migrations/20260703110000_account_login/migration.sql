-- Store the credential to hand a VA (e.g. "username:password"). Held in the pool until claimed.
ALTER TABLE "Account" ADD COLUMN "login" TEXT;
