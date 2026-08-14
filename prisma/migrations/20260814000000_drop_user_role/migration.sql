-- role was never read anywhere — collected at registration and displayed
-- on the Household page, but no code branches on it. Drop it.
ALTER TABLE "users" DROP COLUMN "role";
