import type { PrismaClient, Issue, Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { recordActivity, recordActivities, ACTIVITY_ACTIONS } from '../../lib/activity.js';
import { notify } from '../../lib/notifications.js';
import type { CreateIssueBody, UpdateIssueBody, IssueFilterQuery } from './schema.js';

/** Coerce an issue field value to its stored string form for the activity trail. */
function activityValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Issue scalar fields whose changes are recorded in the activity trail. */
const TRACKED_FIELDS = [
  'title',
  'description',
  'state_id',
  'priority',
  'parent_id',
  'start_date',
  'due_date',
  'estimate_points',
] as const;

/** Issue with assignees and labels included (the standard response shape). */
type IssueWithRelations = Prisma.IssueGetPayload<{
  include: {
    assignees: {
      include: {
        user: { select: { id: true; email: true; display_name: true; avatar_url: true } };
      };
    };
    labels: { include: { label: true } };
  };
}>;

const INCLUDE_RELATIONS = {
  assignees: {
    include: { user: { select: { id: true, email: true, display_name: true, avatar_url: true } } },
  },
  labels: { include: { label: true } },
} as const;

async function resolveProject(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');
}

async function resolveIssue(
  prisma: PrismaClient,
  projectId: string,
  issueId: string,
): Promise<IssueWithRelations> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project_id: projectId, deleted_at: null },
    include: INCLUDE_RELATIONS,
  });
  if (!issue) throw AppError.notFound('Issue not found');
  return issue;
}

/** Next sequence_id for a project — use inside a serializable transaction. */
async function nextSequenceId(
  prisma: Prisma.TransactionClient,
  projectId: string,
): Promise<number> {
  const last = await prisma.issue.findFirst({
    where: { project_id: projectId },
    orderBy: { sequence_id: 'desc' },
    select: { sequence_id: true },
  });
  return (last?.sequence_id ?? 0) + 1;
}

function normalizeArrayParam(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/** Build a `due_date`/`created_at` range filter from before/after bounds. */
function dateRange(after?: string, before?: string): Prisma.DateTimeFilter | undefined {
  if (after === undefined && before === undefined) return undefined;
  return {
    ...(after !== undefined && { gte: new Date(after) }),
    ...(before !== undefined && { lte: new Date(before) }),
  };
}

/** Translate the validated filter query into a Prisma `where` clause. */
function buildWhere(projectId: string, query: IssueFilterQuery): Prisma.IssueWhereInput {
  const states = normalizeArrayParam(query.state);
  const priorities = normalizeArrayParam(query.priority);
  const assignees = normalizeArrayParam(query.assignee);
  const labels = normalizeArrayParam(query.label);
  const dueDate = dateRange(query.due_after, query.due_before);
  const createdAt = dateRange(query.created_after, query.created_before);

  return {
    project_id: projectId,
    deleted_at: null,
    ...(states && { state_id: { in: states } }),
    ...(priorities && { priority: { in: priorities as Issue['priority'][] } }),
    ...(assignees && { assignees: { some: { user_id: { in: assignees } } } }),
    ...(labels && { labels: { some: { label_id: { in: labels } } } }),
    ...(query.cycle !== undefined && { cycle_id: query.cycle }),
    ...(query.module !== undefined && { modules: { some: { module_id: query.module } } }),
    ...(query.created_by !== undefined && { created_by_id: query.created_by }),
    ...(query.parent_id !== undefined && { parent_id: query.parent_id }),
    ...(query.search && {
      OR: [
        { title: { contains: query.search, mode: 'insensitive' as const } },
        { description: { contains: query.search, mode: 'insensitive' as const } },
      ],
    }),
    ...(dueDate && { due_date: dueDate }),
    ...(createdAt && { created_at: createdAt }),
  };
}

/** Sort by the requested column, with `id` as a deterministic tiebreaker for stable cursoring. */
function buildOrderBy(query: IssueFilterQuery): Prisma.IssueOrderByWithRelationInput[] {
  return [{ [query.sort_by]: query.order }, { id: query.order }];
}

/** Hard cap on rows returned for a board-view (grouped) response. */
const GROUP_FETCH_CAP = 500;

export interface IssueGroup {
  key: string | null;
  issues: IssueWithRelations[];
}

export type ListIssuesResult =
  | { data: IssueWithRelations[]; next_cursor: string | null }
  | { group_by: NonNullable<IssueFilterQuery['group_by']>; groups: IssueGroup[] };

export async function listIssues(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  query: IssueFilterQuery,
): Promise<ListIssuesResult> {
  await resolveProject(prisma, workspaceId, projectId);

  const where = buildWhere(projectId, query);
  const orderBy = buildOrderBy(query);

  if (query.group_by) {
    const issues = await prisma.issue.findMany({
      where,
      include: INCLUDE_RELATIONS,
      orderBy,
      take: GROUP_FETCH_CAP,
    });
    return { group_by: query.group_by, groups: bucketIssues(issues, query.group_by) };
  }

  const limit = query.limit;
  const issues = await prisma.issue.findMany({
    where,
    include: INCLUDE_RELATIONS,
    orderBy,
    take: limit + 1, // fetch one extra to determine if there is a next page
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });

  const hasMore = issues.length > limit;
  const data = hasMore ? issues.slice(0, limit) : issues;
  const next_cursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return { data, next_cursor };
}

/**
 * Bucket issues for a board view. Buckets preserve the order in which keys are
 * first seen (i.e. the sort order). For `assignee`, an issue appears in every
 * assignee bucket it belongs to; unassigned issues fall into the `null` bucket.
 */
function bucketIssues(
  issues: IssueWithRelations[],
  groupBy: NonNullable<IssueFilterQuery['group_by']>,
): IssueGroup[] {
  const groups = new Map<string | null, IssueWithRelations[]>();
  const push = (key: string | null, issue: IssueWithRelations): void => {
    const bucket = groups.get(key);
    if (bucket) bucket.push(issue);
    else groups.set(key, [issue]);
  };

  for (const issue of issues) {
    if (groupBy === 'state') push(issue.state_id, issue);
    else if (groupBy === 'priority') push(issue.priority, issue);
    else if (issue.assignees.length === 0) push(null, issue);
    else for (const a of issue.assignees) push(a.user_id, issue);
  }

  return [...groups.entries()].map(([key, bucketIssuesList]) => ({
    key,
    issues: bucketIssuesList,
  }));
}

export async function createIssue(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  creatorId: string,
  body: CreateIssueBody,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);

  // Validate state belongs to the project.
  const state = await prisma.state.findFirst({
    where: { id: body.state_id, project_id: projectId },
  });
  if (!state) throw AppError.badRequest('state_id does not belong to this project');

  // Validate parent (single-level only).
  if (body.parent_id) {
    const parent = await prisma.issue.findFirst({
      where: { id: body.parent_id, project_id: projectId, deleted_at: null },
    });
    if (!parent) throw AppError.badRequest('parent_id does not exist in this project');
    if (parent.parent_id)
      throw AppError.badRequest('Sub-issues cannot have sub-issues (single level only)');
  }

  return prisma.$transaction(async (tx) => {
    const sequenceId = await nextSequenceId(tx, projectId);

    const issue = await tx.issue.create({
      data: {
        workspace_id: workspaceId,
        project_id: projectId,
        sequence_id: sequenceId,
        title: body.title,
        description: body.description,
        state_id: body.state_id,
        priority: body.priority,
        parent_id: body.parent_id ?? null,
        start_date: body.start_date ? new Date(body.start_date) : null,
        due_date: body.due_date ? new Date(body.due_date) : null,
        estimate_points: body.estimate_points ?? null,
        created_by_id: creatorId,
        assignees: body.assignee_ids?.length
          ? { createMany: { data: body.assignee_ids.map((uid) => ({ user_id: uid })) } }
          : undefined,
        labels: body.label_ids?.length
          ? { createMany: { data: body.label_ids.map((lid) => ({ label_id: lid })) } }
          : undefined,
      },
      include: INCLUDE_RELATIONS,
    });

    await recordActivity(tx, {
      workspace_id: workspaceId,
      issue_id: issue.id,
      actor_id: creatorId,
      action: ACTIVITY_ACTIONS.ISSUE_CREATED,
    });

    // Notify anyone assigned at creation time (the creator self-assigning is
    // filtered out inside `notify`).
    await notify(tx, {
      workspace_id: workspaceId,
      actor_id: creatorId,
      type: 'issue_assigned',
      recipient_ids: body.assignee_ids ?? [],
      issue_id: issue.id,
    });

    return issue;
  });
}

export async function getIssue(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);
  return resolveIssue(prisma, projectId, issueId);
}

export async function updateIssue(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  actorId: string,
  body: UpdateIssueBody,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);
  const before = await resolveIssue(prisma, projectId, issueId);

  if (body.state_id) {
    const state = await prisma.state.findFirst({
      where: { id: body.state_id, project_id: projectId },
    });
    if (!state) throw AppError.badRequest('state_id does not belong to this project');
  }

  if (body.parent_id) {
    if (body.parent_id === issueId) throw AppError.badRequest('An issue cannot be its own parent');
    const parent = await prisma.issue.findFirst({
      where: { id: body.parent_id, project_id: projectId, deleted_at: null },
    });
    if (!parent) throw AppError.badRequest('parent_id does not exist in this project');
    if (parent.parent_id)
      throw AppError.badRequest('Sub-issues cannot have sub-issues (single level only)');
  }

  const completedAt = body.state_id
    ? await (async () => {
        const state = await prisma.state.findUnique({ where: { id: body.state_id } });
        return state?.group === 'completed' ? new Date() : null;
      })()
    : undefined;

  return prisma.$transaction(async (tx) => {
    const after = await tx.issue.update({
      where: { id: issueId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.state_id !== undefined && { state_id: body.state_id }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.parent_id !== undefined && { parent_id: body.parent_id }),
        ...(body.start_date !== undefined && {
          start_date: body.start_date ? new Date(body.start_date) : null,
        }),
        ...(body.due_date !== undefined && {
          due_date: body.due_date ? new Date(body.due_date) : null,
        }),
        ...(body.estimate_points !== undefined && { estimate_points: body.estimate_points }),
        ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
        ...(completedAt !== undefined && { completed_at: completedAt }),
      },
      include: INCLUDE_RELATIONS,
    });

    // Record one activity row per scalar field that actually changed.
    const changes = TRACKED_FIELDS.flatMap((field) => {
      const oldValue = activityValue(before[field]);
      const newValue = activityValue(after[field]);
      if (oldValue === newValue) return [];
      return [
        {
          workspace_id: workspaceId,
          issue_id: issueId,
          actor_id: actorId,
          action: ACTIVITY_ACTIONS.ISSUE_UPDATED,
          field,
          old_value: oldValue,
          new_value: newValue,
        },
      ];
    });
    await recordActivities(tx, changes);

    return after;
  });
}

export async function deleteIssue(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  actorId: string,
): Promise<void> {
  await resolveProject(prisma, workspaceId, projectId);
  await resolveIssue(prisma, projectId, issueId);

  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: issueId },
      data: { deleted_at: new Date() },
    });
    await recordActivity(tx, {
      workspace_id: workspaceId,
      issue_id: issueId,
      actor_id: actorId,
      action: ACTIVITY_ACTIONS.ISSUE_DELETED,
    });
  });
}

// ─── Assignees ────────────────────────────────────────────────────────────────

export async function addAssignee(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  actorId: string,
  userId: string,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);
  await resolveIssue(prisma, projectId, issueId);

  const existing = await prisma.issueAssignee.findUnique({
    where: { issue_id_user_id: { issue_id: issueId, user_id: userId } },
  });
  if (existing) throw AppError.conflict('User is already assigned to this issue');

  await prisma.$transaction(async (tx) => {
    await tx.issueAssignee.create({ data: { issue_id: issueId, user_id: userId } });
    await recordActivity(tx, {
      workspace_id: workspaceId,
      issue_id: issueId,
      actor_id: actorId,
      action: ACTIVITY_ACTIONS.ISSUE_ASSIGNEE_ADDED,
      field: 'assignee',
      new_value: userId,
    });
    await notify(tx, {
      workspace_id: workspaceId,
      actor_id: actorId,
      type: 'issue_assigned',
      recipient_ids: [userId],
      issue_id: issueId,
    });
  });
  return resolveIssue(prisma, projectId, issueId);
}

export async function removeAssignee(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  actorId: string,
  userId: string,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);
  await resolveIssue(prisma, projectId, issueId);

  const existing = await prisma.issueAssignee.findUnique({
    where: { issue_id_user_id: { issue_id: issueId, user_id: userId } },
  });
  if (!existing) throw AppError.notFound('Assignee not found on this issue');

  await prisma.$transaction(async (tx) => {
    await tx.issueAssignee.delete({
      where: { issue_id_user_id: { issue_id: issueId, user_id: userId } },
    });
    await recordActivity(tx, {
      workspace_id: workspaceId,
      issue_id: issueId,
      actor_id: actorId,
      action: ACTIVITY_ACTIONS.ISSUE_ASSIGNEE_REMOVED,
      field: 'assignee',
      old_value: userId,
    });
  });
  return resolveIssue(prisma, projectId, issueId);
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export async function attachLabel(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  actorId: string,
  labelId: string,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);
  await resolveIssue(prisma, projectId, issueId);

  const label = await prisma.label.findFirst({ where: { id: labelId, project_id: projectId } });
  if (!label) throw AppError.notFound('Label not found in this project');

  const existing = await prisma.issueLabel.findUnique({
    where: { issue_id_label_id: { issue_id: issueId, label_id: labelId } },
  });
  if (existing) throw AppError.conflict('Label is already attached to this issue');

  await prisma.$transaction(async (tx) => {
    await tx.issueLabel.create({ data: { issue_id: issueId, label_id: labelId } });
    await recordActivity(tx, {
      workspace_id: workspaceId,
      issue_id: issueId,
      actor_id: actorId,
      action: ACTIVITY_ACTIONS.ISSUE_LABEL_ADDED,
      field: 'label',
      new_value: labelId,
    });
  });
  return resolveIssue(prisma, projectId, issueId);
}

export async function detachLabel(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issueId: string,
  actorId: string,
  labelId: string,
): Promise<IssueWithRelations> {
  await resolveProject(prisma, workspaceId, projectId);
  await resolveIssue(prisma, projectId, issueId);

  const existing = await prisma.issueLabel.findUnique({
    where: { issue_id_label_id: { issue_id: issueId, label_id: labelId } },
  });
  if (!existing) throw AppError.notFound('Label is not attached to this issue');

  await prisma.$transaction(async (tx) => {
    await tx.issueLabel.delete({
      where: { issue_id_label_id: { issue_id: issueId, label_id: labelId } },
    });
    await recordActivity(tx, {
      workspace_id: workspaceId,
      issue_id: issueId,
      actor_id: actorId,
      action: ACTIVITY_ACTIONS.ISSUE_LABEL_REMOVED,
      field: 'label',
      old_value: labelId,
    });
  });
  return resolveIssue(prisma, projectId, issueId);
}
