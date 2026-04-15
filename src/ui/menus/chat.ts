import { isAddress, getAddress } from "ethers";

import { ChatService } from "../../apps/chat/chat-service.js";
import type { FriendEntry } from "../../apps/chat/chat-service.js";
import {
    subscribeRoom,
    subscribeDm,
    type LiveRow,
} from "../../apps/chat/chat-subscriptions.js";
import {
    logError,
    logInfo,
    RESET,
    BOLD,
    DIM,
    CYAN,
    GREEN,
    WHITE,
    RED,
    MAGENTA,
    YELLOW,
} from "../../utils/logger.js";
import { prompt, selectFromList } from "../../utils/prompt.js";
import { shortenSig } from "../../utils/format.js";
import { withTxProgress } from "../../utils/tx-progress.js";

const CHAT_LOGO = `${BOLD}${CYAN}
  ███████╗████████╗██╗  ██╗     ██████╗██╗  ██╗ █████╗ ████████╗
  ██╔════╝╚══██╔══╝██║  ██║    ██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  █████╗     ██║   ███████║    ██║     ███████║███████║   ██║
  ██╔══╝     ██║   ██╔══██║    ██║     ██╔══██║██╔══██║   ██║
  ███████╗   ██║   ██║  ██║    ╚██████╗██║  ██║██║  ██║   ██║
  ╚══════╝   ╚═╝   ╚═╝  ╚═╝     ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝${RESET}
`;

const CHAT_MENU_ITEMS: { label: string; action: string | null }[] = [
    { label: "Join Room", action: "rooms" },
    { label: "Create Room", action: "create" },
    { label: "DM", action: "dm" },
    { label: "Back", action: null },
];

const DM_MENU_ITEMS: { label: string; action: string | null }[] = [
    { label: "Friend List", action: "friends" },
    { label: "Pending Requests", action: "pending" },
    { label: "Request Connection", action: "request" },
    { label: "Back", action: null },
];

const parseAddress = (raw: string): string | null => {
    if (!raw) return null;
    try {
        return isAddress(raw) ? getAddress(raw) : null;
    } catch {
        return null;
    }
};

// ---- rendering ----

// One row → one line on the screen. Centralised so history + live updates
// look identical.
const renderRoomRow = (myAddress: string, row: LiveRow) => {
    const data = row.data ?? {};
    const sender = typeof data.sender === "string" ? data.sender : "?";
    const isMe = sender.toLowerCase() === myAddress.toLowerCase();
    const color = isMe ? CYAN : MAGENTA;
    const text = typeof data.text === "string" ? data.text : JSON.stringify(data);
    console.log(`  ${color}${shortenSig(sender)}${RESET}  ${text}`);
};

const renderDmRow = async (
    service: ChatService,
    row: LiveRow,
) => {
    const data = row.data ?? {};
    const decoded = await service.tryDecryptDmRow(data);
    const sender = typeof data.sender === "string" ? data.sender : "?";
    const isMe = sender.toLowerCase() === service.myAddress.toLowerCase();
    const color = isMe ? CYAN : MAGENTA;
    const lock = decoded.encrypted
        ? (decoded.decrypted ? `${GREEN}[enc]${RESET}` : `${RED}[enc?]${RESET}`)
        : "";
    console.log(`  ${color}${shortenSig(sender)}${RESET} ${lock} ${decoded.text}`);
};

// ---- Room chat loop ----

const runRoomChat = async (service: ChatService, room: { name: string }) => {
    console.clear();
    console.log(`${BOLD}${CYAN}# ${room.name}${RESET}`);
    console.log();

    // Track rendered txs so a history row and the subsequent live event
    // don't paint twice.
    const seen = new Set<string>();
    const render = (row: LiveRow) => {
        if (seen.has(row.txHash)) return;
        seen.add(row.txHash);
        renderRoomRow(service.myAddress, row);
    };

    // History pass: oldest → newest.
    const history = await service.readRoom(room.name, 30);
    for (const row of history.slice().reverse()) render(row);
    if (history.length === 0) logInfo("No messages yet.");

    console.log();
    console.log(`${DIM}Live — new messages appear automatically. Type /exit to leave.${RESET}`);

    // Live pass.
    const stop = await subscribeRoom(
        service.dbRootId,
        room.name,
        (row) => render(row),
    );

    try {
        while (true) {
            const input = (await prompt("> ")).trim();
            if (!input) continue;
            if (input === "/exit") break;
            try {
                await withTxProgress("Sending", () => service.sendChat(room.name, input));
            } catch {
                // tx-progress already printed the error
            }
        }
    } finally {
        stop();
    }
};

// ---- DM chat loop ----

const runDmChat = async (service: ChatService, friend: FriendEntry) => {
    console.clear();
    console.log(`${DIM}Preparing IQ encryption...${RESET}`);

    try {
        const ensured = await withTxProgress("Ensure DH key", () => service.ensureMyDhKey());
        if (ensured.created) {
            console.log(`${GREEN}Your IQ encryption key was registered on-chain.${RESET}`);
        }
    } catch (err) {
        logError("Failed to ensure your encryption key", err);
    }

    const partnerKey = await service.lookupDhKey(friend.address);
    if (!partnerKey) {
        console.log(`${YELLOW}Partner has no encryption key yet — DMs will be sent in plaintext.${RESET}`);
    } else {
        console.log(`${GREEN}${BOLD}(^_^)/ IQ ENCRYPTION ACTIVE${RESET}`);
        console.log(`${GREEN}Messages are end-to-end encrypted. Only you and ${friend.address} can read them.${RESET}`);
    }
    console.log();

    const seen = new Set<string>();
    const render = async (row: LiveRow) => {
        if (seen.has(row.txHash)) return;
        seen.add(row.txHash);
        await renderDmRow(service, row);
    };

    const history = await service.fetchDmHistory(friend.address, 30);
    for (const row of history.slice().reverse()) await render(row);
    if (history.length === 0) logInfo("No messages yet.");

    console.log();
    console.log(`${DIM}Live — new messages appear automatically. Commands: /exit  /block${RESET}`);

    const stop = await subscribeDm(
        service.dbRootId,
        friend.address,
        (row) => { render(row); },
    );

    try {
        while (true) {
            const input = (await prompt("> ")).trim();
            if (!input) continue;
            if (input === "/exit") break;
            if (input === "/block") {
                try {
                    await withTxProgress("Block", () => service.manageConnection(friend.address, 2));
                    logInfo("Blocked.");
                } catch { /* logged by tx-progress */ }
                continue;
            }
            try {
                await withTxProgress("Sending", () => service.sendDm(friend.address, input));
            } catch { /* logged */ }
        }
    } finally {
        stop();
    }
};

// ---- friends / pending ----

const handleFriendSelect = async (service: ChatService, friend: FriendEntry) => {
    if (friend.status === "pending") {
        const choice = (await prompt("1) Approve  2) Block  3) Back: ")).trim();
        if (choice === "1") {
            try {
                await withTxProgress("Approve", () => service.manageConnection(friend.address, 1));
                logInfo("Approved.");
            } catch { /* logged */ }
        } else if (choice === "2") {
            try {
                await withTxProgress("Block", () => service.manageConnection(friend.address, 2));
                logInfo("Blocked.");
            } catch { /* logged */ }
        }
        return;
    }
    if (friend.status === "blocked") {
        const choice = (await prompt("1) Unblock  2) Back: ")).trim();
        if (choice === "1") {
            try {
                await withTxProgress("Unblock", () => service.manageConnection(friend.address, 1));
                logInfo("Unblocked.");
            } catch { /* logged */ }
        }
        return;
    }
    await runDmChat(service, friend);
};

export const openFriendList = async (service: ChatService) => {
    const friends = await service.listFriends();
    if (friends.length === 0) {
        logInfo("No friends found.");
        await prompt("Press Enter to continue...");
        return;
    }
    const index = await selectFromList("Friend List", friends, (friend, selected) => {
        const marker = selected ? "*" : " ";
        return `${marker} ${friend.address} [${friend.status}]`;
    });
    if (index === null) return;
    await handleFriendSelect(service, friends[index]);
    await prompt("Press Enter to continue...");
};

const openPendingRequests = async (service: ChatService) => {
    const friends = await service.listFriends();
    const pending = friends.filter((f) => f.status === "pending");
    if (pending.length === 0) {
        logInfo("No pending requests.");
        await prompt("Press Enter to continue...");
        return;
    }
    console.clear();
    console.log(`${BOLD}${CYAN}Pending (${pending.length})${RESET}`);
    const index = await selectFromList("Pending Requests", pending, (friend, selected) => {
        const marker = selected ? `${CYAN}>${RESET}` : " ";
        return `${marker} ${friend.address}`;
    });
    if (index === null) return;
    const chosen = pending[index];
    const choice = (await prompt("1) Approve  2) Block  3) Cancel: ")).trim();
    if (choice === "1") {
        try {
            await withTxProgress("Approve", () => service.manageConnection(chosen.address, 1));
            logInfo(`Approved ${chosen.address}`);
        } catch { /* logged */ }
    } else if (choice === "2") {
        try {
            await withTxProgress("Block", () => service.manageConnection(chosen.address, 2));
            logInfo(`Blocked ${chosen.address}`);
        } catch { /* logged */ }
    }
    await prompt("Press Enter to continue...");
};

const requestConnectionFlow = async (service: ChatService) => {
    const input = (await prompt("Partner address (0x...): ")).trim();
    const partner = parseAddress(input);
    if (!partner) {
        logError("Invalid Ethereum address.");
        await prompt("Press Enter to continue...");
        return;
    }
    if (partner.toLowerCase() === service.myAddress.toLowerCase()) {
        logError("Cannot request a connection with yourself.");
        await prompt("Press Enter to continue...");
        return;
    }
    try {
        const result = await withTxProgress("Request connection", () => service.requestConnection(partner));
        if (result.created) {
            logInfo("Connection requested.", { txHash: result.txHash });
        } else {
            logInfo("Connection already exists.");
        }
    } catch { /* logged */ }
    await prompt("Press Enter to continue...");
};

// ---- rooms ----

const openRoomList = async (service: ChatService) => {
    const rooms = await service.listRooms();
    if (rooms.length === 0) {
        logInfo("No rooms yet.");
        await prompt("Press Enter to continue...");
        return;
    }
    const index = await selectFromList("Room List", rooms, (room, selected) => {
        const marker = selected ? "*" : " ";
        return `${marker} ${room.name}`;
    });
    if (index === null) return;
    await runRoomChat(service, rooms[index]);
    await prompt("Press Enter to continue...");
};

const createRoomFlow = async (service: ChatService) => {
    const name = (await prompt("Room name: ")).trim();
    if (!name) {
        logError("Room name is required.");
        return;
    }
    try {
        const result = await withTxProgress("Create room", () => service.createRoom(name));
        if (result.created) {
            logInfo("Room created.", { txHash: result.txHash });
        } else {
            logInfo("Room already exists.");
        }
    } catch { /* logged */ }
    await prompt("Press Enter to continue...");
};

// ---- menus ----

const DM_LOGO = `${BOLD}${CYAN}
  ██████╗ ███╗   ███╗
  ██╔══██╗████╗ ████║
  ██║  ██║██╔████╔██║
  ██║  ██║██║╚██╔╝██║
  ██████╔╝██║ ╚═╝ ██║
  ╚═════╝ ╚═╝     ╚═╝${RESET}
`;

const renderMenuItem = (item: { label: string; action: string | null }, selected: boolean) => {
    if (item.action === null) {
        return selected
            ? `  ${DIM}${CYAN}> ${WHITE}Back${RESET}`
            : `  ${DIM}  Back${RESET}`;
    }
    return selected
        ? `  ${BOLD}${CYAN}> ${WHITE}${item.label}${RESET}`
        : `  ${DIM}  ${item.label}${RESET}`;
};

const runDmMenu = async (service: ChatService) => {
    while (true) {
        const index = await selectFromList(DM_LOGO, DM_MENU_ITEMS, renderMenuItem);
        if (index === null || DM_MENU_ITEMS[index].action === null) break;
        try {
            switch (DM_MENU_ITEMS[index].action) {
                case "friends":
                    await openFriendList(service);
                    break;
                case "pending":
                    await openPendingRequests(service);
                    break;
                case "request":
                    await requestConnectionFlow(service);
                    break;
            }
        } catch (err) {
            logError("DM action failed", err);
            await prompt("Press Enter to continue...");
        }
    }
};

export const runChatMenu = async () => {
    const service = new ChatService();
    try {
        await withTxProgress("Ensure chat db root", () => service.ensureDbRoot());
    } catch (err) {
        logError("Chat setup failed", err);
        await prompt("Press Enter to return...");
        return;
    }

    while (true) {
        const index = await selectFromList(CHAT_LOGO, CHAT_MENU_ITEMS, renderMenuItem);
        if (index === null || CHAT_MENU_ITEMS[index].action === null) break;
        try {
            switch (CHAT_MENU_ITEMS[index].action) {
                case "rooms":
                    await openRoomList(service);
                    break;
                case "create":
                    await createRoomFlow(service);
                    break;
                case "dm":
                    await runDmMenu(service);
                    break;
            }
        } catch (err) {
            logError("Chat action failed", err);
            await prompt("Press Enter to continue...");
        }
    }
};
