import { Mastra } from '@mastra/core/mastra';

import { createMastraStorage } from './storage/index.js';
import { createGistObservability } from './storage/observability.js';

const databaseUrl = process.env.MASTRA_DATABASE_URL;

export const storage = createMastraStorage(
  databaseUrl ? { databaseUrl } : undefined,
);
export const observability = createGistObservability();

export const mastra = new Mastra({
  storage,
  observability,
  loggerOptions: { export: false },
});
