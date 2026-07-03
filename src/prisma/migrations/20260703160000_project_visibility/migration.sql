-- GitHub-style project visibility. Existing projects default to `private`
-- (unchanged behaviour: only workspace/project members can see them).

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('private', 'public');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "visibility" "ProjectVisibility" NOT NULL DEFAULT 'private';
