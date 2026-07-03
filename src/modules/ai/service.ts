// AI assistant service (Google Gemini).
//
// Runs a function-calling agentic loop against Gemini. The assistant answers
// questions and takes actions (create workspaces / projects / issues, find
// users, …) by calling the tools in `tools.ts`, which execute as the
// authenticated user via `app.inject()`. Replies in the user's own language.

import type { FastifyInstance } from 'fastify';
import { config } from '../../config/index.js';
import { AppError } from '../../lib/errors.js';
import { AI_TOOLS, executeTool, type AiToolDef } from './tools.js';

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiAction {
  tool: string;
  ok: boolean;
}

export interface AiChatResult {
  reply: string;
  actions: AiAction[];
}

const SYSTEM_PROMPT = [
  'You are the built-in AI assistant of a Plane/Jira-style task-management app.',
  'You help the user manage their work: answering questions about their',
  'workspaces, projects, issues and contacts, and performing actions for them.',
  '',
  'Language: detect the language of the user’s message and ALWAYS reply in that',
  'same language — Russian, English, Uzbek, Chinese, French, Spanish, and any',
  'other. Never switch languages unless asked.',
  '',
  'Acting: when the user asks to create or change something, use the tools to',
  'actually do it — do not just describe how. Some actions need ids: call the',
  'list_* / find_user tools first to resolve a name or email into the id a',
  'create_* tool needs. If a tool returns an error, read it, explain the problem',
  'to the user in their language, and suggest a fix.',
  '',
  'Style: be concise and friendly. After doing something, confirm what you did in',
  'one or two sentences. Only ask a clarifying question when you truly cannot',
  'proceed.',
].join('\n');

const MAX_STEPS = 8;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// --- Gemini wire types (minimal) --------------------------------------------
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Convert a JSON-schema fragment to Gemini's schema shape (uppercase types). */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof schema.type === 'string') out.type = schema.type.toUpperCase();
  if (typeof schema.description === 'string') out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.properties && typeof schema.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties as Record<string, unknown>)) {
      props[k] = toGeminiSchema(v as Record<string, unknown>);
    }
    out.properties = props;
  }
  if (schema.items && typeof schema.items === 'object') {
    out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }
  return out;
}

/** Build Gemini `function_declarations` from our tool defs. */
function geminiFunctionDeclarations(tools: AiToolDef[]): Record<string, unknown>[] {
  return tools.map((t) => {
    const decl: Record<string, unknown> = { name: t.name, description: t.description };
    if (t.input_schema.properties && Object.keys(t.input_schema.properties).length > 0) {
      decl.parameters = toGeminiSchema(t.input_schema);
    }
    return decl;
  });
}

async function callGemini(
  apiKey: string,
  model: string,
  contents: GeminiContent[],
): Promise<GeminiContent> {
  const res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{ function_declarations: geminiFunctionDeclarations(AI_TOOLS) }],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    // Surface Gemini's own error message (e.g. bad key, unknown model).
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new AppError(502, 'SERVICE_UNAVAILABLE', `Gemini request failed: ${message}`);
  }

  const data = JSON.parse(text) as { candidates?: { content?: GeminiContent }[] };
  const content = data.candidates?.[0]?.content;
  if (!content) return { role: 'model', parts: [{ text: '' }] };
  return content;
}

export async function aiChat(
  app: FastifyInstance,
  authorization: string,
  message: string,
  history: AiHistoryMessage[] = [],
): Promise<AiChatResult> {
  if (!config.GEMINI_API_KEY) {
    throw new AppError(
      503,
      'SERVICE_UNAVAILABLE',
      'AI assistant is not configured. Set GEMINI_API_KEY in the environment.',
    );
  }

  const contents: GeminiContent[] = [
    ...history.slice(-20).map(
      (m): GeminiContent => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }),
    ),
    { role: 'user', parts: [{ text: message }] },
  ];

  const actions: AiAction[] = [];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const modelTurn = await callGemini(config.GEMINI_API_KEY, config.GEMINI_MODEL, contents);
    const calls = modelTurn.parts.filter((p) => p.functionCall);

    if (calls.length > 0) {
      contents.push(modelTurn); // echo the model's function-call turn
      const responseParts: GeminiPart[] = [];
      for (const part of calls) {
        const fc = part.functionCall!;
        const outcome = await executeTool(app, authorization, fc.name, fc.args ?? {});
        actions.push({ tool: fc.name, ok: outcome.ok });
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: outcome.ok ? { result: outcome.data } : { error: outcome.error },
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
      continue;
    }

    const reply = modelTurn.parts
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    return { reply, actions };
  }

  return {
    reply: 'I ran out of steps before finishing. Please try rephrasing or breaking up the request.',
    actions,
  };
}
