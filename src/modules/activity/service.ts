import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { ActivityListQuery } from './schema.js';

type ActivityWithActor = Prisma.ActivityLogGetPayload<{
  include: { actor: { select: { id: true; display_name: true; avatar_url: true } } };
}>;

const INCLUDE_ACTOR = {
  actor: { select: { id: true, display_name: true, avatar_url: true } },
} as const;

async function resolveIssue(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
): Promise<void> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project_id: projectId, workspace_id: workspaceId, deleted_at: null },
    select: { id: true },
  });
  if (!issue) throw AppError.notFound('Issue not found');
}

export async function listIssueActivity(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  query: ActivityListQuery,
): Promise<{ data: ActivityWithActor[]; next_cursor: string | null }> {
  await resolveIssue(prisma, workspaceId, projectId, issueId);

  const limit = query.limit;
  const entries = await prisma.activityLog.findMany({
    where: { issue_id: issueId },
    include: INCLUDE_ACTOR,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1, // fetch one extra to detect a next page
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });

  const hasMore = entries.length > limit;
  const data = hasMore ? entries.slice(0, limit) : entries;
  const next_cursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return { data, next_cursor };
}
