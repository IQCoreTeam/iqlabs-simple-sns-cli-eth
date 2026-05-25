// Per-network branding for the CLI. SDK exposes the active network via
// getNetwork() (set by app.ts after chainId detection); this file maps that
// mode to the logo + visible names that the menus render.

import { getNetwork, contract } from "@iqlabs-official/ethereum-sdk";
import { BOLD, CYAN, DIM, MAGENTA, RESET } from "./logger.js";

const IQLABS_LOGO = `${BOLD}${CYAN}
  ██╗ ██████╗ ██╗      █████╗ ██████╗ ███████╗
  ██║██╔═══██╗██║     ██╔══██╗██╔══██╗██╔════╝
  ██║██║   ██║██║     ███████║██████╔╝███████╗
  ██║██║▄▄ ██║██║     ██╔══██║██╔══██╗╚════██║
  ██║╚██████╔╝███████╗██║  ██║██████╔╝███████║
  ╚═╝ ╚══▀▀═╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝${RESET}
`;

const MONAD_LOGO = `${BOLD}${MAGENTA}
  ███╗   ███╗ ██████╗ ███╗   ██╗ █████╗ ██████╗
  ████╗ ████║██╔═══██╗████╗  ██║██╔══██╗██╔══██╗
  ██╔████╔██║██║   ██║██╔██╗ ██║███████║██║  ██║
  ██║╚██╔╝██║██║   ██║██║╚██╗██║██╔══██║██║  ██║
  ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║██║  ██║██████╔╝
  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚═════╝${RESET}
`;

const ETH_CHAT_LOGO = `${BOLD}${CYAN}
  ███████╗████████╗██╗  ██╗     ██████╗██╗  ██╗ █████╗ ████████╗
  ██╔════╝╚══██╔══╝██║  ██║    ██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  █████╗     ██║   ███████║    ██║     ███████║███████║   ██║
  ██╔══╝     ██║   ██╔══██║    ██║     ██╔══██║██╔══██║   ██║
  ███████╗   ██║   ██║  ██║    ╚██████╗██║  ██║██║  ██║   ██║
  ╚══════╝   ╚═╝   ╚═╝  ╚═╝     ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝${RESET}
`;

const MONAD_CHAT_LOGO = `${BOLD}${MAGENTA}
  ███╗   ███╗ ██████╗ ███╗   ██╗     ██████╗██╗  ██╗ █████╗ ████████╗
  ████╗ ████║██╔═══██╗████╗  ██║    ██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  ██╔████╔██║██║   ██║██╔██╗ ██║    ██║     ███████║███████║   ██║
  ██║╚██╔╝██║██║   ██║██║╚██╗██║    ██║     ██╔══██║██╔══██║   ██║
  ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║    ╚██████╗██║  ██║██║  ██║   ██║
  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝     ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝${RESET}
`;

const DM_LOGO_CYAN = `${BOLD}${CYAN}
  ██████╗ ███╗   ███╗
  ██╔══██╗████╗ ████║
  ██║  ██║██╔████╔██║
  ██║  ██║██║╚██╔╝██║
  ██████╔╝██║ ╚═╝ ██║
  ╚═════╝ ╚═╝     ╚═╝${RESET}
`;

const DM_LOGO_MAGENTA = `${BOLD}${MAGENTA}
  ██████╗ ███╗   ███╗
  ██╔══██╗████╗ ████║
  ██║  ██║██╔████╔██║
  ██║  ██║██║╚██╔╝██║
  ██████╔╝██║ ╚═╝ ██║
  ╚═════╝ ╚═╝     ╚═╝${RESET}
`;

export interface Brand {
    cliName: string;       // "Ethereum Internet CLI" / "Monad Internet CLI"
    currency: string;      // "ETH" / "MON"
    chatLabel: string;     // top-level menu item: "EthChat" / "MonadChat"
    fileShareLabel: string;
    logo: string;
    chatLogo: string;
    dmLogo: string;
    networkLabel: string;  // "Sepolia" / "Monad" / "Monad Testnet"
}

export const getBrand = (): Brand => {
    const mode = getNetwork();
    const currency = contract.NETWORKS[mode].currency;

    if (mode === "monad" || mode === "monadTestnet") {
        return {
            cliName: "Monad Internet CLI",
            currency,
            chatLabel: "MonadChat",
            fileShareLabel: "File Sharing",
            logo: MONAD_LOGO,
            chatLogo: MONAD_CHAT_LOGO,
            dmLogo: DM_LOGO_MAGENTA,
            networkLabel: mode === "monad" ? "Monad" : "Monad Testnet",
        };
    }

    return {
        cliName: "Ethereum Internet CLI",
        currency,
        chatLabel: "EthChat",
        fileShareLabel: "File Sharing",
        logo: IQLABS_LOGO,
        chatLogo: ETH_CHAT_LOGO,
        dmLogo: DM_LOGO_CYAN,
        networkLabel: "Sepolia",
    };
};

export const renderHeader = (brand: Brand): string =>
    `${brand.logo}${DIM}  ${brand.cliName} — ${brand.networkLabel}${RESET}\n`;
