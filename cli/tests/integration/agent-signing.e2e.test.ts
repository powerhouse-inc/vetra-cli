/**
 * F3c end to end: the Studio's own writes, its agent's work, are signed by
 * the agent's labelled session, `vetra agent vetra-agent`.
 *
 * A real switchboard (in this process, in memory, its data folder the
 * project) and the Studio's Cli serving in this process with its real
 * identity (`studioIdentity`). A trigger has the Cli run `spec-create` as its
 * own work, as the agent's tools do. Nobody is logged in: the agent's
 * pseudonym is made at that first write with no click, its session kept in
 * the project's data folder with the credential's record. Every operation of
 * the created spec and of its filing names that session; none is the
 * switchboard's.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCli, defineTrigger } from "@powerhousedao/clint";
import { runCli } from "@powerhousedao/clint/cli-runner";
import { listCredentialRecords } from "@powerhousedao/shared/clis/credential-records";
import { readActiveIdentity } from "@powerhousedao/shared/clis/identity";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import type { DocumentModelModule, Operation } from "@powerhousedao/shared/document-model";
import { startSwitchboard, type SwitchboardReactor } from "@powerhousedao/switchboard/server";
import { createSignatureVerifier } from "@renown/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AGENT_LABEL } from "../../src/auth/agent-files.js";
import { studioIdentity } from "../../src/auth/studio-identity.js";
import { specCreate } from "../../src/commands/spec/create.js";
import { CLI_NAME, CLI_VERSION } from "../../src/config.js";

const EDITOR_TYPE = "powerhouse/document-editor";

let root: string;
let project: string;
let home: string;
let switchboard: SwitchboardReactor | undefined;
let serving: Promise<number> | undefined;
const stop = new AbortController();
const saved = {
  home: process.env.PH_IDENTITY_HOME,
  dataDir: process.env.PH_USER_DATA_DIR,
  key: process.env.PH_IDENTITY_KEY,
};

/** What the agent's own `spec-create` came back with. */
let settle!: (outcome: { result?: unknown; error?: Error }) => void;
const written = new Promise<{ result?: unknown; error?: Error }>((resolve) => (settle = resolve));

async function models(): Promise<DocumentModelModule[]> {
  const [vetra, common] = await Promise.all([
    import("@powerhousedao/vetra"),
    import("@powerhousedao/clint-common"),
  ]);
  return [
    driveDocumentModelModule as unknown as DocumentModelModule,
    ...(vetra.documentModels as unknown as DocumentModelModule[]),
    ...(common.documentModels as unknown as DocumentModelModule[]),
  ];
}

/** The Studio's Cli as far as this test needs it: its identity, and a trigger
 * that has it create a spec once, as its own work. */
function studioCli() {
  let fired = false;
  const cli = defineCli({
    name: CLI_NAME,
    version: CLI_VERSION,
    description: "The Studio's Cli, writing as its agent",
    commands: [specCreate],
    configSchema: z.object({}).passthrough(),
    triggers: [
      defineTrigger({
        id: "agent-writes",
        type: "condition",
        poll: () => {
          if (fired) return Promise.resolve(null);
          fired = true;
          return Promise.resolve({
            type: "command" as const,
            params: {
              commandId: "spec-create",
              args: { type: EDITOR_TYPE, name: "Agent Editor" },
            },
            callbacks: {
              onSuccess: (result: unknown) => settle({ result }),
              onFailure: (error: Error) => settle({ error }),
            },
          });
        },
      }),
    ],
    // Short ticks: a stop waits for the tick in progress.
    routine: { tickInterval: 200 },
  });
  cli.configureReactor({
    create: () => Promise.reject(new Error("attaches only")),
    remote: async (setup) => ({
      documentModels: await models(),
      drive: { name: "Home", preferredEditor: "vetra-studio" },
      subscriptions: {},
      ...(await studioIdentity(setup)),
    }),
  });
  return cli;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "vetra-f3c-agent-"));
  project = join(root, "project");
  home = join(root, "identities");
  mkdirSync(join(project, "node_modules"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "f3c-agent-lab" }));
  writeFileSync(join(project, "powerhouse.config.json"), "{}");
  // The agent signs in this process: its identity folder is the test's.
  process.env.PH_IDENTITY_HOME = home;
  delete process.env.PH_USER_DATA_DIR;
  delete process.env.PH_IDENTITY_KEY;

  switchboard = await startSwitchboard(
    {
      server: { port: 0, host: "127.0.0.1" },
      storage: { inMemory: true, userDataDir: project },
      features: { workflows: false, mcp: false },
      packages: {
        disableLocal: true,
        list: ["@powerhousedao/vetra", "@powerhousedao/clint-common"],
      },
      identity: {
        keypairPath: join(root, "switchboard", ".keypair.json"),
        storagePath: join(root, "switchboard", ".renown.json"),
      },
      protocol: { createSignaturePolicy: "legacy" },
      // The Studio drive, which the Cli finds by its name.
      drive: { slug: "studio", global: { name: "Home" } },
    },
    { signalHandlers: false, fatalErrorShutdown: false },
  );
  serving = runCli(studioCli(), {
    argv: [],
    url: `http://127.0.0.1:${switchboard.port}/d/studio`,
    workdir: project,
    signal: stop.signal,
  });
}, 120_000);

afterAll(async () => {
  stop.abort();
  await serving;
  await switchboard?.shutdown();
  for (const [name, value] of [
    ["PH_IDENTITY_HOME", saved.home],
    ["PH_USER_DATA_DIR", saved.dataDir],
    ["PH_IDENTITY_KEY", saved.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(root, { recursive: true, force: true });
}, 60_000);

/** Every operation of `documentId`, all scopes. */
async function operationsOf(documentId: string): Promise<Operation[]> {
  const page = await switchboard!.reactor.getOperations(documentId, undefined, undefined, {
    cursor: "",
    limit: 1000,
  });
  return page.results;
}

describe("the Studio agent's own write", () => {
  it("is signed by the agent's session, labelled vetra agent vetra-agent", async () => {
    const outcome = await written;
    expect(outcome.error).toBeUndefined();
    const documentId = (outcome.result as { data: { documentId: string } }).data.documentId;

    // The pseudonym, made when the agent's first action was to be signed.
    const person = readActiveIdentity({ dataDir: project, env: { PH_IDENTITY_HOME: home } });
    expect(person?.kind).toBe("pseudonym");
    const [record] = listCredentialRecords({ dataDir: project });
    expect(record).toMatchObject({
      address: person!.address.toLowerCase(),
      label: AGENT_LABEL,
      source: "cli",
    });
    const sessionKey = record!.sessionDid;

    const switchboardKey = switchboard!.renown?.signer.app?.key;
    const verify = createSignatureVerifier(true);
    const signedByAgent = async (operation: Operation) => {
      const signer = operation.action.context?.signer;
      expect(signer?.user.address).toBe(person!.address);
      expect(signer?.app).toEqual({ name: AGENT_LABEL, key: sessionKey });
      expect(signer?.signatures.at(-1)?.[1]).toBe(sessionKey);
      expect(signer?.app.key).not.toBe(switchboardKey);
      expect(await verify(operation, sessionKey)).toBe(true);
    };

    const created = await operationsOf(documentId);
    expect(created.map((op) => op.action.type)).toEqual(
      expect.arrayContaining(["CREATE_DOCUMENT", "UPGRADE_DOCUMENT"]),
    );
    for (const operation of created) await signedByAgent(operation);

    // Filed in the Studio drive, by the agent too.
    const drive = await switchboard!.reactor.get("studio");
    const filing = (await operationsOf(drive.header.id)).filter(
      (op) =>
        (op.action.type === "ADD_FILE" &&
          (op.action.input as { id?: string }).id === documentId) ||
        (op.action.type === "ADD_RELATIONSHIP" &&
          (op.action.input as { targetId?: string }).targetId === documentId),
    );
    expect(filing.map((op) => op.action.type).sort()).toEqual(["ADD_FILE", "ADD_RELATIONSHIP"]);
    for (const operation of filing) await signedByAgent(operation);
  }, 180_000);
});
