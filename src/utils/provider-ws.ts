// WebSocket provider + contract instance for real-time subscriptions.
// Kept out of the HTTP path so the existing reader/writer code keeps using
// the SDK's HTTP provider unchanged.
//
// Solana equivalent: `new Connection(wssUrl)` + `connection.onAccountChange`.
// Ethereum: `new WebSocketProvider(wssUrl)` + `contract.on(filter, cb)`.

import { Contract, WebSocketProvider } from "ethers";
import { contract as sdkContract } from "@iqlabs-official/ethereum-sdk";

const autoDeriveWss = (httpUrl: string): string =>
    httpUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

export const getWssUrl = (): string => {
    const explicit = process.env.IQ_ETH_WSS_URL?.trim();
    if (explicit) return explicit;
    const http = process.env.ETHEREUM_RPC_URL?.trim();
    if (!http) throw new Error("ETHEREUM_RPC_URL not set");
    return autoDeriveWss(http);
};

// One WebSocket connection per process. The CLI reuses it across multiple
// concurrent subscriptions (room + dm + inventory can all run at once).
let _wsProvider: WebSocketProvider | null = null;
let _wsContract: Contract | null = null;

export const getWsProvider = (): WebSocketProvider => {
    if (_wsProvider) return _wsProvider;
    _wsProvider = new WebSocketProvider(getWssUrl());
    return _wsProvider;
};

export const getWsContract = (): Contract => {
    if (_wsContract) return _wsContract;
    _wsContract = new Contract(
        sdkContract.DEFAULT_CONTRACT_ADDRESS,
        sdkContract.CODEIN_ABI as any,
        getWsProvider(),
    );
    return _wsContract;
};

// Called during graceful shutdown so the WS socket doesn't dangle.
export const closeWsProvider = async (): Promise<void> => {
    if (_wsContract) {
        try { _wsContract.removeAllListeners(); } catch { /* ignore */ }
        _wsContract = null;
    }
    if (_wsProvider) {
        try { await _wsProvider.destroy(); } catch { /* ignore */ }
        _wsProvider = null;
    }
};
