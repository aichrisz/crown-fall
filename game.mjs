// CROWN//FALL — pure engine. No DOM, no network, no dependencies.
// Imported by both index.html (browser module) and verify.mjs (Node tests).

export const SIZE = 15;
export const CELL_COUNT = SIZE * SIZE;

/** Deterministic 32-bit string hash (FNV-1a variant) used to seed the PRNG. */
function hashSeed(seed) {
  let hash = 0x811c9dc5;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed always yields the same stream. */
function makeRandom(seed) {
  let state = hashSeed(seed) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function indexOf(x, y) {
  return y * SIZE + x;
}

export function coordsOf(index) {
  return { x: index % SIZE, y: Math.floor(index / SIZE) };
}

function makeCells() {
  const cells = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const { x, y } = coordsOf(index);
    cells.push({ index, x, y, grains: 0, owner: 'neutral', base: null, crown: false });
  }
  return cells;
}

const BASE_GRAINS = 2;

/**
 * Bases are placed with 180° rotational symmetry so neither side gets a
 * positional advantage; the seed only chooses which symmetric pair is used.
 */
function placeBases(cells, random) {
  const x = 1 + Math.floor(random() * 3); // 1..3
  const y = SIZE - 2 - Math.floor(random() * 3); // 12..10
  const playerIndex = indexOf(x, y);
  const rivalIndex = indexOf(SIZE - 1 - x, SIZE - 1 - y);
  const player = cells[playerIndex];
  player.base = 'player';
  player.owner = 'player';
  player.grains = BASE_GRAINS;
  const rival = cells[rivalIndex];
  rival.base = 'rival';
  rival.owner = 'rival';
  rival.grains = BASE_GRAINS;
  return { playerIndex, rivalIndex };
}

export const NEIGHBOR_DELTAS = [[0, -1], [-1, 0], [1, 0], [0, 1]];

/** Orthogonal in-bounds neighbour indices of `index`, ascending. */
export function neighborsOf(index) {
  const { x, y } = coordsOf(index);
  const result = [];
  for (const [dx, dy] of NEIGHBOR_DELTAS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
    result.push(indexOf(nx, ny));
  }
  return result.sort((a, b) => a - b);
}

/**
 * A placement is legal on a cell the mover already owns, or on a neutral cell
 * orthogonally adjacent to mover territory. Enemy-owned cells are never legal.
 */
export function isLegalMove(state, owner, index) {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return false;
  const cell = state.cells[index];
  if (cell.owner === owner) return true;
  if (cell.owner !== 'neutral') return false;
  return neighborsOf(index).some(n => state.cells[n].owner === owner);
}

/** Ascending list of every legal placement index for `owner`. */
export function legalMoves(state, owner) {
  const moves = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (isLegalMove(state, owner, index)) moves.push(index);
  }
  return moves;
}

export function cloneCells(cells) {
  return cells.map(cell => ({ ...cell }));
}

export const TOPPLE_THRESHOLD = 4;

/**
 * Safety bound for one avalanche. Every topple removes 4 grains from a cell and
 * the board can never hold more than CELL_COUNT * TOPPLE_THRESHOLD grains after
 * a single 1-grain placement, so this ceiling can only be reached by a bug.
 */
export const MAX_TOPPLES = CELL_COUNT * TOPPLE_THRESHOLD * 16;

export class AvalancheBoundError extends Error {
  constructor(limit) {
    super(`avalanche safety bound of ${limit} topples exceeded`);
    this.name = 'AvalancheBoundError';
    this.limit = limit;
  }
}

/**
 * Resolve every cell at or above the threshold until the board is stable.
 * Deterministic: each wave snapshots the unstable cells in ascending index
 * order and topples them in that order. Grains sent off-board dissipate.
 * Mutates the supplied `cells` array (already a private clone).
 * Throws AvalancheBoundError rather than ever returning an unstable board.
 */
export function stabilize(cells, owner, options = {}) {
  const limit = Number.isInteger(options.maxTopples) ? options.maxTopples : MAX_TOPPLES;
  const descending = options.order === 'desc';
  const waves = [];
  const capturedSet = new Set();
  let toppleCount = 0;
  let dissipated = 0;
  for (;;) {
    const unstable = [];
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (cells[index].grains >= TOPPLE_THRESHOLD) unstable.push(index);
    }
    if (unstable.length === 0) {
      return {
        waves,
        toppleCount,
        dissipated,
        captured: [...capturedSet].sort((a, b) => a - b),
        stable: true,
        bounded: false,
      };
    }
    if (descending) unstable.reverse();
    const toppledThisWave = [];
    for (const index of unstable) {
      const cell = cells[index];
      if (cell.grains < TOPPLE_THRESHOLD) continue;
      toppleCount += 1;
      if (toppleCount > limit) throw new AvalancheBoundError(limit);
      cell.grains -= TOPPLE_THRESHOLD;
      cell.owner = owner;
      toppledThisWave.push(index);
      const { x, y } = coordsOf(index);
      for (const [dx, dy] of NEIGHBOR_DELTAS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) {
          dissipated += 1;
          continue;
        }
        const neighbor = cells[indexOf(nx, ny)];
        neighbor.grains += 1;
        // Every in-bounds receiver joins the triggering mover, which is what
        // turns an avalanche into a capture and can chain further topples.
        if (neighbor.owner !== owner) {
          if (neighbor.owner !== 'neutral') capturedSet.add(neighbor.index);
          neighbor.owner = owner;
        }
      }
    }
    waves.push(toppledThisWave);
  }
}

/**
 * Pure board resolution for one placement by `owner` on `index`.
 * Returns a fresh cell array plus a footprint report; never mutates `state`.
 */
export function resolvePlacement(state, owner, index, options = {}) {
  const cells = cloneCells(state.cells);
  const target = cells[index];
  const claimedNeutral = target.owner === 'neutral';
  target.owner = owner;
  target.grains += 1;
  const avalanche = stabilize(cells, owner, options);
  return { cells, claimedNeutral, ...avalanche };
}

export const CROWN_COUNT = 5;
const CROWN_INSET = 2; // crowns never sit on the outer two rings
const CROWN_BASE_CLEARANCE = 3; // Chebyshev distance kept from either base
const CROWN_SPACING = 2; // crowns never touch, not even diagonally

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function rotate180(index) {
  const { x, y } = coordsOf(index);
  return indexOf(SIZE - 1 - x, SIZE - 1 - y);
}

/**
 * Five crowns: the board centre (its own mirror) plus two pairs related by 180°
 * rotation. The symmetry is the fairness guarantee — any advantage a crown gives
 * one side is mirrored for the other. The seed only picks which pairs are used.
 */
function placeCrowns(cells, random, bases) {
  const baseCoords = [coordsOf(bases.playerIndex), coordsOf(bases.rivalIndex)];
  const isCandidate = index => {
    const c = coordsOf(index);
    if (c.x < CROWN_INSET || c.x > SIZE - 1 - CROWN_INSET) return false;
    if (c.y < CROWN_INSET || c.y > SIZE - 1 - CROWN_INSET) return false;
    if (cells[index].base) return false;
    return baseCoords.every(b => chebyshev(c, b) >= CROWN_BASE_CLEARANCE);
  };

  const centre = indexOf((SIZE - 1) / 2, (SIZE - 1) / 2);
  if (!isCandidate(centre)) throw new Error('board centre must always be a legal crown site');
  const chosen = [centre];

  const pairs = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const mirror = rotate180(index);
    if (mirror <= index) continue;
    if (isCandidate(index) && isCandidate(mirror)) pairs.push([index, mirror]);
  }
  // Deterministic Fisher–Yates shuffle driven by the seeded PRNG.
  for (let i = pairs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const spacedFromChosen = index =>
    chosen.every(other => chebyshev(coordsOf(index), coordsOf(other)) >= CROWN_SPACING);
  for (const [a, b] of pairs) {
    if (chosen.length >= CROWN_COUNT) break;
    if (!spacedFromChosen(a) || !spacedFromChosen(b)) continue;
    if (chebyshev(coordsOf(a), coordsOf(b)) < CROWN_SPACING) continue;
    chosen.push(a, b);
  }
  if (chosen.length !== CROWN_COUNT) throw new Error('crown layout could not be seeded');
  const crowns = chosen.sort((a, b) => a - b);
  for (const index of crowns) cells[index].crown = true;
  return crowns;
}

export function crownTally(cells, crowns) {
  const tally = { player: 0, rival: 0, neutral: 0 };
  for (const index of crowns) tally[cells[index].owner] += 1;
  return tally;
}

/**
 * READ: pure what-if simulation of one placement. Returns the exact footprint —
 * toppled cells, captures, dissipation, wave order, resulting crown tally — and
 * never mutates the supplied state nor spends a READ charge. Illegal placements
 * are reported, not thrown, so the UI can explain them.
 */
export function previewMove(state, owner, index, options = {}) {
  if (!isLegalMove(state, owner, index)) {
    return { legal: false, reason: illegalReason(state, owner, index) };
  }
  const result = resolvePlacement(state, owner, index, options);
  const toppled = [...new Set(result.waves.flat())].sort((a, b) => a - b);
  const crowns = crownTally(result.cells, state.crowns ?? []);
  return {
    legal: true,
    index,
    owner,
    cells: result.cells,
    waves: result.waves,
    toppled,
    captured: result.captured,
    claimedNeutral: result.claimedNeutral,
    dissipated: result.dissipated,
    toppleCount: result.toppleCount,
    crowns,
  };
}

/** Every board cell affected by a legal READ, deduplicated and ordered. */
export function previewFootprint(preview) {
  if (!preview?.legal) return [];
  return [...new Set([
    ...(preview.toppled ?? []),
    ...(preview.captured ?? []),
    preview.index,
  ])]
    .filter(index => Number.isInteger(index) && index >= 0 && index < CELL_COUNT)
    .sort((a, b) => a - b);
}

function illegalReason(state, owner, index) {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return 'That cell is off the board.';
  const cell = state.cells[index];
  if (cell.owner !== 'neutral' && cell.owner !== owner) return 'Enemy ground cannot be played on directly.';
  return 'Neutral ground must touch your territory.';
}

export class IllegalMoveError extends Error {
  constructor(reason) {
    super(`illegal move: ${reason}`);
    this.name = 'IllegalMoveError';
    this.reason = reason;
  }
}

export function opponentOf(owner) {
  return owner === 'player' ? 'rival' : 'player';
}

export const CROWNS_TO_WIN = 3;
/** Opening gate: no crown victory can register until BOTH sides have taken this
 *  many turns, so a fast opening avalanche cannot end the match outright. */
export const OPENING_GATE_TURNS = 3;

function openingGateOpen(turnsTaken) {
  return turnsTaken.player >= OPENING_GATE_TURNS && turnsTaken.rival >= OPENING_GATE_TURNS;
}

/**
 * Apply the current mover's placement and hand the turn over.
 * Returns a brand new state; the input state is never touched.
 */
/** Bounded match length. Reaching it ends the match on the ranking ladder. */
export const TURN_CAP = 160;

export function scoreboard(state) {
  const tally = crownTally(state.cells, state.crowns);
  const score = {
    player: { crowns: tally.player, territory: 0, grains: 0 },
    rival: { crowns: tally.rival, territory: 0, grains: 0 },
  };
  for (const cell of state.cells) {
    if (cell.owner === 'neutral') continue;
    score[cell.owner].territory += 1;
    score[cell.owner].grains += cell.grains;
  }
  return score;
}

/** Ranking ladder for capped or stalled matches: crowns, territory, grains, draw. */
export function rankOutcome(state) {
  const score = scoreboard(state);
  for (const key of ['crowns', 'territory', 'grains']) {
    if (score.player[key] === score.rival[key]) continue;
    return { winner: score.player[key] > score.rival[key] ? 'player' : 'rival', reason: key };
  }
  return { winner: null, reason: 'draw' };
}

export function hasLegalMove(state, owner) {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (isLegalMove(state, owner, index)) return true;
  }
  return false;
}

/**
 * Terminal conditions checked after every turn: the bounded turn cap, or a
 * board where neither side has a legal placement. Both resolve on the ladder.
 */
export function checkEnd(state) {
  if (state.status !== 'playing') return state;
  const capped = state.turnCount >= TURN_CAP;
  const stalled = !hasLegalMove(state, 'player') && !hasLegalMove(state, 'rival');
  if (!capped && !stalled) return state;
  const outcome = rankOutcome(state);
  return {
    ...state,
    status: 'ended',
    winner: outcome.winner,
    reason: outcome.reason,
    endedBy: capped ? 'cap' : 'nomoves',
  };
}

/** READ charges per human side, per match. */
export const READ_CHARGES = 3;

/**
 * Spend one READ charge. Only the UI action does this — previewMove itself is a
 * free pure simulation, which is also what the heuristic opponent uses.
 */
export function spendRead(state, owner) {
  if ((state.reads?.[owner] ?? 0) <= 0) throw new Error('no READ charges left');
  return { ...state, reads: { ...state.reads, [owner]: state.reads[owner] - 1 } };
}

/**
 * Rival doctrines. Every doctrine is the *same* honest one-ply heuristic — a
 * single simulation per legal placement, no search, no model of your reply —
 * and differs only in what it values. `warden` holds the original weights, so
 * the default rival is unchanged; the others reprioritise the same terms.
 */
export const DEFAULT_DOCTRINE = 'warden';

export const DOCTRINES = Object.freeze([
  Object.freeze({
    id: 'warden',
    name: 'Warden',
    blurb: 'Balanced. Takes crowns, denies yours, and treats captures, ground and wasted grains as roughly equal concerns.',
    weights: Object.freeze({
      crownGain: 140,
      crownDenial: 110,
      capture: 9,
      territoryGain: 4,
      territoryLoss: 3,
      dissipation: 2,
      victory: 400,
      loadedThreat: 6,
      threatEnemy: 2,
      threatNeutral: 1,
      threatCrown: 4,
      crownProximity: 1,
    }),
  }),
  Object.freeze({
    id: 'reaper',
    name: 'Reaper',
    blurb: 'Aggressive. Hunts captures and enemy ground, loads cells against your territory, and does not care what falls off the edge.',
    weights: Object.freeze({
      crownGain: 90,
      crownDenial: 55,
      capture: 26,
      territoryGain: 2,
      territoryLoss: 10,
      dissipation: 0,
      victory: 400,
      loadedThreat: 11,
      threatEnemy: 5,
      threatNeutral: 0,
      threatCrown: 2,
      crownProximity: 0,
    }),
  }),
  Object.freeze({
    id: 'surveyor',
    name: 'Surveyor',
    blurb: 'Patient. Spreads over quiet ground, hoards grains rather than spilling them over the edge, and creeps toward unheld crowns.',
    weights: Object.freeze({
      crownGain: 170,
      crownDenial: 130,
      capture: 2,
      territoryGain: 7,
      territoryLoss: 1,
      dissipation: 9,
      victory: 400,
      loadedThreat: 3,
      threatEnemy: 1,
      threatNeutral: 1,
      threatCrown: 7,
      crownProximity: 5,
    }),
  }),
]);

const DOCTRINE_BY_ID = new Map(DOCTRINES.map(doctrine => [doctrine.id, doctrine]));

/**
 * Normalize a doctrine id at every boundary: trimmed, lowercased, and anything
 * unrecognised (including nothing at all) becomes warden. Idempotent.
 */
export function normalizeDoctrine(id) {
  const text = typeof id === 'string' ? id.trim().toLowerCase() : '';
  return DOCTRINE_BY_ID.has(text) ? text : DEFAULT_DOCTRINE;
}

/** Look up a doctrine, falling back to warden for anything unrecognised. */
export function doctrineOf(id) {
  return DOCTRINE_BY_ID.get(normalizeDoctrine(id));
}

/**
 * Honest one-ply heuristic — NOT a deep search. It scores every legal placement
 * with a single pure simulation (the same READ machinery a human can use, at no
 * charge) and takes the best, breaking ties by proximity to an unheld crown and
 * then by lowest cell index. It never looks at the opponent's reply, so it can
 * be baited into leaving a loaded cell next to enemy territory.
 */
export function scoreMove(state, owner, index, options = {}) {
  // Doctrine resolution order: explicit option, then the state, then the default.
  const weights = doctrineOf(options.doctrine ?? state.doctrine).weights;
  const foe = opponentOf(owner);
  const before = scoreboard(state);
  const preview = previewMove(state, owner, index);
  if (!preview.legal) return null;
  const after = scoreboard({ ...state, cells: preview.cells });
  const crownGain = after[owner].crowns - before[owner].crowns;
  const crownDenial = before[foe].crowns - after[foe].crowns;
  const territoryGain = after[owner].territory - before[owner].territory;
  const territoryLoss = before[foe].territory - after[foe].territory;
  let score = 0;
  score += weights.crownGain * crownGain;
  score += weights.crownDenial * crownDenial;
  score += weights.capture * preview.captured.length;
  score += weights.territoryGain * territoryGain;
  score += weights.territoryLoss * territoryLoss;
  score -= weights.dissipation * preview.dissipated; // grains thrown off the board are wasted
  if (after[owner].crowns >= CROWNS_TO_WIN) score += weights.victory;
  // Two-step intent: a cell left on three grains topples next turn, so value the
  // enemy cells and unheld crowns it would sweep into. This is the whole of the
  // heuristic's foresight — it never models the opponent's reply.
  const placed = preview.cells[index];
  if (placed.grains === TOPPLE_THRESHOLD - 1) {
    let threatened = 0;
    for (const n of neighborsOf(index)) {
      const neighbor = preview.cells[n];
      if (neighbor.owner === foe) threatened += weights.threatEnemy;
      else if (neighbor.owner === 'neutral') threatened += weights.threatNeutral;
      if (neighbor.crown && neighbor.owner !== owner) threatened += weights.threatCrown;
    }
    score += weights.loadedThreat * threatened;
  }
  // Mild pull toward crowns that nobody holds yet.
  const target = coordsOf(index);
  let nearest = SIZE * 2;
  for (const crown of state.crowns ?? []) {
    if (preview.cells[crown].owner === owner) continue;
    nearest = Math.min(nearest, chebyshev(target, coordsOf(crown)));
  }
  score -= weights.crownProximity * nearest;
  return { index, score, preview };
}

export function chooseMove(state, owner, options = {}) {
  const moves = legalMoves(state, owner);
  if (moves.length === 0) return null;
  let best = null;
  for (const index of moves) {
    const scored = scoreMove(state, owner, index, options);
    if (!scored) continue;
    if (best === null || scored.score > best.score) best = scored;
  }
  return best === null ? null : best.index;
}

export const MAX_SEED_LENGTH = 24;
export const DEFAULT_SEED = 'CROWN-FALL';
const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike glyphs

/** Seeds are uppercase A–Z, 0–9 and dashes, length-capped, and idempotent. */
export function normalizeSeed(input) {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SEED_LENGTH)
    .replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_SEED;
}

/** Build a fresh seed from a 0..1 source (Math.random in the browser). */
export function randomSeed(source = Math.random) {
  let text = '';
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      text += SEED_ALPHABET[Math.floor(source() * SEED_ALPHABET.length) % SEED_ALPHABET.length];
    }
    if (i < 2) text += '-';
  }
  return text;
}

const SHARE_PREFIX = 'CF1';
const SHARE_SEP = '~';
const WINNER_CODE = { player: 'P', rival: 'R' };

/** Compact, offline share string: CF1~SEED~WINNER~playerCrowns~rivalCrowns~turns */
export function formatShare(state) {
  const tally = crownTally(state.cells, state.crowns ?? []);
  const code = state.winner ? WINNER_CODE[state.winner] : 'D';
  return [SHARE_PREFIX, normalizeSeed(state.seed), code, tally.player, tally.rival, state.turnCount].join(SHARE_SEP);
}

export function parseShare(text) {
  const parts = String(text ?? '').trim().split(SHARE_SEP);
  if (parts.length !== 6 || parts[0] !== SHARE_PREFIX) return null;
  const [, seed, code, playerCrowns, rivalCrowns, turns] = parts;
  if (!['P', 'R', 'D'].includes(code)) return null;
  if (!/^\d+$/.test(playerCrowns) || !/^\d+$/.test(rivalCrowns) || !/^\d+$/.test(turns)) return null;
  return {
    version: 1,
    seed: normalizeSeed(seed),
    winner: code === 'P' ? 'player' : code === 'R' ? 'rival' : null,
    crowns: { player: Number(playerCrowns), rival: Number(rivalCrowns) },
    turns: Number(turns),
  };
}

const OWNERS = new Set(['neutral', 'player', 'rival']);

/**
 * Invariant check used by the self-play sweep and as a UI safety net: a state is
 * only ever handed on if it is stable, owned by known sides, and self-consistent.
 */
export function validateState(state) {
  const problems = [];
  if (!Array.isArray(state.cells) || state.cells.length !== CELL_COUNT) {
    problems.push(`cell count must be ${CELL_COUNT}`);
    return problems;
  }
  for (const cell of state.cells) {
    if (!Number.isInteger(cell.grains)) problems.push(`cell ${cell.index} has non-integer grains`);
    else if (cell.grains < 0) problems.push(`cell ${cell.index} has negative grains`);
    else if (cell.grains >= TOPPLE_THRESHOLD) problems.push(`cell ${cell.index} is unstable (${cell.grains} grains)`);
    if (!OWNERS.has(cell.owner)) problems.push(`cell ${cell.index} has an invalid owner`);
  }
  if (!Array.isArray(state.crowns) || state.crowns.length !== CROWN_COUNT) {
    problems.push(`crown set must hold exactly ${CROWN_COUNT} cells`);
  } else if (state.crowns.some(index => !state.cells[index]?.crown)) {
    problems.push('crown set disagrees with the flagged crown cells');
  }
  if (!Number.isInteger(state.turnCount) || state.turnCount < 0 || state.turnCount > TURN_CAP) {
    problems.push(`turn count ${state.turnCount} is outside the bounded cap of ${TURN_CAP}`);
  } else if (Array.isArray(state.moves) && state.moves.length !== state.turnCount) {
    problems.push('move log length disagrees with the turn count');
  }
  if (state.doctrine != null && normalizeDoctrine(state.doctrine) !== state.doctrine) {
    problems.push(`unknown rival doctrine "${state.doctrine}"`);
  }
  return problems;
}

// --- Text mirror: every visual cue also exists as words or glyphs ---

const COLUMN_LETTERS = 'ABCDEFGHIJKLMNO'.slice(0, SIZE);
export const OWNER_GLYPH = { player: 'P', rival: 'R', neutral: '.' };
export const OWNER_WORD = { player: 'you', rival: 'rival', neutral: 'neutral' };

export function cellLabel(index) {
  const { x, y } = coordsOf(index);
  return `${COLUMN_LETTERS[x]}${y + 1}`;
}

/** One sentence per cell, used verbatim as the board button's accessible name. */
export function describeCell(state, index, viewer = state.current) {
  const cell = state.cells[index];
  const parts = [`${cellLabel(index)}:`];
  if (cell.crown) parts.push('crown site,');
  if (cell.base) parts.push(`${cell.base === viewer ? 'your' : 'rival'} base,`);
  parts.push(`${OWNER_WORD[cell.owner]},`);
  parts.push(cell.grains === 0 ? 'empty (0 grains),' : `${cell.grains} grains,`);
  if (cell.grains === TOPPLE_THRESHOLD - 1) parts.push('loaded — one more grain topples it,');
  parts.push(isLegalMove(state, viewer, index) ? 'playable' : 'not playable');
  return parts.join(' ');
}

/**
 * Plain-text mirror of the whole board. Each cell reads as
 * <owner><grains><crown flag>, e.g. `P2#` = yours, two grains, crown site.
 */
export function boardText(state, viewer = state.current) {
  const header = `    ${COLUMN_LETTERS.split('').map(letter => letter.padEnd(3, ' ')).join(' ')}`;
  const rows = [];
  for (let y = 0; y < SIZE; y += 1) {
    const tokens = [];
    for (let x = 0; x < SIZE; x += 1) {
      const cell = state.cells[indexOf(x, y)];
      tokens.push(`${OWNER_GLYPH[cell.owner]}${cell.grains}${cell.crown ? '#' : '-'}`);
    }
    rows.push(`${String(y + 1).padStart(3, ' ')} ${tokens.join(' ')}`);
  }
  const legend = [
    `legend: P = ${viewer === 'player' ? 'you' : 'rival'}, R = ${viewer === 'player' ? 'rival' : 'you'}, . = neutral;`,
    'digit = grains (topples at 4); # = crown site, - = plain ground.',
  ].join(' ');
  return [header, ...rows, legend].join('\n');
}

const REASON_WORD = {
  crowns: 'three crowns held',
  territory: 'more territory',
  grains: 'more grains',
  draw: 'dead level',
};

/** Live status sentence for the polite aria-live region. */
export function statusText(state, viewer = 'player') {
  const tally = crownTally(state.cells, state.crowns ?? []);
  const crowns = `Crowns — you ${tally[viewer]}, rival ${tally[opponentOf(viewer)]}.`;
  const reads = `READ charges left: ${state.reads?.[viewer] ?? 0}.`;
  if (state.status === 'won') {
    const who = state.winner === viewer ? 'You win' : 'The rival wins';
    return `${who} — ${REASON_WORD[state.reason] ?? state.reason}. ${crowns} Turn ${state.turnCount} of ${TURN_CAP}.`;
  }
  if (state.status === 'ended') {
    const who = state.winner === null
      ? 'Draw'
      : `${state.winner === viewer ? 'You win' : 'The rival wins'} on ${REASON_WORD[state.reason] ?? state.reason}`;
    return `Match over — ${who}. ${crowns} Turn ${state.turnCount} of ${TURN_CAP}.`;
  }
  const turn = state.current === viewer ? 'Your turn' : 'Rival to move';
  const passed = state.passedBy ? ` ${state.passedBy === viewer ? 'You had' : 'The rival had'} no legal move and passed.` : '';
  return `${turn}. ${crowns} Turn ${state.turnCount} of ${TURN_CAP}. ${reads}${passed}`;
}

/**
 * Animation budget. A huge cascade is folded into at most this many visual
 * waves — no cell is dropped, later waves are merged — so the render queue and
 * the number of live glow elements stay bounded no matter how big the avalanche.
 */
export const MAX_ANIMATED_WAVES = 16;

export function boundedWaves(waves, limit = MAX_ANIMATED_WAVES) {
  const list = Array.isArray(waves) ? waves : [];
  if (list.length <= limit) return list;
  const folded = Array.from({ length: limit }, () => []);
  const perBucket = Math.ceil(list.length / limit);
  list.forEach((wave, i) => {
    folded[Math.min(limit - 1, Math.floor(i / perBucket))].push(...wave);
  });
  return folded;
}

/** Turn a READ preview into one sentence, so the forecast is never visual-only. */
export function describePreview(state, preview) {
  if (!preview?.legal) return `READ: ${preview?.reason ?? 'that placement is not legal.'}`;
  const parts = [`READ ${cellLabel(preview.index)}:`];
  parts.push(preview.toppled.length === 0
    ? 'no topple — the grain just settles.'
    : `${preview.toppled.length} cell${preview.toppled.length === 1 ? '' : 's'} topple in ${preview.waves.length} wave${preview.waves.length === 1 ? '' : 's'}.`);
  parts.push(preview.captured.length === 0
    ? 'No enemy cells captured.'
    : `Captures ${preview.captured.length} enemy cell${preview.captured.length === 1 ? '' : 's'} (${preview.captured.slice(0, 6).map(cellLabel).join(', ')}${preview.captured.length > 6 ? '…' : ''}).`);
  if (preview.claimedNeutral) parts.push('Claims neutral ground.');
  parts.push(`${preview.dissipated} grain${preview.dissipated === 1 ? '' : 's'} lost off the board.`);
  parts.push(`Crowns after: you ${preview.crowns[preview.owner]}, rival ${preview.crowns[opponentOf(preview.owner)]}.`);
  return parts.join(' ');
}

/** Local match history: bounded, newest first, and deliberately anonymous. */
export const HISTORY_LIMIT = 20;
const HISTORY_FIELDS = ['seed', 'mode', 'doctrine', 'winner', 'reason', 'turns', 'crowns', 'share'];

export function historyEntry(state) {
  const tally = crownTally(state.cells, state.crowns ?? []);
  return {
    seed: state.seed,
    mode: state.mode,
    doctrine: normalizeDoctrine(state.doctrine),
    winner: state.winner,
    reason: state.reason,
    turns: state.turnCount,
    crowns: { player: tally.player, rival: tally.rival },
    share: formatShare(state),
  };
}

/**
 * Prepend an entry, keeping only whitelisted fields so nothing personal can be
 * smuggled into local storage, and truncate to HISTORY_LIMIT.
 */
export function appendHistory(list, entry) {
  const clean = {};
  for (const key of HISTORY_FIELDS) clean[key] = entry?.[key] ?? null;
  return [clean, ...(Array.isArray(list) ? list : [])].slice(0, HISTORY_LIMIT);
}

/**
 * Heuristic vs heuristic match, used by the multi-seed sweep. Bounded twice
 * over: by the rules' turn cap and by an independent loop guard.
 */
export function playSelfMatch(seed, options = {}) {
  const doctrine = normalizeDoctrine(options.doctrine);
  let state = createGame(seed, { mode: options.mode ?? 'solo', doctrine });
  let guard = 0;
  while (state.status === 'playing') {
    guard += 1;
    if (guard > TURN_CAP + 8) throw new Error(`self-play failed to terminate for seed ${state.seed}`);
    const choice = chooseMove(state, state.current, { doctrine });
    if (choice === null) throw new Error(`no legal move for ${state.current} on seed ${state.seed}`);
    state = applyMove(state, choice);
  }
  return {
    seed: state.seed,
    doctrine,
    state,
    turns: state.turnCount,
    winner: state.winner,
    reason: state.reason,
    endedBy: state.endedBy,
    share: formatShare(state),
  };
}

/**
 * Deterministic replay: the seed rebuilds the board, then each logged placement
 * is re-applied through the same rules, so a seed plus a move list is a complete
 * record of a match. Any mismatch is refused rather than silently patched.
 */
export function replayMoves(seed, moves, options = {}) {
  let state = createGame(seed, options);
  for (const move of moves ?? []) {
    if (state.status !== 'playing') throw new IllegalMoveError('the logged match had already ended');
    if (move.owner && move.owner !== state.current) {
      throw new IllegalMoveError(`${move.owner} moved out of turn`);
    }
    state = applyMove(state, move.index);
  }
  return state;
}

/**
 * Apply the current mover's placement and hand the turn over.
 * Returns a brand new state; the input state is never touched.
 */
export function applyMove(state, index) {
  if (state.status !== 'playing') throw new IllegalMoveError('the match is already over');
  const owner = state.current;
  if (!isLegalMove(state, owner, index)) throw new IllegalMoveError(illegalReason(state, owner, index));
  const result = resolvePlacement(state, owner, index);
  const turnsTaken = { ...state.turnsTaken, [owner]: state.turnsTaken[owner] + 1 };
  let next = {
    ...state,
    cells: result.cells,
    turnsTaken,
    turnCount: state.turnCount + 1,
    moves: [...state.moves, { owner, index }],
    current: opponentOf(owner),
    lastMove: {
      owner,
      index,
      waves: result.waves,
      captured: result.captured,
      dissipated: result.dissipated,
      claimedNeutral: result.claimedNeutral,
    },
  };
  // Victory is only ever checked at the end of a turn, and only past the gate.
  const tally = crownTally(next.cells, next.crowns);
  if (openingGateOpen(turnsTaken) && tally[owner] >= CROWNS_TO_WIN) {
    return { ...next, status: 'won', winner: owner, reason: 'crowns', endedBy: 'crowns', current: owner };
  }
  // A side with no legal placement passes; the turn returns to the other side.
  const foe = opponentOf(owner);
  if (hasLegalMove(next, foe)) {
    next = { ...next, current: foe, passedBy: null };
  } else if (hasLegalMove(next, owner)) {
    next = { ...next, current: owner, passedBy: foe };
  }
  return checkEnd(next);
}

/**
 * Seeded starting grain field. Only half the board is drawn and then mirrored
 * through 180°, so the opening position is exactly fair: whatever one side is
 * handed, the other is handed the rotation of it. Crown sites and bases are left
 * out so the prizes start clean and every board is stable on turn one.
 */
function scatterGrains(cells, random, bases) {
  const skip = new Set([bases.playerIndex, bases.rivalIndex]);
  for (const cell of cells) if (cell.crown) skip.add(cell.index);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const mirror = rotate180(index);
    if (mirror < index) continue; // the mirrored half is filled by its partner
    if (skip.has(index) || skip.has(mirror)) continue;
    const roll = random();
    // ~62% of mirrored pairs carry grains, weighted toward one and two.
    const grains = roll < 0.38 ? 0 : roll < 0.66 ? 1 : roll < 0.88 ? 2 : 3;
    cells[index].grains = grains;
    cells[mirror].grains = grains;
  }
}

export function createGame(seed, options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const random = makeRandom(normalizedSeed);
  const cells = makeCells();
  const bases = placeBases(cells, random);
  const crowns = placeCrowns(cells, random, bases);
  scatterGrains(cells, random, bases);
  return {
    seed: normalizedSeed,
    mode: options.mode === 'solo' ? 'solo' : 'hotseat',
    doctrine: normalizeDoctrine(options.doctrine),
    size: SIZE,
    cells,
    bases,
    crowns,
    current: 'player',
    status: 'playing',
    winner: null,
    reason: null,
    turnCount: 0,
    turnsTaken: { player: 0, rival: 0 },
    moves: [],
    lastMove: null,
    passedBy: null,
    endedBy: null,
    reads: { player: READ_CHARGES, rival: READ_CHARGES },
  };
}
