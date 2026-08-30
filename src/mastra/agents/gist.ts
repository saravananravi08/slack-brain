import { Agent } from '@mastra/core/agent';

import { GIST_INSTRUCTIONS } from './instructions.js';

export const GIST_MODEL_IDS = ['claude-opus-5', 'claude-sonnet-5'] as const;

export type GistModelId = (typeof GIST_MODEL_IDS)[number];

export function createGistModel(modelId: GistModelId) {
  return `anthropic/${modelId}` as const;
}

export function createGistAgent(model: ReturnType<typeof createGistModel>) {
  return new Agent({
    id: 'gist',
    name: 'Gist',
    description: 'Grounded Slack knowledge assistant for approved conversations',
    instructions: GIST_INSTRUCTIONS,
    model,
    tools: {},
  });
}
