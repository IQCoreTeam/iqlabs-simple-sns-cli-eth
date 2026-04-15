# IQChan port — deferred plan

This is the 4chan-style imageboard that exists in the Solana CLI
(`../simplechatcli/src/apps/iqchan/*` + `src/ui/menus/iqchan.ts`). Not shipped
in v1 of `simplechatcli-eth`. Write it up later.

## What iqchan does, conceptually

- `dbRootId = "iqchan"` is a second global db root (separate from
  `ethchat-root` and `iq-plaza`).
- Each **board** (e.g. "biz", "tech") is a `table` under the db root, keyed by
  the board id. It doubles as the **feed** for that board — posts are appended
  straight here.
- Each **thread** is its own `table`, seed `${boardId}/thread/${uuid}`.
  - OP row: `{sub, com, name, time, img?, threadPda, threadSeed}`
  - Reply rows: same shape minus `sub` and `threadSeed`.
- **Edits / deletes**: `writer.manageRowData(signer, root, threadSeed, json, targetTx)`.
  SDK already merges these when reading via `readTableRows` (TODO: confirm —
  if not, do it in iqchan-service).
- **Feed**: unlike Solana CLI (which had a dedicated feed PDA), on Ethereum
  the **board table itself IS the feed**. Every `postReply` and `createThread`
  writes to the thread table *and* also writes a lightweight entry to the
  board table — unless the thread has already been bumped past `BUMP_LIMIT`
  replies. Reading the board gives you recent thread activity for free.

## File layout when added

```
src/
├── apps/iqchan/
│   ├── constants.ts            # DB_ROOT_ID="iqchan", BOARD_COLUMNS, BUMP_LIMIT, REPLY_PREVIEW_COUNT
│   └── iqchan-service.ts       # listBoards, listBoardThreads, readThread, createThread, postReply, editPost, deletePost
└── ui/menus/iqchan.ts          # board picker → thread view → reply/edit/delete
```

Add `"IQChan": runIqchanMenu` back into `src/ui/menus/main.ts`.

## Service API (sketch)

```ts
class IqchanService {
    ensureDbRoot(): Promise<void>
    listBoards(): Promise<{ id: string; title: string }[]>
    // Board row = flattened post with threadSeed included when it's an OP.
    listBoardActivity(boardId: string, limit?: number): Promise<Row[]>
    readThread(threadSeed: string): Promise<{ op: Post | null; replies: Post[] }>
    createThread(boardId: string, data: { sub: string; com: string; name: string; img?: string }): Promise<{ threadSeed: string; txHash: string }>
    postReply(threadSeed: string, boardId: string, data: { com: string; name: string; img?: string }, replyCount: number): Promise<string>
    editPost(threadSeed: string, targetTx: string, newCom: string): Promise<string>
    deletePost(threadSeed: string, targetTx: string): Promise<string>
}
```

Rules to keep (from the top-level plan):
- `createThread` must do **one** `writer.createTable` + **one** `writer.writeRow`
  to the thread table + **one** `writer.writeRow` to the board table. Three
  writes total, no more.
- `postReply` writes one row to the thread table; if `replyCount < BUMP_LIMIT`
  it also writes one row to the board table. Skip the second write past the
  bump limit — that's how we prevent old threads from hogging the board feed.
- `editPost` / `deletePost` = `writer.manageRowData` with the target tx hash.
  No custom merging logic if the SDK already exposes merged rows. If not, the
  merge belongs in `iqchan-service.readThread`, not in UI code.

## Open questions

1. **Merge-at-read vs. merge-in-SDK**: does the current SDK already merge
   `manageRowData` instructions into the base rows returned by `readTableRows`?
   If yes, the UI just renders rows as-is. If not, `readThread` needs to walk
   a separate instruction table and apply edits / deletes itself. Check before
   starting.
2. **Feed simplification trade-off**: writing each post to both the thread
   table and the board table doubles write cost. Worth it for us because the
   CLI displays the board as a timeline. If gas becomes an issue, we can
   fall back to a dedicated feed table with a single parallel write per post.
3. **Image hosting**: the Solana CLI carries an `img` field. It was a URL in
   practice (uploaded via file-share, pasted back in). Keep that pattern —
   don't embed base64 blobs in imageboard rows.

## Live updates

Same story as chat/file-share in v1: no websocket subscriptions, user hits
`/refresh` to repoll the board/thread. When we wire up a notify server, swap
the manual refresh out.

## Critical files to reference when porting

- `../simplechatcli/src/apps/iqchan/iqchan-service.ts` — Solana original;
  note that its feed PDA logic and `createExtTableInstruction` path are NOT
  portable. Keep the row shapes, drop the PDA machinery.
- `../simplechatcli/src/apps/iqchan/constants.ts` — reusable constants (BUMP_LIMIT, REPLY_PREVIEW_COUNT, thread seed format).
- `../simplechatcli/src/ui/menus/iqchan.ts` — UI shape for board / thread /
  reply flows. Port the UX 1:1; swap only the service calls.
