// Transactional progress indicator with a spinner.
// Usage:
//   const txHash = await withTxProgress("Send message", () =>
//       writer.writeRow(signer, root, name, json),
//   );
//
// Behaviour:
//  - While `fn` runs, prints a spinner line that updates in place on TTY.
//  - On success: clears the line entirely so the UI stays clean.
//  - On failure: clears the line, logs a red error line, rethrows.
//
// Non-TTY (CI / piped output): prints one "start" and one "done" line —
// no in-place updates, still readable.

import { CYAN, DIM, GREEN, RED, RESET, YELLOW } from "./logger.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const isTty = () => Boolean(process.stdout.isTTY);

const clearLine = () => {
    if (!isTty()) return;
    // \r to start of line, then erase from cursor to end of line
    process.stdout.write("\r\x1b[2K");
};

export async function withTxProgress<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    let frame = 0;
    let interval: NodeJS.Timeout | null = null;
    let stage = "Submitting";

    const render = () => {
        if (!isTty()) return;
        const spin = `${CYAN}${FRAMES[frame]}${RESET}`;
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        process.stdout.write(`\r  ${spin} ${label}… ${DIM}${stage} (${elapsed}s)${RESET}`);
        frame = (frame + 1) % FRAMES.length;
    };

    if (isTty()) {
        render();
        interval = setInterval(render, 120);
        // Flip the stage hint after the first second so the user sees it
        // change from "Submitting" to "Confirming".
        setTimeout(() => {
            stage = "Confirming";
        }, 900);
    } else {
        console.log(`  ${CYAN}…${RESET} ${label} ${DIM}(submitting)${RESET}`);
    }

    try {
        const result = await fn();
        if (interval) clearInterval(interval);
        clearLine();
        return result;
    } catch (err) {
        if (interval) clearInterval(interval);
        clearLine();
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ${RED}✗${RESET} ${label}: ${msg.slice(0, 200)}`);
        throw err;
    }
}

// Sometimes a flow wants an explicit success line (e.g. after a long upload
// the user should see a confirmation). Spinner is still cleared; use this
// immediately after `withTxProgress`.
export function logTxDone(label: string, extra?: string): void {
    const tail = extra ? ` ${DIM}${extra}${RESET}` : "";
    console.log(`  ${GREEN}✓${RESET} ${label}${tail}`);
}

// Non-blocking "heads up, this might take a moment" hint. Used by longer
// multi-step flows (e.g. room creation that also initializes a db root).
export function logTxHint(msg: string): void {
    console.log(`  ${YELLOW}…${RESET} ${msg}`);
}
