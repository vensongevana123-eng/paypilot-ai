# PayPilot AI

**An agentic payment application that uses Noir to authorize policy-controlled payments and Velo to create payment checkout sessions on Stellar Testnet.**

## Project Overview

PayPilot AI demonstrates how an autonomous payment agent can make payments under predefined rules instead of allowing unrestricted transactions.

The project combines:
- **Noir Agent SDK** – manages agent authorization, payment limits, escrow, and merchant claims.
- **Velo SDK** – creates hosted checkout sessions and retrieves payment information.
- **Stellar Testnet** – provides the blockchain environment for testing.

## Problem

Digital payments can require manual approval and repeated user interaction. Giving an automated agent unrestricted payment access can also create risks.

## Solution

PayPilot AI allows a user to authorize an agent with a spending policy. The agent checks the policy before attempting a payment. Velo also provides a checkout flow for test payments.

## How It Works

1. The user connects a wallet.
2. The user registers a device and authorizes a payment agent.
3. The user funds the escrow on Stellar Testnet.
4. The agent checks the spending policy and available escrow.
5. If the payment is allowed, the agent authorizes it.
6. The merchant account attempts to claim the authorized payment.
7. The application also allows users to create Velo checkout sessions.

## Technology Stack

- React
- Vite
- Node.js
- Express
- Noir Agent SDK (`@noirx402/agent-sdk`)
- Velo SDK (`@carts1024/velo-sdk`)
- Stellar SDK
- Stellar Testnet

## Noir Integration

The Noir Agent SDK is used for:
- Device registration
- Agent authorization
- Spending policy checks
- Escrow balance checks
- Payment authorization
- Merchant payment claims

The application uses the Noir Testnet configuration.

## Velo Integration

The Velo SDK is used to:
- Create hosted checkout sessions
- Retrieve payment intent information
- Support a separate checkout payment flow

The Velo integration is configured for Testnet.

## Testnet Information

This project is configured for Stellar Testnet.

The application uses separate owner, agent, and merchant accounts for its Noir demonstration.

**Note:** All payment demonstrations are for testing purposes only. No real funds