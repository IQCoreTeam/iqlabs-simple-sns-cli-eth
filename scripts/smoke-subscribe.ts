// Smoke test for the WebSocket subscribe path.
// Flow:
//  1. subscribe to a room
//  2. send one message
//  3. wait for the event to come back through WS
//  4. assert it matches, clean up
//
// Usage: npx tsx scripts/smoke-subscribe.ts
import "dotenv/config";
import { setRpcUrl } from "@iqlabs-official/ethereum-sdk";

import { ChatService } from "../src/apps/chat/chat-service.js";
import { subscribeRoom } from "../src/apps/chat/chat-subscriptions.js";
import { closeWsProvider } from "../src/utils/provider-ws.js";

async function main() {
    if (!process.env.ETHEREUM_RPC_URL) throw new Error("ETHEREUM_RPC_URL not set");
    setRpcUrl(process.env.ETHEREUM_RPC_URL);

    const svc = new ChatService();
    await svc.ensureDbRoot();

    const roomName = `smoke-live-${Date.now()}`;
    console.log("creating room:", roomName);
    await svc.createRoom(roomName);

    const received: any[] = [];
    const stop = await subscribeRoom(svc.dbRootId, roomName, (row) => {
        console.log("  ws rx:", row.txHash.slice(0, 12), row.data);
        received.push(row);
    });
    console.log("subscribed, sending a message...");

    const expected = `hello-${Date.now()}`;
    const txHash = await svc.sendChat(roomName, expected);
    console.log("sent tx:", txHash.slice(0, 12));

    // Wait up to 20s for the WS event
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const hit = received.find(
            (r) => r.data?.text === expected || r.txHash === txHash,
        );
        if (hit) {
            console.log("✓ received via subscribe:", hit.data);
            stop();
            await closeWsProvider();
            return;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    stop();
    await closeWsProvider();
    throw new Error("timed out waiting for WS event");
}

main().catch(async (err) => {
    console.error(err);
    await closeWsProvider();
    process.exit(1);
});
