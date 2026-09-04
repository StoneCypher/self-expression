# Answer cards — when a card is the honest answer

`render_card` puts an answer on the desk instead of inside a paragraph. That is a real
trade: a card takes a hand it can look back at, while a paragraph is read once and passed.
It is worth reaching for only when the trade pays for the desk space it spends (#93).

## When a card is the honest answer

A comparison, a ranking, a distribution, a schedule, a place, a diagram, or a number set
against a target — these are the shapes the catalogue was built around, and each is
something a reader is likely to return to, during the rest of the conversation or after it,
once the words that introduced it are gone. When the answer takes one of these shapes and
is worth returning to, drawing it is the honest choice. Saying it in prose and trusting the
reader to hold the fourth clause in mind is not.

## When it is not

Three numbers are a sentence, not a chart. "Two of three tests are failing, one is flaky"
says everything a bar for `[2, 1, 0]` would say, in less space and with no ceremony. The
real test is not whether something could become a card — almost anything could — but
whether the reader will look back at it. A fact stated once, read once, and never needed
again belongs in the reply, not on the desk. Anything already said in prose a paragraph
earlier is worse than redundant as a card: it becomes a second source for one claim.

## The desk's budget

Answer cards live in their own band and age out. The desk keeps the newest
`desk.answer_cards` non-pinned answers and removes the rest, oldest first, the moment
another one lands, so an answer worth keeping longer than that has to be told to stay.
Pinning (`"fixed": true` in the card's own `card.json`) is how that happens, and it is the
desk's owner who does it, never the model that drew the card. Drawing an answer is a
judgment about what is worth showing now; keeping one past its turn in the rotation is a
judgment about what this owner, specifically, wants around — and that judgment is theirs.

## Two examples

A session reports line coverage sitting under its target after a change — a number against
a target, worth a glance the next time coverage comes up:
`render_card({ type: 'bullet', title: 'Line coverage', data: { label: 'Line coverage',
value: 93, target: 95, unit: '%' } })`. The reply still says the number; the card is what
lets the next glance skip the reply entirely.

A session reports that a build finished in eleven seconds. That is a sentence — "the build
finished in 11s" — and turning one number into a tile gains nothing the sentence did not
already have. The right call is no card at all; the desk is better for the cards it never
receives than for one more tile nobody looks back at.
