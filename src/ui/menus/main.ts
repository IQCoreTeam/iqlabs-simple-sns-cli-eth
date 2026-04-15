import { getWallet } from "../../utils/wallet.js";
import { logError, RESET, BOLD, DIM, CYAN, GREEN, WHITE } from "../../utils/logger.js";
import { prompt, selectFromList } from "../../utils/prompt.js";
import { shortenSig } from "../../utils/format.js";
import { runChatMenu } from "./chat.js";
import { runFileShareMenu } from "./file-share.js";
import { runMyMenu } from "./my-menu.js";

const LOGO = `${BOLD}${CYAN}
  ██╗ ██████╗ ██╗      █████╗ ██████╗ ███████╗
  ██║██╔═══██╗██║     ██╔══██╗██╔══██╗██╔════╝
  ██║██║   ██║██║     ███████║██████╔╝███████╗
  ██║██║▄▄ ██║██║     ██╔══██║██╔══██╗╚════██║
  ██║╚██████╔╝███████╗██║  ██║██████╔╝███████║
  ╚═╝ ╚══▀▀═╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝${RESET}
`;

const MENU_ITEMS: { label: string; action: (() => Promise<void>) | null }[] = [
    { label: "EthChat", action: runChatMenu },
    { label: "File Sharing", action: runFileShareMenu },
    { label: "My Menu", action: runMyMenu },
    // TODO: IQChan (imageboard) — see TODO_IQCHAN.md at repo root. Deferred
    // until we pick a feed design (board-table-as-feed vs dedicated feed).
    { label: "Exit", action: null },
];

export const runMainMenu = async () => {
    const address = shortenSig(getWallet().address);

    while (true) {
        const index = await selectFromList(
            `${LOGO}${DIM}  Wallet: ${GREEN}${address}${RESET}`,
            MENU_ITEMS,
            (item, selected) => {
                if (item.action === null) {
                    return selected
                        ? `  ${DIM}${CYAN}> ${WHITE}Exit${RESET}`
                        : `  ${DIM}  Exit${RESET}`;
                }
                return selected
                    ? `  ${BOLD}${CYAN}> ${WHITE}${item.label}${RESET}`
                    : `  ${DIM}  ${item.label}${RESET}`;
            },
        );

        if (index === null || MENU_ITEMS[index].action === null) break;
        try {
            await MENU_ITEMS[index].action!();
        } catch (err) {
            logError("Error", err);
            await prompt("Press Enter to continue...");
        }
    }
};
