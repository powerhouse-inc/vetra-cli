import { describe, it, expect, jest } from '@jest/globals';

const saveSpec = jest.fn<(doc: unknown, workdir: string) => Promise<string>>();

jest.unstable_mockModule('../../src/commands/spec/registry.js', () => ({
  saveSpec,
  listSpecTypes: () => ['powerhouse/app'],
}));

const { syncSpecsToFs } = await import('../../src/triggers/spec-sync.js');

describe('syncSpecsToFs', () => {
  const log = {
    debug: jest.fn<(msg: string) => void>(),
    warn: jest.fn<(msg: string) => void>(),
  };

  beforeEach(() => {
    saveSpec.mockReset();
    log.debug.mockReset();
    log.warn.mockReset();
  });

  it('forwards each doc to saveSpec with the given workdir', async () => {
    saveSpec.mockResolvedValue('/work/specs/foo.json');
    const docs = [
      { header: { id: 'a', documentType: 'powerhouse/document-model', name: 'foo' } },
      { header: { id: 'b', documentType: 'powerhouse/app', name: 'bar' } },
    ];
    await syncSpecsToFs(docs, '/work', { log });

    expect(saveSpec).toHaveBeenCalledTimes(2);
    expect(saveSpec).toHaveBeenNthCalledWith(1, docs[0], '/work');
    expect(saveSpec).toHaveBeenNthCalledWith(2, docs[1], '/work');
    expect(log.debug).toHaveBeenCalledTimes(2);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs and continues when saveSpec throws for one doc', async () => {
    saveSpec
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce('/work/specs/bar.json');
    const docs = [
      { header: { id: 'a', documentType: 'powerhouse/document-model', name: 'foo' } },
      { header: { id: 'b', documentType: 'powerhouse/app', name: 'bar' } },
    ];
    await syncSpecsToFs(docs, '/work', { log });

    expect(saveSpec).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toContain('"foo"');
    expect(log.warn.mock.calls[0][0]).toContain('disk full');
    expect(log.debug).toHaveBeenCalledTimes(1);
  });

  it('re-attaches operation history from the client, grouped by scope and ordered, dropping document scope', async () => {
    saveSpec.mockResolvedValue('/work/specs/foo.json');
    const getOperations = jest.fn<(docId: string) => Promise<unknown>>();
    getOperations
      .mockResolvedValueOnce({
        results: [
          { index: 1, action: { scope: 'global' } },
          { index: 0, action: { scope: 'global' } },
          { index: 0, action: { scope: 'document' } },
        ],
        next: () =>
          Promise.resolve({
            results: [{ index: 0, action: { scope: 'local' } }],
          }),
      });
    const docs = [
      { header: { id: 'a', documentType: 'powerhouse/app', name: 'foo' } },
    ];
    await syncSpecsToFs(docs, '/work', { log, client: { getOperations } });

    expect(getOperations).toHaveBeenCalledWith('a');
    expect(saveSpec).toHaveBeenCalledTimes(1);
    const written = saveSpec.mock.calls[0][0] as {
      operations: Record<string, { index: number }[]>;
    };
    // global ops re-ordered by index; document scope omitted; local drained from page 2.
    expect(written.operations.global.map((o) => o.index)).toEqual([0, 1]);
    expect(written.operations.local.map((o) => o.index)).toEqual([0]);
    expect(written.operations.document).toBeUndefined();
  });

  it('is a no-op for empty input', async () => {
    await syncSpecsToFs([], '/work', { log });
    expect(saveSpec).not.toHaveBeenCalled();
  });

  it('works without a logger', async () => {
    saveSpec.mockResolvedValue('/work/specs/x.json');
    await syncSpecsToFs(
      [{ header: { id: 'x', documentType: 'powerhouse/app', name: 'x' } }],
      '/work',
    );
    expect(saveSpec).toHaveBeenCalledTimes(1);
  });
});
