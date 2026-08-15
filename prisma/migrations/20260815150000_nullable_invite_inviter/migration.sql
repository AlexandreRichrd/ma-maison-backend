-- Allow invites.invited_by_user_id to be null, for the household-bootstrap
-- command's invite: it runs against an empty database, before any user
-- exists to be the inviter. Every other invite still sets this column
-- (InvitesService.create() requires a signed-in user), so it stays
-- non-null in practice past that first row.

-- DropForeignKey
ALTER TABLE "invites" DROP CONSTRAINT "invites_invited_by_user_id_fkey";

-- AlterTable
ALTER TABLE "invites" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
