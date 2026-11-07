
import { useEffect, useState } from "react";
import { noirExtensionSigner } from "@noirx402/agent-sdk";
import "./App.css";

const API_URL = "https://paypilot-ai-aoad.onrender.com";
const MAX_DEMO_AMOUNT = 5;

function App() {
  const [serverMessage, setServerMessage] = useState("Checking connection...");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(false);

  const [ownerAddress, setOwnerAddress] = useState("");
  const [noirStatus, setNoirStatus] = useState("");
  const [noirLoading, setNoirLoading] = useState(false);

  const currentPage = window.location.pathname;

  useEffect(() => {
    fetch(API_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        return response.text();
      })
      .then(setServerMessage)
      .catch(() => setServerMessage("Backend offline"));
  }, []);

  async function connectOwner() {
    try {
      setNoirLoading(true);
      setNoirStatus("Connecting to Noir wallet...");

      const signer = await noirExtensionSigner();

      setOwnerAddress(signer.publicKey);
      setNoirStatus("Wallet connected successfully.");
    } catch (error) {
      setNoirStatus(error.message || "Unable to connect Noir wallet.");
    } finally {
      setNoirLoading(false);
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

  async function handlePayment() {
    setStatus("");
    setPayment(null);

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setStatus("Enter a valid amount with up to 2 decimal places.");
      return;
    }

    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount < 0.01 ||
      numericAmount > MAX_DEMO_AMOUNT
    ) {
      setStatus("Demo checkout amount must be between 0.01 and 5 XLM.");
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
        body: JSON.stringify({ amount }),
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
                  <p>Velo has not confirmed this payment yet.</p>
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

        <div className="payment-card">
          <h2>Noir Agent Wallet</h2>

          <p>
            Connect your own Noir-compatible wallet to the Stellar Testnet.
          </p>

          <button
            className="send-button"
            onClick={connectOwner}
            disabled={noirLoading || Boolean(ownerAddress)}
          >
            {noirLoading
              ? "Connecting..."
              : ownerAddress
              ? "Wallet Connected"
              : "Connect Noir Wallet"}
          </button>

          {ownerAddress && (
            <p className="status">Owner: {ownerAddress}</p>
          )}

          {noirStatus && <p className="status">{noirStatus}</p>}

          <p className="status">
            Public agent transactions are not enabled yet. Individual
            wallet authorization is required before enabling them.
          </p>
        </div>

        <div className="payment-card">
          <h2>Noir Agent Payment</h2>

          <p>
            Agent payments use a shared demo account in the current backend.
            They are protected from public use until individual authorization
            is implemented.
          </p>

          <button className="send-button" disabled>
            Agent Payments Not Available in Public Demo
          </button>
        </div>

        <div className="payment-card">
          <h2>Velo Checkout</h2>

          <p>
            Try a Stellar Testnet checkout. This is a test environment,
            not a real-money payment.
          </p>

          <label>Amount (XLM)</label>

          <input
            type="number"
            min="0.01"
            max="5"
            step="0.01"
            placeholder="Enter amount (0.01 - 5 XLM)"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />

          <p className="status">Demo limit: 0.01 to 5 XLM.</p>

          <button
            className="send-button"
            onClick={handlePayment}
            disabled={loading}
          >
            {loading ? "Creating Checkout..." : "Continue to Velo Checkout"}
          </button>

          {status && <p className="status">{status}</p>}

          <p className="status">Backend: {serverMessage}</p>
          <p className="status">Network: Stellar Testnet</p>
        </div>
      </main>
    </div>
  );
}

export default App;
