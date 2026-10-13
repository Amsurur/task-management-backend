// Database seed (run via `npm run prisma:seed` / `npx prisma db seed`).
//
// Idempotent: the demo user is upserted by email and the whole demo workspace
// is skipped if the `demo` slug already exists, so it is safe to run repeatedly.

import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_STATES } from '../modules/projects/service.js';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'Demo12345!';
const DEMO_SLUG = 'demo';

async function main(): Promise<void> {
  const preexisting = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      password_hash: await argon2.hash(DEMO_PASSWORD),
      display_name: 'Demo User',
    },
  });

  const existing = await prisma.workspace.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.info(`Workspace "${DEMO_SLUG}" already exists — seed skipped.`);
    logCredentials(preexisting !== null);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: { name: 'Demo Workspace', slug: DEMO_SLUG, owner_id: user.id },
    });
    await tx.workspaceMember.create({
      data: { workspace_id: workspace.id, user_id: user.id, role: 'owner' },
    });

    const project = await tx.project.create({
      data: {
        workspace_id: workspace.id,
        name: 'Demo Project',
        identifier: 'DEMO',
        description: 'Sample project created by the seed script.',
        lead_id: user.id,
      },
    });
    await tx.projectMember.create({
      data: { project_id: project.id, user_id: user.id, role: 'admin' },
    });
    await tx.state.createMany({
      data: DEFAULT_STATES.map((s) => ({ ...s, project_id: project.id })),
    });
    const states = await tx.state.findMany({ where: { project_id: project.id } });
    const stateByName = (name: string): string => {
      const found = states.find((s) => s.name === name);
      if (!found) throw new Error(`Seed state missing: ${name}`);
      return found.id;
    };

    const bug = await tx.label.create({
      data: { workspace_id: workspace.id, project_id: project.id, name: 'bug', color: '#EF4444' },
    });
    const feature = await tx.label.create({
      data: {
        workspace_id: workspace.id,
        project_id: project.id,
        name: 'feature',
        color: '#3B82F6',
      },
    });

    const issues = [
      { title: 'Set up CI pipeline', state: 'Backlog', priority: 'low', label: feature.id },
      { title: 'Design onboarding flow', state: 'Todo', priority: 'medium', label: feature.id },
      { title: 'Fix login redirect loop', state: 'In Progress', priority: 'high', label: bug.id },
      { title: 'Add dark mode', state: 'Todo', priority: 'low', label: feature.id },
      { title: 'Crash on empty project list', state: 'Done', priority: 'urgent', label: bug.id },
      { title: 'Migrate to new logo', state: 'Cancelled', priority: 'none', label: null },
    ] as const;

    let firstIssueId = '';
    for (const [i, def] of issues.entries()) {
      const issue = await tx.issue.create({
        data: {
          workspace_id: workspace.id,
          project_id: project.id,
          sequence_id: i + 1,
          title: def.title,
          state_id: stateByName(def.state),
          priority: def.priority,
          created_by_id: user.id,
          sort_order: (i + 1) * 65536,
          completed_at: def.state === 'Done' ? new Date() : null,
        },
      });
      if (i === 0) firstIssueId = issue.id;
      await tx.issueAssignee.create({ data: { issue_id: issue.id, user_id: user.id } });
      if (def.label) {
        await tx.issueLabel.create({ data: { issue_id: issue.id, label_id: def.label } });
      }
    }

    await tx.comment.create({
      data: {
        issue_id: firstIssueId,
        author_id: user.id,
        body: 'Welcome to the demo workspace! This is a sample **comment**.',
      },
    });
  });

  // eslint-disable-next-line no-console
  console.info(`Seeded workspace "${DEMO_SLUG}" with project DEMO.`);
  logCredentials(preexisting !== null);
}

function logCredentials(userPreexisted: boolean): void {
  // An existing user keeps its own password (the upsert never overwrites it),
  // so only advertise the demo password when the seed created the account.
  // eslint-disable-next-line no-console
  console.info(
    userPreexisted
      ? `Demo user ${DEMO_EMAIL} already existed — its password was left unchanged.`
      : `Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
