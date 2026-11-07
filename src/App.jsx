
import { useEffect, useState } from "react";
import { Asset, Networks } from "@stellar/stellar-sdk";
import {
  NoirAgentClient,
  noirExtensionSigner,
  toStroops,
} from "@noirx402/agent-sdk";
import "./App.css";

const IS_PUBLIC_DEMO = ![
  "localhost",
  "127.0.0.1",
].includes(window.location.hostname);

const API_URL = IS_PUBLIC_DEMO
  ? "https://paypilot-ai-aoad.onrender.com"
  : "http://localhost:3000";

const AGENT = "GAA5FPAJJ5RCDFHFWVTWTXNDAIFNOGKYTLPFUSRFV6OORDLC7V5BEGDX";
const DEVICE_UID = "PAYPILOT-DEMO-CARD-001";
const MAX_AMOUNT = 5;
const ESCROW_TARGET = 10;

const asset = Asset.native().contractId(Networks.TESTNET);
const noir = new NoirAgentClient();

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function App() {
  const [serverMessage, setServerMessage] = useState(
    "Checking connection..."
  );

  const [ownerSigner, setOwnerSigner] = useState(null);
  const [ownerAddress, setOwnerAddress] = useState("");
  const [noirStatus, setNoirStatus] = useState("");
  const [noirLoading, setNoirLoading] = useState(false);

  const [agentAmount, setAgentAmount] = useState("");
  const [veloAmount, setVeloAmount] = useState("");

  const [status, setStatus] = useState("");
  const [agentResult, setAgentResult] = useState(null);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(false);

  const currentPage = window.location.pathname;

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        return response.json();
      })
      .then((data) => {
        setServerMessage(
          data.status === "ok"
            ? "PayPilot AI Server is running!"
            : "Backend unavailable"
        );
      })
      .catch(() => setServerMessage("Backend offline"));
  }, []);

  async function connectOwner() {
    try {
      setNoirLoading(true);
      setNoirStatus("Connecting to Noir wallet...");

      const signer = await noirExtensionSigner();

      setOwnerSigner(signer);
      setOwnerAddress(signer.publicKey);
      setNoirStatus("Owner wallet connected successfully.");
    } catch (error) {
      setNoirStatus(
        error.message || "Unable to connect Noir wallet."
      );
    } finally {
      setNoirLoading(false);
    }
  }

  async function setupAgent() {
    if (IS_PUBLIC_DEMO) {
      setNoirStatus(
        "Agent setup is available locally only. Run PayPilot AI on localhost."
      );
      return;
    }

    if (!ownerSigner) {
      setNoirStatus("Connect your Owner wallet first.");
      return;
    }

    try {
      setNoirLoading(true);
      setNoirStatus("Preparing Stellar Testnet device...");

      const deviceHash = await sha256Hex(DEVICE_UID);
      const currentOwner = await noir.getDeviceOwner(deviceHash);

      if (!currentOwner) {
        setNoirStatus("Registering demo device...");

        await noir.execute(ownerSigner, {
          kind: "registerDevice",
          deviceHash,
          agent: AGENT,
        });
      } else if (currentOwner !== ownerSigner.publicKey) {
        throw new Error(
          "This demo device is already registered to another owner."
        );
      }

      setNoirStatus("Setting Agent spending limit...");

      await noir.execute(ownerSigner, {
        kind: "registerAgent",
        deviceHash,
        agent: AGENT,
        asset,
        maxAmount: toStroops(String(MAX_AMOUNT)),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const escrowToken = await noir.getEscrowToken(deviceHash);

      if (escrowToken && escrowToken !== asset) {
        throw new Error(
          "The escrow is configured for a different asset."
        );
      }

      const balance = await noir.getEscrowBalance(deviceHash);
      const targetBalance = toStroops(String(ESCROW_TARGET));

      if (balance < targetBalance) {
        const amountToFund = targetBalance - balance;

        setNoirStatus("Funding Stellar Testnet escrow...");

        await noir.execute(ownerSigner, {
          kind: "fundEscrow",
          deviceHash,
          token: asset,
          amount: amountToFund,
        });
      }

      setNoirStatus(
        "Success! Device registered, Agent authorized, and escrow funded."
      );
    } catch (error) {
      console.error("Noir setup error:", error);
      setNoirStatus(
        error.message || "Noir setup failed. Check the console."
      );
    } finally {
      setNoirLoading(false);
    }
  }

  async function handleAgentPayment() {
    if (IS_PUBLIC_DEMO) return;

    setStatus("");
    setAgentResult(null);

    if (!/^\d+(\.\d{1,7})?$/.test(agentAmount)) {
      setStatus("Enter a valid XLM amount.");
      return;
    }

    const amount = Number(agentAmount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      setStatus("Maximum allowed per payment is 5 XLM.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Checking Noir payment policy...");

      const response = await fetch(`${API_URL}/api/noir/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: agentAmount }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Agent payment failed.");
      }

      setAgentResult(data);
      setStatus(data.message || "Payment completed.");
    } catch (error) {
      setStatus(error.message || "Unable to complete agent payment.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePayment() {
    if (IS_PUBLIC_DEMO) return;

    setStatus("");
    setPayment(null);

    if (!/^\d+(\.\d{1,2})?$/.test(veloAmount)) {
      setStatus("Enter a valid amount with up to 2 decimal places.");
      return;
    }

    const amount = Number(veloAmount);

    if (!Number.isFinite(amount) || amount < 0.01 || amount > 5) {
      setStatus("Checkout amount must be between 0.01 and 5 XLM.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Creating Testnet checkout...");

      const response = await fetch(`${API_URL}/api/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: veloAmount }),
      });

      const data = await response.json();

      if (!response.ok || !data.success || !data.checkoutUrl) {
        throw new Error(data.error || "Checkout creation failed.");
      }

      localStorage.setItem("paymentIntentId", data.paymentIntentId);
      window.location.href = data.checkoutUrl;
    } catch (error) {
      setStatus(error.message || "Checkout failed.");
      setLoading(false);
    }
  }

  async function checkPayment() {
    const paymentIntentId = localStorage.getItem("paymentIntentId");

    if (!paymentIntentId) {
      setStatus("No payment ID found.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Checking payment with Velo...");

      const response = await fetch(
        `${API_URL}/api/payment/${encodeURIComponent(paymentIntentId)}`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to retrieve payment.");
      }

      setPayment(data.payment);
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Unable to check payment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentPage === "/success") {
      checkPayment();
    }
  }, []);

  if (currentPage === "/success") {
    const isConfirmed =
      payment?.status === "confirmed" ||
      Boolean(payment?.stageTimestamps?.confirmed);

    const isFailed = ["failed", "expired", "cancelled"].includes(
      payment?.status
    );

    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">PayPilot AI</div>
          <div className="network">Stellar Testnet</div>
        </nav>

        <main className="dashboard">
          <div className="payment-card">
            <h1>Payment Result</h1>

            {!payment && <p>{status || "Loading payment details..."}</p>}

            {payment && (
              <>
                <h2>
                  {isConfirmed
                    ? "Payment Confirmed!"
                    : isFailed
                    ? "Payment Not Completed"
                    : "Payment Pending"}
                </h2>

                <p>Amount: {payment.amount} XLM</p>
                <p>Payment ID: {payment.id}</p>
                <p>Velo Status: {payment.status}</p>
              </>
            )}

            {status && <p className="status">{status}</p>}

            <button
              className="send-button"
              onClick={checkPayment}
              disabled={loading}
            >
              {loading ? "Checking..." : "Check Payment Status"}
            </button>

            <button
              className="send-button"
              onClick={() => (window.location.href = "/")}
            >
              Back to Home
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (currentPage === "/cancel") {
    return (
      <div className="app">
        <nav className="navbar">
          <div className="logo">PayPilot AI</div>
          <div className="network">Stellar Testnet</div>
        </nav>

        <main className="dashboard">
          <div className="payment-card">
            <h1>Checkout Cancelled</h1>
            <p>You returned from checkout without completing the payment.</p>

            <button
              className="send-button"
              onClick={() => (window.location.href = "/")}
            >
              Return to PayPilot
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="navbar">
        <div className="logo">PayPilot AI</div>
        <div className="network">Stellar Testnet</div>
      </nav>

      <main className="dashboard">
        <h1>Smart Payments, Simplified.</h1>

        <p className="subtitle">
          Your AI-powered payment assistant.
        </p>

        <div className="payment-card">
          <h2>Noir Agent Setup</h2>

          <p>
            Connect your Owner wallet to configure your test payment agent.
          </p>

          <button
            className="send-button"
            onClick={connectOwner}
            disabled={noirLoading || Boolean(ownerAddress)}
          >
            {noirLoading
              ? "Connecting..."
              : ownerAddress
              ? "Owner Wallet Connected"
              : "Connect Noir Wallet"}
          </button>

          {ownerAddress && (
            <p className="status">Owner: {ownerAddress}</p>
          )}

          <button
            className="send-button"
            onClick={setupAgent}
            disabled={IS_PUBLIC_DEMO || noirLoading || !ownerSigner}
          >
            {noirLoading
              ? "Setting Up Agent..."
              : "Register Agent and Fund Escrow"}
          </button>

          {IS_PUBLIC_DEMO && (
            <p className="status">
              Agent setup is available locally. Connect your Owner wallet
              and run the app locally to register and fund your test agent.
            </p>
          )}

          {noirStatus && <p className="status">{noirStatus}</p>}
        </div>

        <div className="payment-card">
          <h2>Noir Agent Payment</h2>

          <p>
            Let your authorized payment agent make a policy-checked
            payment to the demo merchant using Stellar Testnet.
          </p>

          <label>Agent Payment Amount (XLM)</label>

          <input
            type="number"
            min="0.01"
            max="5"
            step="0.01"
            placeholder="Enter amount"
            value={agentAmount}
            onChange={(event) => setAgentAmount(event.target.value)}
          />

          <p className="status">
            Maximum allowed per payment: 5 XLM
          </p>

          <button
            className="send-button"
            onClick={handleAgentPayment}
            disabled={IS_PUBLIC_DEMO || loading}
          >
            {IS_PUBLIC_DEMO
              ? "Start Agent Payment"
              : loading
              ? "Processing Payment..."
              : "Start Agent Payment"}
          </button>

          {IS_PUBLIC_DEMO && (
            <p className="status">
              Agent payments are disabled on the public demo until
              individual wallet authorization is implemented.
            </p>
          )}

          {agentResult && (
            <div className="status">
              <p>Amount: {agentResult.amount} XLM</p>
              <p>Network: {agentResult.network}</p>
              <p>Authorization: {agentResult.authorizationHash}</p>
              <p>Claim: {agentResult.claimHash || "Pending"}</p>
            </div>
          )}

          {status && <p className="status">{status}</p>}
        </div>

        <div className="payment-card">
          <h2>Velo Checkout</h2>

          <label>Amount (XLM)</label>

          <input
            type="number"
            min="0.01"
            max="5"
            step="0.01"
            placeholder="Enter amount"
            value={veloAmount}
            onChange={(event) => setVeloAmount(event.target.value)}
          />

          <p className="status">Demo limit: 0.01 to 5 XLM.</p>

          <button
            className="send-button"
            onClick={handlePayment}
            disabled={IS_PUBLIC_DEMO || loading}
          >
            {loading ? "Creating Checkout..." : "Continue"}
          </button>

          {IS_PUBLIC_DEMO && (
            <p className="status">
              Velo checkout is disabled on the public demo.
              Run the app locally to test checkout.
            </p>
          )}

          {status && <p className="status">{status}</p>}
        </div>

        <div className="payment-card">
          <p className="status">Backend: {serverMessage}</p>
          <p className="status">Network: Stellar Testnet</p>
        </div>
      </main>
    </div>
  );
}

export default App;
