// First-run Claude auth: on a bare interactive launch with no credential, offer
// the installer's three paths — paste a key, subscription login (OAuth), or skip.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { configKeyToEnvVar, localConfigPath, userConfigPath } from '@powerhousedao/ph-clint';
import {
  createClaudeAuthCommands,
  createSession,
  createUserTokenStore,
} from '@powerhousedao/ph-clint-claude-subscription';
import { CLI_NAME } from './config.js';

const KEY_ENV = configKeyToEnvVar(CLI_NAME, 'anthropicApiKey'); // VETRA_ANTHROPIC_API_KEY
const REQUIRE_ENV = configKeyToEnvVar(CLI_NAME, 'requireApiKey'); // VETRA_REQUIRE_API_KEY

// Value-taking pre-command flags whose following token must be skipped, not read
// as a subcommand (subset of ph-clint's private frameworkFlags, core/cli.ts).
const VALUE_FLAGS = new Set(['--resume', '--workdir', '-w']);

// Pure argv classification (TTY-independent, exported for tests): true when the
// launch is bare — no subcommand, no --version/--help/--meta, no explicit --config.
export function isBareLaunchArgs(argv: string[]): boolean {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--version' || a === '-V' || a === '--help' || a === '-h' || a === '--meta') return false;
    if (a === '-c' || a === '--config') return false; // explicit config: leave auth alone
    if (VALUE_FLAGS.has(a)) { i++; continue; } // skip the flag's value
    if (a.startsWith('-')) continue; // boolean pre-command flag (-i, --verbose, …)
    return false; // first bare token is a subcommand → one-shot
  }
  return true;
}

// A bare launch on a real terminal (both stdio a TTY) that will use the agent.
function isInteractiveLaunch(argv: string[]): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && isBareLaunchArgs(argv);
}

// The workdir the framework resolves config against: --workdir/-w value, else cwd.
export function resolveWorkdir(argv: string[]): string {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--workdir' || args[i] === '-w') && i + 1 < args.length) return args[i + 1];
  }
  return process.cwd();
}

// Resolve the key across the same layers as resolveConfig (minus --config): env,
// then the workdir's local config, then the user config file.
function resolveApiKey(workdir: string): string | undefined {
  const fromEnv = process.env[KEY_ENV];
  if (fromEnv) return fromEnv;
  return readKey(localConfigPath(workdir, CLI_NAME)) ?? readKey(userConfigPath(CLI_NAME));
}

function readKey(file: string): string | undefined {
  try {
    const v = (JSON.parse(fs.readFileSync(file, 'utf8')) as { anthropicApiKey?: unknown }).anthropicApiKey;
    return typeof v === 'string' && v ? v : undefined;
  } catch {
    return undefined;
  }
}

// Persist atomically at 0600 (writeFileSync's mode is ignored on an existing
// file); set the env first so the key works this run even if the write fails.
function persistApiKey(key: string): string {
  process.env[KEY_ENV] = key;
  const file = userConfigPath(CLI_NAME);
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  } catch { /* new or unreadable file */ }
  obj.anthropicApiKey = key;
  const data = `${JSON.stringify(obj, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows rename won't clobber an existing dest; write in place instead.
    fs.writeFileSync(file, data, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    fs.rmSync(tmp, { force: true });
  }
  return file;
}

async function runClaudeLogin(): Promise<void> {
  const login = createClaudeAuthCommands({ cliName: CLI_NAME }).find((c) => c.id === 'claude-login');
  if (!login) return;
  // --interactive uses only ctx.stdout + a fixed user-scope store; workspace is a stub.
  await login.execute(
    { interactive: true },
    {
      stdout: (text: string) => process.stdout.write(`${text}\n`),
      workspace: {
        loadJsonObject: async <T>(_f: string, fallback: T) => fallback,
        storeJsonObject: async () => {},
      },
    } as never,
  );
}

// Read a line with echo suppressed via raw mode (no readline private APIs).
// If the TTY can't enter raw mode, warn — the input can't be hidden.
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let raw = false;
    try { stdin.setRawMode?.(true); raw = true; } catch { /* leave cooked */ }
    if (!raw) process.stdout.write('(input will be visible) ');
    process.stdout.write(prompt);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = (val: string) => {
      stdin.removeListener('data', onData);
      if (raw) try { stdin.setRawMode?.(false); } catch { /* ignore */ }
      stdin.pause();
      process.stdout.write('\n');
      resolve(val);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10 || code === 4) return finish(buf); // enter / EOF
        if (code === 3) { // ctrl-c
          if (raw) try { stdin.setRawMode?.(false); } catch { /* ignore */ }
          process.stdout.write('\n');
          process.exit(130);
        }
        if (code === 127 || code === 8) { buf = buf.slice(0, -1); continue; } // backspace
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function promptSetup(): Promise<void> {
  process.stdout.write(
    [
      '',
      'Set up Claude auth',
      'Vetra calls Claude. How do you want to authenticate?',
      '  [1] Paste an Anthropic API key  (console.anthropic.com)',
      '  [2] Log in with a Claude.ai subscription',
      '  [3] Skip — set it up later',
      '',
    ].join('\n'),
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let choice: string;
  try {
    choice = (await rl.question('Choose [1/2/3]: ')).trim();
  } finally {
    rl.close(); // release stdin before raw read / claude-login's own reader
  }
  if (choice === '1') {
    const key = (await readSecret('Paste your Anthropic API key (hidden): ')).trim();
    if (!key) { process.stdout.write('No key entered — skipping.\n'); return; }
    try {
      process.stdout.write(`Saved your API key to ${persistApiKey(key)}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`Could not save the API key (${msg}); it is set for this session — export ${KEY_ENV} to persist it.\n`);
    }
    return;
  }
  if (choice === '2') {
    await runClaudeLogin();
    return;
  }
  process.stdout.write(
    `Skipped. Authenticate later with \`export ${KEY_ENV}=sk-ant-...\` or \`${CLI_NAME} claude-login\`.\n`,
  );
}

// Prompt for Claude auth on a bare interactive launch when none is configured.
// Best-effort: any failure is swallowed so the CLI always starts.
export async function ensureClaudeAuth(argv: string[]): Promise<void> {
  try {
    // Provisioned env (VETRA_REQUIRE_API_KEY=true): no interactive setup — the
    // entrypoint hold + agent.ts assertion own the "no key" path.
    if (process.env[REQUIRE_ENV] === 'true') return;
    if (!isInteractiveLaunch(argv)) return;
    if (resolveApiKey(resolveWorkdir(argv))) return; // API key configured
    try {
      const session = createSession({ store: createUserTokenStore({ cliName: CLI_NAME }) });
      if (await session.isAuthenticated()) return; // valid subscription session
    } catch {
      // corrupt/unreadable token file → treat as unconfigured and prompt
    }
    await promptSetup();
  } catch {
    // agent.ts still guides the user if unconfigured
  }
}
