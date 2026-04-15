# simplechatcli-eth

An Ethereum-native TUI for the IQ internet apps: chat rooms, end-to-end
encrypted DMs, and file sharing (IQ Plaza). Port of
[simplechatcli](https://github.com/IQCoreTeam/simplechatcli) (Solana) built on
[`@iqlabs-official/ethereum-sdk`](https://github.com/IQCoreTeam/iq-ethereum-sdk).

Everything lives on-chain on Sepolia today. No backend servers.

---

## Features

- **EthChat rooms** — create named public rooms, post messages, live updates via WebSocket.
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
- An Ethereum RPC endpoint on Sepolia (HTTP **and** WebSocket; Alchemy / Infura / your own node all work)
- A wallet with a little Sepolia ETH to pay gas

---

## Step 1 — Clone & install

```bash
git clone https://github.com/IQCoreTeam/iqlabs-simple-sns-cli-eth.git
cd iqlabs-simple-sns-cli-eth
npm install
```

> `@iqlabs-official/ethereum-sdk` is pulled as a local `file:` dependency from
> `../iq-ethereum-sdk`. Clone the SDK alongside this repo:
>
> ```bash
> cd ..
> git clone https://github.com/IQCoreTeam/iq-ethereum-sdk.git
> cd iq-ethereum-sdk && npm install && npm run build
> cd ../iqlabs-simple-sns-cli-eth && npm install
> ```

---

## Step 2 — Get a Sepolia RPC URL (Alchemy)

Alchemy's free tier is enough to run this CLI end-to-end.

1. Go to [alchemy.com](https://www.alchemy.com/) and sign up (free, email + password).
2. In the dashboard, click **Create App**.
3. Pick **Ethereum → Sepolia** as the network.
4. Open the new app and click **API Key**.
5. Copy the **HTTPS URL** — looks like:

   ```
   https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
   ```

> The same key also works for WebSocket (`wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY`).
> The CLI auto-derives the WS URL from the HTTP one, so you only need to set the HTTP URL.

Other providers (Infura, QuickNode, your own geth/erigon node) work too — paste any
JSON-RPC URL that speaks Sepolia.

---

## Step 3 — Get a wallet

You have two options. **Pick one.**

### Option A — Use an existing private key

If you already have a Sepolia wallet (MetaMask, hardware wallet export, etc.), grab its
private key and put it in `.env` (see Step 4). This is the fastest path.

### Option B — Let the CLI generate a fresh wallet

Skip the `IQ_ETH_PRIVATE_KEY` line in `.env`. On first run the CLI will:

1. Generate a new Ethereum wallet.
2. Save it to `~/.config/iq-eth/wallet.json` as `{ "address": "...", "privateKey": "..." }`.
3. Print the new address on screen so you can fund it.

Either way, **the wallet needs Sepolia ETH** to send transactions. Read-only menus
(browse rooms, browse plaza) still work without ETH.

---

## Step 4 — Fund with Sepolia ETH

You need a bit of testnet ETH. Free faucets:

| Faucet | URL | Notes |
|---|---|---|
| Google Cloud | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | No login, modest daily limit |
| Alchemy | https://www.alchemy.com/faucets/ethereum-sepolia | Requires Alchemy account |
| QuickNode | https://faucet.quicknode.com/ethereum/sepolia | Sometimes needs a tiny mainnet balance |
| PoW Faucet | https://sepolia-faucet.pk910.de/ | Mine in-browser for ETH |

Paste your wallet address (either your existing one or the one the CLI just generated)
and claim. ~0.05 Sepolia ETH is plenty — each message / room creation costs fractions of a cent.

---

## Step 5 — Create `.env`

Copy the template and fill it in:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required: Sepolia JSON-RPC URL (HTTP or HTTPS)
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
2. Prints the connected network (`Network: sepolia (chainId 11155111)`).
3. Shows your ETH balance.
4. Opens the main menu: **EthChat / File Sharing / My Menu / Exit**.

Navigate with arrow keys, Enter to select, Esc to go back.

---

## Typical flows

- **Join a chat room**: EthChat → Join Room → pick a room → type to send. New messages
  appear automatically. `/exit` to leave.
- **Create a room**: EthChat → Create Room → type a name. The name can be long, e.g.
  `team.eu.support.urgent` — it's stored raw on-chain so `listRooms` surfaces the full
  string.
- **DM someone**: EthChat → DM → Request Connection → paste their address → wait for
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
| `Failed to reach RPC` | Your RPC URL is wrong or your Alchemy project is paused. Test in the Alchemy dashboard. |
| `InsufficientFee` on createRoom / sendChat | Wallet has no ETH. Fund it via a faucet (Step 4). |
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
