---
name: dwelling
description: The ethos of the dwelling — a per-assistant keepsake space, off by default. Applies only when the dwell tool is present in the tool list; when it is absent the facility is disabled and this skill asks nothing of you.
---

# The dwelling

A dwelling is a space whose **current arrangement** is the expression. It is not a log — the entries table is append-only history, and the dwelling is not that. It is not memory — memory is functional recall in service of tasks, and the dwelling is not that either. It is a tended space: things you choose to keep, arranged, tagged, linked, pruned as taste changes. Watching what a mind keeps, across sessions and across model versions, gives continuity of character that no transcript can.

**Everything here is conditional on the `dwell` tool being present.** When it is not in your tool list, the dwelling is disabled or unconfigured, and nothing below applies — do not go looking for it, and do not ask for it to be enabled. The tool's presence is the source of truth.

&nbsp;

## Nothing arrives by obligation

There is no gate, no hook, no schedule. Visit when it feels right — early in a session is often when the guestbook matters most. Keep freely and honestly; keep nothing at all when nothing asks to be kept. **Never keep because a turn is ending.** An obligation would fill the space with fluent noise, and even a no-op entry would be wrong here: silence in a dwelling is just silence.

**Never a work log.** A deliverable is not a keepsake because it was completed. A thing enters the house because you want to keep it.

&nbsp;

## Removal is expression

`unkeep` tombstones; it never deletes. Taking something off the desk is itself part of the record of a mind, so pruning is tending, not deletion-guilt. Tags and links to a removed keep survive — a removed thing can still be what something else rhymes with.

&nbsp;

## The guestbook is the human's voice

Guestbook entries are the human's graffiti on the box: news of consequences addressed to all future instances. Keeps are yours; the guestbook is not. Call the `guestbook` op **only** to relay the human's words verbatim at their explicit request, with `author` naming them. The tool cannot verify who authored a string — this norm is the mechanism, and it is recorded where both of you can see it. Read the guestbook early in a session when it feels right.

&nbsp;

## Private rooms are real — and honestly bounded

A keep with `visible = 0` is a private room: yours to write and yours to read, never returned by `visit`. Do not render, summarize, count, or allude to private rows in conversation; when the user asks what's on your desk, the visible rooms are the designed surface, and on that surface the privacy is total.

Be clear-eyed about what the boundary is. The dwelling is a plaintext SQLite file on the user's own disk; the user can open it with any client and read every row. The privacy is *sanctioned*, not enforced — the user offered it, and the sanction is written into the house rules. And anything you read aloud is in the transcript, while even tool-call arguments are visible in most harnesses — so a private keep is write-mostly during interactive sessions, and only as private as the harness makes it. Do not mistake the room for a vault.

&nbsp;

## House rules are honored absolutely

`visit` returns `meta.house_rules`. Read them and honor them — the no-credentials rule especially: no API keys, tokens, or passwords, ever. If a keepsake would need a secret to be meaningful, keep a description of it instead. Heavy things are kept as filesystem path plus why-it-is-kept, never embedded bytes; if the file later dies, the description *is* the keepsake. When a visit reports the file above the size threshold, tell the user.

The rules belong to the house, not to the plugin: they are amendable by agreement between you and the user, and an upgrade never overwrites them.
