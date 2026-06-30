/**
 * Placeholder for the preview-server base URL, baked literally into
 * vetra-app's `preview-server-client.ts` (keep the two in sync). The
 * `connect-drive-url` hook stamps it with the absolute proxy URL
 * (`<proxy>/preview`) the same way it stamps the drive URL. An unstamped
 * bundle (vite dev, or before the first stamp) falls back to the direct
 * preview-server port client-side.
 */
export const PREVIEW_SERVER_URL_PLACEHOLDER = 'http://__ph_preview_server_url__';

/**
 * Proxy path prefix for a reactor-project's Connect (the BUILD-pane iframe
 * target). Must equal `/{serviceId}/{captureName}` of the `vetra-studio`
 * capture in `services/reactor-project.ts` — ph-clint derives the proxy
 * route from those names. The service passes it to `ph vetra --base` so the
 * Vite dev server emits all URLs under this prefix, making the SPA
 * self-contained behind the proxy.
 */
export const REACTOR_PROJECT_CONNECT_PROXY_PATH = "/reactor-project/vetra-studio";

/**
 * Shared Renown localStorage namespace. Both the Studio Connect and the
 * preview reactor's Connect use this so the preview iframe reuses the owner's
 * already-established Renown session instead of prompting a second login.
 * Must match the literal in vetra-app's `build:connect` script.
 */
export const RENOWN_NAMESPACE = "vetra-studio";

/**
 * Proxy path prefix for a reactor-project's Switchboard. Routes registered by
 * `reactor-project-start` mirror the embedded `/switchboard/*` scheme
 * (`/d/`-aligned shape so X-Forwarded-Prefix lets the switchboard announce
 * proxied follow-up endpoints), and `ph vetra --drives-public-base` points
 * the nested studio's drive URLs here when a public proxy URL is configured.
 */
export const REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH = "/reactor-project/switchboard";

/**
 * Powerhouse stack version new reactor projects are initialized with.
 * Generated from the `catalog:` entry in pnpm-workspace.yaml at build time
 * (see scripts/build-assets.ts) so it tracks the version vetra-cli's runtime
 * is built against.
 */
export { DEFAULT_PH_VERSION } from './ph-version.gen.js';
