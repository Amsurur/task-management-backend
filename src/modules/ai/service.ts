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
  'actually do it — do not just describe how. Resolve names to ids first: a',
  'workspace is addressed by its `slug` (not its name) and a project by its id —',
  'if the user names them, call list_workspaces / list_projects (or find_user for',
  'people) to look up the slug/id before the create_* or list_* call. Never guess',
  'a slug from a display name. If a tool returns an error, read it, explain the',
  'problem in the user’s language, and suggest a fix.',
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Models tried in order for each request. Google's free-tier request quota is
 * per-model, so when the primary model is exhausted we fall through to the next
 * one — multiplying the total free capacity so the assistant keeps working far
 * longer without billing. Configured model first, then generous fallbacks.
 */
function modelCandidates(): string[] {
  const fallbacks = ['gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];
  return [...new Set([config.GEMINI_MODEL, ...fallbacks])];
}

/** Server-suggested retry delay from a 429 body ("retryDelay":"5s" or "retry in 30ms"). */
function parseRetryDelayMs(body: string): number | null {
  const s = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (s?.[1]) return Math.ceil(parseFloat(s[1]) * 1000);
  const ms = /retry in (\d+(?:\.\d+)?)ms/i.exec(body);
  if (ms?.[1]) return Math.ceil(parseFloat(ms[1]));
  const sec = /retry in (\d+(?:\.\d+)?)s/i.exec(body);
  if (sec?.[1]) return Math.ceil(parseFloat(sec[1]) * 1000);
  return null;
}

async function generateOnce(
  apiKey: string,
  model: string,
  contents: GeminiContent[],
): Promise<{ ok: true; content: GeminiContent } | { ok: false; status: number; message: string }> {
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
  if (res.ok) {
    const data = JSON.parse(text) as { candidates?: { content?: GeminiContent }[] };
    return { ok: true, content: data.candidates?.[0]?.content ?? { role: 'model', parts: [{ text: '' }] } };
  }
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    /* keep raw text */
  }
  return { ok: false, status: res.status, message };
}

/**
 * Call Gemini `generateContent`, trying each candidate model in turn. For a given
 * model: a rate limit (429) gets one short server-suggested retry, then we move
 * to the next model (its quota is separate); other 5xx get one backoff retry.
 * Only fails if every model is exhausted/unavailable.
 */
async function callGemini(apiKey: string, contents: GeminiContent[]): Promise<GeminiContent> {
  let lastMessage = 'unknown error';

  for (const model of modelCandidates()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await generateOnce(apiKey, model, contents);
      if (r.ok) return r.content;
      lastMessage = `${model}: ${r.message}`;

      // Rate limit (429) or transient overload (500/503): one quick retry on this
      // model, then fall through to the next model (its quota/capacity is separate).
      if (r.status === 429 || r.status === 500 || r.status === 503) {
        if (attempt === 0) {
          await sleep(Math.min(parseRetryDelayMs(r.message) ?? 600, 1500));
          continue;
        }
        break;
      }
      // Non-retryable (bad request, auth, unknown model, etc.) — surface immediately.
      throw new AppError(502, 'SERVICE_UNAVAILABLE', `Gemini request failed: ${r.message}`);
    }
  }

  throw new AppError(
    502,
    'SERVICE_UNAVAILABLE',
    `AI is temporarily rate-limited on all models. Please try again in a moment. (${lastMessage})`,
  );
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
    const modelTurn = await callGemini(config.GEMINI_API_KEY, contents);
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
