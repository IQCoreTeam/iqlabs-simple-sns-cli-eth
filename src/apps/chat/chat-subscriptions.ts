// Real-time subscriptions for rooms, DMs, and inventory.
//
// Mirrors `simplechatcli/src/apps/chat/chat-service.ts` `subscribeToAccount`
// but for Ethereum: we attach event listeners to the WebSocket contract
// instance using the indexed fields in DbCodeInEvent / ConnectionCodeIn /
// UserInventoryCodeInEvent.
//
// Each `subscribe*` returns a `stop()` cleanup. The CLI menu loop calls it
// on `/exit` or when the user backs out.

import { id as keccak } from "ethers";
import { reader, utils as sdkUtils } from "@iqlabs-official/ethereum-sdk";

import { getWsContract, getWsProvider } from "../../utils/provider-ws.js";
import { getWallet } from "../../utils/wallet.js";

// Row delivered to subscriber callbacks. Shape matches `reader.readTableRows`
// return items so the rendering code in chat.ts can be reused as-is.
export interface LiveRow {
    txHash: string;
    data: any;
}

// Decode one tx into the same {txHash, data} shape `readTableRows` produces.
// Used when an event fires and we need to fetch just that single row.
const rowFromTx = async (txHash: string): Promise<LiveRow | null> => {
    const ws = getWsContract();
    const tx = await getWsProvider().getTransaction(txHash);
    if (!tx) return null;
    const parsed = ws.interface.parseTransaction({ data: tx.data });
    if (!parsed) return null;

    // dbCodeIn / dbInstructionCodeIn / walletConnectionCodeIn / userInventoryCodeIn
    // all carry the row data in either an `onChainPath` + `metadata` pair, or
    // (for userInventoryCodeIn) a `tailTx` + `handle` pair.
    const args = parsed.args as any;
    const onChainPath =
        typeof args.onChainPath === "string"
            ? args.onChainPath
            : typeof args.tailTx === "string"
              ? args.tailTx
              : "";
    const metadata =
        typeof args.metadata === "string"
            ? args.metadata
            : typeof args.handle === "string"
              ? args.handle
              : "";

    let dataStr: string;
    if (!onChainPath || onChainPath === "" || onChainPath === "Genesis") {
        dataStr = metadata;
    } else {
        dataStr = await reader.readSendCodeChain(onChainPath);
    }

    let data: any;
    try { data = JSON.parse(dataStr); } catch { data = dataStr; }
    return { txHash, data };
};

// ── Room subscription ───────────────────────────────────────────────────
//
// Fires on every dbCodeIn that targets the given (rootId, tableName).
// onRow is called with the decoded row in the same shape readTableRows
// returns.
export const subscribeRoom = async (
    dbRootId: string,
    tableName: string,
    onRow: (row: LiveRow) => void,
): Promise<() => void> => {
    const ws = getWsContract();
    const filter = ws.filters.DbCodeInEvent(keccak(dbRootId), keccak(tableName));
    const handler = async (...argsAndEvent: any[]) => {
        const ev = argsAndEvent[argsAndEvent.length - 1];
        const txHash = ev?.log?.transactionHash ?? ev?.transactionHash;
        if (!txHash) return;
        try {
            const row = await rowFromTx(txHash);
            if (row) onRow(row);
        } catch {
            // swallow — live rendering shouldn't throw
        }
    };
    await ws.on(filter, handler);
    return () => { ws.off(filter, handler); };
};

// ── DM subscription ─────────────────────────────────────────────────────
//
// Fires on every walletConnectionCodeIn matching this specific connection.
// The ConnectionCodeIn event is indexed by connectionKey, so we filter on
// that to avoid receiving other people's DMs.
export const subscribeDm = async (
    dbRootId: string,
    partner: string,
    onRow: (row: LiveRow) => void,
): Promise<() => void> => {
    const ws = getWsContract();
    const me = getWallet().address;

    // Contract exposes `getConnectionKey(a, b, dbRootId, seed)` as a pure
    // helper — call it once to get the indexed key for our filter.
    const connectionSeed = sdkUtils.deriveDmSeed(me, partner);
    const rootSeed = keccak(dbRootId);
    const connKey = await ws.getConnectionKey(me, partner, rootSeed, connectionSeed);

    const filter = ws.filters.ConnectionCodeIn(connKey);
    const handler = async (...argsAndEvent: any[]) => {
        const ev = argsAndEvent[argsAndEvent.length - 1];
        const txHash = ev?.log?.transactionHash ?? ev?.transactionHash;
        if (!txHash) return;
        try {
            const row = await rowFromTx(txHash);
            if (row) onRow(row);
        } catch { /* ignore */ }
    };
    await ws.on(filter, handler);
    return () => { ws.off(filter, handler); };
};

// ── Inventory subscription ──────────────────────────────────────────────
//
// Fires when the given user writes a new userInventoryCodeIn entry.
// Used by the "My Files" / "DM inbox" panels that want to show uploads or
// incoming DM key registrations in real time.
export const subscribeInventory = async (
    address: string,
    onRow: (row: LiveRow) => void,
): Promise<() => void> => {
    const ws = getWsContract();
    const filter = ws.filters.UserInventoryCodeInEvent(address);
    const handler = async (...argsAndEvent: any[]) => {
        const ev = argsAndEvent[argsAndEvent.length - 1];
        const txHash = ev?.log?.transactionHash ?? ev?.transactionHash;
        if (!txHash) return;
        try {
            const row = await rowFromTx(txHash);
            if (row) onRow(row);
        } catch { /* ignore */ }
    };
    await ws.on(filter, handler);
    return () => { ws.off(filter, handler); };
};

