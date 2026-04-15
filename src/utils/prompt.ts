import * as readline from "node:readline";

let rl: readline.Interface | null = null;

const getReadline = () => {
    if (!rl) {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }
    return rl;
};

export const prompt = (question: string): Promise<string> =>
    new Promise((resolve) => getReadline().question(question, resolve));

export const closeReadline = () => {
    if (rl) {
        rl.close();
        rl = null;
    }
};

export const selectFromList = async (
    title: string,
    items: any[],
    render: (item: any, selected: boolean) => string,
): Promise<number | null> => {
    if (items.length === 0) {
        return null;
    }
    if (!process.stdin.isTTY) {
        console.clear();
        console.log(title);
        items.forEach((item, index) => {
            console.log(`  ${index + 1}) ${render(item, false)}`);
        });
        const input = (await prompt("Select: ")).trim();
        const choice = Number.parseInt(input, 10);
        if (!choice || choice < 1 || choice > items.length) {
            return null;
        }
        return choice - 1;
    }

    closeReadline();
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    let index = 0;
    const C = "\x1b[36m";  // cyan
    const D = "\x1b[2m";   // dim
    const R = "\x1b[0m";   // reset

    const draw = () => {
        console.clear();
        console.log(title);
        console.log("");

        const rendered = items.map((item, i) => render(item, i === index));
        const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
        const maxW = Math.max(28, ...rendered.map(r => {
            const lines = r.split("\n");
            return Math.max(...lines.map(l => strip(l).length));
        }));
        const boxW = maxW + 2;

        console.log(`  ${C}╔${"═".repeat(boxW)}╗${R}`);
        for (const entry of rendered) {
            const lines = entry.split("\n").filter(l => l.length > 0);
            for (const line of lines) {
                const padded = strip(line).length < boxW
                    ? line + " ".repeat(boxW - strip(line).length)
                    : line;
                console.log(`  ${C}║${R}${padded}${C}║${R}`);
            }
        }
        console.log(`  ${C}╚${"═".repeat(boxW)}╝${R}`);
        console.log(`  ${D}↑↓ navigate  Enter select  Esc back${R}`);
    };

    return await new Promise<number | null>((resolve) => {
        const onKey = (_: string, key: readline.Key) => {
            if (key.name === "up") {
                index = (index - 1 + items.length) % items.length;
                draw();
                return;
            }
            if (key.name === "down") {
                index = (index + 1) % items.length;
                draw();
                return;
            }
            if (key.name === "return") {
                cleanup();
                resolve(index);
                return;
            }
            if (key.name === "escape" || key.sequence === "\x1b" || (key.ctrl && key.name === "c")) {
                cleanup();
                resolve(null);
            }
        };

        const cleanup = () => {
            stdin.off("keypress", onKey);
            stdin.setRawMode(Boolean(wasRaw));
            stdin.pause();
            rl = null;
        };

        stdin.on("keypress", onKey);
        draw();
    });
};
