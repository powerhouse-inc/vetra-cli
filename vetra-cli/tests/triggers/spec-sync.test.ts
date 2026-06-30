import { describe, it, expect, jest } from '@jest/globals';
import { join } from 'node:path';
import type { SpecMirrorIo } from '../../src/triggers/spec-sync.js';
import { documentModelDocumentModelModule, actions, Operation } from 'document-model';

// Only needed so the module imports (listSpecTypes runs at load; realSpecMirrorIo
// is built from these). Tests inject their own io, so these are never exercised.
jest.unstable_mockModule('../../src/commands/spec/registry.js', () => ({
  saveSpec: jest.fn(),
  listSpecTypes: () => ['powerhouse/app'],
}));
jest.unstable_mockModule('../../src/commands/spec/_helpers.js', () => ({
  loadByName: jest.fn(),
}));
jest.unstable_mockModule('../../src/helpers/project-lock.js', () => ({
  withProjectCodegenLock: (_base: string, fn: () => Promise<unknown>) => fn(),
}));

const { syncSpecsToFs, mirrorSpecDoc, specRevision, resolveDriveNodes } =
  await import('../../src/triggers/spec-sync.js');

type LoadExisting = (
  projectDir: string,
  docId: string,
) => Promise<{ operations?: Record<string, unknown[]> }>;
type Save = (doc: unknown, projectDir: string) => Promise<string>;
type WithLock = (base: string, fn: () => Promise<unknown>) => Promise<unknown>;

function makeIo(over?: { loadExisting?: LoadExisting; save?: Save }) {
  const loadExisting = jest.fn<LoadExisting>(
    over?.loadExisting ??
      (async () => {
        throw new Error('ENOENT');
      }),
  );
  const save = jest.fn<Save>(over?.save ?? (async () => '/p/specs/x.phd'));
  const withLock = jest.fn<WithLock>((_b, fn) => fn());
  const io = { loadExisting, save, withLock } as unknown as SpecMirrorIo;
  return { io, loadExisting, save, withLock };
}

const docModel = {
  header: { id: 'doc-1', documentType: 'powerhouse/document-model', name: 'Todo List' },
};

describe('specRevision', () => {
  it('counts content-scope ops and excludes the document scope', () => {
    expect(specRevision(undefined)).toBe(0);
    expect(specRevision({})).toBe(0);
    expect(specRevision({ global: [{}, {}], local: [{}] })).toBe(3);
    expect(specRevision({ global: [{}], document: [{}, {}, {}] })).toBe(1);
  });
});

describe('mirrorSpecDoc', () => {
  it('writes when the drive revision is newer than disk', async () => {
    const { io, loadExisting, save, withLock } = makeIo({
      loadExisting: async () => ({ operations: { global: [{}] } }), // rev 1
    });
    const result = await mirrorSpecDoc(docModel, { global: [{}, {}] }, '/p', io); // rev 2
    expect(result).toBe('written');
    expect(withLock).toHaveBeenCalledWith('/p', expect.any(Function));
    // keyed by id, not display name
    expect(loadExisting).toHaveBeenCalledWith('/p', 'doc-1');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      header: { id: 'doc-1' },
      operations: { global: [{}, {}] },
    });
  });

  it('skips when the drive revision is not newer (equal)', async () => {
    const { io, save } = makeIo({
      loadExisting: async () => ({ operations: { global: [{}, {}] } }), // rev 2
    });
    const result = await mirrorSpecDoc(docModel, { global: [{}, {}] }, '/p', io); // rev 2
    expect(result).toBe('skipped');
    expect(save).not.toHaveBeenCalled();
  });

  it('skips a staler drive snapshot so it cannot clobber a newer file', async () => {
    const { io, save } = makeIo({
      loadExisting: async () => ({ operations: { global: [{}, {}, {}] } }), // rev 3
    });
    const result = await mirrorSpecDoc(docModel, { global: [{}] }, '/p', io); // rev 1
    expect(result).toBe('skipped');
    expect(save).not.toHaveBeenCalled();
  });

  it('writes the initial spec when nothing is on disk', async () => {
    const { io, save } = makeIo(); // loadExisting throws → onDisk -1
    const result = await mirrorSpecDoc(docModel, {}, '/p', io); // rev 0 > -1
    expect(result).toBe('written');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('resolveDriveNodes', () => {
  const nodes = [{ id: 'a', kind: 'file', name: 'foo', parentFolder: null }];
  const makeReactor = (over: Record<string, unknown>) => ({
    client: { get: jest.fn<(id: string) => Promise<unknown>>() },
    ...over,
  });

  it('returns [] when there is no reactor', async () => {
    expect(await resolveDriveNodes(undefined)).toEqual([]);
  });

  it('returns [] when the reactor has no drive id', async () => {
    const reactor = makeReactor({});
    expect(await resolveDriveNodes(reactor as never)).toEqual([]);
    expect(reactor.client.get).not.toHaveBeenCalled();
  });

  it('reads nodes from personalDriveId', async () => {
    const reactor = makeReactor({ personalDriveId: 'pd', driveId: 'other' });
    reactor.client.get.mockResolvedValue({ state: { global: { nodes } } });
    expect(await resolveDriveNodes(reactor as never)).toBe(nodes);
    expect(reactor.client.get).toHaveBeenCalledWith('pd');
  });

  it('falls back to driveId when personalDriveId is absent', async () => {
    const reactor = makeReactor({ driveId: 'd' });
    reactor.client.get.mockResolvedValue({ state: { global: { nodes } } });
    await resolveDriveNodes(reactor as never);
    expect(reactor.client.get).toHaveBeenCalledWith('d');
  });

  it('returns [] when the drive read throws', async () => {
    const reactor = makeReactor({ driveId: 'd' });
    reactor.client.get.mockRejectedValue(new Error('gone'));
    expect(await resolveDriveNodes(reactor as never)).toEqual([]);
  });

  it('returns [] when the drive has no node tree', async () => {
    const reactor = makeReactor({ driveId: 'd' });
    reactor.client.get.mockResolvedValue({ state: {} });
    expect(await resolveDriveNodes(reactor as never)).toEqual([]);
  });
});

describe('syncSpecsToFs', () => {
  const log = {
    debug: jest.fn<(msg: string) => void>(),
    warn: jest.fn<(msg: string) => void>(),
  };

  beforeEach(() => {
    log.debug.mockReset();
    log.warn.mockReset();
  });

  it('mirrors each doc (id-keyed, full operations) to the given workdir', async () => {
    const { io, save } = makeIo(); // first write for each
    const docs = [
      documentModelDocumentModelModule.utils.createDocument(),
      { header: { id: 'b', documentType: 'powerhouse/app', name: 'bar' } },
    ];
    await syncSpecsToFs(docs, '/work', { log, io });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toMatchObject(docs[0]);
    expect(save.mock.calls[0][1]).toBe('/work');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('re-attaches operation history from the client, grouped/ordered, preserving document scope', async () => {
    const { io, save } = makeIo();
    let doc = documentModelDocumentModelModule.utils.createDocument();
    doc = documentModelDocumentModelModule.reducer(doc, actions.setModelId({id: "test/model"}));
    doc = documentModelDocumentModelModule.reducer(doc, actions.setModelName({name: "Test Model"}));
    doc = documentModelDocumentModelModule.reducer(doc, actions.setModelDescription({description: "A test model"}));

    const getOperations = jest.fn<(docId: string) => Promise<unknown>>();
    getOperations.mockResolvedValueOnce({
      results: [
       ...doc.operations.global.slice(0, -1),
       ...doc.operations.document
      ] as Operation[],
      next: () =>
        Promise.resolve({ results: [doc.operations.global.at(-1)] }),
    });
    const docs = [
      { header: { id: 'a', documentType: 'powerhouse/app', name: 'foo' } },
    ];
    await syncSpecsToFs(docs, '/work', { log, io, client: { getOperations } });

    expect(getOperations).toHaveBeenCalledWith('a');
    expect(save).toHaveBeenCalledTimes(1);
    const written = save.mock.calls[0][0] as {
      operations: Record<string, { index: number }[]>;
    };
    expect(written.operations.global.map((o) => o.index)).toEqual([0, 1, 2]);
    // The `.phd` keeps the create ops; replay (loadSpecForFile) filters them.
    expect(written.operations.document).toHaveLength(doc.operations.document.length);
  });

  it('routes a doc under its drive project folder', async () => {
    const { io, save } = makeIo();
    const nodes = [
      { id: 'a', kind: 'file', name: 'foo', parentFolder: 'f1' },
      { id: 'f1', kind: 'folder', name: 'my-project', parentFolder: null },
    ];
    await syncSpecsToFs(
      [{ header: { id: 'a', documentType: 'powerhouse/app', name: 'foo' } }],
      '/work',
      { io, nodes },
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe(join('/work', 'my-project'));
  });

  it('falls back to workdir when the parent folder node is missing', async () => {
    const { io, save } = makeIo();
    const nodes = [{ id: 'a', kind: 'file', name: 'foo', parentFolder: 'ghost' }];
    await syncSpecsToFs(
      [{ header: { id: 'a', documentType: 'powerhouse/app', name: 'foo' } }],
      '/work',
      { io, nodes },
    );
    expect(save.mock.calls[0][1]).toBe('/work');
  });

  it('uses the real IO adapter (saveSpec) when none is injected', async () => {
    const registry = await import('../../src/commands/spec/registry.js');
    const saveSpec = jest.mocked(registry.saveSpec);
    saveSpec.mockClear();
    await syncSpecsToFs(
      [{ header: { id: 'z', documentType: 'powerhouse/app', name: 'z' } }],
      '/work',
    );
    expect(saveSpec).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when a write fails for one doc', async () => {
    const { io, save } = makeIo({
      save: async (doc) => {
        if ((doc as { header: { id: string } }).header.id === 'a') {
          throw new Error('disk full');
        }
        return '/work/specs/bar.phd';
      },
    });
    const docs = [
      { header: { id: 'a', documentType: 'powerhouse/document-model', name: 'foo' } },
      { header: { id: 'b', documentType: 'powerhouse/app', name: 'bar' } },
    ];
    await syncSpecsToFs(docs, '/work', { log, io });

    expect(save).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toContain('"foo"');
    expect(log.warn.mock.calls[0][0]).toContain('disk full');
  });

  it('is a no-op for empty input', async () => {
    const { io, save } = makeIo();
    await syncSpecsToFs([], '/work', { log, io });
    expect(save).not.toHaveBeenCalled();
  });

  it('works without a logger', async () => {
    const { io, save } = makeIo();
    await syncSpecsToFs(
      [{ header: { id: 'x', documentType: 'powerhouse/app', name: 'x' } }],
      '/work',
      { io },
    );
    expect(save).toHaveBeenCalledTimes(1);
  });
});
