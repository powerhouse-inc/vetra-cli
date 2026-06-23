/**
 * Live reproduction of the reactor sync-remote JSONB filter bug
 * (see repo-root `reactor-sync-filter-jsonb-bug.md`).
 *
 * Registers a sync channel against the staging switchboard's reactor sync
 * endpoint via `touchChannel`. An EMPTY documentId filter succeeds; a
 * NON-EMPTY one fails with `invalid input syntax for type json` because the
 * Postgres driver serializes the JS array to a Postgres array literal `{a,b}`
 * for the `jsonb` filter_document_ids column.
 *
 * Run (from the vetra-cli package):
 *   pnpm exec tsx scripts/repro-touchchannel-jsonb.ts
 */
import { getBearerToken } from "../src/auth/renown.js";
import { fetchMyEnvironments } from "../src/cloud/_cloud-client.js";

const WORKDIR = process.env.PH_WORKDIR ?? "/Users/yasiel/powerhouse/vetra-test";
const RENOWN_URL = "https://www.renown.id";
const SWITCHBOARD = "https://switchboard.staging.vetra.io";
const DRIVE_ID = "powerhouse";
const SYNC_ENDPOINT = `${SWITCHBOARD}/graphql/r`;

const MUTATION = `mutation ($i: TouchChannelInput!) {
  touchChannel(input: $i) { success ackOrdinal }
}`;

async function touchChannel(
  token: string,
  label: string,
  documentId: string[],
): Promise<void> {
  const input = {
    id: `repro-${label}`,
    name: `repro-${label}`,
    collectionId: `drive.main.${DRIVE_ID}`,
    filter: { documentId, scope: [] as string[], branch: "main" },
    sinceTimestampUtcMs: "0",
  };
  const res = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: MUTATION, variables: { i: input } }),
  });
  const text = await res.text();
  console.log(`\n--- ${label}: documentId=${JSON.stringify(documentId)} ---`);
  console.log(`HTTP ${res.status}`);
  console.log(text);
}

async function main(): Promise<void> {
  const token = await getBearerToken(WORKDIR, RENOWN_URL);
  if (!token) {
    console.error(
      `No Renown credential at ${WORKDIR}/.ph/.renown.json — authorize first.`,
    );
    process.exit(1);
  }
  console.log(`Endpoint: ${SYNC_ENDPOINT}`);
  console.log(`Token: ${token.slice(0, 24)}… (len ${token.length})`);

  console.log(">>>>> Touching empty documentId filter...");
  await touchChannel(token, "empty", []);
  console.log("\n\n\n>>>>> Touching nonempty documentId filter...");
  await touchChannel(token, "nonempty", ["*"]);

  // Decisive check: a REAL document id (a valid env doc in the powerhouse
  // drive). If this fails identically to ["*"], the array value is irrelevant
  // and the failure is purely the jsonb-array serialization bug.
  const envs = await fetchMyEnvironments(`${SWITCHBOARD}/graphql`, "ALL", token);
  const realId = envs[0]?.id;
  if (realId) {
    console.log(`\n\n\n>>>>> Touching with a REAL document id (${realId})...`);
    await touchChannel(token, "realdoc", [realId]);
  } else {
    console.log("\n\n\n>>>>> No real document id available; skipping real-id case.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
