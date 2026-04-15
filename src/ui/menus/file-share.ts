import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { reader } from "@iqlabs-official/ethereum-sdk";

import {
    FileShareService,
    type PlazaFolder,
} from "../../apps/file-share/file-share-service.js";
import { timeAgo, shortenSig, truncate } from "../../utils/format.js";
import {
    BOLD,
    CYAN,
    DIM,
    GREEN,
    MAGENTA,
    RESET,
    WHITE,
    YELLOW,
    logError,
    logInfo,
    logStep,
    logSuccess,
} from "../../utils/logger.js";
import { prompt, selectFromList } from "../../utils/prompt.js";
import { finishProgressBar, renderProgressBar } from "../widgets/progress-bar.js";
import { getWallet } from "../../utils/wallet.js";
import { withTxProgress } from "../../utils/tx-progress.js";

// ---- path + file helpers ----

const expandPath = (input: string): string => {
    const trimmed = input.trim().replace(/^['"]|['"]$/g, "");
    if (!trimmed) return trimmed;
    const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
    return path.resolve(expanded);
};

const downloadsDir = () => path.join(os.homedir(), "Downloads");

const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const pickFile = async (): Promise<{ filePath: string; stat: fs.Stats } | null> => {
    const raw = (await prompt("file path (~ ok): ")).trim();
    if (!raw) {
        logInfo("cancelled");
        return null;
    }
    const filePath = expandPath(raw);
    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch (err) {
        logError(`can't read ${filePath}`, err instanceof Error ? err.message : String(err));
        await prompt("Press Enter to continue...");
        return null;
    }
    if (!stat.isFile()) {
        logError(`not a regular file: ${filePath}`);
        await prompt("Press Enter to continue...");
        return null;
    }
    return { filePath, stat };
};

const printFileInfo = (filePath: string, stat: fs.Stats) => {
    const base64Bytes = Math.ceil((stat.size * 4) / 3);
    const expectedChunks = Math.max(1, Math.ceil(base64Bytes / 850));
    console.log(`  ${DIM}path:  ${RESET}${filePath}`);
    console.log(`  ${DIM}size:  ${RESET}${formatBytes(stat.size)}  ${DIM}(~${expectedChunks} chunks)${RESET}`);
};

// ---- upload to inventory ----

const uploadToInventoryFlow = async (service: FileShareService) => {
    console.clear();
    console.log(`${BOLD}${CYAN}Upload to my inventory${RESET}`);
    console.log();

    const picked = await pickFile();
    if (!picked) return;
    const { filePath, stat } = picked;
    console.log();
    printFileInfo(filePath, stat);
    console.log();

    const confirm = (await prompt("upload? (y/N): ")).trim().toLowerCase();
    if (confirm !== "y") {
        logInfo("cancelled");
        return;
    }

    let txHash: string;
    try {
        txHash = await service.uploadToInventory(filePath, (pct) => renderProgressBar(pct, "upload"));
        renderProgressBar(100, "upload");
    } catch (err) {
        finishProgressBar();
        logError("upload failed", err);
        await prompt("Press Enter to continue...");
        return;
    }
    finishProgressBar();

    console.log();
    logSuccess("Upload complete. On chain forever.");
    console.log(`  ${BOLD}tx hash:${RESET} ${GREEN}${txHash}${RESET}`);
    console.log(`  ${DIM}share this with anyone for 'Download by tx hash'.${RESET}`);
    console.log();
    await prompt("Press Enter to continue...");
};

// ---- plaza folders ----

const folderTag = (f: PlazaFolder): string =>
    f.isPublic ? `${GREEN}[public]${RESET}` : `${DIM}[${f.ownerLabel}]${RESET}`;

const printPlazaWarning = () => {
    console.log(`${BOLD}${CYAN}IQ Plaza${RESET}  ${DIM}the degen dump${RESET}`);
    console.log();
    console.log(`  Public folders accept uploads from any wallet. Files are permanent`);
    console.log(`  and unmoderated. Validate after download.`);
};

const createPlazaFolderFlow = async (
    service: FileShareService,
): Promise<PlazaFolder | null> => {
    console.clear();
    console.log(`${BOLD}${CYAN}Create folder in IQ Plaza${RESET}`);
    console.log(`${DIM}name must match [a-zA-Z0-9_-]+, 1..30 chars, no spaces${RESET}`);
    console.log();

    const name = (await prompt("folder name: ")).trim();
    if (!name) {
        logInfo("cancelled");
        return null;
    }
    if (!/^[a-zA-Z0-9_-]{1,30}$/.test(name)) {
        logError("invalid name. allowed: a-z A-Z 0-9 _ - (1..30 chars)");
        await prompt("Press Enter to continue...");
        return null;
    }

    const visibility = [
        { label: "public", sub: "anyone can dump files here", value: true },
        { label: "private", sub: "only your wallet can upload (others can browse)", value: false },
        { label: "Cancel", sub: "", value: null as boolean | null },
    ];
    const visIdx = await selectFromList(
        `visibility for '${name}/'  ${DIM}(cannot be changed later)${RESET}`,
        visibility,
        (item, selected) => {
            const marker = selected ? `${CYAN}>${RESET}` : " ";
            if (item.value === null) return `  ${DIM}${marker} Cancel${RESET}`;
            return `${marker} ${WHITE}${item.label}${RESET}  ${DIM}${item.sub}${RESET}`;
        },
    );
    if (visIdx === null || visibility[visIdx].value === null) {
        logInfo("cancelled");
        return null;
    }
    const isPublic = visibility[visIdx].value as boolean;

    try {
        const result = await withTxProgress(
            `Create folder '${name}'`,
            () => service.createPlazaFolder(name, isPublic),
        );
        if (!result.created) {
            logInfo(`folder '${name}' already exists. using it.`);
        } else {
            logSuccess(`created. tx: ${shortenSig(result.txHash ?? "")}`);
        }
        const me = getWallet().address;
        return {
            name,
            seedHex: "", // re-listed below — we don't need the seed here
            isPublic,
            ownerLabel: isPublic ? "public" : `${me.slice(0, 6)}...${me.slice(-4)}`,
        };
    } catch (err) {
        logError("create folder failed", err);
        await prompt("Press Enter to continue...");
        return null;
    }
};

const pickOrCreatePlazaFolder = async (
    service: FileShareService,
): Promise<PlazaFolder | null> => {
    logStep("loading IQ Plaza folders...");
    let folders: PlazaFolder[];
    try {
        folders = await service.listPlazaFolders();
    } catch (err) {
        logError("couldn't list folders", err);
        await prompt("Press Enter to continue...");
        return null;
    }

    while (true) {
        type Item = { kind: "folder"; folder: PlazaFolder } | { kind: "create" } | { kind: "back" };
        const items: Item[] = [
            ...folders.map((f) => ({ kind: "folder" as const, folder: f })),
            { kind: "create" as const },
            { kind: "back" as const },
        ];
        const idx = await selectFromList(
            `${BOLD}${CYAN}IQ Plaza${RESET}  ${DIM}${folders.length} folders${RESET}`,
            items,
            (item, selected) => {
                const marker = selected ? `${CYAN}>${RESET}` : " ";
                if (item.kind === "create") return `${marker} ${GREEN}+ create new folder${RESET}`;
                if (item.kind === "back") return `${marker} ${DIM}Back${RESET}`;
                return `${marker} ${WHITE}${item.folder.name}/${RESET}  ${folderTag(item.folder)}`;
            },
        );
        if (idx === null) return null;
        const chosen = items[idx];
        if (chosen.kind === "back") return null;
        if (chosen.kind === "folder") return chosen.folder;
        const made = await createPlazaFolderFlow(service);
        if (made) {
            try {
                folders = await service.listPlazaFolders();
            } catch {
                // keep previous list
            }
            const match = folders.find((f) => f.name === made.name);
            return match ?? made;
        }
    }
};

const uploadToPlazaFlow = async (service: FileShareService) => {
    console.clear();
    printPlazaWarning();
    console.log();

    const folder = await pickOrCreatePlazaFolder(service);
    if (!folder) return;

    if (!folder.isPublic) {
        const me = getWallet().address.toLowerCase();
        const owner = folder.ownerLabel.toLowerCase();
        // ownerLabel is "shortened" form, so just note the restriction to the user.
        if (!me.startsWith(owner.slice(0, 6))) {
            logError(`'${folder.name}/' is private. Only ${folder.ownerLabel} can upload.`);
            await prompt("Press Enter to continue...");
            return;
        }
    }

    console.clear();
    console.log(`${BOLD}${CYAN}Upload to IQ Plaza/${folder.name}/${RESET}  ${DIM}${folderTag(folder)}${RESET}`);
    console.log();

    const picked = await pickFile();
    if (!picked) return;
    const { filePath, stat } = picked;
    console.log();
    printFileInfo(filePath, stat);
    console.log();
    console.log(`  ${YELLOW}heads up:${RESET} this folder is ${folder.isPublic ? "public" : "private"}.`);
    console.log(`            Your wallet (${shortenSig(getWallet().address)}) is stamped on chain forever.`);
    console.log();

    const confirm = (await prompt("continue? (y/N): ")).trim().toLowerCase();
    if (confirm !== "y") {
        logInfo("cancelled");
        return;
    }

    let result: { uploadTx: string; indexTx: string };
    try {
        result = await service.uploadToPlaza(folder.name, filePath, (pct) =>
            renderProgressBar(pct, "upload"),
        );
        renderProgressBar(100, "upload");
    } catch (err) {
        finishProgressBar();
        logError("upload failed", err);
        await prompt("Press Enter to continue...");
        return;
    }
    finishProgressBar();

    console.log();
    logSuccess(`Dropped into ${folder.name}/`);
    console.log(`  ${DIM}file tx: ${RESET}${GREEN}${result.uploadTx}${RESET}`);
    console.log(`  ${DIM}index tx:${RESET} ${DIM}${result.indexTx}${RESET}`);
    console.log();
    await prompt("Press Enter to continue...");
};

const browsePlazaFolder = async (service: FileShareService, folder: PlazaFolder) => {
    while (true) {
        console.clear();
        console.log(`${BOLD}${CYAN}${folder.name}/${RESET}  ${folderTag(folder)}`);
        console.log();

        logStep("loading files...");
        let files: Awaited<ReturnType<typeof service.listPlazaFiles>>;
        try {
            files = await service.listPlazaFiles(folder.name);
        } catch (err) {
            logError("couldn't read folder", err);
            await prompt("Press Enter to continue...");
            return;
        }
        if (files.length === 0) {
            logInfo(`${folder.name}/ is empty.`);
            await prompt("Press Enter to continue...");
            return;
        }

        type Item = { kind: "file"; file: typeof files[number] } | { kind: "back" };
        const items: Item[] = [
            ...files.map((f) => ({ kind: "file" as const, file: f })),
            { kind: "back" as const },
        ];
        const idx = await selectFromList(
            `${BOLD}${CYAN}${folder.name}/${RESET}  ${DIM}${files.length} files${RESET}`,
            items,
            (item, selected) => {
                const marker = selected ? `${CYAN}>${RESET}` : " ";
                if (item.kind === "back") return `${marker} ${DIM}Back${RESET}`;
                const f = item.file;
                const fname = f.ext ? `${f.name}.${f.ext}` : f.name;
                const when = f.timestamp ? timeAgo(Math.floor(f.timestamp / 1000)) : "?";
                return `${marker} ${WHITE}${fname}${RESET}  ${DIM}by ${shortenSig(f.uploader)} - ${when}${RESET}`;
            },
        );
        if (idx === null) return;
        const chosen = items[idx];
        if (chosen.kind === "back") return;

        const fname = chosen.file.ext ? `${chosen.file.name}.${chosen.file.ext}` : chosen.file.name;
        console.log();
        console.log(
            `  ${DIM}note: this came from ${shortenSig(chosen.file.uploader)}. validate after download.${RESET}`,
        );
        console.log();
        await downloadFlow(service, chosen.file.sig, fname);
    }
};

const browsePlazaFlow = async (service: FileShareService) => {
    while (true) {
        console.clear();
        printPlazaWarning();
        console.log();

        logStep("loading folders...");
        let folders: PlazaFolder[];
        try {
            folders = await service.listPlazaFolders();
        } catch (err) {
            logError("couldn't list folders", err);
            await prompt("Press Enter to continue...");
            return;
        }
        if (folders.length === 0) {
            logInfo("no folders yet. create one from 'Upload file → IQ Plaza'.");
            await prompt("Press Enter to continue...");
            return;
        }

        type Item = { kind: "folder"; folder: PlazaFolder } | { kind: "back" };
        const items: Item[] = [
            ...folders.map((f) => ({ kind: "folder" as const, folder: f })),
            { kind: "back" as const },
        ];
        const idx = await selectFromList(
            `${BOLD}${CYAN}IQ Plaza${RESET}  ${DIM}${folders.length} folders${RESET}`,
            items,
            (item, selected) => {
                const marker = selected ? `${CYAN}>${RESET}` : " ";
                if (item.kind === "back") return `${marker} ${DIM}Back${RESET}`;
                return `${marker} ${WHITE}${item.folder.name}/${RESET}  ${folderTag(item.folder)}`;
            },
        );
        if (idx === null) return;
        const chosen = items[idx];
        if (chosen.kind === "back") return;
        await browsePlazaFolder(service, chosen.folder);
    }
};

// ---- download ----

const downloadFlow = async (
    service: FileShareService,
    txHash: string,
    knownFilename?: string,
) => {
    const fallbackName = knownFilename && knownFilename.length > 0
        ? knownFilename
        : `${txHash.slice(0, 16)}.bin`;
    const defaultDest = path.join(downloadsDir(), fallbackName);
    const dest = (await prompt(`save to [${defaultDest}]: `)).trim();
    const finalDest = dest ? expandPath(dest) : defaultDest;

    console.log();
    let result: { bytesWritten: number; filename: string };
    try {
        result = await service.downloadFromInventory(txHash, finalDest, (pct) =>
            renderProgressBar(pct, "download"),
        );
        renderProgressBar(100, "download");
    } catch (err) {
        finishProgressBar();
        logError("download failed", err);
        await prompt("Press Enter to continue...");
        return;
    }
    finishProgressBar();

    console.log();
    logSuccess(`saved ${formatBytes(result.bytesWritten)} → ${finalDest}`);
    if (result.filename && path.basename(finalDest) !== result.filename) {
        console.log(`  ${DIM}on-chain filename: ${result.filename}${RESET}`);
    }
    await prompt("Press Enter to continue...");
};

const downloadByHashFlow = async (service: FileShareService) => {
    console.clear();
    console.log(`${BOLD}${CYAN}Download by tx hash${RESET}`);
    console.log();
    const txHash = (await prompt("tx hash (0x...): ")).trim();
    if (!txHash) {
        logInfo("cancelled");
        return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        logError("that doesn't look like an Ethereum tx hash");
        await prompt("Press Enter to continue...");
        return;
    }

    logStep("fetching metadata...");
    let knownFilename = "";
    try {
        const { metadata } = await reader.readCodeIn(txHash);
        if (typeof metadata?.handle === "string") knownFilename = metadata.handle;
        console.log(`  ${DIM}handle:${RESET} ${knownFilename || "(unknown)"}`);
        console.log();
    } catch (err) {
        logError("couldn't read metadata", err instanceof Error ? err.message : String(err));
        const cont = (await prompt("continue anyway? (y/N): ")).trim().toLowerCase();
        if (cont !== "y") return;
    }

    await downloadFlow(service, txHash, knownFilename);
};

// ---- my files ----

const myFilesFlow = async (service: FileShareService) => {
    console.clear();
    console.log(`${BOLD}${CYAN}My files${RESET}  ${DIM}(inventory tx list)${RESET}`);
    console.log();

    const address = service.myAddress;
    logStep("fetching inventory...");
    let entries: Awaited<ReturnType<typeof reader.fetchInventoryTransactions>>;
    try {
        entries = await reader.fetchInventoryTransactions(address, { limit: 100 });
    } catch (err) {
        logError("failed to fetch inventory", err);
        await prompt("Press Enter to continue...");
        return;
    }
    if (entries.length === 0) {
        logInfo("no inventory items yet.");
        await prompt("Press Enter to continue...");
        return;
    }

    while (true) {
        const idx = await selectFromList(
            `${BOLD}${CYAN}My files${RESET}  ${DIM}${entries.length} txs${RESET}`,
            entries,
            (entry, selected) => {
                const marker = selected ? `${CYAN}>${RESET}` : " ";
                const name = entry.handle || "(no handle)";
                return `${marker} ${WHITE}${truncate(name, 40)}${RESET}  ${DIM}${shortenSig(entry.txHash)}${RESET}`;
            },
        );
        if (idx === null) return;
        const chosen = entries[idx];
        await downloadFlow(service, chosen.txHash, chosen.handle || "");
    }
};

// ---- main ----

const FILE_SHARE_LOGO = `${BOLD}${MAGENTA}
  ███████╗██╗██╗     ███████╗
  ██╔════╝██║██║     ██╔════╝
  █████╗  ██║██║     █████╗
  ██╔══╝  ██║██║     ██╔══╝
  ██║     ██║███████╗███████╗
  ╚═╝     ╚═╝╚══════╝╚══════╝${RESET}`;

const MENU_ITEMS: { label: string; action: string | null }[] = [
    { label: "Upload to My Inventory", action: "upload-inventory" },
    { label: "Upload to IQ Plaza", action: "upload-plaza" },
    { label: "Browse IQ Plaza", action: "browse-plaza" },
    { label: "My files", action: "my-files" },
    { label: "Download by tx hash", action: "download" },
    { label: "Back", action: null },
];

export const runFileShareMenu = async () => {
    const service = new FileShareService();

    while (true) {
        const header = `${FILE_SHARE_LOGO}\n  ${DIM}wallet: ${GREEN}${shortenSig(service.myAddress)}${RESET}`;
        const idx = await selectFromList(header, MENU_ITEMS, (item, selected) => {
            if (item.action === null) {
                return selected
                    ? `  ${DIM}${CYAN}> ${WHITE}Back${RESET}`
                    : `  ${DIM}  Back${RESET}`;
            }
            return selected
                ? `  ${BOLD}${CYAN}> ${WHITE}${item.label}${RESET}`
                : `  ${DIM}  ${item.label}${RESET}`;
        });
        if (idx === null || MENU_ITEMS[idx].action === null) break;
        try {
            switch (MENU_ITEMS[idx].action) {
                case "upload-inventory":
                    await uploadToInventoryFlow(service);
                    break;
                case "upload-plaza":
                    await uploadToPlazaFlow(service);
                    break;
                case "browse-plaza":
                    await browsePlazaFlow(service);
                    break;
                case "my-files":
                    await myFilesFlow(service);
                    break;
                case "download":
                    await downloadByHashFlow(service);
                    break;
            }
        } catch (err) {
            logError("file share action failed", err);
            await prompt("Press Enter to continue...");
        }
    }
};
