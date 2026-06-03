// Cloud-based AI access via Vercel AI Gateway (default) or direct providers.
//
// AI Gateway is a unified endpoint that fronts every major provider
// (Anthropic, OpenAI, Google, Mistral, Meta, etc.) behind a single API.
// You change models by changing a string — "anthropic/claude-opus-4-6" → "openai/gpt-4o".
// It also handles fallbacks, caching, observability, and zero data retention.
//
// Setup: AI_GATEWAY_API_KEY in .env (get from Vercel Dashboard → AI → Gateway).
// Defaults to "auto" model selection — Vercel picks the best Claude available.

import {generateText, streamText, type LanguageModel} from 'ai';
import {createGateway} from '@ai-sdk/gateway';

const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? '',
  baseURL: process.env.AI_GATEWAY_BASE_URL,   // optional override
});

// Default model — change with one string. Examples:
//   anthropic/claude-opus-4-6
//   anthropic/claude-sonnet-4-6
//   openai/gpt-4o
//   google/gemini-2.5-pro
//   meta/llama-4-maverick
export const DEFAULT_MODEL = 'anthropic/claude-opus-4-6';

export function model(name: string = DEFAULT_MODEL): LanguageModel {
  return gateway(name);
}

// Convenience: one-shot text generation.
export async function complete(prompt: string, opts: {model?: string; system?: string} = {}) {
  const result = await generateText({
    model: model(opts.model),
    system: opts.system,
    prompt,
  });
  return result.text;
}

// Convenience: streaming. Pipe to a Next response, RSC stream, or fetch reader.
export function stream(prompt: string, opts: {model?: string; system?: string} = {}) {
  return streamText({
    model: model(opts.model),
    system: opts.system,
    prompt,
  });
}

// Tool-use / agent-shaped calls. Pass tools defined via `tool({...})` from `ai`.
export {tool, generateObject, streamObject} from 'ai';
