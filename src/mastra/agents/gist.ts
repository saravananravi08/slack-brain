import { Agent } from '@mastra/core/agent';
import type { Memory } from '@mastra/memory';

import type { createChannelMemorySearchTool } from '../tools/channel-memory-search.js';
import { GIST_INSTRUCTIONS } from './instructions.js';

export const GIST_MODEL_IDS = ['gpt-4.1', 'gpt-4.1-mini'] as const;

export type GistModelId = (typeof GIST_MODEL_IDS)[number];

export function createGistModel(modelId: GistModelId) {
  return `openai/${modelId}` as const;
}

export function createGistAgent(
  model: ReturnType<typeof createGistModel>,
  memory?: Memory,
  channelMemorySearch?: ReturnType<typeof createChannelMemorySearchTool>,
) {
  return new Agent({
    id: 'gist',
    name: 'Gist',
    description: 'Grounded Slack knowledge assistant for approved conversations',
    instructions: GIST_INSTRUCTIONS,
    model,
    tools: channelMemorySearch
      ? { search_channel_memory: channelMemorySearch }
      : {},
    ...(memory ? { memory } : {}),
  });
}
