// What the Editor's playtest actually puts on the canvas, drawn through the real script with a recording context - the
// board art itself is stubbed out, so only the things drawn over it (the line of sight, the refusal flash) are seen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WeavePuzzle = require('../../src/TheWeave.Exporter/runtime/puzzle.js');
const WeaveBoard = require('../../src/TheWeave.Exporter/runtime/board.js');

const REFLECT_MIMIC = { id: 'reflect-mimic', name: 'Reflect Mimic', parts: [{ kind: 'Reflect' }] };
const obj = (kind, col, row, extra = {}) => ({ kind, col, row, ...extra });
const pane = (col, row) => obj('Archeton', col, row, { archeton: 'reflect-mimic', direction: 'Right' });

function makeContext(calls) {
  const context = {
    calls,
    canvas: { width: 240, height: 240 },
    save() {}, restore() {}, clearRect() {}, putImageData() {}, translate() {}, rotate() {}, drawImage() {},
    fillRect() {},
    strokeRect() { calls.push({ op: 'strokeRect', style: context.strokeStyle, width: context.lineWidth }); },
    beginPath() { context.path = []; },
    moveTo(x, y) { context.path.push(['move', x, y]); },
    lineTo(x, y) { context.path.push(['line', x, y]); },
    stroke() { calls.push({ op: 'stroke', style: context.strokeStyle, width: context.lineWidth, path: context.path }); },
    setLineDash(dash) { context.dash = dash; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData() { return { width: 24, height: 24, data: new Uint8ClampedArray(24 * 24 * 4) }; },
    imageSmoothingEnabled: false, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '', strokeStyle: '', lineWidth: 1, dash: null,
  };
  return context;
}

function loadPlaytest() {
  const element = {
    addEventListener() {}, textContent: '', hidden: true, classList: { add() {}, remove() {} }, style: {},
    getContext: () => makeContext([]),
  };
  const puzzleEditor = { playtest: null, shipImage: null, image: null };
  const sandbox = {
    console, Math, Map, Set, JSON, Date,
    document: { getElementById: () => element, createElement: () => element, addEventListener() {}, body: element },
    window: null,
    puzzleEditor, project: { archetons: [REFLECT_MIMIC] },
    // the board art is not the subject here
    WeavePuzzle: { ...WeavePuzzle, renderBoard: () => {} },
    WeaveBoard,
    PUZZLE_ART_PX: WeavePuzzle.ART_PX, PUZZLE_TILE_PX: WeavePuzzle.TILE_PX,
    PUZZLE_SHIP_WIDTH: 20, PUZZLE_SHIP_HEIGHT: 20,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.requestAnimationFrame = () => 0;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/TheWeave.EditorApp/wwwroot/puzzlePlaytest.js'), 'utf8'), sandbox);

  // draws one frame of a play and hands back everything it stroked
  return (play) => {
    const calls = [];
    puzzleEditor.playtest = { objects: [], play, lastMs: null, drawnKey: null };
    sandbox.drawPlaytest(makeContext(calls), {}, 0);
    return calls.filter((call) => call.op === 'stroke');
  };
}

const draw = loadPlaytest();

test('the line of sight is drawn from the ship to its reflection whenever there is one', () => {
  const play = WeaveBoard.createBoardPlay({ puzzle: { objects: [pane(5, 5), obj('Start', 2, 5)], archetons: [REFLECT_MIMIC] } });
  const strokes = draw(play);
  assert.equal(strokes.length, 1, 'one line, at rest');
  assert.equal(strokes[0].style, 'rgba(255, 154, 60, 0.1)', 'a tenth of full strength, so it sits behind the board');
  assert.deepEqual(strokes[0].path, [['move', 2.5 * WeavePuzzle.TILE_PX, 5.5 * WeavePuzzle.TILE_PX], ['line', 8.5 * WeavePuzzle.TILE_PX, 5.5 * WeavePuzzle.TILE_PX]], 'ship centre to reflection centre');
});

test('the line is drawn with nothing in the way, refused or not', () => {
  const play = WeaveBoard.createBoardPlay({ puzzle: { objects: [pane(5, 5), obj('Start', 2, 5)], archetons: [REFLECT_MIMIC] } });
  assert.equal(draw(play).length, 1, 'standing still');
  play.mover.press('right');
  for (let i = 0; i < 6; i++) play.step(16);
  assert.equal(draw(play).length, 1, 'and mid-step, so it stretches rather than snapping');
});

test('a refused step takes the line to full strength, from the same two points', () => {
  const play = WeaveBoard.createBoardPlay({
    puzzle: { objects: [pane(5, 5), obj('Start', 2, 5), obj('Wall', 9, 5)], archetons: [REFLECT_MIMIC] },
  });
  play.mover.press('left');
  for (let i = 0; i < 40; i++) play.step(16);
  assert.deepEqual(play.mover.cell, at(2, 5), 'the ship stays, the reflection has nowhere to go');
  const [line] = draw(play);
  assert.equal(line.style, 'rgba(255, 154, 60, 0.8)', 'and the line says why');
  assert.deepEqual(line.path, [['move', 2.5 * WeavePuzzle.TILE_PX, 5.5 * WeavePuzzle.TILE_PX], ['line', 8.5 * WeavePuzzle.TILE_PX, 5.5 * WeavePuzzle.TILE_PX]]);
});

test('a pane whose sight is blocked gets a line that stops at whatever is in the way', () => {
  const play = WeaveBoard.createBoardPlay({
    puzzle: { objects: [pane(5, 5), obj('Start', 2, 5), obj('Wall', 4, 5)], archetons: [REFLECT_MIMIC] },
  });
  assert.equal(play.game.reflections.length, 0, 'the pane shows nothing');
  const [line] = draw(play);
  assert.equal(line.style, 'rgba(255, 154, 60, 0.35)', 'still drawn, still orange');
  assert.deepEqual(line.path, [
    ['move', 2.5 * WeavePuzzle.TILE_PX, 5.5 * WeavePuzzle.TILE_PX],
    ['line', 4.5 * WeavePuzzle.TILE_PX, 5.5 * WeavePuzzle.TILE_PX],
  ], 'from the ship as far as the Wall');
});

function at(col, row) {
  return { col, row };
}
