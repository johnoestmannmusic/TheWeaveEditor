// sokoban.js
// John Oestmann
// Sokoban-style grid movement: a board of squares, and something that walks between them. Knows
// nothing about the DOM, keyboards, or The Weave's maps - callers feed in pixel geometry and
// pressed/released directions, then read back a position to draw. main.js uses this to walk the
// ship around a page's map; anything else on a grid (a smaller board, obstacles, pushable boxes)
// can build its own grid and mover from the same two functions.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated
// into every exported site's jsx/sokoban.js, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WeaveSokoban = factory();
})(this, function () {

  const DIRECTION_DELTAS = {
    up: { col: 0, row: -1 },
    down: { col: 0, row: 1 },
    left: { col: -1, row: 0 },
    right: { col: 1, row: 0 },
  };

  // A board of columns x rows squares, cells being plain { col, row } objects. originX/originY are
  // the top-left corner of square (0, 0), in whatever pixel space the caller draws in.
  function createGrid({ columns, rows, cellWidth, cellHeight, originX = 0, originY = 0 }) {

    function clamp(value, max){
      return Math.max(0, Math.min(max, value));
    }

    function inBounds(cell){
      return cell.col >= 0 && cell.col < columns && cell.row >= 0 && cell.row < rows;
    }

    return {
      columns,
      rows,
      cellWidth,
      cellHeight,
      inBounds,

      centerOf(cell){
        return {
          x: originX + (cell.col + 0.5) * cellWidth,
          y: originY + (cell.row + 0.5) * cellHeight,
        };
      },

      // The square nearest to a pixel position - clamped onto the board, so this always returns a
      // real square even for a point outside it.
      cellAt(x, y){
        return {
          col: clamp(Math.floor((x - originX) / cellWidth), columns - 1),
          row: clamp(Math.floor((y - originY) / cellHeight), rows - 1),
        };
      },

      // The square one step away in a direction ('up'/'down'/'left'/'right'), or null off the board.
      neighbor(cell, direction){
        let delta = DIRECTION_DELTAS[direction];
        let next = { col: cell.col + delta.col, row: cell.row + delta.row };
        return inBounds(next) ? next : null;
      },
    };
  }

  // Something that walks a grid one square at a time. Directions are fed in as press/release events
  // and update(dtMs) advances it, so it never needs to know what's actually doing the pressing.
  //
  // - Holding a direction keeps walking at a constant speed. Time left over from finishing one step
  //   carries into the next, so a long hold never hitches at a square boundary.
  // - Releasing finishes the step in progress, then stops dead center on that square.
  // - With several directions held, the most recently pressed wins.
  // - A press is never lost, even one too quick to span a single update - it's remembered and
  //   walked at the next opportunity, which is what makes a tap reliably move exactly one square.
  //
  // canEnter(from, to, direction) is the hook for anything that can block a step (walls, or a box
  // that can only be pushed if there's room behind it). A blocked step only turns to face that way.
  // onArrive(cell) is called on finishing each step, for anything that happens on reaching a square.
  function createMover(grid, { cell, stepMs, canEnter = () => true, onArrive = () => {}, facing = 'up' }) {

    let current = cell;
    let target = null;
    let elapsed = 0;
    let heldDirections = [];
    let queuedDirection = null;

    function beginNextStep(){
      let direction = queuedDirection ?? heldDirections[heldDirections.length - 1] ?? null;
      queuedDirection = null;
      if (!direction) return false;

      facing = direction;
      let next = grid.neighbor(current, direction);
      if (!next || !canEnter(current, next, direction)) return false;

      target = next;
      elapsed = 0;
      return true;
    }

    // Spends time on the step underway, returning however much was left over from finishing it.
    function advanceStep(dtMs){
      let left = stepMs - elapsed;
      if (dtMs < left) {
        elapsed += dtMs;
        return 0;
      }
      current = target;
      target = null;
      onArrive(current);
      return dtMs - left;
    }

    return {
      // The square being stood on, or walked to while isMoving.
      get cell(){ return target ?? current; },
      get facing(){ return facing; },
      get isMoving(){ return target !== null; },
      // Whether anything's asking it to move: a direction held, or a press still waiting for its step.
      get hasInput(){ return heldDirections.length > 0 || queuedDirection !== null; },

      get position(){
        let from = grid.centerOf(current);
        if (!target) return from;
        let to = grid.centerOf(target);
        let t = elapsed / stepMs;
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      },

      press(direction){
        if (heldDirections.includes(direction)) return;
        heldDirections.push(direction);
        queuedDirection = direction;
      },

      release(direction){
        heldDirections = heldDirections.filter(d => d !== direction);
      },

      // Asks for one step in a direction as if it had been tapped, for something other than the
      // player moving this along, like a conveyor belt.
      queue(direction){
        queuedDirection = direction;
      },

      // Jumps straight to a square. Anything held carries on from there.
      teleport(destination){
        current = destination;
        target = null;
        elapsed = 0;
      },

      // Forgets everything pressed so far, e.g. when focus is lost and a release may never arrive.
      releaseAll(){
        heldDirections = [];
        queuedDirection = null;
      },

      // Forgets presses waiting for their step, but not what's still held - for a caller that's
      // temporarily stopped calling update() and doesn't want those presses to fire afterward.
      clearQueue(){
        queuedDirection = null;
      },

      update(dtMs){
        let remaining = dtMs;
        while (target || beginNextStep()) {
          remaining = advanceStep(remaining);
          if (target) return;
        }
      },

      // Like update(), but only ever finishes the step already underway - nothing new starts, and
      // presses keep waiting. For when something else needs the mover to hold still for a moment.
      finishStep(dtMs){
        if (target) advanceStep(dtMs);
      },
    };
  }

  return { createGrid, createMover };
});
