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
