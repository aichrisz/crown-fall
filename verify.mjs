import assert from 'node:assert/strict';

let engine = {};
let createGame;
try {
  engine = await import('./game.mjs');
  ({ createGame } = engine);
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('a seeded game starts on a 15×15 board with distinct owned bases', () => {
  assert.equal(typeof createGame, 'function', 'createGame must exist');
  const game = createGame('CROWN-FALL-001', { mode: 'hotseat' });
  assert.equal(game.size, 15);
  assert.equal(game.cells.length, 225);
  const playerBases = game.cells.filter(cell => cell.base === 'player' && cell.owner === 'player');
  const rivalBases = game.cells.filter(cell => cell.base === 'rival' && cell.owner === 'rival');
  assert.equal(playerBases.length, 1);
  assert.equal(rivalBases.length, 1);
  assert.notEqual(playerBases[0].index, rivalBases[0].index);
});

test('legal placements are own cells plus the neutral orthogonal frontier, never enemy cells', () => {
  const { legalMoves, indexOf, coordsOf } = engine;
  assert.equal(typeof legalMoves, 'function', 'legalMoves must exist');
  const game = createGame('CROWN-FALL-001', { mode: 'hotseat' });
  const moves = legalMoves(game, 'player');
  const base = game.bases.playerIndex;
  const { x, y } = coordsOf(base);
  const expected = [base];
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < game.size && ny >= 0 && ny < game.size) expected.push(indexOf(nx, ny));
  }
  assert.deepEqual(moves, expected.slice().sort((a, b) => a - b));
  assert.ok(!moves.includes(game.bases.rivalIndex), 'enemy base is never a legal target');
  const rivalMoves = legalMoves(game, 'rival');
  assert.ok(!rivalMoves.includes(game.bases.playerIndex), 'enemy base is never a legal target');
  assert.ok(rivalMoves.includes(game.bases.rivalIndex));
});

test('placement adds one grain, claims the selected neutral cell, and never mutates input', () => {
  const { resolvePlacement, legalMoves, coordsOf } = engine;
  assert.equal(typeof resolvePlacement, 'function', 'resolvePlacement must exist');
  const game = createGame('CROWN-FALL-001', { mode: 'hotseat' });
  const base = game.bases.playerIndex;
  const before = JSON.stringify(game.cells);

  const own = resolvePlacement(game, 'player', base);
  assert.equal(own.cells[base].grains, game.cells[base].grains + 1);
  assert.equal(own.cells[base].owner, 'player');
  assert.equal(JSON.stringify(game.cells), before, 'input state must be untouched');

  const frontier = legalMoves(game, 'player').find(i => game.cells[i].owner === 'neutral');
  const claim = resolvePlacement(game, 'player', frontier);
  assert.equal(claim.cells[frontier].owner, 'player', 'claimed neutral becomes mover-owned');
  assert.equal(claim.cells[frontier].grains, game.cells[frontier].grains + 1, 'exactly one grain is added');
  assert.ok(coordsOf(frontier).x >= 0);
  assert.equal(JSON.stringify(game.cells), before, 'input state must be untouched');
});

/** Build a bare board for engine unit tests: every cell neutral and empty. */
function blankState(overrides = {}) {
  const game = createGame('TEST-BOARD', { mode: 'hotseat' });
  const cells = game.cells.map(cell => ({ ...cell, grains: 0, owner: 'neutral', base: null, crown: false }));
  return { ...game, cells, ...overrides };
}

test('a cell reaching four topples: minus four, one grain to each orthogonal neighbour', () => {
  const { indexOf, neighborsOf } = engine;
  const state = blankState();
  const centre = indexOf(7, 7);
  state.cells[centre].owner = 'player';
  state.cells[centre].grains = 3;

  const result = engine.resolvePlacement(state, 'player', centre);
  assert.equal(result.cells[centre].grains, 0, 'toppled cell loses exactly four grains');
  const neighbours = neighborsOf(centre);
  assert.equal(neighbours.length, 4);
  for (const n of neighbours) {
    assert.equal(result.cells[n].grains, 1, `neighbour ${n} receives one grain`);
  }
  const total = result.cells.reduce((sum, cell) => sum + cell.grains, 0);
  assert.equal(total, 4, 'interior topple conserves all four grains');
});

test('grains sent off the finite board dissipate at edges and corners', () => {
  const { indexOf } = engine;
  const corner = blankState();
  corner.cells[indexOf(0, 0)].owner = 'player';
  corner.cells[indexOf(0, 0)].grains = 3;
  const cornerResult = engine.resolvePlacement(corner, 'player', indexOf(0, 0));
  assert.equal(cornerResult.dissipated, 2, 'a corner topple loses two grains off-board');
  assert.equal(cornerResult.cells.reduce((s, c) => s + c.grains, 0), 2);
  assert.equal(cornerResult.cells[indexOf(1, 0)].grains, 1);
  assert.equal(cornerResult.cells[indexOf(0, 1)].grains, 1);

  const edge = blankState();
  edge.cells[indexOf(7, 0)].owner = 'player';
  edge.cells[indexOf(7, 0)].grains = 3;
  const edgeResult = engine.resolvePlacement(edge, 'player', indexOf(7, 0));
  assert.equal(edgeResult.dissipated, 1, 'an edge topple loses one grain off-board');
  assert.equal(edgeResult.cells.reduce((s, c) => s + c.grains, 0), 3);
});

test('every in-bounds receiver is captured by the triggering mover, cascade included', () => {
  const { indexOf } = engine;
  const state = blankState();
  const centre = indexOf(7, 7);
  const north = indexOf(7, 6);
  const northNorth = indexOf(7, 5);
  state.cells[centre].owner = 'player';
  state.cells[centre].grains = 3;
  state.cells[north].owner = 'rival';
  state.cells[north].grains = 3;
  state.cells[northNorth].owner = 'rival';
  state.cells[northNorth].grains = 0;

  const result = engine.resolvePlacement(state, 'player', centre);
  assert.equal(result.cells[north].owner, 'player', 'enemy receiver is captured');
  assert.equal(result.cells[northNorth].owner, 'player', 'cascade receiver is captured too');
  assert.equal(result.cells[centre].owner, 'player');
  assert.ok(result.toppleCount >= 2, 'the enemy cell was pushed over the threshold and toppled');
  assert.ok(result.captured.includes(north), 'capture footprint lists the enemy cell');
  assert.ok(result.captured.includes(northNorth));
  assert.ok(!result.cells.some(c => c.owner === 'rival'), 'the whole cascade belongs to the mover');
});

test('stabilization terminates deterministically, is order-independent, and enforces its bound', () => {
  const { indexOf, TOPPLE_THRESHOLD, MAX_TOPPLES } = engine;
  assert.ok(Number.isFinite(MAX_TOPPLES) && MAX_TOPPLES > 0, 'an explicit safety bound must exist');

  // 48 dense pseudo-random boards, each stabilised twice and once in reverse order.
  let rng = 123456789;
  const nextRandom = () => {
    rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
    return rng / 4294967296;
  };
  for (let trial = 0; trial < 48; trial += 1) {
    const state = blankState();
    for (const cell of state.cells) {
      cell.grains = Math.floor(nextRandom() * 4);
      cell.owner = nextRandom() < 0.5 ? 'player' : 'rival';
    }
    const target = Math.floor(nextRandom() * state.cells.length);
    state.cells[target].owner = 'player';
    const a = engine.resolvePlacement(state, 'player', target);
    const b = engine.resolvePlacement(state, 'player', target);
    const reversed = engine.resolvePlacement(state, 'player', target, { order: 'desc' });
    assert.ok(a.stable && !a.bounded, `trial ${trial} must stabilise inside the bound`);
    assert.ok(a.cells.every(c => c.grains < TOPPLE_THRESHOLD && c.grains >= 0), 'no unstable or negative cells remain');
    assert.ok(a.cells.every(c => c.owner === 'player' || c.owner === 'rival' || c.owner === 'neutral'), 'owners stay valid');
    assert.deepEqual(b.cells, a.cells, `trial ${trial} repeat must be identical`);
    assert.deepEqual(
      reversed.cells.map(c => [c.grains, c.owner]),
      a.cells.map(c => [c.grains, c.owner]),
      `trial ${trial} reverse wave order must reach the same final state`,
    );
    assert.ok(a.toppleCount <= MAX_TOPPLES);
  }

  // A deliberately tiny bound must be refused loudly, never silently returned.
  const big = blankState();
  for (const cell of big.cells) cell.grains = 3;
  big.cells[indexOf(7, 7)].owner = 'player';
  assert.throws(
    () => engine.resolvePlacement(big, 'player', indexOf(7, 7), { maxTopples: 3 }),
    /avalanche safety bound/i,
    'exceeding the safety bound must throw instead of returning an unstable board',
  );
});

test('five crowns are seeded deterministically, inset, clear of bases, and rotationally fair', () => {
  const { coordsOf, indexOf, SIZE } = engine;
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const layouts = new Set();
  for (let n = 0; n < 40; n += 1) {
    const seed = `SWEEP-${n}`;
    const game = createGame(seed, { mode: 'solo' });
    const crowns = game.cells.filter(c => c.crown).map(c => c.index);
    assert.equal(crowns.length, 5, `${seed} must have exactly five crowns`);
    assert.deepEqual(crowns, game.crowns, 'state.crowns mirrors the flagged cells');
    const pb = coordsOf(game.bases.playerIndex);
    const rb = coordsOf(game.bases.rivalIndex);
    for (const index of crowns) {
      const c = coordsOf(index);
      assert.ok(c.x >= 2 && c.x <= SIZE - 3 && c.y >= 2 && c.y <= SIZE - 3, `${seed} crown ${index} must be inset from edges`);
      assert.ok(cheb(c, pb) >= 3 && cheb(c, rb) >= 3, `${seed} crown ${index} must stay clear of both bases`);
      assert.ok(!game.cells[index].base, 'a crown is never a base');
      // 180° rotational symmetry is the fairness guarantee for the layout.
      const mirrored = indexOf(SIZE - 1 - c.x, SIZE - 1 - c.y);
      assert.ok(crowns.includes(mirrored), `${seed} crown ${index} must have a mirrored partner`);
    }
    for (const a of crowns) {
      for (const b of crowns) {
        if (a >= b) continue;
        assert.ok(cheb(coordsOf(a), coordsOf(b)) >= 2, `${seed} crowns ${a}/${b} must not touch`);
      }
    }
    assert.deepEqual(createGame(seed, { mode: 'solo' }).crowns, crowns, 'same seed, same crowns');
    layouts.add(crowns.join(','));
  }
  assert.ok(layouts.size >= 3, 'different seeds must produce different crown layouts');
});

test('previewMove reports the exact avalanche footprint without mutating state', () => {
  const { previewMove, indexOf } = engine;
  assert.equal(typeof previewMove, 'function', 'previewMove must exist');

  const state = blankState();
  const centre = indexOf(7, 7);
  const north = indexOf(7, 6);
  state.cells[centre].owner = 'player';
  state.cells[centre].grains = 3;
  state.cells[north].owner = 'rival';
  state.cells[north].grains = 3;
  state.cells[north].crown = true;
  state.crowns = [north];
  const snapshot = JSON.stringify(state);

  const preview = previewMove(state, 'player', centre);
  assert.equal(preview.legal, true);
  assert.deepEqual(preview.toppled, [north, centre].sort((a, b) => a - b), 'exact toppled set');
  assert.deepEqual(preview.captured, [north], 'exact capture set');
  assert.equal(preview.claimedNeutral, false);
  assert.equal(preview.dissipated, 0);
  assert.equal(preview.crowns.player, 1, 'crown tally after the move');
  assert.equal(preview.crowns.rival, 0);
  assert.ok(Array.isArray(preview.waves) && preview.waves.length >= 2, 'waves are reported for animation');
  assert.deepEqual(preview.cells, engine.resolvePlacement(state, 'player', centre).cells);
  assert.equal(JSON.stringify(state), snapshot, 'pure simulation must not mutate the state');

  const repeat = previewMove(state, 'player', centre);
  assert.deepEqual(repeat.cells, preview.cells, 'preview is deterministic');

  const game = createGame('CROWN-FALL-001', { mode: 'solo' });
  const illegal = previewMove(game, 'player', game.bases.rivalIndex);
  assert.equal(illegal.legal, false, 'illegal previews report rather than throw');
  assert.equal(typeof illegal.reason, 'string');
  assert.equal(JSON.stringify(game.cells), JSON.stringify(createGame('CROWN-FALL-001', { mode: 'solo' }).cells));
});

test('READ exposes the complete bounded board footprint without truncating cells', () => {
  const { previewFootprint, CELL_COUNT } = engine;
  assert.equal(typeof previewFootprint, 'function', 'previewFootprint must exist');
  const captured = Array.from({ length: 90 }, (_, index) => index);
  const toppled = Array.from({ length: 90 }, (_, index) => index + 70);
  const footprint = previewFootprint({ legal: true, index: 200, captured, toppled });
  assert.deepEqual(footprint, [...new Set([...captured, ...toppled, 200])].sort((a, b) => a - b));
  assert.ok(footprint.length > 64, 'an exact READ must not silently stop at 64 cells');
  assert.ok(footprint.length <= CELL_COUNT, 'the finite board inherently bounds the footprint');
  assert.deepEqual(previewFootprint({ legal: false, index: 1 }), []);
});

test('applyMove alternates movers immutably, records history, and rejects illegal placements', () => {
  const { applyMove } = engine;
  assert.equal(typeof applyMove, 'function', 'applyMove must exist');
  const game = createGame('CROWN-FALL-001', { mode: 'hotseat' });
  assert.equal(game.current, 'player', 'the player opens');
  assert.equal(game.status, 'playing');
  assert.deepEqual(game.turnsTaken, { player: 0, rival: 0 });
  assert.deepEqual(game.moves, []);
  const snapshot = JSON.stringify(game);

  const afterOne = applyMove(game, game.bases.playerIndex);
  assert.equal(afterOne.current, 'rival');
  assert.deepEqual(afterOne.turnsTaken, { player: 1, rival: 0 });
  assert.equal(afterOne.turnCount, 1);
  assert.deepEqual(afterOne.moves, [{ owner: 'player', index: game.bases.playerIndex }]);
  assert.equal(JSON.stringify(game), snapshot, 'applyMove never mutates the previous state');

  const afterTwo = applyMove(afterOne, afterOne.bases.rivalIndex);
  assert.equal(afterTwo.current, 'player');
  assert.deepEqual(afterTwo.turnsTaken, { player: 1, rival: 1 });
  assert.equal(afterTwo.moves.length, 2);

  assert.throws(() => applyMove(afterTwo, afterTwo.bases.rivalIndex), /illegal/i, 'enemy ground is refused');
  assert.throws(() => applyMove(afterTwo, -1), /illegal/i);
});

test('three crowns win only at end of turn once both sides have taken three turns', () => {
  const { applyMove, indexOf } = engine;
  const build = turnsTaken => {
    const state = blankState({ turnsTaken: { ...turnsTaken }, current: 'player' });
    const crownA = indexOf(4, 4);
    const crownB = indexOf(6, 6);
    const crownC = indexOf(8, 8);
    state.crowns = [crownA, crownB, crownC];
    for (const index of state.crowns) state.cells[index].crown = true;
    state.cells[crownA].owner = 'player';
    state.cells[crownB].owner = 'player';
    state.cells[indexOf(8, 7)].owner = 'player'; // frontier neighbour of crownC
    state.turnCount = turnsTaken.player + turnsTaken.rival;
    return { state, crownC };
  };

  const early = build({ player: 0, rival: 0 });
  const earlyResult = applyMove(early.state, early.crownC);
  assert.equal(earlyResult.crowns.length, 3);
  assert.equal(engine.crownTally(earlyResult.cells, earlyResult.crowns).player, 3);
  assert.equal(earlyResult.status, 'playing', 'the opening gate suppresses an instant win');
  assert.equal(earlyResult.winner, null);

  const oneShort = build({ player: 2, rival: 2 });
  const oneShortResult = applyMove(oneShort.state, oneShort.crownC);
  assert.deepEqual(oneShortResult.turnsTaken, { player: 3, rival: 2 });
  assert.equal(oneShortResult.status, 'playing', 'the rival has not yet taken three turns');

  const gated = build({ player: 2, rival: 3 });
  const gatedResult = applyMove(gated.state, gated.crownC);
  assert.deepEqual(gatedResult.turnsTaken, { player: 3, rival: 3 });
  assert.equal(gatedResult.status, 'won');
  assert.equal(gatedResult.winner, 'player');
  assert.equal(gatedResult.reason, 'crowns');

  const twoCrowns = build({ player: 5, rival: 5 });
  twoCrowns.state.cells[indexOf(6, 6)].owner = 'neutral';
  const twoResult = applyMove(twoCrowns.state, twoCrowns.crownC);
  assert.equal(engine.crownTally(twoResult.cells, twoResult.crowns).player, 2);
  assert.equal(twoResult.status, 'playing', 'two crowns is not a win');
});

test('a stuck side passes, the 160-turn cap ends the match, and ranks resolve crowns→territory→grains→draw', () => {
  const { applyMove, indexOf, TURN_CAP, checkEnd, rankOutcome, scoreboard } = engine;
  assert.equal(TURN_CAP, 160, 'the cap is a bounded 160 turns');
  assert.equal(typeof checkEnd, 'function', 'checkEnd must exist');

  // The rival owns nothing, so it cannot move and must pass back to the player.
  const wiped = blankState({ current: 'player', turnsTaken: { player: 4, rival: 4 }, turnCount: 8 });
  wiped.cells[indexOf(2, 2)].owner = 'player';
  const passed = applyMove(wiped, indexOf(2, 2));
  assert.equal(passed.status, 'playing');
  assert.equal(passed.current, 'player', 'the stuck rival passes the turn straight back');
  assert.equal(passed.passedBy, 'rival');

  // Hitting the cap ends the match and ranks it.
  const atCap = blankState({ current: 'player', turnsTaken: { player: 80, rival: 79 }, turnCount: TURN_CAP - 1 });
  atCap.cells[indexOf(2, 2)].owner = 'player';
  atCap.cells[indexOf(2, 3)].owner = 'player';
  atCap.cells[indexOf(3, 3)].owner = 'rival';
  atCap.cells[indexOf(3, 3)].grains = 1;
  const capped = applyMove(atCap, indexOf(2, 2));
  assert.equal(capped.turnCount, TURN_CAP);
  assert.equal(capped.status, 'ended');
  assert.equal(capped.reason, 'territory', 'the cap is settled by the ranking ladder');
  assert.equal(capped.winner, 'player');

  // Neither side can move on a fully neutral board.
  const stalled = checkEnd(blankState({ current: 'player', turnCount: 12 }));
  assert.equal(stalled.status, 'ended');
  assert.equal(stalled.reason, 'draw');
  assert.equal(stalled.winner, null);

  const ladder = (setup) => {
    const state = blankState();
    state.crowns = [indexOf(4, 4), indexOf(6, 6), indexOf(8, 8), indexOf(5, 9), indexOf(9, 5)];
    for (const c of state.crowns) state.cells[c].crown = true;
    setup(state);
    return rankOutcome(state);
  };
  const byCrowns = ladder(state => {
    state.cells[state.crowns[0]].owner = 'rival';
    state.cells[indexOf(1, 1)].owner = 'player';
    state.cells[indexOf(1, 2)].owner = 'player';
    state.cells[indexOf(1, 3)].owner = 'player';
  });
  assert.deepEqual(byCrowns, { winner: 'rival', reason: 'crowns' }, 'crowns outrank territory');
  const byTerritory = ladder(state => {
    state.cells[indexOf(1, 1)].owner = 'player';
    state.cells[indexOf(1, 2)].owner = 'player';
    state.cells[indexOf(12, 12)].owner = 'rival';
    state.cells[indexOf(12, 12)].grains = 3;
  });
  assert.deepEqual(byTerritory, { winner: 'player', reason: 'territory' }, 'territory outranks grains');
  const byGrains = ladder(state => {
    state.cells[indexOf(1, 1)].owner = 'player';
    state.cells[indexOf(1, 1)].grains = 1;
    state.cells[indexOf(12, 12)].owner = 'rival';
    state.cells[indexOf(12, 12)].grains = 3;
  });
  assert.deepEqual(byGrains, { winner: 'rival', reason: 'grains' });
  const drawn = ladder(state => {
    state.cells[indexOf(1, 1)].owner = 'player';
    state.cells[indexOf(1, 1)].grains = 2;
    state.cells[indexOf(13, 13)].owner = 'rival';
    state.cells[indexOf(13, 13)].grains = 2;
  });
  assert.deepEqual(drawn, { winner: null, reason: 'draw' });

  const board = scoreboard(byGrainsState());
  assert.deepEqual(Object.keys(board).sort(), ['player', 'rival']);
  assert.deepEqual(Object.keys(board.player).sort(), ['crowns', 'grains', 'territory']);

  function byGrainsState() {
    const state = blankState();
    state.cells[indexOf(1, 1)].owner = 'player';
    state.cells[indexOf(1, 1)].grains = 2;
    return state;
  }
});

test('each human side holds three READ charges; pure simulation never spends one', () => {
  const { spendRead, previewMove, READ_CHARGES } = engine;
  assert.equal(READ_CHARGES, 3);
  const game = createGame('CROWN-FALL-001', { mode: 'solo' });
  assert.deepEqual(game.reads, { player: 3, rival: 3 });

  previewMove(game, 'player', game.bases.playerIndex);
  previewMove(game, 'rival', game.bases.rivalIndex);
  assert.deepEqual(game.reads, { player: 3, rival: 3 }, 'previewMove is free — the AI uses it too');

  const once = spendRead(game, 'player');
  assert.deepEqual(once.reads, { player: 2, rival: 3 });
  assert.deepEqual(game.reads, { player: 3, rival: 3 }, 'spendRead does not mutate the old state');
  const twice = spendRead(once, 'player');
  const thrice = spendRead(twice, 'player');
  assert.deepEqual(thrice.reads, { player: 0, rival: 3 });
  assert.throws(() => spendRead(thrice, 'player'), /no read charges/i);
  assert.deepEqual(spendRead(thrice, 'rival').reads, { player: 0, rival: 2 });
});

test('the heuristic opponent picks a legal move deterministically and grabs an offered crown', () => {
  const { chooseMove, isLegalMove, indexOf } = engine;
  assert.equal(typeof chooseMove, 'function', 'chooseMove must exist');
  const game = createGame('CROWN-FALL-014', { mode: 'solo' });
  const pick = chooseMove(game, 'player');
  assert.ok(isLegalMove(game, 'player', pick), 'the opponent never proposes an illegal move');
  assert.equal(chooseMove(game, 'player'), pick, 'same state, same choice');
  assert.equal(chooseMove(createGame('CROWN-FALL-014', { mode: 'solo' }), 'player'), pick, 'same seed, same choice');

  // Offered a free crown claim, the heuristic must take it.
  const state = blankState({ current: 'rival' });
  const crown = indexOf(6, 6);
  state.crowns = [crown, indexOf(4, 10), indexOf(10, 4)];
  for (const c of state.crowns) state.cells[c].crown = true;
  state.cells[indexOf(6, 7)].owner = 'rival'; // touches the crown
  state.cells[indexOf(1, 1)].owner = 'rival'; // dull alternative far away
  const choice = chooseMove(state, 'rival');
  assert.equal(choice, crown, 'a crown claim beats a quiet build');

  const stuck = blankState();
  assert.equal(chooseMove(stuck, 'player'), null, 'no legal move yields null');
});

test('seeds normalise predictably and results round-trip through a compact share string', () => {
  const { normalizeSeed, randomSeed, formatShare, parseShare, indexOf, applyMove } = engine;
  assert.equal(typeof normalizeSeed, 'function', 'normalizeSeed must exist');
  assert.equal(normalizeSeed('  crown fall 7 '), 'CROWN-FALL-7');
  assert.equal(normalizeSeed('a//b??c'), 'A-B-C');
  assert.equal(normalizeSeed('---x---'), 'X');
  assert.equal(normalizeSeed(''), 'CROWN-FALL');
  assert.equal(normalizeSeed('x'.repeat(60)).length, 24, 'seeds are length-capped');
  assert.equal(normalizeSeed(normalizeSeed('Odd Seed!')), normalizeSeed('Odd Seed!'), 'normalisation is idempotent');
  assert.equal(createGame('crown fall 7').seed, 'CROWN-FALL-7', 'createGame normalises its seed');
  assert.equal(randomSeed(() => 0.5), randomSeed(() => 0.5), 'seed generation is a pure function of its source');
  assert.equal(normalizeSeed(randomSeed(() => 0.5)), randomSeed(() => 0.5));

  const state = blankState({ current: 'player', turnsTaken: { player: 3, rival: 3 }, turnCount: 6 });
  state.seed = 'CROWN-FALL-015';
  state.crowns = [indexOf(4, 4), indexOf(6, 6), indexOf(8, 8), indexOf(5, 9), indexOf(9, 5)];
  for (const c of state.crowns) state.cells[c].crown = true;
  state.cells[indexOf(4, 4)].owner = 'player';
  state.cells[indexOf(6, 6)].owner = 'player';
  state.cells[indexOf(8, 7)].owner = 'player';
  const won = applyMove(state, indexOf(8, 8));
  assert.equal(won.status, 'won');

  const share = formatShare(won);
  assert.match(share, /^CF1~CROWN-FALL-015~P~3~0~7$/, 'compact, server-free share string');
  assert.deepEqual(parseShare(share), {
    version: 1,
    seed: 'CROWN-FALL-015',
    winner: 'player',
    crowns: { player: 3, rival: 0 },
    turns: 7,
  });
  assert.equal(parseShare('nonsense'), null, 'malformed share strings are rejected');
  assert.equal(parseShare(formatShare(engine.checkEnd(blankState({ turnCount: 3 })))).winner, null);
});

test('a recorded move list replays to a byte-identical state and refuses corrupted logs', () => {
  const { replayMoves, chooseMove, applyMove } = engine;
  assert.equal(typeof replayMoves, 'function', 'replayMoves must exist');
  const seed = 'CROWN-FALL-016';
  let live = createGame(seed, { mode: 'solo' });
  for (let i = 0; i < 12 && live.status === 'playing'; i += 1) {
    live = applyMove(live, chooseMove(live, live.current));
  }
  assert.ok(live.moves.length >= 10, 'the scripted match produced a real log');

  const replayed = replayMoves(seed, live.moves, { mode: 'solo' });
  assert.equal(JSON.stringify(replayed), JSON.stringify(live), 'replay reproduces the exact state');

  const prefix = replayMoves(seed, live.moves.slice(0, 4), { mode: 'solo' });
  assert.equal(prefix.moves.length, 4);
  assert.equal(prefix.turnCount, 4);

  const corrupted = live.moves.map((m, i) => (i === 3 ? { ...m, index: 0 } : m));
  assert.throws(() => replayMoves(seed, corrupted, { mode: 'solo' }), /illegal/i, 'a corrupted log is rejected');
  const wrongOwner = live.moves.map((m, i) => (i === 1 ? { ...m, owner: m.owner === 'player' ? 'rival' : 'player' } : m));
  assert.throws(() => replayMoves(seed, wrongOwner, { mode: 'solo' }), /out of turn|illegal/i);
});

test('self-play terminates inside the turn cap and reports a well-formed result', () => {
  const { playSelfMatch, TURN_CAP, replayMoves } = engine;
  assert.equal(typeof playSelfMatch, 'function', 'playSelfMatch must exist');
  const match = playSelfMatch('CROWN-FALL-017');
  assert.ok(['won', 'ended'].includes(match.state.status), 'the match reached a terminal state');
  assert.ok(match.state.turnCount <= TURN_CAP, 'never exceeds the bounded cap');
  assert.equal(match.turns, match.state.turnCount);
  assert.ok(['crowns', 'territory', 'grains', 'draw'].includes(match.reason));
  assert.ok([null, 'player', 'rival'].includes(match.winner));
  assert.equal(match.share, engine.formatShare(match.state));
  assert.equal(
    JSON.stringify(playSelfMatch('CROWN-FALL-017').state),
    JSON.stringify(match.state),
    'self-play is deterministic',
  );
  assert.equal(
    JSON.stringify(replayMoves('CROWN-FALL-017', match.state.moves, { mode: 'solo' })),
    JSON.stringify(match.state),
    'the match log replays exactly',
  );
});

test('validateState catches unstable, invalid or inconsistent boards', () => {
  const { validateState, indexOf, TOPPLE_THRESHOLD } = engine;
  assert.equal(typeof validateState, 'function', 'validateState must exist');
  assert.deepEqual(validateState(createGame('CROWN-FALL-018', { mode: 'solo' })), [], 'a fresh game is valid');

  const broken = createGame('CROWN-FALL-018', { mode: 'solo' });
  const bad = { ...broken, cells: broken.cells.map(c => ({ ...c })) };
  bad.cells[indexOf(5, 5)].grains = TOPPLE_THRESHOLD;
  bad.cells[indexOf(6, 5)].grains = -1;
  bad.cells[indexOf(7, 5)].owner = 'nobody';
  bad.crowns = bad.crowns.slice(1);
  bad.turnCount = 999;
  const problems = validateState(bad);
  assert.ok(problems.some(p => /unstable/i.test(p)), 'flags an unstable cell');
  assert.ok(problems.some(p => /negative/i.test(p)), 'flags negative grains');
  assert.ok(problems.some(p => /owner/i.test(p)), 'flags an invalid owner');
  assert.ok(problems.some(p => /crown/i.test(p)), 'flags a broken crown set');
  assert.ok(problems.some(p => /cap|turn/i.test(p)), 'flags an impossible turn count');
});

test('a 120-seed self-play sweep is deterministic, terminal within the cap, and always valid', () => {
  const { playSelfMatch, validateState, replayMoves, TURN_CAP, parseShare } = engine;
  const seeds = Array.from({ length: 120 }, (_, i) => `SWEEP-${String(i).padStart(3, '0')}`);
  const summary = { crowns: 0, territory: 0, grains: 0, draw: 0, cap: 0, player: 0, rival: 0, drawn: 0 };
  let longest = 0;
  for (const seed of seeds) {
    const match = playSelfMatch(seed);
    assert.ok(['won', 'ended'].includes(match.state.status), `${seed} must reach a terminal state`);
    assert.ok(match.turns > 0 && match.turns <= TURN_CAP, `${seed} must finish within the cap`);
    assert.deepEqual(validateState(match.state), [], `${seed} must end on a valid, stable board`);
    assert.equal(match.state.moves.length, match.turns, `${seed} log length matches turn count`);
    assert.ok(parseShare(match.share), `${seed} share string parses`);
    assert.equal(playSelfMatch(seed).share, match.share, `${seed} self-play must be reproducible`);
    assert.equal(
      JSON.stringify(replayMoves(seed, match.state.moves, { mode: 'solo' }).cells),
      JSON.stringify(match.state.cells),
      `${seed} replays to the same board`,
    );
    summary[match.reason] += 1;
    if (match.endedBy === 'cap') summary.cap += 1;
    if (match.winner === 'player') summary.player += 1;
    else if (match.winner === 'rival') summary.rival += 1;
    else summary.drawn += 1;
    longest = Math.max(longest, match.turns);
  }
  console.log(
    `    sweep: ${seeds.length} seeds · player ${summary.player} / rival ${summary.rival} / drawn ${summary.drawn}` +
    ` · by crowns ${summary.crowns}, territory ${summary.territory}, grains ${summary.grains}, draw ${summary.draw}` +
    ` · cap-ended ${summary.cap} · longest ${longest} turns`,
  );
});

test('match history stays newest-first, capped at twenty, and free of anything personal', () => {
  const { appendHistory, HISTORY_LIMIT, playSelfMatch, historyEntry } = engine;
  assert.equal(HISTORY_LIMIT, 20);
  assert.equal(typeof appendHistory, 'function', 'appendHistory must exist');
  const match = playSelfMatch('CROWN-FALL-019');
  const entry = historyEntry(match.state);
  assert.deepEqual(Object.keys(entry).sort(), ['crowns', 'mode', 'reason', 'seed', 'share', 'turns', 'winner']);
  assert.equal(entry.share, match.share);

  const first = appendHistory([], entry);
  assert.equal(first.length, 1);
  const second = appendHistory(first, { ...entry, seed: 'SECOND' });
  assert.equal(second[0].seed, 'SECOND', 'newest first');
  assert.equal(first.length, 1, 'appendHistory does not mutate the old list');

  let list = [];
  for (let i = 0; i < 30; i += 1) list = appendHistory(list, { ...entry, seed: `S-${i}` });
  assert.equal(list.length, HISTORY_LIMIT, 'history is bounded');
  assert.equal(list[0].seed, 'S-29');
  assert.equal(list[HISTORY_LIMIT - 1].seed, 'S-10', 'the oldest entries fall off');

  const dirty = appendHistory([], { ...entry, playerName: 'Ada', email: 'a@b.c', ip: '10.0.0.1' });
  assert.deepEqual(Object.keys(dirty[0]).sort(), ['crowns', 'mode', 'reason', 'seed', 'share', 'turns', 'winner']);
  assert.equal(JSON.stringify(dirty).includes('Ada'), false, 'no personal data is ever stored');
});

test('the board exposes a non-colour text mirror: labels, cell descriptions and a status line', () => {
  const { cellLabel, describeCell, boardText, statusText, indexOf } = engine;
  assert.equal(typeof cellLabel, 'function', 'cellLabel must exist');
  assert.equal(cellLabel(indexOf(0, 0)), 'A1');
  assert.equal(cellLabel(indexOf(14, 14)), 'O15');
  assert.equal(cellLabel(indexOf(4, 6)), 'E7');

  const state = blankState({ current: 'player', turnsTaken: { player: 2, rival: 1 }, turnCount: 3 });
  state.crowns = [indexOf(7, 7), indexOf(4, 4), indexOf(10, 10), indexOf(5, 9), indexOf(9, 5)];
  for (const c of state.crowns) state.cells[c].crown = true;
  state.cells[indexOf(7, 8)].owner = 'player';
  state.cells[indexOf(7, 8)].grains = 2;
  state.cells[indexOf(4, 4)].owner = 'rival';
  state.cells[indexOf(4, 4)].grains = 1;

  const mine = describeCell(state, indexOf(7, 8));
  assert.match(mine, /^H9/);
  assert.match(mine, /you/i);
  assert.match(mine, /2 grains/);
  const crownCell = describeCell(state, indexOf(7, 7));
  assert.match(crownCell, /crown/i, 'crowns are named in text, never colour alone');
  assert.match(crownCell, /neutral/i);
  assert.match(crownCell, /playable|frontier/i, 'legality is stated for the current mover');
  assert.match(describeCell(state, indexOf(4, 4)), /rival/i);
  assert.match(describeCell(state, indexOf(0, 0)), /empty|0 grains/i);
  assert.match(describeCell(state, indexOf(0, 0)), /not playable/i);

  const text = boardText(state);
  const lines = text.split('\n');
  const rowLines = lines.filter(line => /^\s*\d+ /.test(line));
  assert.equal(rowLines.length, 15, 'one text line per board row');
  assert.match(lines[0], /A/);
  assert.match(lines[0], /O/);
  assert.match(text, /P = you/i, 'a glyph legend replaces colour cues');
  assert.match(text, /#\s*=\s*crown/i);
  assert.ok(text.includes('P2#') || text.includes('P2'), 'owner and grain count are readable as text');

  const status = statusText(state);
  assert.match(status, /your turn/i);
  assert.match(status, /turn 3 of 160/i);
  assert.match(status, /crowns/i);
  assert.match(status, /read/i);
  assert.match(statusText({ ...state, status: 'won', winner: 'rival', reason: 'crowns' }), /rival/i);
  assert.match(statusText({ ...state, status: 'ended', winner: null, reason: 'draw' }), /draw/i);
});

test('a READ result is summarised as a sentence for the live region', () => {
  const { describePreview, previewMove, indexOf } = engine;
  assert.equal(typeof describePreview, 'function', 'describePreview must exist');
  const state = blankState({ current: 'player' });
  state.crowns = [indexOf(7, 7), indexOf(4, 4), indexOf(10, 10), indexOf(5, 9), indexOf(9, 5)];
  for (const c of state.crowns) state.cells[c].crown = true;
  state.cells[indexOf(7, 8)].owner = 'player';
  state.cells[indexOf(7, 8)].grains = 3;
  state.cells[indexOf(7, 7)].owner = 'rival';
  state.cells[indexOf(7, 7)].grains = 3;

  const preview = previewMove(state, 'player', indexOf(7, 8));
  const text = describePreview(state, preview);
  assert.match(text, /^READ H9/);
  assert.match(text, /topple/i);
  assert.match(text, /captur/i);
  assert.match(text, /off the board/i);
  assert.match(text, /crowns after/i);

  const quiet = previewMove(state, 'player', indexOf(7, 9));
  assert.match(describePreview(state, quiet), /no topple/i, 'a quiet move says so plainly');
  assert.match(describePreview(state, { legal: false, reason: 'Enemy ground.' }), /enemy ground/i);
});

test('the animation queue is bounded: long avalanches are folded into a fixed wave budget', () => {
  const { boundedWaves, MAX_ANIMATED_WAVES } = engine;
  assert.equal(typeof boundedWaves, 'function', 'boundedWaves must exist');
  assert.ok(MAX_ANIMATED_WAVES >= 4 && MAX_ANIMATED_WAVES <= 64, 'a small fixed budget');

  const short = [[1], [2, 3]];
  assert.deepEqual(boundedWaves(short), short, 'short avalanches pass through untouched');

  const long = Array.from({ length: MAX_ANIMATED_WAVES * 3 }, (_, i) => [i]);
  const folded = boundedWaves(long);
  assert.equal(folded.length, MAX_ANIMATED_WAVES, 'never more than the budget');
  assert.deepEqual(folded.flat().sort((a, b) => a - b), long.flat().sort((a, b) => a - b), 'no cell is dropped');
  assert.deepEqual(boundedWaves([]), []);
  assert.deepEqual(boundedWaves(long), folded, 'folding is deterministic');
});

test('the heuristic loads cells that threaten enemy ground, so real matches actually avalanche', () => {
  const { chooseMove, applyMove, createGame: build, playSelfMatch, indexOf } = engine;

  // Loading a cell to three grains beside four enemy cells beats a quiet claim.
  const state = blankState({ current: 'player' });
  state.crowns = [indexOf(7, 7), indexOf(4, 4), indexOf(10, 10), indexOf(5, 9), indexOf(9, 5)];
  for (const c of state.crowns) state.cells[c].crown = true;
  const spear = indexOf(2, 7);
  state.cells[spear].owner = 'player';
  state.cells[spear].grains = 2;
  for (const n of engine.neighborsOf(spear)) {
    state.cells[n].owner = 'rival';
    state.cells[n].grains = 1;
  }
  state.cells[indexOf(12, 12)].owner = 'player'; // quiet expansion option far away
  assert.equal(chooseMove(state, 'player'), spear, 'the heuristic sets up the capture');

  // Across real self-play, avalanches and captures must actually happen.
  let topples = 0;
  let captures = 0;
  for (let i = 0; i < 20; i += 1) {
    const seed = `AVALANCHE-${i}`;
    const match = playSelfMatch(seed);
    let walk = build(seed, { mode: 'solo' });
    for (const move of match.state.moves) {
      walk = applyMove(walk, move.index);
      topples += walk.lastMove.waves.flat().length;
      captures += walk.lastMove.captured.length;
    }
  }
  assert.ok(topples > 50, `self-play must produce avalanches (saw ${topples} topples)`);
  assert.ok(captures > 10, `self-play must produce captures (saw ${captures})`);
});

test('starting grains are scattered, stable, and perfectly mirrored for fairness', () => {
  const { indexOf, coordsOf, SIZE, TOPPLE_THRESHOLD, validateState } = engine;
  const mirror = index => {
    const c = coordsOf(index);
    return indexOf(SIZE - 1 - c.x, SIZE - 1 - c.y);
  };
  const fingerprints = new Set();
  for (let n = 0; n < 30; n += 1) {
    const seed = `GRAINS-${n}`;
    const game = createGame(seed, { mode: 'solo' });
    assert.deepEqual(validateState(game), [], `${seed} starts valid and stable`);
    const loaded = game.cells.filter(c => c.grains > 0).length;
    assert.ok(loaded >= 40, `${seed} must start with a real grain field (saw ${loaded})`);
    assert.ok(game.cells.some(c => c.grains === TOPPLE_THRESHOLD - 1), `${seed} has loaded cells ready to topple`);
    for (const cell of game.cells) {
      assert.ok(cell.grains >= 0 && cell.grains < TOPPLE_THRESHOLD, 'no cell starts unstable');
      // 180° rotational mirror: whatever one side is given, so is the other.
      assert.equal(cell.grains, game.cells[mirror(cell.index)].grains, `${seed} grain field must mirror at ${cell.index}`);
      const mirrored = game.cells[mirror(cell.index)];
      const swap = { player: 'rival', rival: 'player', neutral: 'neutral' };
      assert.equal(swap[cell.owner], mirrored.owner, `${seed} ownership must mirror at ${cell.index}`);
      assert.equal(cell.crown, mirrored.crown);
    }
    for (const crown of game.crowns) {
      assert.equal(game.cells[crown].grains, 0, 'crown sites start clean');
    }
    assert.equal(game.cells[game.bases.playerIndex].grains, game.cells[game.bases.rivalIndex].grains);
    assert.equal(
      JSON.stringify(createGame(seed, { mode: 'solo' }).cells),
      JSON.stringify(game.cells),
      'the grain field is a pure function of the seed',
    );
    fingerprints.add(game.cells.map(c => c.grains).join(''));
  }
  assert.ok(fingerprints.size >= 25, 'seeds produce distinct grain fields');
});

test('index.html is offline-only, keyboard-first, zoomable, and labels the rival honestly', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  for (const forbidden of [
    'http://', 'https://', 'fetch(', 'XMLHttpRequest', 'serviceWorker', 'sendBeacon',
    'gtag(', 'google-analytics', 'importScripts', 'ws://', 'eval(', 'new Function',
    '<script src', '<link rel="stylesheet"', '@import', '<img ', 'url(http',
  ]) {
    assert.equal(html.includes(forbidden), false, `index.html must not contain ${forbidden}`);
  }
  const imports = [...html.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(imports)], ['./game.mjs'], 'the page imports the local engine and nothing else');

  assert.match(html, /<html lang="en">/);
  assert.match(html, /<noscript>/i, 'a scriptless visitor must be told what is going on');
  assert.equal(/user-scalable\s*=\s*no|maximum-scale/.test(html), false, 'pinch zoom must stay enabled');
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label/);
  assert.match(html, /:focus-visible/, 'focus must be visible');
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /ArrowLeft/, 'full keyboard play');
  assert.match(html, /localStorage/);

  assert.match(html, /heuristic/i, 'the opponent is labelled a heuristic');
  assert.equal(/\bdeep (ai|learning|search)\b/i.test(html), false, 'no deep-AI claims');
  assert.match(html, /one move ahead|no search|does not search/i, 'the heuristic states its own shallowness');
});

/**
 * Minimal DOM stand-in so the browser module inside index.html can actually be
 * executed here. It is deliberately small: enough of the DOM surface that the
 * page's own code paths run, not a browser. Anything the page needs and the stub
 * lacks shows up as a crash, which is the point.
 */
function installDomStub() {
  const registry = new Map();
  const nodes = [];

  const makeNode = (tagName = 'div') => {
    const node = {
      tagName: tagName.toUpperCase(),
      children: [],
      dataset: {},
      attributes: {},
      handlers: new Map(),
      ownText: '',
      className: '',
      tabIndex: -1,
      disabled: false,
      hidden: false,
      value: '',
      focused: false,
      classes: new Set(),
    };
    node.classList = {
      add: (...names) => names.forEach(n => node.classes.add(n)),
      remove: (...names) => names.forEach(n => node.classes.delete(n)),
      contains: name => node.classes.has(name),
    };
    Object.defineProperty(node, 'textContent', {
      get() {
        return node.ownText + node.children.map(child => child.textContent ?? '').join('');
      },
      set(value) {
        node.children = [];
        node.ownText = String(value);
      },
    });
    Object.defineProperty(node, 'firstChild', { get: () => node.children[0] ?? null });
    Object.defineProperty(node, 'lastChild', { get: () => node.children[node.children.length - 1] ?? null });
    node.append = (...kids) => { node.children.push(...kids); kids.forEach(k => { k.parent = node; }); };
    node.remove = () => {
      if (!node.parent) return;
      node.parent.children = node.parent.children.filter(child => child !== node);
      node.parent = null;
    };
    node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
    node.getAttribute = name => node.attributes[name] ?? null;
    node.insertAdjacentHTML = (position, html) => {
      const fake = makeNode('svg');
      const match = /class="([^"]+)"/.exec(html);
      if (match) match[1].split(/\s+/).forEach(name => fake.classes.add(name));
      fake.parent = node;
      if (position === 'afterbegin') node.children.unshift(fake);
      else node.children.push(fake);
    };
    const descendants = () => node.children.flatMap(child => [child, ...(child.__descendants?.() ?? [])]);
    node.__descendants = descendants;
    node.querySelector = selector => {
      const test = selector.startsWith('.')
        ? candidate => candidate.classes?.has(selector.slice(1))
        : candidate => candidate.tagName === selector.toUpperCase();
      return descendants().find(test) ?? null;
    };
    node.addEventListener = (type, handler) => {
      if (!node.handlers.has(type)) node.handlers.set(type, []);
      node.handlers.get(type).push(handler);
    };
    node.__fire = (type, event = {}) => {
      const payload = { preventDefault() {}, target: node, ...event };
      for (const handler of node.handlers.get(type) ?? []) handler(payload);
    };
    node.focus = () => { nodes.forEach(other => { other.focused = false; }); node.focused = true; };
    node.select = () => {};
    node.click = () => node.__fire('click');
    nodes.push(node);
    return node;
  };

  const canvasFor = node => {
    node.width = 0;
    node.height = 0;
    node.getContext = () => ({
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
    });
    node.toDataURL = () => 'data:image/png;base64,stub';
    return node;
  };

  const documentStub = {
    handlers: new Map(),
    getElementById(id) {
      if (!registry.has(id)) {
        const node = makeNode(id === 'seed' || id === 'share-out' ? 'input' : 'div');
        if (id === 'seed') node.value = 'CROWN-FALL-001';
        if (id === 'mode') node.value = 'solo';
        if (id === 'help') { node.hidden = true; node.append(makeNode('h2')); }
        registry.set(id, node);
      }
      return registry.get(id);
    },
    createElement(tag) {
      const node = makeNode(tag);
      return tag === 'canvas' ? canvasFor(node) : node;
    },
    addEventListener(type, handler) {
      if (!documentStub.handlers.has(type)) documentStub.handlers.set(type, []);
      documentStub.handlers.get(type).push(handler);
    },
    __fire(type, event = {}) {
      const payload = { preventDefault() {}, target: {}, ...event };
      for (const handler of documentStub.handlers.get(type) ?? []) handler(payload);
    },
  };

  const store = new Map();
  const windowStub = {
    matchMedia: () => ({ matches: true }), // reduced motion: skip animation waits
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
  };

  const saved = {};
  const globals = {
    document: documentStub,
    window: windowStub,
    navigator: { clipboard: { writeText: async () => {} } },
    HTMLInputElement: class HTMLInputElement {},
    HTMLSelectElement: class HTMLSelectElement {},
  };
  for (const [key, value] of Object.entries(globals)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  return {
    document: documentStub,
    byId: id => documentStub.getElementById(id),
    store,
    restore() {
      for (const key of Object.keys(globals)) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

test('the page module runs: it renders, places, reads, exports and drives the solo rival', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script, 'index.html must carry exactly one module script');
  const engineUrl = new URL('./game.mjs', import.meta.url).href;
  const source = script[1].replace("'./game.mjs'", JSON.stringify(engineUrl));
  const dom = installDomStub();
  try {
    await import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);

    const board = dom.byId('board');
    const cells = board.children.flatMap(row => row.children);
    assert.equal(cells.length, 225, 'the page builds all 225 cell buttons');
    assert.ok(cells.every(cell => (cell.getAttribute('aria-label') ?? '').length > 8), 'every cell has a text label');
    assert.ok(cells.some(cell => cell.querySelector('.crown')), 'crown sites are drawn');
    assert.equal(cells.filter(cell => cell.tabIndex === 0).length, 1, 'exactly one cell is in the tab order');
    assert.match(dom.byId('status').textContent, /your turn/i);
    assert.match(dom.byId('mirror').textContent, /legend/i, 'the text mirror is filled in');
    assert.match(dom.byId('share-out').value, /^CF1~/);

    // READ the focused cell.
    dom.byId('read').__fire('click');
    assert.match(dom.byId('read-out').textContent, /^READ /, 'READ reports a forecast');
    assert.equal(dom.byId('read-count').textContent, '2', 'the UI action spent one charge');

    // Keyboard navigation moves the roving tab stop.
    const before = cells.findIndex(cell => cell.tabIndex === 0);
    board.__fire('keydown', { key: 'ArrowRight' });
    const after = cells.findIndex(cell => cell.tabIndex === 0);
    assert.equal(after, before + 1, 'ArrowRight moves focus one column');

    // Place a grain, then let the solo rival answer.
    const playable = cells.find(cell => cell.dataset.legal === '1');
    assert.ok(playable, 'at least one playable cell is marked');
    playable.__fire('click');
    await new Promise(resolve => { setTimeout(resolve, 600); });
    assert.match(dom.byId('status').textContent, /Turn 2 of 160/, 'the human move and the rival reply both landed');
    assert.match(dom.byId('read-out').textContent, /played [A-O]\d+/i);

    // Illegal placement is explained, not silently ignored.
    const blocked = cells.find(cell => cell.dataset.legal === '0' && cell.dataset.owner === 'neutral');
    blocked.__fire('click');
    assert.match(dom.byId('read-out').textContent, /not playable/i);

    // Pause freezes placements, then help/export/share/seed/history remain available.
    dom.byId('pause').__fire('click');
    assert.equal(dom.byId('pause').getAttribute('aria-pressed'), 'true');
    const pausedTurn = dom.byId('status').textContent.match(/Turn \d+ of 160/)?.[0];
    cells.find(cell => cell.dataset.legal === '1').__fire('click');
    await new Promise(resolve => { setTimeout(resolve, 20); });
    assert.equal(dom.byId('status').textContent.match(/Turn \d+ of 160/)?.[0], pausedTurn, 'pause prevents placements');
    assert.match(dom.byId('read-out').textContent, /paused/i);
    dom.byId('pause').__fire('click');
    dom.byId('help-toggle').__fire('click');
    assert.equal(dom.byId('help').hidden, false);
    assert.equal(dom.byId('help-toggle').getAttribute('aria-expanded'), 'true');
    dom.byId('export').__fire('click');
    assert.match(dom.byId('read-out').textContent, /exported/i);
    dom.byId('share').__fire('click');
    await new Promise(resolve => { setTimeout(resolve, 10); });
    assert.match(dom.byId('read-out').textContent, /CF1~/);
    dom.byId('seed').value = 'weird seed!!';
    dom.byId('seed').__fire('change');
    assert.equal(dom.byId('seed').value, 'WEIRD-SEED');
    dom.byId('new-random').__fire('click');
    assert.match(dom.byId('seed').value, /^[A-Z0-9-]+$/);
    dom.byId('replay').__fire('click');
    assert.match(dom.byId('read-out').textContent, /replaying seed/i);
    assert.match(dom.byId('status').textContent, /Turn 0 of 160/, 'replay returns to the opening position');
    dom.byId('clear-history').__fire('click');
    assert.match(dom.byId('history').textContent, /no matches recorded/i);

    // Hotseat: two humans alternate on the same device, with no rival timer.
    dom.byId('seed').value = 'CROWN-FALL-HOTSEAT';
    dom.byId('mode').value = 'hotseat';
    dom.byId('mode').__fire('change');
    const hotseatCells = dom.byId('board').children.flatMap(row => row.children);
    hotseatCells.find(cell => cell.dataset.legal === '1').__fire('click');
    await new Promise(resolve => { setTimeout(resolve, 60); });
    assert.match(dom.byId('status').textContent, /rival ▼ \(amber\) to move/i, 'hotseat names the side to move');
    assert.match(dom.byId('status').textContent, /Turn 1 of 160/, 'no rival timer fired on its behalf');
    hotseatCells.find(cell => cell.dataset.legal === '1').__fire('click');
    await new Promise(resolve => { setTimeout(resolve, 60); });
    assert.match(dom.byId('status').textContent, /Turn 2 of 160/);
    assert.match(dom.byId('status').textContent, /player ▲ \(violet\) to move/i, 'and back to the first human');
  } finally {
    dom.restore();
  }
});

// --- SLICES BELOW ---

let passed = 0;for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} tests passed`);
