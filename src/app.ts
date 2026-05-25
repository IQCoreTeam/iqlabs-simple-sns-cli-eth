import "dotenv/config";
import { formatEther } from "ethers";
import {
    setRpcUrl,
    setNetwork,
    contract,
    utils as sdkUtils,
} from "@iqlabs-official/ethereum-sdk";

import { runMainMenu } from "./ui/menus/main.js";
import { closeReadline, prompt } from "./utils/prompt.js";
import { generateWallet, getWallet, getWalletInfo } from "./utils/wallet.js";
import { saveEnvVar } from "./utils/config.js";
import { closeWsProvider } from "./utils/provider-ws.js";
import { BOLD, DIM, GREEN, RED, RESET, YELLOW } from "./utils/logger.js";
import { getBrand, renderHeader } from "./utils/branding.js";

const showLogo = () => {
    console.clear();
    console.log(renderHeader(getBrand()));
};

const main = async () => {
    // 1. Ensure wallet
    const info = getWalletInfo();
    if (!info.exists) {
        const result = generateWallet();
        showLogo();
        console.log(`  ${GREEN}Wallet created!${RESET}`);
        console.log(`  ${DIM}Saved to: ${result.path}${RESET}`);
        console.log(`  ${DIM}Address:  ${GREEN}${result.wallet.address}${RESET}`);
        console.log("");
    } else if (info.source === "env") {
        console.log(`  ${DIM}Wallet loaded from ${info.path}${RESET}`);
    }

    // 2. Ensure RPC
    let rpcUrl = process.env.ETHEREUM_RPC_URL;
    if (!rpcUrl) {
        showLogo();
        console.log(`  ${YELLOW}RPC endpoint not configured.${RESET}`);
        console.log(`  ${DIM}Paste a JSON-RPC URL — Sepolia / Monad / Monad Testnet supported.${RESET}`);
        console.log("");
        while (true) {
            const url = (await prompt("  > ")).trim();
            if (!url) {
                console.log(`\n  ${RED}RPC is required. Try again.${RESET}`);
                continue;
            }
            saveEnvVar("ETHEREUM_RPC_URL", url);
            rpcUrl = url;
            console.log(`\n  ${GREEN}RPC saved.${RESET}`);
            break;
        }
    }
    setRpcUrl(rpcUrl);

    // 3. Sanity: reach the network, and switch SDK mode to whatever the RPC
    //    actually serves (so Monad RPC → Monad contract address, etc.).
    const provider = sdkUtils.getProvider();
    let chainId: number;
    try {
        const network = await provider.getNetwork();
        chainId = Number(network.chainId);
        const mode = contract.networkFromChainId(chainId);
        if (mode) {
            setNetwork(mode, rpcUrl);
        }
    } catch (err) {
        console.log(`  ${RED}Failed to reach RPC. Check ETHEREUM_RPC_URL.${RESET}`);
        console.error(err);
        process.exit(1);
    }

    // Now that the mode is set, re-render the header in the right brand.
    showLogo();
    const brand = getBrand();
    console.log(`  ${DIM}Network: ${brand.networkLabel} (chainId ${chainId})${RESET}`);

    // 4. Balance hint (non-blocking — user can still browse read-only)
    const wallet = getWallet();
    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) {
        console.log("");
        console.log(`  ${YELLOW}Your wallet has 0 ${brand.currency}.${RESET}`);
        console.log(`  ${DIM}Read-only features still work. Send ${brand.currency} to write on-chain.${RESET}`);
        console.log(`  ${BOLD}Address:${RESET} ${GREEN}${wallet.address}${RESET}`);
    } else {
        console.log(`  ${DIM}Balance: ${formatEther(balance)} ${brand.currency}${RESET}`);
    }
    console.log("");
    await prompt(`  ${DIM}Press Enter to continue...${RESET}`);

    // 5. Main loop
    await runMainMenu();
    closeReadline();
    await closeWsProvider();
};

main().catch(async (err) => {
    console.error("Error:", err);
    closeReadline();
    await closeWsProvider();
    process.exit(1);
});
