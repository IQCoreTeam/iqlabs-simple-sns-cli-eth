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

// Which contract fees a given action will be charged. Most chat/file writes
// follow the 2-tx pattern: a code-in (basicFee) + a chain-tail update
// (linkedListFee). createTable / requestConnection / manageRowData charge
// linkedListFee only. Pass the list that matches the SDK call you're about
// to make.
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
