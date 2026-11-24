/**
 * F3c end to end: a command typed in a second terminal runs in the running
 * Studio's Cli, and its writes are signed by the person who typed it.
 *
 * A real switchboard (in this process, in memory, its data folder the
 * project), a Cli serving `spec-create` in this process with a control
 * channel and the Studio's run record, and the real `vetra` command line in a
 * child process. The child finds the Studio through the record, sends the
 * command, and answers the Cli's signing asks with its own session: a
 * pseudonym made on the spot, a session labelled "vetra" in its identity
 * folder, the credential's record in the project. Every operation the command
 * wrote names the caller's address and session; none is the switchboard's.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCli, defineTrigger } from "@powerhousedao/clint";
import { runCli } from "@powerhousedao/clint/cli-runner";
import { writeRunRecord } from "@powerhousedao/host-core";
import {
  closeProcessControlChannel,
  ensureProcessControlChannel,
} from "@powerhousedao/host-core/control-channel";
import { listCredentialRecords } from "@powerhousedao/shared/clis/credential-records";
import { readActiveIdentity } from "@powerhousedao/shared/clis/identity";
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import type { DocumentModelModule, Operation } from "@powerhousedao/shared/document-model";
import { startSwitchboard, type SwitchboardReactor } from "@powerhousedao/switchboard/server";
import { createSignatureVerifier } from "@renown/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { specCreate } from "../../src/commands/spec/create.js";
import { CLI_NAME, CLI_VERSION } from "../../src/config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SOURCE = ["--import", "tsx", join(ROOT, "cli", "src", "main.ts")];
const EDITOR_TYPE = "powerhouse/document-editor";

let root: string;
let project: string;
let home: string;
let switchboard: SwitchboardReactor;
let serving: Promise<number> | undefined;
const stop = new AbortController();

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

/** The Studio's Cli as far as this test needs it: spec-create, serving. */
function studioCli() {
  const cli = defineCli({
    name: CLI_NAME,
    version: CLI_VERSION,
    description: "The Studio's Cli, serving spec-create",
    commands: [specCreate],
    configSchema: z.object({}).passthrough(),
    // A routine keeps it serving, as the Studio's triggers do.
    triggers: [defineTrigger({ id: "idle", type: "condition", poll: () => Promise.resolve(null) })],
    // Short ticks: a stop waits for the tick in progress.
    routine: { tickInterval: 200 },
  });
  cli.configureReactor({
    create: () => Promise.reject(new Error("attaches only")),
    remote: async () => ({
      documentModels: await models(),
      drive: { name: "Home", preferredEditor: "vetra-studio" },
      subscriptions: {},
    }),
  });
  return cli;
}

/** The `vetra` command line, from source, in the project. */
function vetra(args: string[]): Promise<{ code: number; output: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, PH_IDENTITY_HOME: home };
  delete env.VETRA_SWITCHBOARD_URL;
  delete env.PH_USER_DATA_DIR;
  const child = spawn(process.execPath, [...SOURCE, "--workdir", project, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr.on("data", (d: Buffer) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "vetra-f3c-"));
  project = join(root, "project");
  home = join(root, "identities");
  mkdirSync(join(project, "node_modules"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "f3c-lab" }));
  writeFileSync(join(project, "powerhouse.config.json"), "{}");

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
  const origin = `http://127.0.0.1:${switchboard.port}`;

  const channel = await ensureProcessControlChannel();
  if (!channel) throw new Error("no control channel");
  serving = runCli(studioCli(), {
    argv: [],
    url: `${origin}/d/studio`,
    workdir: project,
    signal: stop.signal,
  });
  writeRunRecord(project, {
    version: 2,
    host: "studio",
    package: "@powerhousedao/vetra-cli",
    projectName: "f3c-lab",
    kind: "compound",
    verb: "serve",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    extra: { control: channel.record },
    members: {
      switchboard: {
        host: "switchboard",
        runnerModule: "@powerhousedao/ph-cli/runners/switchboard",
        kind: "reactor",
        verb: "serve",
        outputs: {
          origin,
          endpoints: { graphql: `${origin}/graphql` },
          drives: { studio: { id: "studio", url: `${origin}/d/studio` } },
        },
      },
    },
  });
}, 120_000);

afterAll(async () => {
  stop.abort();
  await serving;
  await closeProcessControlChannel();
  await switchboard?.shutdown();
  rmSync(root, { recursive: true, force: true });
}, 60_000);

/** Every operation of `documentId`, all scopes. */
async function operationsOf(documentId: string): Promise<Operation[]> {
  const page = await switchboard.reactor.getOperations(documentId, undefined, undefined, {
    cursor: "",
    limit: 1000,
  });
  return page.results;
}

describe("a command typed beside the running Studio", () => {
  it("is signed by the person who typed it, through a session labelled vetra", async () => {
    const { code, output } = await vetra(["spec-create", "--type", EDITOR_TYPE, "--name", "Signed Editor"]);
    expect(output).toMatch(/Created powerhouse\/document-editor "Signed Editor"/);
    expect(code).toBe(0);
    const documentId = /id: (\S+)/.exec(output)![1]!;

    // The caller's pseudonym, made when the first action was to be signed.
    const person = readActiveIdentity({ dataDir: project, env: { PH_IDENTITY_HOME: home } });
    expect(person?.kind).toBe("pseudonym");
    const [record] = listCredentialRecords({ dataDir: project });
    expect(record).toMatchObject({
      address: person!.address.toLowerCase(),
      label: "vetra",
      source: "cli",
    });
    const sessionKey = record!.sessionDid;

    const switchboardKey = switchboard.renown?.signer.app?.key;
    const verify = createSignatureVerifier(true);
    const signedByCaller = async (operation: Operation) => {
      const signer = operation.action.context?.signer;
      expect(signer?.user.address).toBe(person!.address);
      expect(signer?.app).toEqual({ name: "vetra", key: sessionKey });
      expect(signer?.signatures.at(-1)?.[1]).toBe(sessionKey);
      expect(signer?.app.key).not.toBe(switchboardKey);
      expect(await verify(operation, sessionKey)).toBe(true);
    };

    const created = await operationsOf(documentId);
    expect(created.map((op) => op.action.type)).toEqual(
      expect.arrayContaining(["CREATE_DOCUMENT", "UPGRADE_DOCUMENT"]),
    );
    for (const operation of created) await signedByCaller(operation);

    // Filed in the Studio drive, by the caller too.
    const drive = await switchboard.reactor.get("studio");
    const filing = (await operationsOf(drive.header.id)).filter(
      (op) =>
        (op.action.type === "ADD_FILE" &&
          (op.action.input as { id?: string }).id === documentId) ||
        (op.action.type === "ADD_RELATIONSHIP" &&
          (op.action.input as { targetId?: string }).targetId === documentId),
    );
    expect(filing.map((op) => op.action.type).sort()).toEqual(["ADD_FILE", "ADD_RELATIONSHIP"]);
    for (const operation of filing) await signedByCaller(operation);
  }, 180_000);
});
