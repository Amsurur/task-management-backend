// Users directory + public profiles.
//
// Any authenticated user can browse the people registered in this backend and
// open a profile. A profile shows the user's projects using GitHub-style
// visibility: `public` projects are visible to everyone; `private` projects are
// only shown to viewers who share access (a member of the project's workspace or
// of the project itself). Hidden projects are reported as a count only.

import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { chatHub } from '../chat/realtime.js';

const publicUser = {
  id: true,
  email: true,
  display_name: true,
  avatar_url: true,
  created_at: true,
} as const;

export interface PresenceEntry {
  user_id: string;
  online: boolean;
  last_seen_at: Date | null;
}

/**
 * Online status for a set of users. `online` comes from live socket connections;
 * `last_seen_at` (when offline) lets the client show "last seen 5 min ago".
 */
export async function getPresence(prisma: PrismaClient, ids: string[]): Promise<PresenceEntry[]> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, last_seen_at: true },
  });
  return users.map((u) => {
    const online = chatHub.isOnline(u.id);
    return { user_id: u.id, online, last_seen_at: online ? null : u.last_seen_at };
  });
}

/** Directory listing — all active users, optionally filtered by name/email. */
export async function listUsers(
  prisma: PrismaClient,
  query: string | undefined,
  limit: number,
): Promise<unknown[]> {
  const q = query?.trim();
  return prisma.user.findMany({
    where: {
      is_active: true,
      ...(q
        ? {
            OR: [
              { display_name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: publicUser,
    take: limit,
    orderBy: { display_name: 'asc' },
  });
}

interface ProfileProject {
  id: string;
  name: string;
  identifier: string;
  description: string | null;
  visibility: string;
  created_at: Date;
  workspace: { slug: string; name: string } | null;
}

export interface UserProfile {
  user: {
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
    created_at: Date;
  };
  stats: { workspaces: number; projects: number; public_projects: number };
  projects: ProfileProject[];
  /** Projects the viewer isn't allowed to see (private, no shared access). */
  private_project_count: number;
}

/**
 * A user's public profile. `projects` contains only what the viewer may see;
 * `private_project_count` is how many of the user's projects are hidden.
 */
export async function getUserProfile(
  prisma: PrismaClient,
  viewerId: string,
  userId: string,
): Promise<UserProfile> {
  const user = await prisma.user.findFirst({
    where: { id: userId, is_active: true },
    select: publicUser,
  });
  if (!user) throw AppError.notFound('User not found');

  // Projects this user is associated with: a member of, or the lead of.
  const associated = await prisma.project.findMany({
    where: {
      is_archived: false,
      OR: [{ members: { some: { user_id: userId } } }, { lead_id: userId }],
    },
    include: { workspace: { select: { slug: true, name: true } } },
    orderBy: { created_at: 'desc' },
  });

  // What the viewer is allowed to see beyond public projects: workspaces they
  // belong to, and projects they are a direct member of.
  const [viewerWorkspaces, viewerProjects] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { user_id: viewerId }, select: { workspace_id: true } }),
    prisma.projectMember.findMany({
      where: { user_id: viewerId, project_id: { in: associated.map((p) => p.id) } },
      select: { project_id: true },
    }),
  ]);
  const viewerWorkspaceIds = new Set(viewerWorkspaces.map((m) => m.workspace_id));
  const viewerProjectIds = new Set(viewerProjects.map((m) => m.project_id));

  const canSee = (p: (typeof associated)[number]): boolean =>
    p.visibility === 'public' ||
    viewerWorkspaceIds.has(p.workspace_id) ||
    viewerProjectIds.has(p.id);

  const visible = associated.filter(canSee);
  const publicCount = associated.filter((p) => p.visibility === 'public').length;

  const workspaceCount = await prisma.workspaceMember.count({ where: { user_id: userId } });

  return {
    user,
    stats: { workspaces: workspaceCount, projects: associated.length, public_projects: publicCount },
    projects: visible.map((p) => ({
      id: p.id,
      name: p.name,
      identifier: p.identifier,
      description: p.description,
      visibility: p.visibility,
      created_at: p.created_at,
      workspace: p.workspace,
    })),
    private_project_count: associated.length - visible.length,
  };
}
