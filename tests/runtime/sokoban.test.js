// Run with: node --test tests/runtime/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGrid, createMover } = require('../../src/TheWeave.Exporter/runtime/sokoban.js');

const STEP_MS = 100;

function mapGrid(){
  return createGrid({ columns: 19, rows: 10, cellWidth: 150, cellHeight: 150, originX: 150, originY: 150 });
}

function mover(grid = mapGrid(), options = {}){
  return createMover(grid, { cell: { col: 5, row: 5 }, stepMs: STEP_MS, ...options });
}

test('centerOf returns the middle of a square, offset by the origin', () => {
  assert.deepEqual(mapGrid().centerOf({ col: 0, row: 0 }), { x: 225, y: 225 });
  assert.deepEqual(mapGrid().centerOf({ col: 18, row: 9 }), { x: 2925, y: 1575 });
});

test('cellAt finds the containing square and clamps points off the board', () => {
  let grid = mapGrid();
  assert.deepEqual(grid.cellAt(225, 225), { col: 0, row: 0 });
  assert.deepEqual(grid.cellAt(299, 299), { col: 0, row: 0 });
  assert.deepEqual(grid.cellAt(301, 301), { col: 1, row: 1 });
  assert.deepEqual(grid.cellAt(0, 0), { col: 0, row: 0 });
  assert.deepEqual(grid.cellAt(99999, 99999), { col: 18, row: 9 });
});

test('neighbor returns null off every edge of the board', () => {
  let grid = mapGrid();
  assert.equal(grid.neighbor({ col: 0, row: 3 }, 'left'), null);
  assert.equal(grid.neighbor({ col: 18, row: 3 }, 'right'), null);
  assert.equal(grid.neighbor({ col: 3, row: 0 }, 'up'), null);
  assert.equal(grid.neighbor({ col: 3, row: 9 }, 'down'), null);
  assert.deepEqual(grid.neighbor({ col: 3, row: 3 }, 'right'), { col: 4, row: 3 });
});

test('a gap column pushes later columns over by one square and doubles that one step', () => {
  let grid = createGrid({ columns: 38, rows: 10, cellWidth: 150, cellHeight: 150, originX: 150, originY: 150, gapColumns: [19] });
  assert.equal(grid.centerOf({ col: 18, row: 0 }).x, 2925);
  assert.equal(grid.centerOf({ col: 19, row: 0 }).x, 3225);
  assert.equal(grid.stepLength({ col: 18, row: 0 }, { col: 19, row: 0 }), 2);
  assert.equal(grid.stepLength({ col: 19, row: 0 }, { col: 20, row: 0 }), 1);
  assert.deepEqual(grid.cellAt(3225, 225), { col: 19, row: 0 });
});

test('crossing a gap column takes twice as long at the same speed', () => {
  let grid = createGrid({ columns: 4, rows: 1, cellWidth: 10, cellHeight: 10, gapColumns: [2] });
  let m = createMover(grid, { cell: { col: 1, row: 0 }, stepMs: STEP_MS });
  m.press('right');
  m.release('right');
  m.update(STEP_MS);
  assert.equal(m.isMoving, true);
  assert.equal(m.position.x, 25);
  m.update(STEP_MS);
  assert.equal(m.isMoving, false);
  assert.deepEqual(m.cell, { col: 2, row: 0 });
});

test('a tap too quick to span an update still moves exactly one square', () => {
  let m = mover();
  m.press('right');
  m.release('right');
  for (let i = 0; i < 10; i++) m.update(STEP_MS);
  assert.deepEqual(m.cell, { col: 6, row: 5 });
  assert.equal(m.isMoving, false);
});

test('position glides smoothly between squares', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS / 2);
  let start = mapGrid().centerOf({ col: 5, row: 5 });
  assert.deepEqual(m.position, { x: start.x + 75, y: start.y });
  assert.equal(m.isMoving, true);
});

test('releasing mid-step finishes that step and stops dead center', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS * 2.5); // two squares done, halfway into the third
  m.release('right');
  m.update(STEP_MS * 10);
  assert.deepEqual(m.cell, { col: 8, row: 5 });
  assert.equal(m.isMoving, false);
  assert.deepEqual(m.position, mapGrid().centerOf({ col: 8, row: 5 }));
});

test('holding keeps moving at constant speed with no hitch at square boundaries', () => {
  let m = mover();
  m.press('right');
  let startX = m.position.x;
  for (let i = 1; i <= 50; i++) {
    m.update(STEP_MS / 7);
    assert.ok(Math.abs(m.position.x - (startX + i * 150 / 7)) < 1e-6);
  }
});

test('never moves diagonally - a turn only happens at a square boundary', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS / 2);
  m.press('down');
  m.update(STEP_MS / 4);
  let start = mapGrid().centerOf({ col: 5, row: 5 });
  assert.equal(m.position.y, start.y);
  m.update(STEP_MS / 2); // past the boundary, now heading down
  assert.equal(m.position.x, start.x + 150);
  assert.ok(m.position.y > start.y);
});

test('the most recently pressed direction wins, and releasing it falls back to the other', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS / 2);
  m.press('down');
  m.update(STEP_MS / 2);
  assert.deepEqual(m.cell, { col: 6, row: 6 }); // reached (6, 5), then turned down straight away
  assert.equal(m.facing, 'down');
  m.release('down');
  m.update(STEP_MS / 2);
  assert.equal(m.facing, 'down'); // still finishing the step already underway
  m.update(STEP_MS);
  assert.equal(m.facing, 'right');
});

test('a tap during a step is walked next rather than lost', () => {
  let m = mover();
  m.press('right');
  m.release('right');
  m.update(STEP_MS / 2);
  m.press('down');
  m.release('down');
  m.update(STEP_MS * 10);
  assert.deepEqual(m.cell, { col: 6, row: 6 });
});

test('a board edge blocks the step but still turns to face it', () => {
  let m = mover(mapGrid(), { cell: { col: 0, row: 0 }, facing: 'down' });
  m.press('up');
  m.update(STEP_MS * 3);
  assert.deepEqual(m.cell, { col: 0, row: 0 });
  assert.equal(m.facing, 'up');
  assert.equal(m.isMoving, false);
});

test('walking into an edge stops there, then a new direction moves on', () => {
  let m = mover();
  m.press('left');
  m.update(STEP_MS * 100);
  assert.deepEqual(m.cell, { col: 0, row: 5 });
  assert.equal(m.isMoving, false);
  m.press('down');
  m.update(STEP_MS / 2);
  assert.deepEqual(m.cell, { col: 0, row: 6 });
});

test('canEnter can block a step, as an obstacle would', () => {
  let wall = { col: 7, row: 5 };
  let m = mover(mapGrid(), { canEnter: (from, to) => !(to.col === wall.col && to.row === wall.row) });
  m.press('right');
  m.update(STEP_MS * 10);
  assert.deepEqual(m.cell, { col: 6, row: 5 });
  assert.equal(m.isMoving, false);
});

test('canEnter is told where the step starts, ends, and which way, as a pushable box would need', () => {
  let seen = [];
  let m = mover(mapGrid(), { canEnter: (from, to, direction) => { seen.push({ from, to, direction }); return true; } });
  m.press('up');
  m.release('up');
  m.update(STEP_MS);
  assert.deepEqual(seen, [{ from: { col: 5, row: 5 }, to: { col: 5, row: 4 }, direction: 'up' }]);
});

test('clearQueue forgets a waiting press but keeps a held direction', () => {
  let m = mover();
  m.press('right');
  m.release('right');
  m.clearQueue();
  m.update(STEP_MS * 5);
  assert.deepEqual(m.cell, { col: 5, row: 5 });

  m.press('down');
  m.clearQueue();
  m.update(STEP_MS / 2);
  assert.deepEqual(m.cell, { col: 5, row: 6 });
});

test('releaseAll stops walking at the next square', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS / 2);
  m.releaseAll();
  m.update(STEP_MS * 10);
  assert.deepEqual(m.cell, { col: 6, row: 5 });
});

test('finishStep finishes the step underway but starts nothing new, leaving presses waiting', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS / 2);
  m.release('right');
  m.press('down'); // a tap during the step
  m.release('down');

  m.finishStep(STEP_MS * 10);
  assert.deepEqual(m.cell, { col: 6, row: 5 });
  assert.equal(m.isMoving, false);

  m.finishStep(STEP_MS * 10);
  assert.deepEqual(m.cell, { col: 6, row: 5 });

  m.update(STEP_MS / 2);
  assert.deepEqual(m.cell, { col: 6, row: 6 });
});

test('the same code drives a 10x10 board over 240px album art at any whole-number scale', () => {
  for (let scale of [1, 2, 3]) {
    let cell = 24 * scale;
    let grid = createGrid({ columns: 10, rows: 10, cellWidth: cell, cellHeight: cell });
    assert.deepEqual(grid.centerOf({ col: 9, row: 9 }), { x: 240 * scale - cell / 2, y: 240 * scale - cell / 2 });

    let m = createMover(grid, { cell: { col: 0, row: 0 }, stepMs: STEP_MS });
    m.press('right');
    m.update(STEP_MS * 100);
    m.release('right');
    assert.deepEqual(m.cell, { col: 9, row: 0 });
  }
});
