import { CYAN, DIM, GREEN, RESET } from "../../utils/logger.js";

const BAR_WIDTH = 30;
let lastNonTtyBucket = -1;

// Renders a single-line in-place progress bar via \r when stdout is a TTY.
// On non-TTY (CI, piped) falls back to one log per 10% bucket.
export const renderProgressBar = (percent: number, label: string): void => {
    const pct = Math.max(0, Math.min(100, Math.floor(percent)));

    if (!process.stdout.isTTY) {
        const bucket = Math.floor(pct / 10);
        if (bucket !== lastNonTtyBucket) {
            lastNonTtyBucket = bucket;
            console.log(`[${label}] ${pct}%`);
        }
        return;
    }

    const filled = Math.round((pct / 100) * BAR_WIDTH);
    const bar = `${GREEN}${"█".repeat(filled)}${DIM}${"░".repeat(BAR_WIDTH - filled)}${RESET}`;
    process.stdout.write(`\r  ${CYAN}${label}${RESET} [${bar}] ${pct}%   `);
};

export const finishProgressBar = (): void => {
    lastNonTtyBucket = -1;
    if (process.stdout.isTTY) {
        process.stdout.write("\n");
    }
};
