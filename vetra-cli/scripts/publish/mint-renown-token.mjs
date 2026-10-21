// Mint a short-lived Renown bearer token (aud = target registry) for publishing.
// Needs PH_RENOWN_PRIVATE_KEY + RENOWN_ADDRESS. Usage: <script> <registry-url>.
import { NodeKeyStorage, RenownCryptoBuilder } from "@renown/sdk/node";

const registryUrl = process.argv[2];
const address = process.env.RENOWN_ADDRESS;
if (!registryUrl) throw new Error("registry url argument is required");
if (!process.env.PH_RENOWN_PRIVATE_KEY) {
  throw new Error("PH_RENOWN_PRIVATE_KEY is not set");
}
if (!address) throw new Error("RENOWN_ADDRESS is not set");

// A Renown delegation credential for (RENOWN_ADDRESS -> this app DID) must
// already exist in Renown, or the registry rejects the token.
const crypto = await new RenownCryptoBuilder()
  .withKeyPairStorage(new NodeKeyStorage())
  .build();

const token = await crypto.getBearerToken(address, {
  aud: registryUrl,
  expiresIn: 600,
});

process.stdout.write(token);
