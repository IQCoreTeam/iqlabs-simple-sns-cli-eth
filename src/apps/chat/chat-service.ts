import { reader, writer, crypto } from "@iqlabs-official/ethereum-sdk";
import type { Wallet } from "ethers";

import { getWallet } from "../../utils/wallet.js";
import { makeMessageId } from "../../utils/id.js";
import { logStep, logSuccess } from "../../utils/logger.js";
import { assertCanPayFee } from "../../utils/preflight.js";

// Chat room default schema.
const DM_COLUMNS = ["id", "text", "sender", "timestamp"];
const DM_ID_COL = "id";

// App-specific db root. Keep separate from `iq-plaza` (file sharing).
export const CHAT_DB_ROOT = "ethchat-root";

export interface ChatRow {
    txHash: string;
    data: any;
}

export interface FriendEntry {
    address: string;          // other party
    status: "pending" | "approved" | "blocked" | "unknown";
    connectionKey: string;
    partyA: string;
    partyB: string;
}

// Cache derived DH keys per wallet address (they're deterministic).
const _dhKeyCache = new Map<string, string>();

export class ChatService {
    readonly wallet: Wallet;
    readonly dbRootId: string = CHAT_DB_ROOT;

    constructor() {
        this.wallet = getWallet();
    }

    get myAddress(): string {
        return this.wallet.address;
    }

    // ---- db root ----

    async ensureDbRoot(): Promise<void> {
        try {
            await reader.getTablelistFromRoot(CHAT_DB_ROOT);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/DbRoot not found/i.test(msg)) throw err;
            logStep(`Initializing chat db root (${CHAT_DB_ROOT}) on-chain...`);
            await writer.initializeDbRoot(this.wallet, CHAT_DB_ROOT);
            logSuccess("Chat db root initialized.");
        }
    }

    // ---- DH keys (end-to-end encryption for DMs) ----

    async deriveDhKeypair(): Promise<{ privKey: Uint8Array; pubKey: Uint8Array; pubHex: string }> {
        const sign = async (msg: Uint8Array): Promise<Uint8Array> => {
            // Wallet.signMessage returns 0x-prefixed hex; strip it and decode.
            const hex = await this.wallet.signMessage(msg);
            return crypto.hexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);
        };
        const { privKey, pubKey } = await crypto.deriveX25519Keypair(sign);
        return { privKey, pubKey, pubHex: crypto.bytesToHex(pubKey) };
    }

    // Returns the hex pub key, registering one on-chain if missing.
    async ensureMyDhKey(): Promise<{ pubHex: string; created: boolean }> {
        const cached = _dhKeyCache.get(this.myAddress);
        if (cached) return { pubHex: cached, created: false };

        const me = await this.deriveDhKeypair();
        const existing = await this.lookupDhKey(this.myAddress);
        if (existing === me.pubHex) {
            _dhKeyCache.set(this.myAddress, me.pubHex);
            return { pubHex: me.pubHex, created: false };
        }

        const payload = JSON.stringify({ t: "iq-locker-key-v1", k: me.pubHex });
        await writer.codeIn(this.wallet, payload, "locker-key.json", "application/json");
        _dhKeyCache.set(this.myAddress, me.pubHex);
        return { pubHex: me.pubHex, created: true };
    }

    // Walks an address's inventory backwards looking for a locker-key.json
    // code_in. Returns the hex X25519 public key or null.
    async lookupDhKey(address: string): Promise<string | null> {
        let entries: Awaited<ReturnType<typeof reader.fetchInventoryTransactions>>;
        try {
            entries = await reader.fetchInventoryTransactions(address, { limit: 50 });
        } catch {
            return null;
        }
        for (const entry of entries) {
            try {
                const result = await reader.readCodeIn(entry.txHash);
                if (!result?.data) continue;
                const parsed = JSON.parse(result.data);
                if (parsed?.t === "iq-locker-key-v1" && typeof parsed.k === "string") {
                    return parsed.k;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    // ---- rooms ----

    async listRooms(): Promise<{ name: string; seedHex: string }[]> {
        // One RPC: getDbRoot returns names + seeds already paired. Throws if
        // the chat root hasn't been initialized — caller should run
        // `ensureDbRoot` before entering the chat menu (runChatMenu already
        // does this once on entry).
        const root = await reader.getTablelistFromRoot(CHAT_DB_ROOT);
        const seen = new Set<string>();
        const rooms: { name: string; seedHex: string }[] = [];
        for (const entry of [...root.tables, ...root.globalTables]) {
            if (!entry.name || seen.has(entry.seedHex)) continue;
            seen.add(entry.seedHex);
            rooms.push({ name: entry.name, seedHex: entry.seedHex });
        }
        return rooms;
    }

    async createRoom(name: string): Promise<{ created: boolean; txHash?: string }> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("room name is empty");
        await this.ensureDbRoot();

        try {
            await reader.fetchTableMeta(CHAT_DB_ROOT, trimmed);
            return { created: false };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/Table not found/i.test(msg)) throw err;
        }
        await assertCanPayFee(this.wallet, ["linkedList"]);
        const txHash = await writer.createTable(
            this.wallet,
            CHAT_DB_ROOT,
            trimmed,
            DM_COLUMNS,
            DM_ID_COL,
        );
        return { created: true, txHash };
    }

    async sendChat(roomName: string, message: string, handle?: string): Promise<string> {
        const trimmed = message.trim();
        if (!trimmed) throw new Error("message is empty");
        await assertCanPayFee(this.wallet, ["basic", "linkedList"]);
        return writer.writeRow(
            this.wallet,
            CHAT_DB_ROOT,
            roomName,
            JSON.stringify({
                id: makeMessageId(12),
                text: trimmed,
                sender: handle?.trim() || this.myAddress,
                timestamp: Date.now(),
            }),
        );
    }

    async readRoom(roomName: string, limit = 50): Promise<ChatRow[]> {
        return reader.readTableRows(CHAT_DB_ROOT, roomName, { limit });
    }

    // ---- connections / DMs ----

    async listFriends(): Promise<FriendEntry[]> {
        const raw = await reader.fetchUserConnections(this.myAddress);
        return raw.map((c) => {
            const other = c.partyA.toLowerCase() === this.myAddress.toLowerCase() ? c.partyB : c.partyA;
            return {
                address: other,
                status: (c.status as FriendEntry["status"]) ?? "unknown",
                connectionKey: c.connectionKey,
                partyA: c.partyA,
                partyB: c.partyB,
            };
        });
    }

    async requestConnection(partner: string): Promise<{ created: boolean; txHash?: string }> {
        const status = await reader.readConnection(CHAT_DB_ROOT, this.myAddress, partner);
        if (status.status !== "unknown") return { created: false };
        const txHash = await writer.requestConnection(
            this.wallet,
            CHAT_DB_ROOT,
            partner,
            "dm",
            DM_COLUMNS,
            DM_ID_COL,
        );
        return { created: true, txHash };
    }

    async manageConnection(
        partner: string,
        newStatus: 0 | 1 | 2, // pending / approved / blocked
    ): Promise<string> {
        return writer.manageConnection(this.wallet, partner, CHAT_DB_ROOT, newStatus);
    }

    async sendDm(partner: string, message: string, handle?: string): Promise<string> {
        const trimmed = message.trim();
        if (!trimmed) throw new Error("message is empty");

        await this.ensureMyDhKey();
        const partnerPub = await this.lookupDhKey(partner);
        await assertCanPayFee(this.wallet, ["basic", "linkedList"]);

        const sender = handle?.trim() || this.myAddress;
        const base = { id: makeMessageId(12), sender, timestamp: Date.now() };

        if (!partnerPub) {
            // Partner hasn't registered — fall back to plaintext so the CLI
            // still works. The menu layer surfaces a warning to the user.
            return writer.writeConnectionRow(
                this.wallet,
                partner,
                CHAT_DB_ROOT,
                JSON.stringify({ ...base, text: trimmed, enc: 0 }),
            );
        }

        const me = await this.deriveDhKeypair();
        const encrypted = await crypto.multiEncrypt(
            [me.pubHex, partnerPub],
            new TextEncoder().encode(trimmed),
        );
        const envelope = {
            m: "dm",
            r: encrypted.recipients.map((r) => [r.recipientPub, r.ephemeralPub, r.wrappedKey, r.wrapIv]),
            i: encrypted.iv,
            c: encrypted.ciphertext,
        };
        return writer.writeConnectionRow(
            this.wallet,
            partner,
            CHAT_DB_ROOT,
            JSON.stringify({ ...base, text: JSON.stringify(envelope), enc: 1 }),
        );
    }

    // Tries to decrypt a row's `text` field if it looks like a DM envelope.
    // Returns the cleartext message + flags describing what happened.
    async tryDecryptDmRow(row: any): Promise<{ text: string; encrypted: boolean; decrypted: boolean }> {
        const data = row?.data ?? row;
        const text = data?.text ?? "";
        if (typeof text !== "string" || !text.startsWith('{"m":"dm"')) {
            return { text, encrypted: false, decrypted: false };
        }
        try {
            const env = JSON.parse(text);
            if (env.m !== "dm" || !Array.isArray(env.r)) {
                return { text, encrypted: false, decrypted: false };
            }
            const me = await this.deriveDhKeypair();
            const recipients = env.r.map((r: string[]) => ({
                recipientPub: r[0],
                ephemeralPub: r[1],
                wrappedKey: r[2],
                wrapIv: r[3],
            }));
            const plain = await crypto.multiDecrypt(me.privKey, me.pubHex, {
                recipients,
                iv: env.i,
                ciphertext: env.c,
            });
            return { text: new TextDecoder().decode(plain), encrypted: true, decrypted: true };
        } catch {
            return { text, encrypted: true, decrypted: false };
        }
    }

    async fetchDmHistory(partner: string, limit = 50): Promise<ChatRow[]> {
        return reader.readConnectionRows(CHAT_DB_ROOT, this.myAddress, partner, { limit });
    }
}


