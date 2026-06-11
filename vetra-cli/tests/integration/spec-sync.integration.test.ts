/**
 * Integration test for the drive → FS direction of spec-sync.
 *
 * Spins up an in-memory reactor with the vetra document models, subscribes
 * to spec doc-types, and verifies that creating a spec document in the
 * reactor results in syncSpecsToFs writing it to disk at the expected
 * `<workdir>/specs/<subdir>/<name>.<ext>.phd` location.
 *
 * Pattern is borrowed from packages/reactor/test/integration/subscriptions.test.ts
 * in the powerhouse monorepo (vitest there → jest here, and we layer the
 * syncSpecsToFs helper on top of the subscription).
 */

import {AppModuleV1} from "@powerhousedao/vetra/document-models"
import {AppModuleDocument, setAppName} from "@powerhousedao/vetra/document-models/app-module"
import {baseLoadFromFile} from "document-model/node"
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ReactorBuilder,
  ReactorClientBuilder,
  type ReactorClientModule,
} from '@powerhousedao/reactor';
import { documentModels as vetraDocumentModels } from '@powerhousedao/vetra';
import { documentModels as driveDocumentModels } from '@powerhousedao/clint-common';
import {
  addFile,
  addFolder,
  driveDocumentModelModule,
} from '@powerhousedao/shared/document-drive';
import { specPath } from '@powerhousedao/vetra/codegen';
import { syncSpecsToFs } from '../../src/triggers/spec-sync.js';

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeout?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 5_000;
  const intervalMs = opts.intervalMs ?? 25;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeout}ms`);
}

describe('spec-sync drive → FS integration', () => {
  let module: ReactorClientModule;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-sync-it-'));
    // Drive model must be registered or reactor builder rejects.
    const builder = new ReactorBuilder().withDocumentModels([
      driveDocumentModelModule,
      ...(driveDocumentModels as unknown as any[]),
      ...(vetraDocumentModels as unknown as any[]),
    ]);
    module = await new ReactorClientBuilder()
      .withReactorBuilder(builder)
      .buildModule();
  });

  afterEach(async () => {
    await module.reactor.kill().completed;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a created spec doc to <workdir>/specs/<subdir>/...phd', async () => {
    const written: string[] = [];
    const errors: string[] = [];
    const log = {
      debug: (m: string) => written.push(m),
      warn: (m: string) => errors.push(m),
    };

    // Subscribe → mirror to disk via the same helper the trigger uses.
    // Serialize writes so concurrent events targeting the same path don't
    // race; this keeps the final on-disk state aligned with the last event
    // we observed.
    let eventCount = 0;
    let chain: Promise<void> = Promise.resolve();
    const unsubscribe = module.client.subscribe(
      { type: 'powerhouse/app' },
      (event) => {
        if (event.documents.length === 0) return;
        eventCount += 1;
        chain = chain.then(() =>
          syncSpecsToFs(event.documents as never, tmpDir, {
            log,
            client: module.client as never,
          }),
        );
      },
    );

    const doc = AppModuleV1.utils.createDocument();
    doc.header.name = 'my-test-app';
    doc.header.documentType = 'powerhouse/app';
    await module.client.create(doc);

    await module.client.execute(doc.header.id, "main", [setAppName({ name: 'my-test-app-name' })]);

    // Two subscription events expected: one for create, one for execute.
    await waitUntil(() => eventCount >= 2);
    await chain;

    const expectedPath = specPath(tmpDir, 'powerhouse/app', 'my-test-app');
    const stat = await fs.stat(expectedPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(
      written.some(
        (m) =>
          m.includes('[spec-sync] wrote powerhouse/app') &&
          m.includes('my-test-app'),
      ),
    ).toBe(true);

    const specDoc = await baseLoadFromFile(expectedPath, AppModuleV1.reducer);
    const inMemory = await module.client.get<AppModuleDocument>(doc.header.id);

    expect(specDoc.header).toEqual(inMemory.header);
    expect(specDoc.state).toEqual(inMemory.state);
    expect((specDoc.state.global as { name: string }).name).toBe(
      'my-test-app-name',
    );
    // The written `.phd` preserves the operation history (the SET_APP_NAME
    // execute), not just the current-state snapshot. `client.get` returns a
    // state-only view, so this is asserted against the file, not `inMemory`.
    expect(specDoc.operations.global.length).toBeGreaterThan(0);
    expect(
      specDoc.operations.global.some(
        (op) => op.action.type === 'SET_APP_NAME',
      ),
    ).toBe(true);

    unsubscribe();
  }, 15_000);

  it('routes a doc filed under a project folder to <workdir>/<project>/specs/', async () => {
    const project = 'workout-tracker';
    const drive = await module.client.createEmpty('powerhouse/document-drive');
    const driveId = drive.header.id;
    const folderId = randomUUID();
    await module.client.execute(driveId, 'main', [
      addFolder({ id: folderId, name: project, parentFolder: null }) as never,
    ]);

    const doc = AppModuleV1.utils.createDocument();
    doc.header.name = 'filed-app';
    doc.header.documentType = 'powerhouse/app';
    await module.client.create(doc);
    await module.client.execute(driveId, 'main', [
      addFile({
        id: doc.header.id,
        name: 'filed-app',
        documentType: 'powerhouse/app',
        parentFolder: folderId,
      }) as never,
    ]);

    const inDrive = await module.client.get<AppModuleDocument>(doc.header.id);
    const nodes = (await module.client.get(driveId) as any).state.global.nodes;
    await syncSpecsToFs([inDrive] as never, tmpDir, { nodes });

    // Written under the project folder, not the workdir root.
    const projectPath = specPath(path.join(tmpDir, project), 'powerhouse/app', 'filed-app');
    expect((await fs.stat(projectPath)).isFile()).toBe(true);
    await expect(
      fs.stat(specPath(tmpDir, 'powerhouse/app', 'filed-app')),
    ).rejects.toBeTruthy();
  }, 15_000);

  it('only forwards documents of the subscribed type', async () => {
    const observed: string[] = [];
    const unsubscribe = module.client.subscribe(
      { type: 'powerhouse/app' },
      (event) => {
        for (const doc of event.documents) {
          observed.push((doc as any).header.documentType);
        }
      },
    );

    // Create a non-spec doc (the drive itself). Should not arrive on this
    // subscription.
    const driveModel = (driveDocumentModels as any[]).find(
      (m: any) => typeof m.utils?.createDocument === 'function',
    );
    if (driveModel) {
      try {
        const driveDoc = driveModel.utils.createDocument();
        await module.client.create(driveDoc);
      } catch {
        // Some doc-model types require additional setup; ignore — the point
        // is just that observed[] stays empty for non-app types.
      }
    }

    await new Promise((r) => setTimeout(r, 100));
    expect(observed.filter((t) => t !== 'powerhouse/app')).toEqual([]);

    unsubscribe();
  }, 10_000);
});
