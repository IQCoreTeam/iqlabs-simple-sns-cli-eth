import { randomUUID } from "node:crypto";

export const makeMessageId = (sliceLength?: number): string => {
    const id = randomUUID();
    return typeof sliceLength === "number" ? id.slice(0, sliceLength) : id;
};
