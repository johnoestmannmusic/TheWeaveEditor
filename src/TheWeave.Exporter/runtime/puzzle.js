// puzzle.js
// John Oestmann
// Sokoban puzzles played over a track's album art: what each object looks like, what colours they're
// drawn in, the rules for placing them on a board, and the rules for playing one. Knows nothing about
// the DOM - callers pass in plain pixel data, and get plain pixel data back. Shared by the Editor's
// Puzzle Editor and the exported site, so that a puzzle looks the same in both.
//
// Split by concern into puzzleRules.js, puzzleColours.js and puzzleDrawing.js, loaded in that order before this,
// which brings their public parts together as WeavePuzzle.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into
// every exported site's jsx/puzzle.js, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./puzzleRules.js'), require('./puzzleColours.js'), require('./puzzleDrawing.js'));
  else root.WeavePuzzle = factory(root.WeavePuzzleRules, root.WeavePuzzleColours, root.WeavePuzzleDrawing);
})(this, function (rules, colours, drawing) {
  const PUBLIC = ['BOARD_SIZE', 'DEFAULT_START', 'LETTERS', 'TILE_PX', 'ART_PX', 'placeObject', 'eraseObject', 'exitDirectionOf', 'entranceFrom', 'entranceAfter', 'blockingEntrance', 'suggestLetter', 'pickPalette', 'pickTextures', 'renderBoard', 'hasFinish', 'createPuzzleGame', 'RESET_FADE_MS', 'RESET_SWEEP_STEP_MS', 'resetSweepMs', 'resetSweepAt', 'spinAt', 'SPIN_STEPS', 'PULSE_REACH_PX', 'BOARD_TIMING', 'PAINTS', 'DRAWN_KINDS', 'ANIMATED_KINDS', 'TURNED_KINDS', 'SYMBOLS', 'SPRITE_ROLES', 'TEXTURE_SHADES', 'standardDrawing', 'standardMix', 'mixTexture', 'renderDrawingLayer', 'RAISED_PX'];
  const parts = { ...rules, ...colours, ...drawing };
  return Object.fromEntries(PUBLIC.map(name => [name, parts[name]]));
});
