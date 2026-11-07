import { Keypair } from "@stellar/stellar-sdk";
import fs from "fs";
import path from "path";

const envPath = path.resolve(".env");

const env = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8")
  : "";

function getOrCreateAccount(name) {
  const existing = env.match(
    new RegExp(`^${name}=([^\\r\\n]+)`, "m")
  );

  if (existing) {
    const keypair = Keypair.fromSecret(existing[1]);
    return keypair.publicKey();
  }

  const keypair = Keypair.random();

  fs.appendFileSync(
    envPath,
    `\n${name}=${keypair.secret()}`
  );

  return keypair.publicKey();
}

const agent = getOrCreateAccount("NOIR_AGENT_SECRET");
const merchant = getOrCreateAccount("NOIR_MERCHANT_SECRET");

console.log("\nPayPilot AI Testnet Accounts");
console.log("Agent:", agent);
console.log("Merchant:", merchant);
console.log("\nSecret keys saved locally in .env.");
console.log("Do not share your .env file.");