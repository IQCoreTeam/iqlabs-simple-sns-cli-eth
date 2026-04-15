import * as fs from "node:fs";
import * as path from "node:path";
import { ZeroAddress } from "ethers";
import type { Wallet } from "ethers";
import { reader, writer } from "@iqlabs-official/ethereum-sdk";

import { getWallet } from "../../utils/wallet.js";
import { makeMessageId } from "../../utils/id.js";
import { logStep, logSuccess } from "../../utils/logger.js";

// IQ Plaza — shared public file drop. Uses a separate db root from chat.
export const PLAZA_DB_ROOT = "iq-plaza";

const FILE_COLUMNS = ["id", "name", "ext", "sig", "uploader", "timestamp"];
const FILE_ID_COL = "id";

export interface PlazaFolder {
    name: string;       // human-readable name (= seed hint passed to createTable)
    seedHex: string;    // bytes32 hex as stored in DbRoot
    isPublic: boolean;  // writers.length === 0 on-chain
    ownerLabel: string; // "public" or shortened writer address
}

export interface PlazaFile {
    id: string;
    name: string;
    ext: string;
    sig: string;        // code_in tx hash — the download key
    uploader: string;
    timestamp: number;
}

// Exists purely to bridge filesystem I/O with the SDK's string-based API.
// Anything that's a single SDK call (fetch metadata, list inventory sigs)
// belongs in the menu, not here.
export class FileShareService {
    readonly wallet: Wallet;

    constructor() {
        this.wallet = getWallet();
    }

    get myAddress(): string {
        return this.wallet.address;
    }

    // ---- inventory uploads / downloads ----

    async uploadToInventory(
        filePath: string,
        onProgress?: (pct: number) => void,
    ): Promise<string> {
        const buf = fs.readFileSync(filePath);
        const base64 = buf.toString("base64");
        const filename = path.basename(filePath);
        // filetype undefined → let the contract/metadata stay generic; we
        // carry filename as the handle so download can restore it.
        return writer.codeIn(this.wallet, base64, filename, "application/octet-stream", onProgress);
    }

    async downloadFromInventory(
        txHash: string,
        destPath: string,
        onProgress?: (pct: number) => void,
    ): Promise<{ bytesWritten: number; filename: string }> {
        const { metadata, data } = await reader.readCodeIn(txHash, onProgress);
        if (!data) throw new Error("downloaded payload is empty");
        const filename = typeof metadata?.handle === "string" ? metadata.handle : "";
        const buf = Buffer.from(data, "base64");
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, buf);
        return { bytesWritten: buf.length, filename };
    }

    // ---- IQ Plaza folders ----

    async ensurePlazaRoot(): Promise<void> {
        try {
            await reader.getTablelistFromRoot(PLAZA_DB_ROOT);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/DbRoot not found/i.test(msg)) throw err;
            logStep(`Initializing IQ Plaza db root (${PLAZA_DB_ROOT}) on-chain...`);
            await writer.initializeDbRoot(this.wallet, PLAZA_DB_ROOT);
            logSuccess("Plaza db root initialized.");
        }
    }

    async listPlazaFolders(): Promise<PlazaFolder[]> {
        // One RPC for the names, then one getTable per entry to learn
        // isPublic / owner. Still cheaper than the previous N getTable calls
        // that also had to decode bytes fields.
        const root = await reader.getTablelistFromRoot(PLAZA_DB_ROOT);
        const seen = new Set<string>();
        const entries = [...root.tables, ...root.globalTables].filter((e) => {
            if (!e.name || seen.has(e.seedHex)) return false;
            seen.add(e.seedHex);
            return true;
        });

        const folders: PlazaFolder[] = [];
        for (const entry of entries) {
            try {
                const meta: any = await reader.fetchTableMeta(PLAZA_DB_ROOT, entry.name);
                const writers = (meta?.writers ?? []) as string[];
                const isPublic = writers.length === 0;
                const owner = writers[0];
                const ownerLabel = isPublic
                    ? "public"
                    : owner && owner !== ZeroAddress
                      ? `${owner.slice(0, 6)}...${owner.slice(-4)}`
                      : "private";
                folders.push({ name: entry.name, seedHex: entry.seedHex, isPublic, ownerLabel });
            } catch {
                continue;
            }
        }
        return folders;
    }

    async createPlazaFolder(
        name: string,
        isPublic: boolean,
    ): Promise<{ created: boolean; txHash?: string }> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("folder name is empty");
        await this.ensurePlazaRoot();

        try {
            await reader.fetchTableMeta(PLAZA_DB_ROOT, trimmed);
            return { created: false };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/Table not found/i.test(msg)) throw err;
        }

        const writers = isPublic ? [] : [this.myAddress];
        const txHash = await writer.createTable(
            this.wallet,
            PLAZA_DB_ROOT,
            trimmed,
            FILE_COLUMNS,
            FILE_ID_COL,
            [],
            undefined,
            writers,
        );
        return { created: true, txHash };
    }

    async listPlazaFiles(folderName: string): Promise<PlazaFile[]> {
        const rows = await reader.readTableRows(PLAZA_DB_ROOT, folderName, { limit: 100 });
        const files: PlazaFile[] = [];
        for (const row of rows) {
            const d = row?.data;
            if (!d || typeof d !== "object" || typeof d.sig !== "string") continue;
            files.push({
                id: typeof d.id === "string" ? d.id : "",
                name: typeof d.name === "string" ? d.name : "",
                ext: typeof d.ext === "string" ? d.ext : "",
                sig: d.sig,
                uploader: typeof d.uploader === "string" ? d.uploader : "",
                timestamp: typeof d.timestamp === "number" ? d.timestamp : 0,
            });
        }
        return files.sort((a, b) => b.timestamp - a.timestamp);
    }

    // Convenience: upload + index in a plaza folder in one shot.
    async uploadToPlaza(
        folderName: string,
        filePath: string,
        onProgress?: (pct: number) => void,
    ): Promise<{ uploadTx: string; indexTx: string }> {
        const uploadTx = await this.uploadToInventory(filePath, onProgress);
        const base = path.basename(filePath);
        const dot = base.lastIndexOf(".");
        const name = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot + 1) : "";
        const indexTx = await writer.writeRow(
            this.wallet,
            PLAZA_DB_ROOT,
            folderName,
            JSON.stringify({
                id: makeMessageId(12),
                name,
                ext,
                sig: uploadTx,
                uploader: this.myAddress,
                timestamp: Date.now(),
            }),
        );
        return { uploadTx, indexTx };
    }
}

