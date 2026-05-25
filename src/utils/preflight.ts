// Pre-flight check for on-chain writes: confirm the wallet can actually cover
// the per-call fee before the contract reverts with InsufficientFee.
//
// Why this exists: Monad RPC strips revert reasons from estimateGas, so a
// fee-too-small revert surfaces in ethers as the unhelpful
//   "missing revert data (action='estimateGas', data=null, reason=null, ...)"
// We check upfront and raise a message that names the actual fee and balance.

import { formatEther, type Wallet } from "ethers";
import { utils as sdkUtils } from "@iqlabs-official/ethereum-sdk";

import { getBrand } from "./branding.js";

// Which contract fees a given action will be charged. From the ABI:
//   linkedListFee  -> createTable / requestConnection / updateTableTxChainTail
//                     / updateConnectionTxChainTail (all payable). So:
//                       createRoom, sendChat (writeRow), sendDm
//                       (writeConnectionRow), requestConnection.
//   basicFee       -> updateUserTxChainTail (payable). Only the inventory
//                     upload path (codeIn / file-share to "My Inventory")
//                     touches this.
// Pass the list that matches the SDK call(s) the action triggers; the
// in-between code-in calls (dbCodeIn / walletConnectionCodeIn /
// userInventoryCodeIn) are nonpayable and don't add to the bill.
export type FeeKind = "basic" | "linkedList";

export class InsufficientFeeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InsufficientFeeError";
    }
}

export async function assertCanPayFee(
    wallet: Wallet,
    kinds: FeeKind[],
): Promise<void> {
    const [basicFee, linkedListFee] = await Promise.all([
        kinds.includes("basic") ? sdkUtils.getBasicFee(wallet) : Promise.resolve(0n),
        kinds.includes("linkedList") ? sdkUtils.getLinkedListFee(wallet) : Promise.resolve(0n),
    ]);
    const fee = basicFee + linkedListFee;
    const balance = await wallet.provider!.getBalance(wallet.address);
    if (balance >= fee) return;

    const { currency } = getBrand();
    const need = formatEther(fee);
    const have = formatEther(balance);
    const short = formatEther(fee - balance);
    const breakdown = kinds.length > 1
        ? ` (basicFee ${formatEther(basicFee)} + linkedListFee ${formatEther(linkedListFee)})`
        : "";
    throw new InsufficientFeeError(
        `needs ${need} ${currency}${breakdown} but wallet has ${have} ${currency} `
        + `(short ${short}). Top up and try again.`,
    );
}
