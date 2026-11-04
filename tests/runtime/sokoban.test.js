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

test('a grid reports the size of its squares', () => {
  assert.equal(mapGrid().cellWidth, 150);
  assert.equal(mapGrid().cellHeight, 150);
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

test('onArrive is told about each square as it is reached', () => {
  let reached = [];
  let m = mover(mapGrid(), { onArrive: (cell) => reached.push(cell) });
  m.press('right');
  m.update(STEP_MS * 2.5);
  m.release('right');
  assert.deepEqual(reached, [{ col: 6, row: 5 }, { col: 7, row: 5 }]);
  m.update(STEP_MS);
  assert.deepEqual(reached[2], { col: 8, row: 5 });
});

test('queueing from onArrive continues straight on, with no time lost', () => {
  let m;
  m = mover(mapGrid(), { onArrive: (cell) => { if (cell.col < 8) m.queue('right'); } });
  m.queue('right');
  m.update(STEP_MS * 2.5);
  let start = mapGrid().centerOf({ col: 5, row: 5 });
  assert.deepEqual(m.position, { x: start.x + 150 * 2.5, y: start.y });
});

test('queue asks for one step, like a tap, without anything being held', () => {
  let m = mover();
  m.queue('down');
  m.update(STEP_MS);
  m.update(STEP_MS);
  assert.deepEqual(m.cell, { col: 5, row: 6 });
  assert.equal(m.isMoving, false);
});

test('a queued step still has to be allowed', () => {
  let m = mover(mapGrid(), { canEnter: () => false });
  m.queue('down');
  m.update(STEP_MS);
  assert.deepEqual(m.cell, { col: 5, row: 5 });
});

test('teleport jumps straight to a square, even from onArrive, and whatever is held carries on from there', () => {
  let m;
  m = mover(mapGrid(), { onArrive: (cell) => { if (cell.col === 6) m.teleport({ col: 0, row: 0 }); } });
  m.press('right');
  m.update(STEP_MS);
  assert.deepEqual(m.position, mapGrid().centerOf({ col: 0, row: 0 }));
  m.release('right');
  m.update(STEP_MS);
  assert.deepEqual(m.cell, { col: 1, row: 0 });
  assert.equal(m.isMoving, false);
});

test('teleporting mid-step abandons that step', () => {
  let m = mover();
  m.press('right');
  m.update(STEP_MS / 2);
  m.release('right');
  m.teleport({ col: 2, row: 2 });
  assert.equal(m.isMoving, false);
  m.update(STEP_MS);
  assert.deepEqual(m.cell, { col: 2, row: 2 });
});

// ---------- exploring ----------

const { cellsWithin, encodeCells, decodeCells, edgeOf } = require('../../src/TheWeave.Exporter/runtime/sokoban.js');

const planet = () => createGrid({ columns: 20, rows: 10, cellWidth: 150, cellHeight: 150, originX: 0, originY: 150 });

test('a reach of 3.5 is a circle 3, 3, 2 and 1 squares out', () => {
  let keys = new Set(cellsWithin(planet(), { col: 10, row: 5 }, 3.5).map(c => c.col + ',' + c.row));
  let across = (row) => [...keys].filter(k => k.endsWith(',' + row)).length;
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map(across), [3, 5, 7, 7, 7, 5, 3]);
  assert.equal(keys.size, 37);
});

test('the circle stops at the edges of the grid', () => {
  let cells = cellsWithin(planet(), { col: 0, row: 0 }, 3.5);
  assert.ok(cells.every(c => c.col >= 0 && c.row >= 0));
  assert.equal(cells.length, 4 + 4 + 3 + 2);
});

test('explored squares save and load, and a save for another size of grid is nothing', () => {
  let grid = planet();
  let cells = new Set(['0,0', '19,9', '7,3']);
  let text = encodeCells(grid, cells);
  assert.equal(text.length, 200);
  assert.deepEqual(decodeCells(grid, text), cells);
  assert.equal(decodeCells(grid, '101').size, 0);
  assert.equal(decodeCells(grid, null).size, 0);
});

test('the edge is every unexplored square touching an explored one, diagonals included', () => {
  let edge = edgeOf(planet(), new Set(['5,5', '6,5']));
  assert.equal(edge.size, 10);
  assert.ok(edge.has('4,4') && edge.has('7,6') && !edge.has('5,5'));
  assert.equal(edgeOf(planet(), new Set(['0,0'])).size, 3);
});
