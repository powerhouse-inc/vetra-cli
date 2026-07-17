// Generate a Renown app key pair for CI publishing (one-time, offline).
// Run where @renown/sdk is installed: `node scripts/generate-renown-keypair.mjs`.
import { MemoryKeyStorage, RenownCryptoBuilder } from "@renown/sdk/node";

const storage = new MemoryKeyStorage();
const crypto = await new RenownCryptoBuilder()
  .withKeyPairStorage(storage)
  .build();
const keyPair = await storage.loadKeyPair();

console.log("App DID — issue a Renown delegation credential to this:\n");
console.log(`  ${crypto.did}\n`);
console.log("VETRA_REGISTRY_RENOWN_KEY — store as a CI secret (keep private):\n");
console.log(JSON.stringify(keyPair));
