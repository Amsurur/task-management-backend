-- CreateEnum
CREATE TYPE "IssueLinkType" AS ENUM ('blocks', 'blocked_by', 'relates_to', 'duplicates');

-- CreateTable
CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "related_issue_id" TEXT NOT NULL,
    "relation_type" "IssueLinkType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueLink_issue_id_idx" ON "IssueLink"("issue_id");

-- CreateIndex
CREATE INDEX "IssueLink_related_issue_id_idx" ON "IssueLink"("related_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "IssueLink_issue_id_related_issue_id_relation_type_key" ON "IssueLink"("issue_id", "related_issue_id", "relation_type");

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_related_issue_id_fkey" FOREIGN KEY ("related_issue_id") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
