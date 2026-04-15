// Quick smoke test: create a room then list it.
// Usage: npx tsx scripts/smoke-rooms.ts
import "dotenv/config";
import { setRpcUrl } from "@iqlabs-official/ethereum-sdk";

import { ChatService } from "../src/apps/chat/chat-service.js";

async function main() {
    if (!process.env.ETHEREUM_RPC_URL) {
        throw new Error("ETHEREUM_RPC_URL not set");
    }
    setRpcUrl(process.env.ETHEREUM_RPC_URL);

    const svc = new ChatService();
    console.log("wallet:", svc.myAddress);

    console.log("ensureDbRoot...");
    await svc.ensureDbRoot();

    const name = `smoke-room-${Date.now()}`;
    console.log("createRoom:", name);
    const created = await svc.createRoom(name);
    console.log(" ->", created);

    console.log("listRooms...");
    const rooms = await svc.listRooms();
    console.log(" ->", rooms);

    const found = rooms.find((r) => r.name === name);
    if (!found) {
        throw new Error(`freshly-created room "${name}" not in listRooms`);
    }
    console.log(`✓ found ${name} in listRooms`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
