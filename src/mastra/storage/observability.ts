import type { AnySpan, SpanOutputProcessor } from '@mastra/core/observability';
import {
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';

export const TRACE_ERROR_MESSAGE = 'Operation failed.';

function safeErrorName(name: string | undefined): string {
  if (name === 'Error' || (name && /^[A-Za-z][A-Za-z0-9]{0,63}Error$/.test(name))) {
    return name;
  }
  return 'Error';
}

export class TraceErrorRedactor implements SpanOutputProcessor {
  readonly name = 'gist-trace-error-redactor';

  process(span: AnySpan): AnySpan {
    if (span.errorInfo) {
      span.errorInfo = {
        message: TRACE_ERROR_MESSAGE,
        name: safeErrorName(span.errorInfo.name),
      };
    }
    return span;
  }

  async shutdown(): Promise<void> {}
}

export function createGistObservability(): Observability {
  return new Observability({
    configs: {
      default: {
        serviceName: 'gist',
        exporters: [new MastraStorageExporter({ strategy: 'realtime' })],
        spanOutputProcessors: [
          new TraceErrorRedactor(),
          new SensitiveDataFilter({ redactionStyle: 'full' }),
        ],
        includeInternalSpans: false,
        serializationOptions: {
          maxStringLength: 4_096,
          maxDepth: 6,
          maxArrayLength: 50,
          maxObjectKeys: 50,
        },
        logging: { enabled: false },
      },
    },
    sensitiveDataFilter: false,
  });
}
