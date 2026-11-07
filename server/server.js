
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { Asset, Networks } from "@stellar/stellar-sdk";
import {
  NoirAgentClient,
  keypairSigner,
  toStroops,
  fromStroops,
} from "@noirx402/agent-sdk";
import { Velo } from "@carts1024/velo-sdk";
import { velo } from "./velo.js";

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);

// Velo webhook - verify the signature before accepting events
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

app.use(express.json({ limit: "10kb" }));

// Noir configuration
if (
  !process.env.NOIR_AGENT_SECRET ||
  !process.env.NOIR_MERCHANT_SECRET
) {
  throw new Error("Missing Noir account configuration.");
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

// Health check
app.get("/", (req, res) => {
  res.send("PayPilot AI Server is running!");
});

// Noir account and policy information
app.get("/api/noir/status", async (req, res) => {
  try {
    const balance = await noir.getEscrowBalance(deviceHash);
    const policy = await noir.getPolicy(deviceHash);

    return res.json({
      success: true,
      network: "Stellar Testnet",
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

    return res.status(500).json({
      success: false,
      error: "Unable to retrieve Noir status.",
    });
  }
});

// Agent-driven Noir Testnet payment
app.post("/api/noir/pay", async (req, res) => {
  // Public production payments remain disabled until authentication is added.
  if (IS_PRODUCTION) {
    return res.status(403).json({
      success: false,
      error: "Testnet payments are disabled on the public server.",
    });
  }

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

    // Step 1: Check the Noir spending policy.
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
      network: "Stellar Testnet",
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

// Velo checkout
app.post("/api/create-checkout", async (req, res) => {
  // Do not allow public checkout creation until authentication is added.
  if (IS_PRODUCTION) {
    return res.status(403).json({
      success: false,
      error: "Checkout creation is disabled on the public server.",
    });
  }

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
        success: false,
        error: "Please provide a valid amount.",
      });
    }

    const frontendUrl =
      process.env.FRONTEND_URL || "http://localhost:5174";

    const session = await velo.checkout.sessions.create({
      amount: Number(amount).toFixed(2),
      asset: "native",
      description: "PayPilot AI Testnet Payment",
      successUrl: `${frontendUrl}/success`,
      cancelUrl: `${frontendUrl}/cancel`,
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

// Velo payment lookup
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

// Start server
app.listen(PORT, () => {
  console.log(`PayPilot AI Server running on port ${PORT}`);
  console.log("Noir Agent:", agentAddress);
  console.log("Noir Merchant:", merchantAddress);
  console.log("Network: Stellar Testnet");
  console.log("Production mode:", IS_PRODUCTION);
});
