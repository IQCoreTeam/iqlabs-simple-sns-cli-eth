// Smoke test: upload a ~250 KB payload via writer.codeIn, then read it back.
// Reproduces the previous `oversized data: transaction size 263259, limit
// 131072` failure mode and confirms the byte-budget batching fix.
//
// Usage: npx tsx scripts/smoke-large-upload.ts
import "dotenv/config";
import { setRpcUrl, reader } from "@iqlabs-official/ethereum-sdk";
import { Wallet } from "ethers";

import { getWallet } from "../src/utils/wallet.js";
import { FileShareService } from "../src/apps/file-share/file-share-service.js";

async function main() {
    if (!process.env.ETHEREUM_RPC_URL) throw new Error("ETHEREUM_RPC_URL not set");
    setRpcUrl(process.env.ETHEREUM_RPC_URL);

    const wallet: Wallet = getWallet();
    console.log("wallet:", wallet.address);

    // 250 KB random-ish base64 text. Bigger than a single tx (128 KB calldata
    // limit) so the uploader must split into multiple batches.
    const raw = Buffer.alloc(250_000);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 17 + 3) & 0xff;
    const base64 = raw.toString("base64");
    console.log("payload bytes (base64):", base64.length);

    const svc = new FileShareService();
    console.log("uploading...");
    // Write to a temp file so uploadToInventory can stat it.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmp = path.join(os.tmpdir(), `iq-smoke-${Date.now()}.bin`);
    fs.writeFileSync(tmp, raw);

    const txHash = await svc.uploadToInventory(tmp, (pct) => {
        process.stdout.write(`\r  upload ${Math.round(pct)}%   `);
    });
    process.stdout.write("\n");
    console.log("upload tx:", txHash);

    console.log("reading back...");
    const { data } = await reader.readCodeIn(txHash);
    const roundtrip = Buffer.from(data, "base64");
    const match = roundtrip.equals(raw);
    console.log("  length:", roundtrip.length, "match:", match);
    if (!match) throw new Error("roundtrip mismatch");

    fs.unlinkSync(tmp);
    console.log("✓ large upload OK");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
