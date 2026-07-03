// AI assistant tools.
//
// Each tool maps to a real REST endpoint, executed via `app.inject()` with the
// caller's own Authorization header. This means the assistant can only ever do
// what the user is already allowed to do — every request goes through the same
// auth hooks, workspace-membership checks and Zod validation as a normal call.
// There is no privileged back door.

import type { FastifyInstance } from 'fastify';
import type { InjectOptions, Response as InjectResponse } from 'light-my-request';

/** A JSON-schema-ish tool definition (provider-agnostic). */
export interface AiToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Tool schemas advertised to the model. Kept small and task-focused. */
export const AI_TOOLS: AiToolDef[] = [
  {
    name: 'whoami',
    description: 'Get the current authenticated user (id, email, display name).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_workspaces',
    description: 'List the workspaces the current user belongs to.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_workspace',
    description: 'Create a new workspace. The current user becomes its owner.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable workspace name' },
        slug: {
          type: 'string',
          description: 'URL slug: lowercase letters, digits and hyphens only, 2-50 chars',
        },
      },
      required: ['name', 'slug'],
    },
  },
  {
    name: 'list_projects',
    description: 'List the projects inside a workspace.',
    input_schema: {
      type: 'object',
      properties: { workspace_slug: { type: 'string' } },
      required: ['workspace_slug'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a project inside a workspace. Default states are created automatically.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_slug: { type: 'string' },
        name: { type: 'string' },
        identifier: {
          type: 'string',
          description: 'Short uppercase key for issue numbers, e.g. "MOB" (A-Z0-9, max 10)',
        },
      },
      required: ['workspace_slug', 'name', 'identifier'],
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in a project. Use list_projects first to get the project id.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_slug: { type: 'string' },
        project_id: { type: 'string' },
      },
      required: ['workspace_slug', 'project_id'],
    },
  },
  {
    name: 'find_user',
    description:
      'Find registered users by name or email (e.g. to add as a contact or start a chat).',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of a name or email' } },
      required: ['query'],
    },
  },
  {
    name: 'list_labels',
    description: 'List the labels of a project.',
    input_schema: {
      type: 'object',
      properties: { workspace_slug: { type: 'string' }, project_id: { type: 'string' } },
      required: ['workspace_slug', 'project_id'],
    },
  },
  {
    name: 'create_label',
    description: 'Create a label in a project.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_slug: { type: 'string' },
        project_id: { type: 'string' },
        name: { type: 'string' },
        color: { type: 'string', description: 'Hex color like #3B82F6 (optional)' },
      },
      required: ['workspace_slug', 'project_id', 'name'],
    },
  },
  {
    name: 'assign_issue',
    description: 'Assign a user to an issue. Use find_user / list_workspaces to get the user id.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_slug: { type: 'string' },
        project_id: { type: 'string' },
        issue_id: { type: 'string' },
        user_id: { type: 'string' },
      },
      required: ['workspace_slug', 'project_id', 'issue_id', 'user_id'],
    },
  },
  {
    name: 'create_cycle',
    description: 'Create a cycle (sprint) in a project.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_slug: { type: 'string' },
        project_id: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['workspace_slug', 'project_id', 'name'],
    },
  },
  {
    name: 'create_issue',
    description:
      'Create an issue in a project. A workflow state is chosen automatically (the default/first state). Use list_projects to get the project id.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_slug: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string', description: 'Optional markdown description' },
        priority: {
          type: 'string',
          enum: ['none', 'low', 'medium', 'high', 'urgent'],
          description: 'Optional priority',
        },
      },
      required: ['workspace_slug', 'project_id', 'title'],
    },
  },
];

export interface ToolOutcome {
  ok: boolean;
  data?: unknown;
  error?: unknown;
}

const enc = encodeURIComponent;

/** Execute a tool call by injecting a real HTTP request with the user's token. */
export async function executeTool(
  app: FastifyInstance,
  authorization: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  // `app.inject`'s public type resolves to the chainable (no-arg) overload, so
  // narrow it to the Promise-returning form we actually use.
  const inject = app.inject as unknown as (opts: InjectOptions) => Promise<InjectResponse>;
  const call = async (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
  ): Promise<{ statusCode: number; data: unknown }> => {
    const opts: InjectOptions = {
      method,
      url,
      headers: { authorization, 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    };
    const res = await inject(opts);
    let data: unknown;
    try {
      data = res.body ? res.json() : null;
    } catch {
      data = res.body;
    }
    return { statusCode: res.statusCode, data };
  };
  const wrap = (r: { statusCode: number; data: unknown }): ToolOutcome =>
    r.statusCode < 400 ? { ok: true, data: r.data } : { ok: false, error: r.data };

  try {
    switch (name) {
      case 'whoami':
        return wrap(await call('GET', '/api/v1/auth/me'));
      case 'list_workspaces':
        return wrap(await call('GET', '/api/v1/workspaces'));
      case 'create_workspace':
        return wrap(
          await call('POST', '/api/v1/workspaces', {
            name: input.name,
            slug: input.slug,
          }),
        );
      case 'list_projects':
        return wrap(
          await call('GET', `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects`),
        );
      case 'create_project':
        return wrap(
          await call('POST', `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects`, {
            name: input.name,
            identifier: input.identifier,
          }),
        );
      case 'find_user':
        return wrap(await call('GET', `/api/v1/contacts/search?q=${enc(String(input.query))}`));
      case 'list_labels':
        return wrap(
          await call(
            'GET',
            `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects/${enc(String(input.project_id))}/labels`,
          ),
        );
      case 'create_label':
        return wrap(
          await call(
            'POST',
            `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects/${enc(String(input.project_id))}/labels`,
            { name: input.name, color: (input.color as string) || '#6B7280' },
          ),
        );
      case 'assign_issue':
        return wrap(
          await call(
            'POST',
            `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects/${enc(String(input.project_id))}/issues/${enc(String(input.issue_id))}/assignees`,
            { user_id: input.user_id },
          ),
        );
      case 'create_cycle':
        return wrap(
          await call(
            'POST',
            `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects/${enc(String(input.project_id))}/cycles`,
            { name: input.name },
          ),
        );
      case 'list_issues':
        return wrap(
          await call(
            'GET',
            `/api/v1/workspaces/${enc(String(input.workspace_slug))}/projects/${enc(String(input.project_id))}/issues`,
          ),
        );
      case 'create_issue': {
        const ws = enc(String(input.workspace_slug));
        const pid = enc(String(input.project_id));
        // Resolve a state automatically — the client (Claude) shouldn't have to know state ids.
        const statesRes = await call('GET', `/api/v1/workspaces/${ws}/projects/${pid}/states`);
        if (statesRes.statusCode >= 400) return { ok: false, error: statesRes.data };
        const raw = statesRes.data as unknown;
        const states = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? [])) as {
          id: string;
          is_default?: boolean;
        }[];
        const state = states.find((s) => s.is_default) ?? states[0];
        if (!state) return { ok: false, error: 'No workflow state found in this project' };
        const body: Record<string, unknown> = { title: input.title, state_id: state.id };
        if (input.description) body.description = input.description;
        if (input.priority) body.priority = input.priority;
        return wrap(await call('POST', `/api/v1/workspaces/${ws}/projects/${pid}/issues`, body));
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
