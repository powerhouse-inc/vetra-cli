/**
 * Port for the embedded `local-registry` service. The embedded Switchboard
 * and Connect in `cli.ts` resolve `registryUrl` from this constant, and the
 * service hardcodes it instead of exposing a `--port` param — the three need
 * to agree and there's no benefit to letting the user move the port off of
 * a value cli.ts can read at startup. Until ph-clint accepts a lazy
 * `registryUrl: (ctx) => string` callback (HANDOFF Known Issue #3),
 * keep this fixed.
 */
export const LOCAL_REGISTRY_PORT = 8765;
export const LOCAL_REGISTRY_URL = `http://localhost:${LOCAL_REGISTRY_PORT}`;

/**
 * Internal kill-switch for the local-registry + publish-reload integration
 * with the embedded Switchboard and Connect. When false, the registry
 * service, publish-reload trigger, and `registryUrl` wiring on the embedded
 * reactor are all skipped. Flip to true to restore the integration.
 */
export const LOCAL_REGISTRY_ENABLED = false;

/**
 * Placeholder baked into the prebuilt Connect bundle's
 * `PH_CONNECT_DEFAULT_DRIVES_URL` at package-build time. The
 * `connect-drive-url` lifecycle hook rewrites it to the live drive URL on
 * startup, since Connect can only read the value from a build-time literal.
 * The root `build` script must pass this exact string to
 * `ph-cli connect build --default-drives-url`.
 */
export const CONNECT_DRIVE_URL_PLACEHOLDER = 'http://__ph_drive_url__';

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
 * Powerhouse stack version new reactor projects are initialized with.
 * Generated from the `catalog:` entry in pnpm-workspace.yaml at build time
 * (see scripts/build-assets.ts) so it tracks the version vetra-cli's runtime
 * is built against.
 */
export { DEFAULT_PH_VERSION } from './ph-version.gen.js';
