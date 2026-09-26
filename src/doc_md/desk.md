# The desk

A desk is a local web panel — one page, one port, no build step — that an assistant can put
things onto while a session runs, and that its owner can arrange, dismiss, and answer back
from. This document is the mechanism and its conventions. It is not any particular desk.

&nbsp;

## The split that matters

**The mechanism is shared; a desk's contents are not.** Everything in
`src/scripts/desk/` is the same for every desk on every machine: the server, the card
module, the shell, the panel, two icons. Everything a desk actually *contains* — its cards,
its name, its outstanding questions, its board, its vendored libraries, the geometry it last
reported — lives in a desk directory somewhere else entirely, and nothing in this repository
knows what is in it.

That boundary is why the desk directory is an argument rather than a default. Two desks on
one machine are normal. A desk that guessed where it lived would be a desk that could
quietly answer for the wrong one.

```text
src/scripts/desk/                 the mechanism — checked in, identical everywhere
├── panel.mjs                     the server: node:http, node:sqlite, node:fs, nothing else
├── deskcards.mjs                 the card deck: list, render, remove, assemble
├── deskcards.d.mts               hand-written types, so the tests see the contract
├── deskguard.mjs                 the request guard: host, origin, content type
├── deskinbox.mjs                 the inbox: pull requests, tracker tickets, intents, permalinks, questions
├── deskinbox.d.mts               its hand-written types
├── desk-shell.html               structure only, with three card placeholders
├── panel.html                    the second surface, still monolithic
├── icon-john.svg  icon-claude.svg
└── *.example.json  *.example.jsonl   the shapes of a desk's state, never a desk's data

<a desk directory>                the contents — one per desk, not in this repository
├── cards/                        one directory per card
│   └── sankey/
│       ├── card.json             { "ord": 30 }
│       ├── card.html             one <section data-card="sankey"> …
│       ├── card.css              rules this card owns, and nothing else
│       └── card.js               a DESK.inits.push(…) builder
├── desk-config.json              the desk's name, put-away list, repo, ticket labels, PR and ticket intents
├── questions.json                the inbox: what is waiting on the desk's owner
├── inbox.jsonl                   append-only record of what the owner sent back
├── audit.jsonl                   append-only record of PR and ticket intents and opened links
├── geometry.json                 the last frame the page measured of itself
├── board.md                      whatever the desk wants to show as text
├── importmap.json                bare specifiers this desk resolves
└── vendor/node_modules/          libraries this desk serves from its own origin
```

&nbsp;

## Running it

```text
node src/scripts/desk/panel.mjs <desk directory>
```

The desk directory can also come from `SELF_EXPRESSION_DESK`; with neither, the server prints a
usage line and exits rather than adopting the working directory — a desk is deliberately not a
default location, because `gone` deletes card directories beneath it.
`SELF_EXPRESSION_DESK_PORT` moves it off 7373, which is what a second desk needs.
`SELF_EXPRESSION_DESK_REPO` names the GitHub repo whose pull requests and issues the inbox lists, and
overrides `desk-config.json`'s `repo`; `SELF_EXPRESSION_DESK_GH` names the `gh` binary when it
is not on the path.
`SELF_EXPRESSION_AFFECT_LOG` points at the affect log the history charts read; with no log
present the server says so once and the rest of the desk works unchanged, because one
desk's database must never be a requirement of the mechanism.

`/desk` is the card-assembled surface. Everything else is `panel.html`.

&nbsp;

## What a card is

One card is one directory. Its name is its identity — a readable name beats a uuid for the
same reason the whole scheme is worth having: the thing a human has to reason about should
say what it is.

| File | Required | What it is |
|---|---|---|
| `card.json` | yes | `{ "ord": 30 }`, optionally `"fixed": true` |
| `card.html` | no | markup, concatenated into the page's `<main>` |
| `card.css` | no | rules this card owns, concatenated into the page's `<style>` |
| `card.js` | no | a builder, concatenated into the page's script |

`ord` sets display order, lowest first; ties break by directory name, so a deck with no ords
at all still has a stable order rather than the filesystem's. `fixed` marks a card that
refuses deletion. A card contributing no assets at all is legal and renders as nothing —
absence of a file is normal and silent, which is what lets a markup-only card exist without
ceremony.

**A directory with no `card.json` is skipped, not guessed at.** A half-written card should
stay off the desk until it is finished, rather than appear in an unpredictable position.
That also makes "start a card" a safe operation at any hour: make the directory, write the
markup, and it arrives when its manifest does.

&nbsp;

## Answer cards

Cards above are hand-placed. An answer card is written by the MCP server's `render_card`
tool instead — a session draws an answer onto the desk rather than describing it, and the
id and the ord are derived, not chosen. Answers live in their own band, ords `[1000,
2000)`, so they always read below every hand-placed card and never renumber one
(issue #93).

Answers age out. The desk keeps the newest `desk.answer_cards` (default 8) non-pinned
answers and removes the rest, oldest first, the moment another one is written. Pinning a
card (`"fixed": true` in its `card.json`, the same field a hand-placed card can carry) takes
it out of the count entirely — it stops being an answer and becomes something the desk's
owner decided to keep, and that decision is the owner's, never the model's. `render_card`
and `list_card_types` are registered whenever a card kit loaded beside the running server,
independent of `desk.path`; until `desk.path` is set, `render_card` refuses to write and
answers by naming the key that turns it on rather than guessing at a directory. This is the
mechanism; the taste — when a card is the honest answer and when three numbers are a
sentence — lives apart, in `src/doc_md/reference/answer-cards.md`.

**Do not run the kit's `node newcard.mjs rebuild --deck <desk>/cards` on a live desk.** Rebuild
regenerates every `card.json` from its recorded `spec`, which means writing each one from
scratch — and `answer` and `fixed` are not part of what it writes. It strips both from every card
on the deck: every answer stops being an answer, so age-out can no longer see it, and every
pinned card silently stops being pinned. It is a tool for a deck of hand-placed cards that needs
a type improvement applied, not for a desk `render_card` writes to.

The desk this writes onto is the one this file describes, started the same way:
`self-expression-desk <desk directory>` once installed, or `node
src/scripts/desk/panel.mjs <desk directory>` from a checkout.

&nbsp;

## Why a card is a directory

Cards used to be markup inside one large HTML document. Adding one was an edit; removing one
was surgery — find the section, find its styles, find its builder, cut each out by index.
That worked until it did not, twice:

- an attribute in an unexpected order hid a card from its own deletion, so the cut removed
  the wrong span and left the card on the desk;
- the JavaScript for three deleted cards outlived them and threw on every single load.

Both failures are the same failure: **a removal that can half-succeed**. Three separate
edits to one file, each of which can miss, with no structure making them succeed or fail
together.

A directory ends it. Removal is one `rmSync` of one path: markup, styles and script leave
together or not at all, and there is nothing left to drift. The page is *assembled from what
is present* rather than *edited toward what should be*, so there is no second source of
truth to go stale — which is also why the shell discovers its cards with
`querySelectorAll('main [data-card]')` instead of carrying a roster.

&nbsp;

## What card JavaScript must do

Card scripts are concatenated into a page that re-runs them, so two rules are not optional:

1. **Safe to re-run.** A builder runs on first paint and again after every hot-swap. Anything
   that accumulates — a document-level listener, an interval — must remove or clear its
   previous self before installing a new one. `clearInterval(window.__something)` before
   `setInterval`, `removeEventListener` before `addEventListener`.
2. **Return early when its own element is absent.** A card can be put away, or deleted, or
   simply not finished. `var el = document.querySelector('[data-card="x"]'); if (!el)
   return;` is the whole discipline. A missing card is not a fault, and a builder that
   treats it as one takes the rest of the page down with it.

The shell exposes `DESK.inits`, an array of builders. A card pushes onto it and is called on
first paint and after every swap:

```js
DESK.inits.push(function () {
  var el = document.querySelector('[data-card="sankey"]');
  if (!el) return;                    // put away, deleted, or not finished
  el.replaceChildren(draw(el.clientWidth));
});
```

&nbsp;

## Two dismissal tiers

Closing a card means two different things and collapsing them means one of the two is always
wrong.

- **Put away** is reversible. The card's id joins `hidden` in `desk-config.json`, the section
  gets `class="away"`, and the header tray offers *bring back*. Nothing on disk changes.
- **Forget** deletes. The card's directory is removed outright.

There are **no tombstones and no shadow copies**. A forgotten card is not hidden, not
archived, and not marked deleted — it is gone, and the tray stops mentioning it because
there is nothing left to mention. The `gone` list in `desk-config.json` is deliberately not a
record of what was deleted: it holds only ids whose deletion *failed*, so it is a list of
problems rather than a growing pile of ghosts, and it is empty on a healthy desk.

The choice is kept server-side rather than in the browser, because the desk renews itself
whenever the page changes and a purely local dismissal would spring back within seconds.

&nbsp;

## The inbox protocol

`questions.json` is the assistant's side of the conversation: things it needs from the desk's
owner. It is a file rather than an endpoint on purpose — a restarted server must not lose
what is outstanding, and a session can raise a question by writing the file, with no running
handle required. A row with an `answer` stops being offered; the row stays.

Rows come in four kinds, and each gets the treatment it earns:

| Kind | Marked by | How it reads |
|---|---|---|
| Question | neither field | inline, bulleted; one to three `options` become buttons |
| Task | `"kind": "task"` | its own row, with three action buttons |
| Stuck | `"stuck": true` | its own row, in red, sorted above everything |
| Ticket | `"kind": "ticket"` | a pill in its own rail below everything; not counted as owed |

**Questions** are inline because most of them need a word, and a page of full-width rows for
one-word questions reads as a wall. Options become buttons only up to three: past that they
stop being a glance, and a question with that many answers belongs in conversation.

**Tasks** carry a disposition rather than an answer — *do this next*, *dispatch to agents*,
*remove from the inbox*. The first two write `queued` and stay visible, because they are
instructions the assistant must still act on. The third deletes the row from the file: a
deletion is a deletion, and a dropped task does not acquire a tombstone field.

**Stuck rows** are for something already decided that then quietly did not happen. They sort
first and take a full red row, because that is precisely the item an inline bullet is good at
hiding.

Every row can also be retired without being answered. A question whose premise went stale is
not a question anyone owes an answer to, and leaving it there teaches its reader to stop
reading the list.

**Answers and actions are one-way.** They are written to `questions.json` and printed to the
server's log, and that is the whole delivery mechanism: the assistant reads its own console.
Nothing is pushed back into a session, because nothing here can guarantee a session is
listening, and a channel that claimed delivery it could not make would be worse than no
channel. An answer is also idempotent — a second click on an answered question is a stray
double-click, not a change of mind.

**Tickets** are the assistant's suggestions of what to pick up next — `"#134 restore the
inbox"` — and carry the same three verbs as tasks. They sit in their own rail below every row
that is actually waiting, and they are left out of the "waiting on you" count, which would
otherwise be a lie told by the assistant's own to-do list. The leading `#N` becomes a
permalink to issue N in the desk's repo, or to the row's own `url` when it carries a valid
issue or PR permalink; with no repo and no `url` it stays plain text, because a link to a
guessed tracker is worse than none. The rail is a fixed-size shortlist rather than a queue
that drains: dropping a ticket promotes the next one off `questions.json`'s `reserve` bench,
and when the bench is empty the rail simply shrinks.

Hand-written tickets are only half of the rail. The other half is filled from the tracker —
see *Tickets from the tracker* below — and follows the hand-written rows in the same rail.

Every write to `questions.json` is atomic (written beside the file and renamed over it), and a
read that lands mid-edit serves the last good copy, so the inbox never blinks empty because
someone was saving the file.

&nbsp;

## Pull requests in the inbox

When the desk names a repo, the inbox also lists that repo's **open pull requests**, in two
lists: *out by me* and *out by someone else*. The split is by the GitHub account that opened
each PR — an agent pushing under the owner's token is the owner, as far as GitHub and the
desk are concerned. Whether an agent wrote it is a separate fact: a PR labelled `Created by
AI` is tinted, but never moved between lists. Each row's number is a permalink, and its tag
says *land requested*, *to agents*, *draft*, or the review state.

The repo comes from `SELF_EXPRESSION_DESK_REPO`, else `desk-config.json`'s `repo`, else
nowhere. There is deliberately no fallback — not the working directory's remote, not this
plugin's own repository — for the same reason there is no default desk: a desk that guessed
would list someone else's pull requests and point every ticket at the wrong tracker, and
nothing on the page would say so.

The list comes from `gh pr list`, run by the server with no shell and fixed arguments, and
cached for a minute; the page asks once a minute too. What is cached is GitHub's answer, not
the split, so hiding a PR or recording an intent shows on the next request. **The inbox never
goes blank without saying why**: with no repo configured, no `gh` installed, `gh` not signed
in, or `gh` failing, the lists stay empty and a line above them says which. When `gh` cannot
say who the owner is, every PR is listed as someone else's, and the line says that too.

Each PR row has three buttons, and **none of them touches GitHub**:

| Button | Records |
|---|---|
| land | `prIntent[N] = "land"` — the owner wants it merged. Merging into a protected branch is a thing to be asked about every time, so the desk writes the wish down and the merge still needs a person to say yes out loud. |
| agents | `prIntent[N] = "agent"` — hand it to agents. |
| drop | adds N to `prHidden` and forgets its intent. The PR stays open on GitHub; it is only gone from this desk. |

Each one is also appended to `audit.jsonl` (`"action": "pr.intent"`, `"note": "recorded only;
no GitHub write"`), along with refusals. The desk is reachable over loopback and never passes
through a session's permission prompts, so its side effects are logged to be reviewable
afterwards by someone who was not there; `/audit` serves the newest rows.

&nbsp;

## Tickets from the tracker

When the desk names a repo, the ticket rail also lists that repo's **open issues that are
waiting on the owner**, so a fresh desk's inbox shows issues without anyone writing them into
`questions.json` by hand. An open issue qualifies when either is true:

- it is **assigned to the owner** (the GitHub account `gh` is signed in as), or
- it carries one of the desk's **ticket labels**, matched without regard to case. These are
  `desk-config.json`'s `ticketLabels`, or by default `Question`, `Needs answers`, `needs
  owner` and `Needs research`. `"ticketLabels": []` is a real setting, meaning "only issues
  assigned to me".

The list comes from `gh issue list`, cached for a minute and coalesced exactly as the PR list
is, and served at `/tickets`. What is cached is GitHub's answer, not the selection, so a drop,
an intent, or a new hand-written row shows on the next request.

**Each issue appears once.** A tracker issue that a hand-written ticket row already points at
(by its `url`, or by its leading `#N` in the desk's repo) is left out of the tracker half. The
hand-written row wins, because someone put it there on purpose. Drop that row and the
tracker's copy comes back.

**The rail is a shortlist here too.** The tracker half shows the first `ticketLimit`
qualifying issues (default 8, at most 50), newest first as `gh` orders them. The rest wait on
the bench, and dropping a shown ticket promotes the next one.

A tracker ticket has the hand-written ticket's three verbs. Because there is no
`questions.json` row to write them on, they are recorded in the desk config under the issue's
permalink, and **none of them touches GitHub**:

| Button | Records |
|---|---|
| do this next | `ticketIntent[url] = "next"`, tagged *up next*. |
| agents | `ticketIntent[url] = "agents"`, tagged *to agents*. |
| drop | adds the permalink to `ticketHidden` and forgets its intent. The issue stays open on GitHub; it is only gone from this desk. |

Intents are keyed by permalink rather than number because a number alone would collide
across repos, and a desk's repo can change. There is no *land* for a ticket: an issue has
nothing to merge. Each intent is appended to `audit.jsonl` as `ticket.intent`, and refusals as
`ticket.intent.refused`. `/ticket` accepts only an exact issue permalink and one of the three
verbs.

When there is no repo, no `gh`, or `gh` is failing, the tracker half stays empty and a line
says which. If the pull-request line already says the same thing, the ticket line stays quiet
rather than repeating it. When `gh` cannot say who the owner is, labelled issues are still
listed, and the line says that assigned ones cannot be.

&nbsp;

## Opening permalinks

Clicking a permalink does not follow it. Followed normally, a link would navigate the desk
itself away whenever it is shown in an editor's embedded browser, so the page posts the URL to
`/open` and the server hands it to the operating system's opener, which starts the browser the
owner actually uses. `/open` accepts only an exact GitHub issue or pull-request permalink and
refuses everything else, and both outcomes are audited.

&nbsp;

## The hot-swap

When anything the page is made of changes on disk, the server bumps an `edition` counter
(debounced, because Windows fires several events per save). Open pages poll `/edition` and,
on a change, **replace `<main>` in place** rather than reloading.

A full reload throws away the paint, the fonts, the scroll position and the custom element
registry and rebuilds all of it — that rebuild *is* the white flash. Fetching the same URL
and swapping one subtree keeps every one of those, restores the scroll offset, and re-runs
`DESK.inits` against the new subtree.

Only markup can be swapped this way. The page's own scripts and styles have already executed,
so if those changed there is nothing for a swap to do. **That case is detected rather than
assumed**: the swap builds a signature from the concatenated text of every inline `<script>`
and `<style>` in the fetched document, and falls back to a real reload when it differs from
the signature it was built with. Adding a card's CSS changes the signature, so the page
reloads; editing a card's markup does not, so the page swaps.

The renewal loop is deliberately the first script in the document and deliberately not a
module: it is the page's own repair mechanism, so it must survive an error in everything
below it. If the rest of the page throws, editing the file still fixes the open tab.

&nbsp;

## A desk's state, and its shapes

None of these files ship with the mechanism. Each has an `.example` beside `panel.mjs`
carrying its shape and nothing else.

- **`desk-config.json`** — `name` (the desk's title, editable by clicking it), `hidden` (put
  away, offered back), `gone` (deletions that failed), `repo` (the `owner/name` whose pull
  requests and issues the inbox lists), `prIntent` (PR number → `land` or `agent`), `prHidden`
  (PR numbers dropped from this desk), `ticketLabels` (labels that put an open issue in the
  ticket rail), `ticketLimit` (how many tracker tickets show at once), `ticketIntent` (issue
  permalink → `next` or `agents`), `ticketHidden` (issue permalinks dropped from this desk).
  Merged rather than replaced on every write, because these are written by different controls
  and one posting alone must not erase the others.
- **`questions.json`** — `{ "questions": [ … ], "reserve": [ … ] }`; each row has `id`,
  `text`, `asked`, and optionally `options`, `kind` (`task` or `ticket`), `stuck`, `url`,
  `answer`, `answeredAt`, `dismissed`, `queued`, `queuedAt`. `reserve` is the bench of tickets
  that refill the rail.
- **`inbox.jsonl`** — append-only, one JSON object per line: `n`, `at`, and whatever the page
  sent, which is usually `kind`, `surface` and `value`.
- **`audit.jsonl`** — append-only, one JSON object per line: `at`, `action` (`pr.intent`,
  `pr.intent.refused`, `ticket.intent`, `ticket.intent.refused`, `open.allowed`,
  `open.refused`), and what it acted on.
- **`geometry.json`** — overwritten, never appended: only the current frame is interesting.

&nbsp;

## Deliberately not here

- **No desk contents.** No cards, no board, no art, no configuration, no questions. Those
  belong to one desk and would be noise in every other.
- **No vendored `node_modules`.** A desk that needs a library puts it under
  `vendor/node_modules/` in its own directory and names it in its own `importmap.json`; the
  server serves that tree at `/nm/` so `script-src 'self'` can stay as it is, and knows no
  package by name. The prototype shell carried two `<script src="/jssm/…">` tags, which are
  exactly the shape of the failure this mechanism exists to end — markup in the shell
  outliving the thing it was added for, and throwing on load. A dependency belongs to the
  card that needs it, and leaves with it.
- **No dependencies at all.** `panel.mjs` imports from `node:` and from `deskcards.mjs`,
  `deskguard.mjs` and `deskinbox.mjs` beside it, and that is the complete list. It is meant to
  be started, used, killed and forgotten without installing anything or leaving anything
  behind. The GitHub CLI is used when present and a repo is named, and never required: without
  it the inbox says so and every other part of the desk works unchanged.
