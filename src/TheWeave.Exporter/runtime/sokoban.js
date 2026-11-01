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
  //
  // gapColumns lists columns that have one square's width of unplayable space immediately to their
  // left - e.g. the second sector of a double map, whose own label column sits between the two
  // grids. Walking across a gap is a single step, just proportionally longer (see stepLength).
  function createGrid({ columns, rows, cellWidth, cellHeight, originX = 0, originY = 0, gapColumns = [] }) {

    let columnCenters = [];
    for (let col = 0, gapsPassed = 0; col < columns; col++) {
      if (gapColumns.includes(col)) gapsPassed++;
      columnCenters.push(originX + (col + gapsPassed + 0.5) * cellWidth);
    }

    function rowCenter(row){
      return originY + (row + 0.5) * cellHeight;
    }

    function inBounds(cell){
      return cell.col >= 0 && cell.col < columns && cell.row >= 0 && cell.row < rows;
    }

    return {
      columns,
      rows,
      inBounds,

      centerOf(cell){
        return { x: columnCenters[cell.col], y: rowCenter(cell.row) };
      },

      // The square nearest to a pixel position - clamped onto the board, so this always returns a
      // real square even for a point outside it.
      cellAt(x, y){
        let col = 0;
        for (let i = 1; i < columns; i++) {
          if (Math.abs(columnCenters[i] - x) < Math.abs(columnCenters[col] - x)) col = i;
        }
        let row = Math.floor((y - originY) / cellHeight);
        return { col, row: Math.max(0, Math.min(rows - 1, row)) };
      },

      // The square one step away in a direction ('up'/'down'/'left'/'right'), or null off the board.
      neighbor(cell, direction){
        let delta = DIRECTION_DELTAS[direction];
        let next = { col: cell.col + delta.col, row: cell.row + delta.row };
        return inBounds(next) ? next : null;
      },

      // How long a step between two neighboring squares is, in squares: 1, or 2 across a gap column.
      stepLength(from, to){
        return from.col === to.col
          ? Math.abs(rowCenter(to.row) - rowCenter(from.row)) / cellHeight
          : Math.abs(columnCenters[to.col] - columnCenters[from.col]) / cellWidth;
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
  function createMover(grid, { cell, stepMs, canEnter = () => true, facing = 'up' }) {

    let current = cell;
    let target = null;
    let elapsed = 0;
    let duration = 0;
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
      duration = stepMs * grid.stepLength(current, next);
      return true;
    }

    // Spends time on the step underway, returning however much was left over from finishing it.
    function advanceStep(dtMs){
      let left = duration - elapsed;
      if (dtMs < left) {
        elapsed += dtMs;
        return 0;
      }
      current = target;
      target = null;
      return dtMs - left;
    }

    return {
      // The square being stood on, or walked to while isMoving.
      get cell(){ return target ?? current; },
      get facing(){ return facing; },
      get isMoving(){ return target !== null; },

      get position(){
        let from = grid.centerOf(current);
        if (!target) return from;
        let to = grid.centerOf(target);
        let t = elapsed / duration;
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
