import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { Wallet } from "ethers";
import { utils as sdkUtils } from "@iqlabs-official/ethereum-sdk";

const DEFAULT_WALLET_DIR = path.join(os.homedir(), ".config", "iq-eth");
const DEFAULT_WALLET_PATH = path.join(DEFAULT_WALLET_DIR, "wallet.json");

const envPrivateKey = (): string | null => {
    const raw = process.env.IQ_ETH_PRIVATE_KEY?.trim();
    if (!raw) return null;
    return raw.startsWith("0x") ? raw : `0x${raw}`;
};

const resolveWalletPath = (): string => {
    const local = path.join(process.cwd(), "wallet.json");
    if (fs.existsSync(local)) return local;
    if (process.env.IQ_ETH_WALLET_PATH) return process.env.IQ_ETH_WALLET_PATH;
    return DEFAULT_WALLET_PATH;
};

const loadWallet = (walletPath: string): Wallet => {
    const raw = fs.readFileSync(walletPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.privateKey !== "string") {
        throw new Error(`Invalid wallet file: ${walletPath} (missing privateKey)`);
    }
    return new Wallet(parsed.privateKey, sdkUtils.getProvider());
};

export const generateWallet = (): { wallet: Wallet; path: string } => {
    const hd = Wallet.createRandom();
    const wallet = new Wallet(hd.privateKey, sdkUtils.getProvider());
    if (!fs.existsSync(DEFAULT_WALLET_DIR)) {
        fs.mkdirSync(DEFAULT_WALLET_DIR, { recursive: true });
    }
    fs.writeFileSync(
        DEFAULT_WALLET_PATH,
        JSON.stringify({ address: wallet.address, privateKey: wallet.privateKey }, null, 2),
        "utf8",
    );
    return { wallet, path: DEFAULT_WALLET_PATH };
};

// Resolution order: IQ_ETH_PRIVATE_KEY env → ./wallet.json → $IQ_ETH_WALLET_PATH
// → ~/.config/iq-eth/wallet.json. `info` surfaces whichever source is live so
// app.ts can skip the generate step when env provides a key.
export const getWalletInfo = (): { source: "env" | "file"; path: string; exists: boolean } => {
    if (envPrivateKey()) return { source: "env", path: "IQ_ETH_PRIVATE_KEY", exists: true };
    const p = resolveWalletPath();
    return { source: "file", path: p, exists: fs.existsSync(p) };
};

export const getWallet = (): Wallet => {
    const key = envPrivateKey();
    if (key) return new Wallet(key, sdkUtils.getProvider());
    const p = resolveWalletPath();
    if (!fs.existsSync(p)) throw new Error(`Wallet not found: ${p}`);
    return loadWallet(p);
};
