
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

app.set("trust proxy", 1);

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

// Simple in-memory request limiter for the public demo.
const requestLimits = new Map();

function allowRequest(key, maxRequests, windowMs) {
  const now = Date.now();
  let entry = requestLimits.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    requestLimits.set(key, entry);
    return false;
  }

  entry.count += 1;
  requestLimits.set(key, entry);
  return true;
}

// Velo webhook signature verification.
app.post(
  "/api/webhooks/velo",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-velo-signature"];
      const secret = process.env.VELO_WEBHOOK_SECRET;

      if (!secret || !signature) {
        return res.status(400).json({
          received: false,
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

// Noir configuration.
if (
  !process.env.NOIR_AGENT_SECRET ||
  !process.env.NOIR_MERCHANT_SECRET
) {
  throw new Error("Missing Noir account configuration.");
}

const noir = new NoirAgentClient();

const agentSigner = keypairSigner(process.env.NOIR_AGENT_SECRET);
const merchantSigner = keypairSigner(process.env.NOIR_MERCHANT_SECRET);

const agentAddress = agentSigner.publicKey;
const merchantAddress = merchantSigner.publicKey;

const asset = Asset.native().contractId(Networks.TESTNET);

const DEVICE_UID = "PAYPILOT-DEMO-CARD-001";

const deviceHash = createHash("sha256")
  .update(DEVICE_UID)
  .digest("hex");

// Health check.
app.get("/", (req, res) => {
  res.send("PayPilot AI Server is running!");
});

// Read-only shared Noir demo status.
app.get("/api/noir/status", async (req, res) => {
  try {
    const balance = await noir.getEscrowBalance(deviceHash);
    const policy = await noir.getPolicy(deviceHash);

    return res.json({
      success: true,
      network: "Stellar Testnet",
      demoAccount: true,
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

// Shared server-side Noir payments stay disabled in production.
app.post("/api/noir/pay", async (req, res) => {
  if (IS_PRODUCTION) {
    return res.status(403).json({
      success: false,
      error: "Shared Noir payments are disabled on the public demo.",
    });
  }

  try {
    const rawAmount = String(req.body.amount ?? "");

    if (!/^\d+(\.\d{1,7})?$/.test(rawAmount)) {
      return res.status(400).json({
        success: false,
        error: "Enter a valid XLM amount.",
      });
    }

    const amount = toStroops(rawAmount);

    if (amount <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Amount must be greater than zero.",
      });
    }

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

    const authorization = await noir.authorizePayment({
      agent: agentSigner,
      deviceHash,
      merchant: merchantAddress,
      asset,
      amount,
    });

    let claimHash = null;
    let claimError = null;

    try {
      const claim = await noir.claim({
        merchant: merchantSigner,
        token: asset,
      });
      claimHash = claim.hash;
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

// Public Velo checkout: Stellar Testnet only.
app.post("/api/create-checkout", async (req, res) => {
  const clientKey = req.ip || "unknown";

  if (!allowRequest(clientKey, 5, 10 * 60 * 1000)) {
    return res.status(429).json({
      success: false,
      error: "Too many checkout requests. Please try again later.",
    });
  }

  try {
    const rawAmount = String(req.body.amount ?? "");

    if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
      return res.status(400).json({
        success: false,
        error: "Enter an amount with up to 2 decimal places.",
      });
    }

    const amount = Number(rawAmount);

    if (!Number.isFinite(amount) || amount < 0.01 || amount > 5) {
      return res.status(400).json({
        success: false,
        error: "Demo checkout amount must be between 0.01 and 5 XLM.",
      });
    }

    const frontendUrl = process.env.FRONTEND_URL;

    if (IS_PRODUCTION && !frontendUrl) {
      return res.status(500).json({
        success: false,
        error: "Frontend URL is not configured.",
      });
    }

    const baseUrl = frontendUrl || "http://localhost:5174";

    const session = await velo.checkout.sessions.create({
      amount: amount.toFixed(2),
      asset: "native",
      description: "PayPilot AI Stellar Testnet Demo",
      successUrl: `${baseUrl}/success`,
      cancelUrl: `${baseUrl}/cancel`,
    });

    if (!session.checkoutUrl || !session.paymentIntentId) {
      throw new Error("Velo did not return checkout details.");
    }

    return res.json({
      success: true,
      network: "Stellar Testnet",
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

// Velo payment lookup.
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
  console.log(`PayPilot AI Server running on port ${PORT}`);
  console.log("Noir Agent:", agentAddress);
  console.log("Noir Merchant:", merchantAddress);
  console.log("Network: Stellar Testnet");
  console.log("Production mode:", IS_PRODUCTION);
});
