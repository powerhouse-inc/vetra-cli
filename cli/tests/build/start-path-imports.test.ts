/**
 * The start path stays light: help, version, a command's help, a command
 * that needs neither agent nor reactor, and the sending side of a command the
 * running Studio runs load none of the heavy packages. Each case runs the Cli
 * in a child process with a hook that records its imports.
 * The source entry always runs; the built bin runs when `dist/` is there.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveCommands, type CommandRequest } from "@powerhousedao/clint";
import { writeRunRecord } from "@powerhousedao/host-core";
import { openControlChannel, type ControlChannel } from "@powerhousedao/host-core/control-channel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const HOOK = pathToFileURL(join(HERE, "record-imports.mjs")).href;
const ROOT_URL = pathToFileURL(ROOT).href;

/** Packages that load on first use; a linked checkout resolves to `packages/<name>`. */
const HEAVY: [name: string, pattern: RegExp][] = [
  ["Mastra", /\/node_modules\/@mastra\//],
  ["the reactor client", /\/(?:@powerhousedao|packages)\/reactor[^/]*\//],
  ["Renown", /\/node_modules\/@renown\/|\/packages\/renown\//],
  ["the chat package", /\/(?:@powerhousedao|packages)\/clint-common\//],
  ["the vetra models", /\/(?:@powerhousedao|packages)\/vetra\//],
  ["document-model", /\/(?:@powerhousedao|packages|node_modules)\/document-model\//],
  ["the package's document models", /^own:\/document-models\//],
  ["the agent definitions", /^own:\/cli\/src\/agents\//],
  [
    "a heavy dependency",
    /\/node_modules\/(?:graphql|@graphql-tools|@graphql-codegen|viem|kysely|remeda|handlebars|highlight\.js|marked|marked-terminal|cli-highlight|http-proxy|ts-morph|typescript|@babel|yaml)\//,
  ],
];

/** Ceiling for packages not named above; `--help` loads 269 modules from source, 258 built. */
const MAX_MODULES = 450;

/** Ceiling for the process that sends a command to the running Studio; it loads 261 built. */
const MAX_FORWARDED_MODULES = 350;

function heavyImports(urls: string[]): string[] {
  return urls
    .map((url) => (url.startsWith(`${ROOT_URL}/`) && !url.includes("/node_modules/") ? `own:${url.slice(ROOT_URL.length)}` : url))
    .flatMap((url) => HEAVY.filter(([, pattern]) => pattern.test(url)).map(([name]) => `${name}: ${url}`));
}

const workdir = mkdtempSync(join(tmpdir(), "vetra-start-path-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

let run = 0;

async function recordImports(
  entry: string[],
  args: string[],
  dir: string = workdir,
): Promise<{ code: number; output: string; urls: string[] }> {
  const out = join(workdir, `imports-${run++}.txt`);
  const env: NodeJS.ProcessEnv = { ...process.env, RECORD_IMPORTS_OUT: out };
  // No switchboard to attach to, and the run record is the folder's own.
  delete env.VETRA_SWITCHBOARD_URL;
  delete env.PH_USER_DATA_DIR;
  const child = spawn(process.execPath, ["--import", HOOK, ...entry, "--workdir", dir, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr.on("data", (d: Buffer) => (output += d.toString()));
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 1));
  });
  const urls = existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean) : [];
  return { code, output, urls };
}

const CASES: { name: string; args: string[]; prints: RegExp }[] = [
  { name: "--help", args: ["--help"], prints: /spec-list/ },
  { name: "--version", args: ["--version"], prints: /\d+\.\d+\.\d+/ },
  { name: "<command> --help", args: ["spec-list", "--help"], prints: /--category/ },
  // Needs neither agent nor reactor.
  { name: "config --list", args: ["config", "--list"], prints: /model/ },
  // Reads files only: no Renown, no network (an exit after a request aborts
  // Node on Windows).
  { name: "whoami", args: ["whoami"], prints: /acts for the user's pseudonym/ },
];

const SOURCE = ["--import", "tsx", join(ROOT, "cli", "src", "main.ts")];
const BUILT = [join(ROOT, "bin", "vetra.mjs")];
const hasBuild = existsSync(join(ROOT, "dist", "node", "cli", "index.mjs"));

describe("heavyImports", () => {
  it("names the heavy packages, linked or installed", () => {
    const urls = [
      "file:///x/node_modules/.pnpm/@mastra+core@1/node_modules/@mastra/core/dist/agent/index.js",
      "file:///x/powerhouse/packages/reactor-browser/dist/index.js",
      "file:///x/node_modules/@powerhousedao/reactor/dist/index.js",
      "file:///x/powerhouse/packages/renown/dist/node.js",
      "file:///x/powerhouse/packages/clint-common/dist/chat/index.mjs",
      "file:///x/node_modules/@powerhousedao/vetra/dist/index.js",
      "file:///x/node_modules/document-model/dist/index.js",
      `${ROOT_URL}/document-models/index.ts`,
      `${ROOT_URL}/cli/src/agents/agent.ts`,
      "file:///x/node_modules/graphql/index.js",
    ];
    expect(heavyImports(urls)).toHaveLength(urls.length);
  });

  it("passes the start path's own modules", () => {
    expect(
      heavyImports([
        "node:fs",
        `${ROOT_URL}/cli/src/commands/spec/meta.ts`,
        "file:///x/powerhouse/packages/clint/dist/index.mjs",
        "file:///x/powerhouse/packages/host-core/dist/index.mjs",
        "file:///x/node_modules/zod/v4/index.js",
      ]),
    ).toEqual([]);
  });
});

describe.each([
  { target: "source", entry: SOURCE, skip: false },
  { target: "built bin", entry: BUILT, skip: !hasBuild },
])("start path imports ($target)", ({ entry, skip }) => {
  it.skipIf(skip).each(CASES)(
    "$name loads no heavy package",
    async ({ args, prints }) => {
      const { code, output, urls } = await recordImports(entry, args);
      expect(output).toMatch(prints);
      expect(code).toBe(0);
      expect(urls.length).toBeGreaterThan(20);
      expect(heavyImports(urls)).toEqual([]);
      expect(urls.length).toBeLessThan(MAX_MODULES);
    },
    60_000,
  );

  // A command that needs the reactor runs in the project's running Studio:
  // the process that was started for it sends it there and loads none of it.
  describe("a command the running Studio runs", () => {
    let project: string;
    let channel: ControlChannel;
    let received: CommandRequest[];

    beforeAll(async () => {
      project = mkdtempSync(join(tmpdir(), "vetra-forwarded-"));
      writeFileSync(join(project, "package.json"), JSON.stringify({ name: "forwarded" }));
      writeFileSync(join(project, "powerhouse.config.json"), "{}");
      received = [];
      channel = await openControlChannel();
      // The Studio's side of the channel, with no Studio behind it.
      serveCommands(channel, { name: "vetra", version: "0.0.0", workdir: project }, (command) => {
        received.push(command.request);
        command.stdout(`the Studio ran ${command.request.command}\n`);
        return Promise.resolve(0);
      });
      writeRunRecord(project, {
        version: 2,
        host: "studio",
        package: "@powerhousedao/vetra-cli",
        projectName: "forwarded",
        kind: "compound",
        verb: "serve",
        pid: process.pid,
        startedAt: new Date().toISOString(),
        members: {},
        extra: { control: channel.record },
      });
    });

    afterAll(async () => {
      await channel.close();
      rmSync(project, { recursive: true, force: true });
    });

    it.skipIf(skip)(
      "is sent there, and the sender loads no heavy package",
      async () => {
        const { code, output, urls } = await recordImports(entry, ["spec-list", "--category", "product"], project);
        expect(output).toMatch(/the Studio ran spec-list/);
        expect(code).toBe(0);
        expect(received.at(-1)).toMatchObject({
          cli: "vetra",
          command: "spec-list",
          input: { category: "product" },
          caller: { pid: expect.any(Number) as number },
        });
        expect(heavyImports(urls)).toEqual([]);
        expect(urls.length).toBeGreaterThan(20);
        expect(urls.length).toBeLessThan(MAX_FORWARDED_MODULES);
      },
      60_000,
    );

    it.skipIf(skip)(
      "is refused with no Studio, and builds no reactor of its own",
      async () => {
        const { code, output, urls } = await recordImports(entry, ["spec-list"]);
        expect(output).toMatch(/vetra spec-list runs in a running vetra, and none runs for/);
        expect(output).toMatch(/Start it with `ph vetra`/);
        expect(code).toBe(1);
        expect(heavyImports(urls)).toEqual([]);
        expect(urls.length).toBeLessThan(MAX_FORWARDED_MODULES);
      },
      60_000,
    );
  });
});
