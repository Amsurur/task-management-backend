import type { PrismaClient, Project, ProjectMember } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { CreateProjectBody, UpdateProjectBody, AddProjectMemberBody } from './schema.js';

/** Default workflow states seeded for every new project. */
const DEFAULT_STATES = [
  { name: 'Backlog', color: '#6B7280', group: 'backlog' as const, order: 0 },
  { name: 'Todo', color: '#374151', group: 'unstarted' as const, order: 1, is_default: true },
  { name: 'In Progress', color: '#3B82F6', group: 'started' as const, order: 2 },
  { name: 'Done', color: '#10B981', group: 'completed' as const, order: 3 },
  { name: 'Cancelled', color: '#EF4444', group: 'cancelled' as const, order: 4 },
];

export async function listProjects(prisma: PrismaClient, workspaceId: string): Promise<Project[]> {
  return prisma.project.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'asc' },
  });
}

export async function createProject(
  prisma: PrismaClient,
  workspaceId: string,
  creatorId: string,
  body: CreateProjectBody,
): Promise<Project> {
  const conflict = await prisma.project.findUnique({
    where: { workspace_id_identifier: { workspace_id: workspaceId, identifier: body.identifier } },
  });
  if (conflict) {
    throw AppError.conflict(
      `Project identifier "${body.identifier}" is already used in this workspace`,
    );
  }

  if (body.lead_id) {
    const leadMember = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: body.lead_id } },
    });
    if (!leadMember) throw AppError.badRequest('Project lead must be a workspace member');
  }

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        workspace_id: workspaceId,
        name: body.name,
        identifier: body.identifier,
        description: body.description,
        lead_id: body.lead_id ?? null,
        visibility: body.visibility,
      },
    });

    // Seed default states.
    await tx.state.createMany({
      data: DEFAULT_STATES.map((s) => ({ ...s, project_id: project.id })),
    });

    // Add the creator as project admin.
    await tx.projectMember.create({
      data: { project_id: project.id, user_id: creatorId, role: 'admin' },
    });

    return project;
  });
}

export async function getProject(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
): Promise<Project> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');
  return project;
}

export async function updateProject(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  body: UpdateProjectBody,
): Promise<Project> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');

  if (body.lead_id) {
    const leadMember = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: body.lead_id } },
    });
    if (!leadMember) throw AppError.badRequest('Project lead must be a workspace member');
  }

  return prisma.project.update({
    where: { id: projectId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.lead_id !== undefined && { lead_id: body.lead_id }),
      ...(body.visibility !== undefined && { visibility: body.visibility }),
      ...(body.is_archived !== undefined && { is_archived: body.is_archived }),
    },
  });
}

export async function deleteProject(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');
  await prisma.project.delete({ where: { id: projectId } });
}

// ─── Project members ──────────────────────────────────────────────────────────

export async function listProjectMembers(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
): Promise<ProjectMember[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');

  return prisma.projectMember.findMany({
    where: { project_id: projectId },
    include: { user: { select: { id: true, email: true, display_name: true, avatar_url: true } } },
    orderBy: { created_at: 'asc' },
  });
}

export async function addProjectMember(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  body: AddProjectMemberBody,
): Promise<ProjectMember> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');

  // The user must already be a workspace member.
  const wsMember = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: body.user_id } },
  });
  if (!wsMember)
    throw AppError.badRequest('User must be a workspace member before joining a project');

  const existing = await prisma.projectMember.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: body.user_id } },
  });
  if (existing) throw AppError.conflict('User is already a member of this project');

  return prisma.projectMember.create({
    data: { project_id: projectId, user_id: body.user_id, role: body.role },
    include: { user: { select: { id: true, email: true, display_name: true, avatar_url: true } } },
  });
}

export async function removeProjectMember(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  targetUserId: string,
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace_id: workspaceId },
  });
  if (!project) throw AppError.notFound('Project not found');

  const member = await prisma.projectMember.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } },
  });
  if (!member) throw AppError.notFound('Member not found in this project');

  await prisma.projectMember.delete({
    where: { project_id_user_id: { project_id: projectId, user_id: targetUserId } },
  });
}
