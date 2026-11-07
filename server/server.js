
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { Velo } from "@carts1024/velo-sdk";
import {
  NoirAgentClient,
  keypairSigner,
  toStroops,
  fromStroops,
} from "@noirx402/agent-sdk";
import { velo } from "./velo.js";

const app = express();
const PORT = 3000;

app.use(cors());

// Velo setup
app.post(
  "/api/webhooks/velo",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-velo-signature"];
      const secret = process.env.VELO_WEBHOOK_SECRET;

      if (!secret || !signature) {
        return res.status(400).json({
          error: "Missing webhook configuration or signature.",
        });
      }

      const event = await Velo.webhooks.verify({
        payload: req.body,
        signature,
        secret,
      });

      console.log("Verified Velo webhook:", {
        id: event.id ?? "unknown",
        type: event.type ?? "unknown",
      });

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Velo webhook verification failed:", error.message);
      return res.status(400).json({
        received: false,
        error: "Invalid webhook signature.",
      });
    }
  }
);

app.use(express.json());

// Noir setup
if (!process.env.NOIR_AGENT_SECRET || !process.env.NOIR_MERCHANT_SECRET) {
  throw new Error("Missing Noir account configuration in .env");
}

const noir = new NoirAgentClient();

const agentSigner = keypairSigner(
  process.env.NOIR_AGENT_SECRET
);

const merchantSigner = keypairSigner(
  process.env.NOIR_MERCHANT_SECRET
);

const agentAddress = agentSigner.publicKey;
const merchantAddress = merchantSigner.publicKey;

const asset = Asset.native().contractId(Networks.TESTNET);

const DEVICE_UID = "PAYPILOT-DEMO-CARD-001";

const deviceHash = createHash("sha256")
  .update(DEVICE_UID)
  .digest("hex");

// Backend connection test
app.get("/", (req, res) => {
  res.send("PayPilot AI Server is running!");
});

// Noir account information
app.get("/api/noir/status", async (req, res) => {
  try {
    const balance = await noir.getEscrowBalance(deviceHash);
    const policy = await noir.getPolicy(deviceHash);

    res.json({
      success: true,
      agent: agentAddress,
      merchant: merchantAddress,
      escrowBalance: fromStroops(balance),
      policy: policy
        ? {
            agent: policy.agent,
            maxAmount: fromStroops(policy.maxAmount),
            asset: policy.asset,
            expiresAt: policy.expiresAt,
          }
        : null,
    });
  } catch (error) {
    console.error("Noir status error:", error.message);
    res.status(500).json({
      success: false,
      error: "Unable to retrieve Noir status.",
    });
  }
});

// Agent-driven Testnet payment
app.post("/api/noir/pay", async (req, res) => {
  try {
    const rawAmount = String(req.body.amount ?? "");

    if (!/^\d+(\.\d{1,7})?$/.test(rawAmount)) {
      return res.status(400).json({
        success: false,
        error: "Enter a valid XLM amount with up to 7 decimal places.",
      });
    }

    const amount = toStroops(rawAmount);

    if (amount <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Amount must be greater than zero.",
      });
    }

    console.log("Agent checking payment:", rawAmount, "XLM");

    // Step 1: Ask Noir to check the spending policy.
    const check = await noir.checkPayment({
      deviceHash,
      agent: agentAddress,
      asset,
      amount,
      requireEscrow: true,
    });

    if (!check.ok) {
      return res.status(403).json({
        success: false,
        refused: true,
        reason: check.reason,
        message: `Noir refused this payment: ${check.reason}`,
      });
    }

    // Step 2: Agent authorizes the payment.
    const authorization = await noir.authorizePayment({
      agent: agentSigner,
      deviceHash,
      merchant: merchantAddress,
      asset,
      amount,
    });

    console.log("Noir payment authorized:", authorization.hash);

    // Step 3: Merchant claims the pending payment.
    let claimHash = null;
    let claimError = null;

    try {
      const claim = await noir.claim({
        merchant: merchantSigner,
        token: asset,
      });

      claimHash = claim.hash;
      console.log("Merchant claimed payment:", claimHash);
    } catch (error) {
      claimError = "Payment authorized, but merchant claim needs retry.";
      console.error("Merchant claim error:", error.message);
    }

    return res.json({
      success: true,
      message: "Noir Agent authorized the Testnet payment.",
      amount: fromStroops(amount),
      asset: "XLM",
      agent: agentAddress,
      merchant: merchantAddress,
      authorizationHash: authorization.hash,
      claimHash,
      claimError,
    });
  } catch (error) {
    console.error("Noir payment error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Noir payment could not be completed.",
    });
  }
});

// Original Velo checkout
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { amount } = req.body;

    if (
      amount === undefined ||
      amount === null ||
      amount === "" ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      return res.status(400).json({
        error: "Please provide a valid amount.",
      });
    }

    const session = await velo.checkout.sessions.create({
      amount: Number(amount).toFixed(2),
      asset: "native",
      description: "PayPilot AI Testnet Payment",
      successUrl: "http://localhost:5174/success",
      cancelUrl: "http://localhost:5174/cancel",
    });

    if (!session.checkoutUrl) {
      throw new Error("Velo did not return a checkout URL.");
    }

    return res.json({
      success: true,
      checkoutUrl: session.checkoutUrl,
      paymentIntentId: session.paymentIntentId,
    });
  } catch (error) {
    console.error("Checkout error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Unable to create checkout session.",
    });
  }
});

// Original Velo payment lookup
app.get("/api/payment/:id", async (req, res) => {
  try {
    const intent = await velo.paymentIntents.retrieve(req.params.id);

    return res.json({
      success: true,
      payment: intent,
    });
  } catch (error) {
    console.error("Payment lookup error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Unable to retrieve payment information.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`PayPilot AI Server running on http://localhost:${PORT}`);
  console.log("Noir Agent:", agentAddress);
  console.log("Noir Merchant:", merchantAddress);
  console.log("Network: Stellar Testnet");
});
