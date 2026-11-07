
import { useEffect, useState } from "react";
import { Asset, Networks } from "@stellar/stellar-sdk";
import {
  NoirAgentClient,
  noirExtensionSigner,
  toStroops,
} from "@noirx402/agent-sdk";
import "./App.css";

const API_URL = "http://127.0.0.1:3000";

const AGENT =
  "GAA5FPAJJ5RCDFHFWVTWTXNDAIFNOGKYTLPFUSRFV6OORDLC7V5BEGDX";

const DEVICE_UID = "PAYPILOT-DEMO-CARD-001";

const noir = new NoirAgentClient();

async function createDeviceHash(uid) {
  const data = new TextEncoder().encode(uid);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function App() {
  const [serverMessage, setServerMessage] = useState(
    "Checking connection..."
  );

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(false);

  const [ownerSigner, setOwnerSigner] = useState(null);
  const [ownerAddress, setOwnerAddress] = useState("");
  const [noirStatus, setNoirStatus] = useState("");
  const [noirLoading, setNoirLoading] = useState(false);

  // Noir Agent Payment
  const [agentAmount, setAgentAmount] = useState("1");
  const [agentStatus, setAgentStatus] = useState("");
  const [agentResult, setAgentResult] = useState(null);
  const [agentLoading, setAgentLoading] = useState(false);

  const currentPage = window.location.pathname;

  useEffect(() => {
    fetch(API_URL)
      .then((response) => response.text())
      .then(setServerMessage)
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

  async function setupNoir() {
    if (!ownerSigner) {
      setNoirStatus("Connect your Owner wallet first.");
      return;
    }

    try {
      setNoirLoading(true);
      setNoirStatus("Preparing Testnet device...");

      const deviceHash = await createDeviceHash(DEVICE_UID);
      const asset = Asset.native().contractId(Networks.TESTNET);

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
          "This demo device is already registered to another wallet."
        );
      }

      const policy = await noir.getPolicy(deviceHash);

      if (!policy) {
        setNoirStatus("Setting Agent spending limit...");

        await noir.execute(ownerSigner, {
          kind: "registerAgent",
          deviceHash,
          agent: AGENT,
          asset,
          maxAmount: toStroops("5"),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      } else if (
        policy.agent !== AGENT ||
        policy.asset !== asset
      ) {
        throw new Error(
          "An existing policy uses a different Agent or asset."
        );
      }

      const escrowToken = await noir.getEscrowToken(deviceHash);
      const balance = await noir.getEscrowBalance(deviceHash);
      const targetBalance = toStroops("10");

      if (escrowToken && escrowToken !== asset) {
        throw new Error("The device escrow uses a different asset.");
      }

      if (balance < targetBalance) {
        const amountToFund = targetBalance - balance;

        setNoirStatus("Funding Testnet escrow...");

        await noir.execute(ownerSigner, {
          kind: "fundEscrow",
          deviceHash,
          token: asset,
          amount: amountToFund,
        });
      }

      setNoirStatus(
        "Success! Device registered, Agent authorized, and escrow funded with 10 XLM."
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

  // Agent checks policy, authorizes payment, and merchant claims it.
  async function handleAgentPayment() {
    setAgentResult(null);
    setAgentStatus("");

    if (
      !/^\d+(\.\d{1,7})?$/.test(agentAmount) ||
      Number(agentAmount) <= 0
    ) {
      setAgentStatus("Enter a valid XLM amount.");
      return;
    }

    if (Number(agentAmount) > 5) {
      setAgentStatus(
        "Payment exceeds the Agent's 5 XLM spending limit."
      );
      return;
    }

    try {
      setAgentLoading(true);
      setAgentStatus("Agent checking Noir spending policy...");

      const response = await fetch(`${API_URL}/api/noir/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: agentAmount,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          data.error ||
          `Payment refused: ${data.reason || "Unknown reason"}`
        );
      }

      setAgentResult(data);

      if (data.claimHash) {
        setAgentStatus(
          "Success! Agent authorized the payment and Merchant claimed it."
        );
      } else {
        setAgentStatus(
          "Payment authorized, but Merchant claim needs attention."
        );
      }
    } catch (error) {
      console.error("Agent payment error:", error);
      setAgentStatus(error.message || "Agent payment failed.");
    } finally {
      setAgentLoading(false);
    }
  }

  async function checkPayment() {
    const paymentIntentId = localStorage.getItem("paymentIntentId");

    if (!paymentIntentId) {
      setStatus("No payment ID found. Please create a checkout first.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Checking payment with Velo...");

      const response = await fetch(
        `${API_URL}/api/payment/${paymentIntentId}`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to retrieve payment.");
      }

      setPayment(data.payment);
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentPage === "/success") {
      checkPayment();
    }
  }, []);

  async function handlePayment() {
    setStatus("");
    setPayment(null);

    if (
      !amount ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      setStatus("Please enter an amount greater than zero.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Creating secure checkout...");

      const response = await fetch(`${API_URL}/api/create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount }),
      });

      const data = await response.json();

      if (!response.ok || !data.checkoutUrl) {
        throw new Error(data.error || "Checkout creation failed.");
      }

      localStorage.setItem("paymentIntentId", data.paymentIntentId);

      window.location.href = data.checkoutUrl;
    } catch (error) {
      setStatus(error.message);
      setLoading(false);
    }
  }

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

                {!isConfirmed && !isFailed && (
                  <p>
                    Velo has not confirmed this payment yet.
                    You can check again shortly.
                  </p>
                )}
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

        {/* NOIR SETUP */}
        <div className="payment-card">
          <h2>Noir Agent Setup</h2>

          <p>
            Connect your Owner wallet to configure your test payment agent.
          </p>

          <button
            className="send-button"
            onClick={connectOwner}
            disabled={noirLoading || Boolean(ownerSigner)}
          >
            {ownerSigner ? "Owner Connected" : "Connect Noir Wallet"}
          </button>

          {ownerAddress && (
            <p className="status">
              Owner: {ownerAddress}
            </p>
          )}

          <button
            className="send-button"
            onClick={setupNoir}
            disabled={noirLoading || !ownerSigner}
          >
            {noirLoading
              ? "Please wait..."
              : "Register Agent and Fund Escrow"}
          </button>

          <p className="status">{noirStatus}</p>
        </div>

        {/* NEW NOIR AGENT PAYMENT */}
        <div className="payment-card">
          <h2>Noir Agent Payment</h2>

          <p>
            Let your authorized payment agent make a policy-checked
            payment to the demo merchant using Stellar Testnet.
          </p>

          <label>Agent Payment Amount (XLM)</label>

          <input
            type="number"
            min="0.0000001"
            max="5"
            step="0.0000001"
            value={agentAmount}
            onChange={(e) => setAgentAmount(e.target.value)}
          />

          <p className="status">
            Maximum allowed per payment: 5 XLM
          </p>

          <button
            className="send-button"
            onClick={handleAgentPayment}
            disabled={agentLoading}
          >
            {agentLoading
              ? "Agent Processing Payment..."
              : "Start Agent Payment"}
          </button>

          {agentStatus && (
            <p className="status">{agentStatus}</p>
          )}

          {agentResult && (
            <div className="agent-result">
              <h3>Agent Payment Result</h3>

              <p>
                <strong>Amount:</strong> {agentResult.amount} XLM
              </p>

              <p>
                <strong>Network:</strong> Stellar Testnet
              </p>

              <p>
                <strong>Agent:</strong> {agentResult.agent}
              </p>

              <p>
                <strong>Merchant:</strong> {agentResult.merchant}
              </p>

              <p>
                <strong>Authorization Hash:</strong>
              </p>

              <p className="status">
                {agentResult.authorizationHash}
              </p>

              <p>
                <strong>Merchant Claim Hash:</strong>
              </p>

              <p className="status">
                {agentResult.claimHash || "Claim not completed"}
              </p>

              {agentResult.claimError && (
                <p className="status">
                  Claim message: {agentResult.claimError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* VELO CHECKOUT */}
        <div className="payment-card">
          <h2>Velo Checkout</h2>

          <label>Amount (XLM)</label>

          <input
            type="number"
            min="0"
            step="any"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <button
            className="send-button"
            onClick={handlePayment}
            disabled={loading}
          >
            {loading ? "Please wait..." : "Continue"}
          </button>

          <p className="status">{status}</p>
          <p className="status">Backend: {serverMessage}</p>
        </div>
      </main>
    </div>
  );
}

export default App;
