/**
 * Local re-export of the shared cloud client. The deploy commands import the
 * shared `@powerhousedao/vetra-cloud-client` code through this single module
 * instead of the package specifier directly.
 *
 * In dev / tests / tsc type-check this resolves the workspace package as usual.
 * The production build (`build:cloud-client`) overwrites the tsc-emitted
 * `dist/cloud/_cloud-client.js` with a tsdown bundle that inlines the package
 * (and its `@powerhousedao/vetra-cloud-package` dep), so the shipped CLI carries
 * no external dependency on it — the shared client stays a LOCAL, unpublished
 * workspace package. See vetra-cli `package.json` build scripts.
 */
export * from "@powerhousedao/vetra-cloud-client";
