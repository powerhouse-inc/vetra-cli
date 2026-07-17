// Issue a Renown delegation credential (publisher wallet -> CI app DID) and
// write it straight to switchboard GraphQL. Env vars listed in the throws below.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  buildAndSignCredential,
  NodeKeyStorage,
  RenownCryptoBuilder,
} from "@renown/sdk/node";

const walletKey = process.env.VETRA_REGISTRY_WALLET_KEY;
const switchboardUrl = process.env.PH_RENOWN_SWITCHBOARD_URL;
// Must match the chainId the SDK bearer token hardcodes (1); the registry
// fetches the credential by the token's chainId, so a mismatch denies publishes.
const chainId = Number(process.env.PH_RENOWN_CHAIN_ID || "1");
const expiresInDays = Number(process.env.PH_RENOWN_EXPIRES_DAYS || "365");
if (!walletKey) throw new Error("VETRA_REGISTRY_WALLET_KEY is not set");
if (!process.env.PH_RENOWN_PRIVATE_KEY)
  throw new Error("PH_RENOWN_PRIVATE_KEY is not set");
if (!switchboardUrl) throw new Error("PH_RENOWN_SWITCHBOARD_URL is not set");

// viem is a transitive dep of @renown/sdk, so resolve it from the SDK's dir.
const require = createRequire(import.meta.url);
const sdkDir = path.dirname(require.resolve("@renown/sdk/node"));
const { privateKeyToAccount } = await import(
  pathToFileURL(require.resolve("viem/accounts", { paths: [sdkDir] })).href
);

// Delegate to the CI app key's own DID so the binding matches the key that
// later mints publish tokens.
const crypto = await new RenownCryptoBuilder()
  .withKeyPairStorage(new NodeKeyStorage())
  .build();
const appDid = crypto.did;

const account = privateKeyToAccount(walletKey);
const vc = await buildAndSignCredential({
  signTypedData: (args) => account.signTypedData(args),
  address: account.address,
  chainId,
  app: "vetra-cli",
  appId: appDid,
  expiresInDays,
});

// Mirror the Renown app's storeCredential INIT input shape.
const initInput = {
  id: vc.id,
  context: vc["@context"],
  type: vc.type,
  issuer: { id: vc.issuer.id, ethereumAddress: vc.issuer.ethereumAddress },
  credentialSubject: {
    id: vc.credentialSubject.id,
    app: vc.credentialSubject.app,
  },
  credentialSchema: {
    id: vc.credentialSchema.id,
    type: vc.credentialSchema.type,
  },
  issuanceDate: vc.issuanceDate,
  expirationDate: vc.expirationDate || undefined,
  proof: {
    type: "EthereumEip712Signature2021",
    created: vc.issuanceDate,
    verificationMethod: vc.issuer.id,
    proofPurpose: "assertionMethod",
    proofValue: vc.proof.proofValue,
    ethereumAddress: vc.issuer.ethereumAddress,
    eip712: {
      domain: { version: "1", chainId },
      primaryType: "VerifiableCredential",
    },
  },
};

async function gql(query, variables) {
  const res = await fetch(switchboardUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors)
    throw new Error(
      `switchboard error: ${JSON.stringify(body.errors || res.status)}`,
    );
  return body.data;
}

const action = (type, input) => ({
  id: globalThis.crypto.randomUUID(),
  type,
  input,
  scope: "global",
  timestampUtcMs: Date.now(),
});

const created = await gql(
  `mutation ($documentType: String!) {
    createEmptyDocument(documentType: $documentType) { id }
  }`,
  { documentType: "powerhouse/renown-credential" },
);
const docId = created.createEmptyDocument.id;

await gql(
  `mutation ($documentIdentifier: String!, $actions: [JSONObject!]!) {
    mutateDocument(documentIdentifier: $documentIdentifier, actions: $actions) { id }
  }`,
  { documentIdentifier: docId, actions: [action("INIT", initInput)] },
);

console.log("Provisioned delegation credential:");
console.log(`  owner:      ${vc.issuer.id}`);
console.log(`  app DID:    ${appDid}`);
console.log(`  expires:    ${vc.expirationDate}`);
console.log(`  documentId: ${docId}`);
