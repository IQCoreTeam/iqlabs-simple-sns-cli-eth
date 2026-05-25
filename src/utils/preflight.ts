// Pre-flight check for on-chain writes: confirm the wallet can actually cover
// the per-call fee before the contract reverts with InsufficientFee.
//
// Why this exists: Monad RPC strips revert reasons from estimateGas, so a
// fee-too-small revert surfaces in ethers as the unhelpful
//   "missing revert data (action='estimateGas', data=null, reason=null, ...)"
// We check upfront and raise a message that names the actual fee and balance.
//
// Fee model (SDK >= 0.2.0, mirrors solana):
//   - chat/DM/inventory writes (writeRow / writeConnectionRow / codeIn) charge
//     basicFee when the payload fits inline (<= DIRECT_METADATA_MAX_BYTES)
//     and linkedListFee when sendCode-chained
//   - createRoom (createTable) charges tableCreationFee — possibly overridden
//     per dbRoot, so we ask the SDK for the *effective* value

import { formatEther, type Wallet } from "ethers";
import {
    utils as sdkUtils,
    constants as sdkConstants,
} from "@iqlabs-official/ethereum-sdk";

import { getBrand } from "./branding.js";

export class InsufficientFeeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InsufficientFeeError";
    }
}

// Decide whether a JSON-stringified row payload will be sent inline (basicFee)
// or via a sendCode chain (linkedListFee). Matches SDK prepareUpload's branch.
const isInlinePayload = (rowJson: string): boolean =>
    Buffer.byteLength(rowJson, "utf8") <= sdkConstants.DIRECT_METADATA_MAX_BYTES;

async function assertCanPay(wallet: Wallet, fee: bigint, label: string): Promise<void> {
    if (fee === 0n) return;
    const balance = await wallet.provider!.getBalance(wallet.address);
    if (balance >= fee) return;
    const { currency } = getBrand();
    throw new InsufficientFeeError(
        `${label} needs ${formatEther(fee)} ${currency} but wallet has ${formatEther(balance)} ${currency} `
        + `(short ${formatEther(fee - balance)}). Top up and try again.`,
    );
}

// For a row-style write (chat, DM, inventory). Pass the exact JSON the SDK
// will serialise so we pick the right tier.
export async function assertCanPayRowWrite(
    wallet: Wallet,
    rowJson: string,
): Promise<void> {
    const inline = isInlinePayload(rowJson);
    const fee = inline
        ? await sdkUtils.getBasicFee(wallet)
        : await sdkUtils.getLinkedListFee(wallet);
    await assertCanPay(wallet, fee, inline ? "Send (inline)" : "Send (chunked)");
}

// For createTable / createPrivateTable. Reads the per-root override when set.
export async function assertCanPayCreateTable(
    wallet: Wallet,
    dbRootId: string,
): Promise<void> {
    const fee = await sdkUtils.getEffectiveTableCreationFee(wallet, dbRootId);
    await assertCanPay(wallet, fee, "Create room");
}
