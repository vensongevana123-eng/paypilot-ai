import "dotenv/config";
import { Velo } from "@carts1024/velo-sdk";

export const velo = new Velo({
  apiKey: process.env.VELO_API_KEY,
  environment: "testnet",
});