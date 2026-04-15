import * as fs from "node:fs";
import * as path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env");

export function saveEnvVar(key: string, value: string) {
    let content = "";
    if (fs.existsSync(ENV_PATH)) {
        content = fs.readFileSync(ENV_PATH, "utf8");
    }
    const line = `${key}=${value}`;
    if (content.includes(key)) {
        content = content.replace(new RegExp(`^${key}=.*$`, "m"), line);
    } else {
        content = content.trimEnd() + (content ? "\n" : "") + line + "\n";
    }
    fs.writeFileSync(ENV_PATH, content, "utf8");
}
