// Generate a fresh Ethereum wallet to OWN vetra-cli in the registry (one-off).
// Prints the address + private key; store the key as a secret, never commit it.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// viem is a transitive dep of @renown/sdk, so resolve it from the SDK's dir.
const require = createRequire(import.meta.url);
const sdkDir = path.dirname(require.resolve("@renown/sdk/node"));
const { generatePrivateKey, privateKeyToAccount } = await import(
  pathToFileURL(require.resolve("viem/accounts", { paths: [sdkDir] })).href
);

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("Publisher wallet — this address OWNS vetra-cli in the registry:\n");
console.log(`  address: ${account.address}`);
console.log(`  did:pkh: did:pkh:eip155:1:${account.address.toLowerCase()}\n`);
console.log("VETRA_REGISTRY_WALLET_KEY — provisioning secret (keep private):\n");
console.log(`  ${privateKey}\n`);
console.log("VETRA_REGISTRY_RENOWN_ADDRESS — publish secret (the address above):\n");
console.log(`  ${account.address}`);
