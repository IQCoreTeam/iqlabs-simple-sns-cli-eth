import { reader, setRpcUrl, getRpcUrl } from "@iqlabs-official/ethereum-sdk";

import { getWallet } from "../../utils/wallet.js";
import { saveEnvVar } from "../../utils/config.js";
import { logError, logInfo, RESET, BOLD, DIM, CYAN, GREEN, WHITE } from "../../utils/logger.js";
import { prompt, selectFromList } from "../../utils/prompt.js";
import { openFriendList } from "./chat.js";
import { ChatService } from "../../apps/chat/chat-service.js";

const rpcSettings = async () => {
    const current = getRpcUrl();
    logInfo(`Current RPC: ${current}`);
    console.log("");
    console.log("Paste a JSON-RPC URL (empty to keep current):");
    const newUrl = (await prompt("> ")).trim();
    if (newUrl) {
        setRpcUrl(newUrl);
        saveEnvVar("ETHEREUM_RPC_URL", newUrl);
        logInfo(`RPC updated and saved: ${newUrl}`);
    }
    await prompt("Press Enter to continue...");
};

const showProfile = async () => {
    const address = getWallet().address;
    logInfo(`Address: ${address}`);
    try {
        const state = await reader.readUserState(address);
        logInfo("User state:", state);
    } catch {
        logInfo("No user state found on-chain");
    }
    await prompt("Press Enter to continue...");
};

const showInventory = async () => {
    const address = getWallet().address;
    logInfo("Fetching inventory transactions...");

    let entries: Awaited<ReturnType<typeof reader.fetchInventoryTransactions>>;
    try {
        entries = await reader.fetchInventoryTransactions(address, { limit: 100 });
    } catch (err) {
        logError("Failed to fetch inventory", err instanceof Error ? err.message : String(err));
        await prompt("Press Enter to continue...");
        return;
    }

    if (entries.length === 0) {
        logInfo("No inventory items yet.");
        await prompt("Press Enter to continue...");
        return;
    }

    const items = entries.map((e, i) => ({
        label: `${i + 1}. ${e.handle || "(no handle)"}  ${DIM}${e.txHash.slice(0, 10)}...${e.txHash.slice(-6)}${RESET}`,
        txHash: e.txHash,
    }));

    while (true) {
        const index = await selectFromList(
            `\n  ${BOLD}${CYAN}Inventory${RESET} ${DIM}(${entries.length} items)${RESET}`,
            items,
            (item, selected) =>
                selected
                    ? `  ${BOLD}${CYAN}> ${WHITE}${item.label}${RESET}`
                    : `  ${DIM}  ${item.label}${RESET}`,
        );
        if (index === null) return;

        console.clear();
        logInfo(`Reading ${items[index].txHash}...`);
        try {
            const result = await reader.readCodeIn(items[index].txHash);
            console.log("");
            console.log(`  ${BOLD}Metadata:${RESET}`, result.metadata);
            if (result.data) {
                try {
                    const parsed = JSON.parse(result.data);
                    console.log(`  ${BOLD}Data:${RESET}`);
                    console.log(JSON.stringify(parsed, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
                } catch {
                    const preview = result.data.slice(0, 200);
                    console.log(`  ${BOLD}Data:${RESET} ${preview}${result.data.length > 200 ? "..." : ""}`);
                }
            } else {
                console.log(`  ${DIM}(no data)${RESET}`);
            }
        } catch (err) {
            logError("Failed to read", err instanceof Error ? err.message : String(err));
        }
        console.log("");
        await prompt("Press Enter to go back...");
    }
};

const dmInbox = async () => {
    const service = new ChatService();
    try {
        await service.ensureDbRoot();
    } catch (err) {
        logError("Chat setup failed", err);
        await prompt("Press Enter to continue...");
        return;
    }
    await openFriendList(service);
};

const MY_MENU_ITEMS: { label: string; action: (() => Promise<void>) | null }[] = [
    { label: "RPC Settings", action: rpcSettings },
    { label: "My Profile", action: showProfile },
    { label: "My Inventory", action: showInventory },
    { label: "DM Inbox", action: dmInbox },
    { label: "Back", action: null },
];

export const runMyMenu = async () => {
    const address = getWallet().address;

    while (true) {
        const index = await selectFromList(
            `\n  ${BOLD}${CYAN}╔══════════════════════════╗${RESET}\n  ${BOLD}${CYAN}║        My Menu           ║${RESET}\n  ${BOLD}${CYAN}╚══════════════════════════╝${RESET}\n  ${DIM}Wallet: ${GREEN}${address}${RESET}`,
            MY_MENU_ITEMS,
            (item, selected) => {
                if (item.action === null) {
                    return selected
                        ? `  ${DIM}${CYAN}> ${WHITE}Back${RESET}`
                        : `  ${DIM}  Back${RESET}`;
                }
                return selected
                    ? `  ${BOLD}${CYAN}> ${WHITE}${item.label}${RESET}`
                    : `  ${DIM}  ${item.label}${RESET}`;
            },
        );

        if (index === null || MY_MENU_ITEMS[index].action === null) break;
        try {
            await MY_MENU_ITEMS[index].action!();
        } catch (err) {
            logError("Error", err);
            await prompt("Press Enter to continue...");
        }
    }
};
