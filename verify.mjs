import assert from 'node:assert/strict';

let createGame;
try {
  ({ createGame } = await import('./game.mjs'));
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

let passed = 0;
for (const { name, fn } of tests) {
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
