# simplechatcli-eth

An EVM-native TUI for the IQ internet apps: chat rooms, end-to-end
encrypted DMs, and file sharing (IQ Plaza). Port of
[simplechatcli](https://github.com/IQCoreTeam/simplechatcli) (Solana) built on
[`@iqlabs-official/ethereum-sdk`](https://github.com/IQCoreTeam/iq-ethereum-sdk).

Everything lives on-chain. No backend servers.

**Supported chains** (auto-detected from your RPC's chainId):

| Mode | Chain ID | Currency | Brand |
|---|---|---|---|
| Sepolia | 11155111 | ETH | `EthChat`, IQLABS logo |
| Monad | 143 | MON | `MonadChat`, MONAD logo |
| Monad Testnet | 10143 | MON | `MonadChat`, MONAD logo |

Same binary — point it at a Monad RPC and the CLI rebrands itself.

---

## Features

- **Chat rooms** — create named public rooms, post messages, live updates via WebSocket. (Menu shows up as `EthChat` on Sepolia, `MonadChat` on Monad.)
- **DMs** — request / approve connections, send end-to-end encrypted messages
  (multi-recipient X25519 + AES-GCM) between any two wallets.
- **File sharing** — upload files into your inventory, browse & upload to public/private
  folders inside **IQ Plaza**.
- **Live event subscriptions** — rooms and DMs auto-render new messages via
  Ethereum WebSocket RPC. No `/refresh` needed.
- **Tx progress spinner** — every on-chain write shows a `Submitting → Confirming`
  spinner that clears on success.

---

## Requirements

- Node.js 20+ (tested on 22)
- A JSON-RPC endpoint on one of the supported chains (HTTP **and** WebSocket).
  Alchemy / Infura / public Monad endpoints / your own node all work.
- A wallet with a little gas on whichever chain you pick (Sepolia ETH or Monad MON).

---

## Step 1 — Clone & install

```bash
git clone https://github.com/IQCoreTeam/iqlabs-simple-sns-cli-eth.git
cd iqlabs-simple-sns-cli-eth
npm install
```

`@iqlabs-official/ethereum-sdk` is resolved from npm. The Monad chain support
this CLI needs lives in `^0.1.3`+ of the SDK.

---

## Step 2 — Get an RPC URL

Pick whichever chain you want to run on. The CLI auto-detects the chainId at
startup and switches its mode (Sepolia → EthChat, Monad → MonadChat).

### Option A — Sepolia (Alchemy free tier)

1. Sign up at [alchemy.com](https://www.alchemy.com/) (free, email + password).
2. In the dashboard, click **Create App**.
3. Pick **Ethereum → Sepolia**.
4. Open the app → **API Key** → copy the **HTTPS URL**:

   ```
   https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
   ```

Other providers (Infura, QuickNode, your own geth/erigon node) work too.

### Option B — Monad Testnet (public RPC)

No signup. Use the public Monad testnet endpoint directly:

```
https://testnet-rpc.monad.xyz
```

When the CLI sees chainId `10143` it flips into Monad mode automatically.

### Option C — Monad Mainnet

```
https://rpc.monad.xyz
```

> The CLI auto-derives the WebSocket URL from the HTTP one (`https://` →
> `wss://`). If your provider needs a different WS endpoint, set
> `IQ_ETH_WSS_URL` explicitly in `.env`.

---

## Step 3 — Get a wallet

You have two options. **Pick one.**

### Option A — Use an existing private key

If you already have an EVM wallet (MetaMask, hardware wallet export, etc.), grab its
private key and put it in `.env` (see Step 5). The same private key works on Sepolia
and Monad — only the RPC URL changes. This is the fastest path.

### Option B — Let the CLI generate a fresh wallet

Skip the `IQ_ETH_PRIVATE_KEY` line in `.env`. On first run the CLI will:

1. Generate a new Ethereum wallet.
2. Save it to `~/.config/iq-eth/wallet.json` as `{ "address": "...", "privateKey": "..." }`.
3. Print the new address on screen so you can fund it.

Either way, **the wallet needs a little gas** (Sepolia ETH or Monad MON, depending on
which RPC you point at). Read-only menus (browse rooms, browse plaza) still work without.

---

## Step 4 — Fund the wallet

### Sepolia ETH faucets

| Faucet | URL | Notes |
|---|---|---|
| Google Cloud | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | No login, modest daily limit |
| Alchemy | https://www.alchemy.com/faucets/ethereum-sepolia | Requires Alchemy account |
| QuickNode | https://faucet.quicknode.com/ethereum/sepolia | Sometimes needs a tiny mainnet balance |
| PoW Faucet | https://sepolia-faucet.pk910.de/ | Mine in-browser for ETH |

~0.05 Sepolia ETH is plenty.

### Monad Testnet MON faucet

| Faucet | URL | Notes |
|---|---|---|
| Official Monad | https://faucet.monad.xyz/ | Daily drip per address |

A few MON is enough — Monad fees are tiny.

Paste your wallet address (either your existing one or the one the CLI just generated)
and claim.

---

## Step 5 — Create `.env`

Copy the template and fill it in:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required: JSON-RPC URL. Pick one — the CLI auto-detects the chain.
# Sepolia:        https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
# Monad testnet:  https://testnet-rpc.monad.xyz
# Monad mainnet:  https://rpc.monad.xyz
ETHEREUM_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY

# Optional: private key for the wallet you want to use.
# If omitted, the CLI generates a new wallet at ~/.config/iq-eth/wallet.json.
# Must start with 0x and be exactly 64 hex chars after.
# IQ_ETH_PRIVATE_KEY=0x...

# Optional: explicit WebSocket RPC URL. If omitted, derived from ETHEREUM_RPC_URL
# (https:// → wss://). Alchemy / Infura accept the same key on both protocols.
# IQ_ETH_WSS_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY

# Optional: override the wallet file path.
# Default: ~/.config/iq-eth/wallet.json. Ignored if IQ_ETH_PRIVATE_KEY is set.
# IQ_ETH_WALLET_PATH=./wallet.json
```

> The env var is still named `ETHEREUM_RPC_URL` for backward compatibility; it
> accepts any supported chain (Sepolia, Monad, Monad Testnet).

> **Never commit `.env`.** It's in `.gitignore`; keep it local.

---

## Step 6 — Run it

Dev mode (tsx, no build needed):

```bash
npm run dev
```

Or build and run the compiled JS:

```bash
npm run build
npm run start
```

First-run sequence:

1. Loads / generates a wallet.
2. Detects the chain from your RPC and switches mode:
   - Sepolia (`chainId 11155111`) → IQLABS logo, header reads "Ethereum Internet CLI — Sepolia"
   - Monad Testnet (`chainId 10143`) → MONAD logo, header reads "Monad Internet CLI — Monad Testnet"
   - Monad mainnet (`chainId 143`) → MONAD logo, header reads "Monad Internet CLI — Monad"
3. Shows your balance in the right unit (ETH or MON).
4. Opens the main menu: **EthChat / MonadChat / File Sharing / My Menu / Exit**
   (label of the first item depends on mode).

Navigate with arrow keys, Enter to select, Esc to go back.

---

## Typical flows

(Menu items in italics adapt to your chain — `EthChat` on Sepolia, `MonadChat` on Monad.)

- **Join a chat room**: *Chat* → Join Room → pick a room → type to send. New messages
  appear automatically. `/exit` to leave.
- **Create a room**: *Chat* → Create Room → type a name. The name can be long, e.g.
  `team.eu.support.urgent` — it's stored raw on-chain so `listRooms` surfaces the full
  string.
- **DM someone**: *Chat* → DM → Request Connection → paste their address → wait for
  them to approve → DM → Friend List → pick them → type. Messages are encrypted with
  X25519, only you two can read the ciphertext.
- **Upload a file**: File Sharing → Upload to My Inventory (private) or IQ Plaza → pick
  a folder → point at a file path. Returns a tx hash that doubles as the "download key".
- **Download by tx hash**: File Sharing → Download by tx hash → paste `0x...`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ETHEREUM_RPC_URL not set` | You haven't created `.env`, or the line is commented out. |
| `Failed to reach RPC` | Your RPC URL is wrong or your provider is paused. Test the URL in your browser / dashboard. |
| `InsufficientFee` on createRoom / sendChat | Wallet has no gas. Fund it via a faucet (Step 4) — Sepolia ETH or Monad MON, matching your RPC. |
| Header still says "Ethereum Internet CLI" on a Monad RPC | The chainId your RPC reported doesn't match any known mode. Confirm the RPC is actually Monad (curl the endpoint with `eth_chainId`) and that you're on SDK `^0.1.3`. |
| Subscribe never fires new messages | Your RPC provider doesn't support WebSocket on this endpoint. Set `IQ_ETH_WSS_URL` explicitly. |
| `DbRoot not found` after a fresh deploy | First run on a newly-deployed contract. The CLI auto-runs `initializeDbRoot` on first chat entry. |

---

## Project layout

```
src/
├── app.ts                          # entry: wallet + RPC + main menu
├── apps/
│   ├── chat/
│   │   ├── chat-service.ts         # rooms, DMs, encryption
│   │   └── chat-subscriptions.ts   # live WebSocket event listeners
│   └── file-share/
│       └── file-share-service.ts   # inventory + IQ Plaza
├── ui/
│   ├── menus/                      # main / chat / file-share / my-menu
│   └── widgets/progress-bar.ts     # chunk upload progress
└── utils/
    ├── wallet.ts                   # ethers.Wallet, resolve env/file/default
    ├── provider-ws.ts              # WebSocketProvider + Contract singleton
    ├── tx-progress.ts              # withTxProgress spinner widget
    ├── branding.ts                 # per-chain logo / labels / currency
    └── prompt.ts / logger.ts / format.ts / id.ts / config.ts
```

The chat and file-share flows live here; `iqchan` (imageboard) is deferred — see
`TODO_IQCHAN.md`.

---

## Related repositories

- Smart contract: [IQCoreTeam/code-in-for-eth](https://github.com/IQCoreTeam/code-in-for-eth)
- SDK (TS): [IQCoreTeam/iq-ethereum-sdk](https://github.com/IQCoreTeam/iq-ethereum-sdk)
- Solana version of this CLI: [IQCoreTeam/simplechatcli](https://github.com/IQCoreTeam/simplechatcli)
- Solana SDK: [IQCoreTeam/iqlabs-solana-sdk](https://github.com/IQCoreTeam/iqlabs-solana-sdk)
