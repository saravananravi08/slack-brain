const EMBEDDING_DIMENSIONS = 1_536;

if (process.env.T306_SYNTHETIC_EMBEDDINGS === '1') {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/embeddings')) {
      throw new Error(`Unexpected network request during synthetic rehearsal: ${url}`);
    }

    const body = JSON.parse(String(init?.body));
    const values = Array.isArray(body.input) ? body.input : [body.input];
    const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
    embedding[0] = 1;
    return new Response(JSON.stringify({
      object: 'list',
      data: values.map((_, index) => ({ object: 'embedding', index, embedding })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: values.length, total_tokens: values.length },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}
