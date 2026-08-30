import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createSlackAdapter } from '@chat-adapter/slack';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as {
  engines: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('project scaffold', () => {
  it('exposes the approved runtime package APIs', () => {
    expect(
      [
        createAnthropic,
        createOpenAI,
        createSlackAdapter,
        Mastra,
        LibSQLStore,
        Memory,
      ].every((value) => typeof value === 'function'),
    ).toBe(true);
  });

  it('pins direct dependencies and standard scripts', () => {
    expect(packageJson.engines.node).toBe('>=22.13.0 <23');
    expect(packageJson.scripts).toMatchObject({
      'benchmark:retrieval':
        'node --experimental-strip-types benchmarks/retrieval/runner.ts',
      build: 'mastra build',
      dev: 'mastra dev',
      start: 'mastra start',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    });
    expect(packageJson.dependencies).not.toHaveProperty('@slack/bolt');
    expect(packageJson.dependencies).not.toHaveProperty('better-sqlite3');

    for (const version of Object.values({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    })) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
