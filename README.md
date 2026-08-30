# CROWN//FALL

A small, original, offline strategy game for a phone-sized screen. Grains stack on a 15×15 field, overloaded cells
break and spill into their neighbours, and every cell an avalanche touches changes hands. Hold three of the five crown
sites at the end of your turn and the match is yours.

Open `index.html` in a browser. There is nothing to install, nothing to build, and nothing to connect to.

- `index.html` — the whole interface: inline CSS, one inline ES module, no assets.
- `game.mjs` — the pure rules engine, imported by both the page and the tests.
- `verify.mjs` — the test suite. Run it with `node verify.mjs`.

## Rules, exactly

**Board.** A finite 15×15 square grid, 225 cells, columns A–O left to right and rows 1–15 top to bottom. Every cell
holds an integer number of grains and is owned by *you*, the *rival*, or *nobody* (neutral).

**Opening position.** Both sides get one distinct base cell holding 2 grains. Five crown sites are seeded per board.
The rest of the board is given a seeded scatter of 0–3 grains. The entire opening position — bases, crowns and grain
field — is generated as one half of the board and then mirrored through 180°, so both sides face exactly the same
shape. Crown sites start empty and are never a base.

**Placement.** On your turn you place exactly one grain on either:

- a cell you already own, or
- a *neutral* cell that is orthogonally adjacent to a cell you own (your frontier).

You may never place directly on an enemy-owned cell. Placing on neutral ground claims it for you.

**Toppling.** Any cell holding 4 or more grains topples: it loses 4 grains and sends 1 grain to each of its four
orthogonal neighbours. Grains sent past the edge of the board dissipate and are gone — the board is finite and lossy,
which is what makes every avalanche terminate.

**Capture.** Every in-bounds cell that receives a grain becomes owned by the side that triggered the avalanche,
including cells it takes from the enemy. Receivers can be pushed to 4 grains and topple in turn, so the entire cascade
— however far it spreads — belongs to the mover. This is the only way territory and crowns are taken from an opponent.

**Resolution order.** The avalanche resolves in waves. Each wave takes every cell currently at 4 or more grains, in
ascending cell index, and topples them in that order; the next wave then re-scans. This repeats until no cell is
unstable. The result is deterministic, and the suite also checks that reversing the within-wave order reaches the same
final board for these single-mover placements. No broader claim about order independence is made or relied on.

**Safety bound.** Stabilisation is capped at `MAX_TOPPLES` (225 × 4 × 16 = 14 400 topples for one placement). The
bound exists to make a runaway impossible rather than merely unlikely: if it were ever reached the engine throws
`AvalancheBoundError` instead of returning an unstable board. Across the 120-seed sweep it is never approached.

**Crown victory and the opening gate.** Victory is checked *only at the end of a turn*, and only for the side that
just moved. Holding **3 or more** of the 5 crown sites wins — but no crown victory registers until **both** sides have
taken at least **3 turns**. So the earliest possible win is the player's 4th turn (after the rival's 3rd), and an
explosive opening cascade cannot end the game outright. Reaching three crowns before the gate opens is not a win; you
have to still be holding them once it does.

**No moves, and the cap.** After each turn, if the side to move has no legal placement it passes and the turn returns
to the other side. If *neither* side can move, or once **160 turns** have been taken in total, the match ends and is
ranked: **crowns**, then **territory** (cells owned), then **grains** (grains on owned cells), then **draw**.

**READ.** Each human side has **3 READ charges** per match. READ previews the exact footprint of a candidate legal
placement — which cells topple, in how many waves, which enemy cells are captured, how many grains fall off the board,
and the crown tally afterwards — without changing the game state. The preview function itself is pure and free; only
the READ button spends a charge. The heuristic rival uses the same pure simulation and spends nothing, which is stated
plainly rather than hidden.

## The rival is a heuristic, not a deep AI

Solo play is against a **deterministic one-ply heuristic**. For each legal placement it runs a single simulation and
scores the result: crowns gained, crowns denied, enemy cells captured, territory swing, grains wasted off-board, and a
bonus for leaving a cell on 3 grains next to enemy ground or an unheld crown (a cell that will topple next turn). Best
score wins; ties break toward crowns and then the lowest cell index.

Its limits, honestly:

- **No search.** It never models your reply. A capture it takes gladly may hand you a bigger avalanche in return.
- **No defence except by accident.** It does not notice that a cell of yours is one grain from sweeping through it.
- **Two moves of intent at most**, via the "loaded cell" bonus. There is no plan beyond that.
- **Fully deterministic.** The same position always produces the same move, so a line that beats it keeps beating it.
- **Moving first is worth something.** In the 120-seed heuristic-vs-heuristic sweep the first mover won 82 matches and
  the second 38. Every board is provably symmetric under 180° rotation, so that gap is pure tempo: the tempo advantage
  is real and is not compensated for.

## Controls and accessibility

| Input | Action |
| --- | --- |
| Tap / click a cell | Place a grain there |
| Arrow keys | Move the board focus |
| Home / End | Jump to the start / end of the row |
| Page Up / Page Down | Jump to the top / bottom of the column |
| Enter or Space | Place a grain on the focused cell |
| R | Spend a READ charge on the focused cell |
| N | New match on the seed in the box |
| P | Pause (freezes placements, the rival, and animations) |
| H | Open or close the rules panel |
| Escape | Close the rules panel |

- The board is a real `role="grid"` of 225 `<button>` elements with a roving tab stop — pointer, touch and keyboard all
  drive the same controls. Focus is always visible (a 3px outline, never removed).
- In hotseat the status line names the side to move (`Player ▲ (violet)` / `Rival ▼ (amber)`) rather than relying on
  the players remembering whose turn it is.
- Ownership is never signalled by colour alone: each side has its own tint **and** hatch direction **and** pip shape
  **and** glyph (▲ / ▼), and every cell's accessible name spells it out — for example
  `H9: crown site, you, 2 grains, playable`.
- A plain-text mirror of the whole board is available under "Board as text", where each cell reads as
  `<owner><grains><crown flag>`, e.g. `P2#` is yours, two grains, a crown site.
- Status, move results and READ forecasts are announced through polite live regions.
- `prefers-reduced-motion: reduce` removes all animation; the game plays identically without it.
- Layout is fluid from 320px up, uses relative units, and pinch zoom is not blocked.
- Avalanche animation is folded into at most `MAX_ANIMATED_WAVES` (16) visual waves regardless of cascade size, and
  reuses the existing cell elements rather than spawning particles, so the render queue stays bounded.
- Sound is deliberately omitted.

## Seeds, sharing and history

**Seed format.** Uppercase `A–Z`, `0–9` and `-`, up to 24 characters. Anything you type is normalised: lowercase is
raised, runs of other characters become a single `-`, leading and trailing dashes are trimmed, and an empty seed
becomes `CROWN-FALL`. Normalisation is idempotent, so a seed shown in the box always reproduces the board it made.
The seed alone determines the bases, the crown layout and the grain field.

**Result string.** `CF1~SEED~W~playerCrowns~rivalCrowns~turns`, where `W` is `P`, `R` or `D` (player, rival, draw) —
for example `CF1~CROWN-FALL-015~P~3~0~7`. It is generated and parsed entirely in the page; there is no server, no
link shortener and no upload. "Export board PNG" draws the final board to a canvas at export time and downloads it
locally.

**Replay.** "Replay this seed" restarts the same seed from its opening position. Separately, a seed plus its move log
is a complete record of a match: `replayMoves(seed, moves)` re-applies every placement through the same rules and
reproduces the final board exactly. The page runs that check when a match ends and says so if it ever disagrees.

**History.** The last 20 results are kept in this browser's `localStorage` under `crownfall.history.v1`. Each entry
holds only seed, mode, winner, ranking reason, turn count, crown tally and result string — the writer whitelists those
fields, so nothing else can be stored even by accident. "Clear history" removes them.

## Offline and privacy properties

- No network calls of any kind: no `fetch`, no `XMLHttpRequest`, no WebSocket, no service worker, no beacons.
- No external assets: no CDN, no web fonts, no images, no audio. The crowns are inline SVG paths and everything else is
  CSS. Open the file from disk and it works.
- No analytics, telemetry, tracking, cookies, fingerprinting or ads.
- No personal data is collected, requested or stored. The only persisted data is the anonymous result list above.
- No copyrighted characters, logos, quotes or music; the visual identity, wording and rules text are original.

## Tests

```
node verify.mjs
```

Every named test prints with an exact pass total. The suite covers legality and the frontier rule, toppling, boundary
dissipation, mover capture through a whole cascade, stabilisation termination / determinism / wave-order perturbation /
the safety bound, seeded crown layout and grain field with their fairness mirror, exact READ preview and its
non-mutation, READ charges, turn alternation and immutability, the crown win with its opening gate, passing, the turn
cap and the ranking ladder, seed normalisation, the share string round-trip, replay, the bounded animation queue, the
bounded anonymous history, the text mirror, the heuristic's determinism and legality, and a **120-seed self-play
sweep** in which every match must terminate inside the cap and end on a board with no unstable, negative or
invalid-owner cells. Every match in that sweep is currently decided on crowns, the longest running 122 of the 160
permitted turns. The suite also extracts the page's module and executes it against a small DOM stub, so the
interface itself — first render, a placement, the rival's reply, READ, export, replay — is exercised rather than
assumed.

Also useful:

```
node --check game.mjs
```
