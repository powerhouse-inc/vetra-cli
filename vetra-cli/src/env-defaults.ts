/**
 * Process-wide env defaults, applied before any other module loads.
 * Imported first from main.ts so these are set before the reactor/switchboard boot.
 */

// Per-model GraphQL subgraphs build one executable schema per document model,
// each embedding every model's SDL (O(N^2)) plus a per-model ApolloServer. The
// studio and MCP query the merged supergraph, not the per-model endpoints, so
// these are dead weight (~200MB+ heap). Default off; override by setting the
// env explicitly.
process.env.DOCUMENT_MODEL_SUBGRAPHS_ENABLED ??= 'false';
