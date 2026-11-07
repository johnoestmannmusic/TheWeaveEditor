// puzzleRules.js
// John Oestmann
// The rules of a Sokoban puzzle: placing objects on a board, boards that connect edge to edge, playing one
// (createPuzzleGame), how long things take on a board, and a Reset Switch's sweep.
// Knows nothing about the DOM. One of the parts of WeavePuzzle, brought together by puzzle.js - see there.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into every exported
// site's jsx/ folder, and linked into the Editor, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WeavePuzzleRules = factory();
})(this, function () {

  const BOARD_SIZE = 10;
  // Where the ship begins on a board that hasn't said otherwise.
  const DEFAULT_START = { col: 5, row: 9 };
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const DIRECTION_DELTAS = {
    Up: { x: 0, y: -1 },
    Down: { x: 0, y: 1 },
    Left: { x: -1, y: 0 },
    Right: { x: 1, y: 0 },
  };

  function isAt(object, cell){
    return object.col === cell.col && object.row === cell.row;
  }

  // A tile things sit on, rather than a thing itself. A square holds one of these plus one object.
  function isFloor(object){
    return object.kind === 'Stream' || object.kind === 'RotatorTile' || object.kind === 'Pipe';
  }

  // ---------- placing objects ----------

  // A board with one more object on it, leaving the original alone. A square holds one object plus
  // optionally a floor tile under it, so anything new replaces only what it would otherwise share the
  // square with, and there's only ever one Start. The ship always needs somewhere to begin, so nothing
  // else can replace Start - it has to be moved out of the way first.
  function placeObject(objects, object){
    let floor = isFloor(object);
    if (!floor && object.kind !== 'Start' && objects.some(other => other.kind === 'Start' && isAt(other, object))) return objects;
    return [
      ...objects.filter(other => {
        if (object.kind === 'Start' && other.kind === 'Start') return false;
        return !(isAt(other, object) && isFloor(other) === floor);
      }),
      object,
    ];
  }

  // A board with the top thing on a square removed: an object first, then the floor tile it was on. Start
  // stays, for the same reason it can't be replaced.
  function eraseObject(objects, cell){
    let here = objects.filter(other => isAt(other, cell) && other.kind !== 'Start');
    let top = here.find(other => !isFloor(other)) ?? here[0];
    return objects.filter(other => other !== top);
  }

  // ---------- connected boards ----------

  // A location's parts connect edge to edge, like screens of a map: a Finish on an edge leads off it, and the
  // ship comes in on the opposite edge of the next part's board, directly across. Shared with
  // TheWeave.Core's PuzzleConnection.

  // Which way a square leads off the board, or null in the middle, or in a corner, which would point two ways.
  function exitDirectionOf(cell){
    let last = BOARD_SIZE - 1;
    let onSide = cell.col === 0 || cell.col === last;
    let onTopOrBottom = cell.row === 0 || cell.row === last;
    if (onSide === onTopOrBottom) return null;
    if (onSide) return cell.col === 0 ? 'Left' : 'Right';
    return cell.row === 0 ? 'Up' : 'Down';
  }

  // Where the ship comes in on the next board after leaving through an edge square.
  function entranceFrom(cell){
    let last = BOARD_SIZE - 1;
    switch (exitDirectionOf(cell)) {
      case 'Left': return { col: last, row: cell.row };
      case 'Right': return { col: 0, row: cell.row };
      case 'Up': return { col: cell.col, row: last };
      case 'Down': return { col: cell.col, row: 0 };
    }
    return null;
  }

  // Where the ship comes in on the board after this puzzle's, or null if it doesn't lead on: it needs exactly
  // one Finish, on an edge.
  function entranceAfter(puzzle){
    let finishes = (puzzle?.objects ?? []).filter(object => object.kind === 'Finish');
    return finishes.length === 1 ? entranceFrom(finishes[0]) : null;
  }

  // Whatever is in the way of the ship coming in at a square: anything but a floor tile or Start.
  function blockingEntrance(objects, entrance){
    return objects.find(object => isAt(object, entrance) && !isFloor(object) && object.kind !== 'Start') ?? null;
  }

  // The letter a new object most likely wants: a Teleporter's unfinished pair, a Gate's missing Switch,
  // or otherwise the first letter that kind hasn't used.
  function suggestLetter(objects, kind){
    let letters = (wanted) => objects.filter(o => o.kind === wanted).map(o => o.letter);
    let firstUnused = (...used) => LETTERS.find(letter => !used.flat().includes(letter)) ?? LETTERS[0];

    if (kind === 'Teleporter') {
      let teleporters = letters('Teleporter');
      return teleporters.find(letter => teleporters.filter(l => l === letter).length === 1) ?? firstUnused(teleporters);
    }

    let gates = letters('Gate');
    let switches = letters('Switch');
    if (kind === 'Switch') return gates.find(letter => !switches.includes(letter)) ?? firstUnused(gates, switches);
    return switches.find(letter => !gates.includes(letter)) ?? firstUnused(gates, switches);
  }

  // ---------- playing ----------

  const OPPOSITES = { Up: 'Down', Down: 'Up', Left: 'Right', Right: 'Left' };
  // How far a lit Lantern reaches, in squares from its own. A little past 3 makes it read as a circle on a
  // grid of squares: each row outward from it reaches 3, 3, 2 and 1 squares to either side.
  const LANTERN_REACH = 3.5;
  // How many Jump Tiles can launch the ship one after another before the next one lets it stay.
  const MAX_JUMPS_IN_A_ROW = 8;
  // sokoban.js's directions are lower case, and a puzzle's are capitalized as they are in the project file.
  const MOVER_DIRECTIONS = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' };
  const PUZZLE_DIRECTIONS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };

  // Whether a puzzle can be solved at all, which is what decides if it can hold anything back.
  function hasFinish(puzzle){
    return !!puzzle && puzzle.objects.some(object => object.kind === 'Finish');
  }

  // One playthrough of a puzzle. Holds where everything is, and answers what happens next - the caller
  // owns the ship's actual movement, through sokoban.js's canEnter and onArrive hooks.
  function createPuzzleGame(puzzle) {
    let streams = new Map();
    let rotators = new Map();
    // Each Pipe's floor tile by its square, its direction changing as Pipe Switches turn it.
    let pipes = new Map();
    let floors = [];
    let start = { col: DEFAULT_START.col, row: DEFAULT_START.row };

    for (const object of puzzle.objects) {
      if (object.kind === 'Start') {
        start = { col: object.col, row: object.row };
      } else if (object.kind === 'Pipe') {
        let pipe = { ...object, revealed: false, startDirection: object.direction };
        pipes.set(cellKey(object), pipe);
        floors.push(pipe);
      } else if (isFloor(object)) {
        (object.kind === 'Stream' ? streams : rotators).set(cellKey(object), object.direction);
        floors.push({ ...object, revealed: false });
      }
    }

    // Every object as the puzzle starts, which is also what a Reset Switch puts back. Each keeps its place in the
    // puzzle's list as its index, so it can be matched up with itself before and after a reset.
    function startingObjects(){
      return puzzle.objects.flatMap((object, index) => object.kind === 'Start' || isFloor(object) ? []
        : [{ ...object, index, fromCol: object.col, fromRow: object.row, open: !!object.open, revealed: false, lit: false }]);
    }

    let objects = startingObjects();

    let shipCell = start;
    // Goes up whenever anything on the board changes, so that whatever's worked out from it, or drawn from it, can
    // be kept until it does - see beamPaths, and board.js's frame.
    let version = 0;
    let beamCache = new Map();
    // The square the ship last arrived from, for a Block's laser to send it back to - see sentBackByBeam.
    let previousShipCell = null;
    let solved = false;
    // How many Jump Tiles in a row the ship has been launched from, so two facing each other can't go on forever.
    let jumpsInARow = 0;

    function cellKey(cell){
      return cell.col + "," + cell.row;
    }

    // What's on a square. A Push Block can sit in an open Gate, sharing its square, and then it's the block that
    // counts: that's what's in the way, gets pushed, or stops a beam.
    // What's on a square. Two can share one: a Push Block in an open Gate, or a Slide Bug sliding over a Switch, say.
    // Then it's the solid one that counts - what's in the way, gets pushed, or stops a beam - then anything but a Gate.
    function objectAt(cell){
      return objects.find(object => isAt(object, cell) && isSolid(object))
        ?? objects.find(object => isAt(object, cell) && object.kind !== 'Gate')
        ?? objects.find(object => isAt(object, cell))
        ?? null;
    }

    function switchesActive(){
      return !objects.some(object => object.kind === 'Key');
    }

    function isSolid(object){
      return object.kind === 'Wall' || object.kind === 'PushBlock' || object.kind === 'Archeton' || (object.kind === 'Gate' && !object.open);
    }

    // ---------- Archetons ----------

    // Each Archeton's parts, by its definition's id - see TheWeave.Core's ArchetonDefinition.
    let archetonDefinitions = new Map((puzzle.archetons ?? []).map(definition => [definition.id, definition]));
    const ALL_WAYS = ['Up', 'Down', 'Left', 'Right'];

    // Whether a Beam stops at a square: Walls, closed Gates and other Archetons always stop it, and Push Blocks if
    // it says so.
    function stopsBeam(cell, part){
      let there = objectAt(cell);
      if (!there) return false;
      if (there.kind === 'PushBlock') return part.blockedByBlocks !== false;
      return isSolid(there);
    }

    // Every way each Archeton's Beams look right now: { archeton, part, direction, pushes, blocks, cells }, cells being
    // the squares it reaches, walking out as far as its range until something stops it. It ends at the ship, if it
    // reaches it, unless throughShip, for where it would reach with the ship out of the way.
    function beamPaths(throughShip = false){
      // Worked out once for each state of the board, however often it's asked - see version.
      let cacheKey = version + (throughShip ? '+' : '-');
      if (beamCache.has(cacheKey)) return beamCache.get(cacheKey);
      if (beamCache.size > 4) beamCache.clear();
      let paths = [];
      for (const archeton of objects) {
        if (archeton.kind !== 'Archeton') continue;
        let parts = archetonDefinitions.get(archeton.archeton)?.parts ?? [];
        let pushes = parts.some(part => part.kind === 'Push');
        let blocks = parts.some(part => part.kind === 'Block');
        for (const part of parts) {
          if (part.kind !== 'Beam') continue;
          let ways = part.look === 'Facing' ? [archeton.direction ?? 'Right'] : ALL_WAYS;
          for (const direction of ways) {
            let cells = [];
            let cell = { col: archeton.col, row: archeton.row };
            for (let reach = 1; reach <= (part.range ?? 0); reach++) {
              cell = nextCell(cell, direction);
              if (!onBoard(cell) || stopsBeam(cell, part)) break;
              cells.push(cell);
              if (!throughShip && isAt(shipCell, cell)) break;
            }
            paths.push({ archeton, part, direction, pushes, blocks, cells });
          }
        }
      }
      beamCache.set(cacheKey, paths);
      return paths;
    }

    // Whether an Archeton with a Block keeps the ship from stepping onto a square, by a Beam reaching it.
    function blockedByBeam(cell){
      return beamPaths(true).some(path => path.blocks && path.cells.some(reached => isAt(reached, cell)));
    }

    // Which way a Block's laser sends the ship, if it's somehow ended up in its reach - pushing a Push Block that was
    // shielding it out of the way, say: back to the square it just came from, or failing that, away from the
    // Archeton along the beam. Null if it isn't in one, or can't go either way.
    function sentBackByBeam(cell){
      if (!isAt(shipCell, cell) || !blockedByBeam(cell)) return null;
      let back = previousShipCell;
      if (back && Math.abs(back.col - cell.col) + Math.abs(back.row - cell.row) === 1) {
        let direction = back.col > cell.col ? 'Right' : back.col < cell.col ? 'Left' : back.row > cell.row ? 'Down' : 'Up';
        if (canEnter(cell, back, MOVER_DIRECTIONS[direction])) return direction;
      }
      for (const path of beamPaths(true)) {
        if (!path.blocks || !path.cells.some(reached => isAt(reached, cell))) continue;
        if (canEnter(cell, nextCell(cell, path.direction), MOVER_DIRECTIONS[path.direction])) return path.direction;
      }
      return null;
    }

    // Whether the ship is in a Beam's reach, or one square off it.
    function nearPath(path){
      return path.cells.some(cell => Math.abs(cell.col - shipCell.col) + Math.abs(cell.row - shipCell.row) <= 1);
    }

    // Every Beam that reaches the ship right now: { archeton, part, from, to, direction, pushes }.
    function beamsOnShip(){
      return beamPaths()
        .filter(path => path.cells.some(cell => isAt(shipCell, cell)))
        .map(path => ({ ...path, from: { col: path.archeton.col, row: path.archeton.row }, to: shipCell }));
    }

    // Which way a Beam's Push sends the ship from its square, if one's reaching it and it can go that way.
    function pushedByBeam(cell){
      if (!isAt(shipCell, cell)) return null;
      for (const hit of beamsOnShip()) {
        if (hit.pushes && canEnter(cell, nextCell(cell, hit.direction), MOVER_DIRECTIONS[hit.direction])) return hit.direction;
      }
      return null;
    }

    // For sokoban.js's canEnter. A Stream holds a ship until it pushes it off: the only way to leave
    // one is the way it's going. It can't be stepped onto head-on either.
    function canEnter(from, to, moverDirection){
      if (!onBoard(to)) return false;
      let direction = PUZZLE_DIRECTIONS[moverDirection];
      let holding = streams.get(cellKey(from));
      if (holding && holding !== direction) return false;
      if (streams.get(cellKey(to)) === OPPOSITES[direction]) return false;
      if (!pipeAllows(from, direction) || !pipeAllows(to, direction)) return false;
      if (blockedByBeam(to)) return false;
      let object = objectAt(to);
      if (object?.kind === 'PushBlock') return !!pushedTo(object, direction);
      return !(object && isSolid(object));
    }

    // Whether moving along a direction is along a square's Pipe, if it has one: across a Pipe lying Left or Right, or up
    // and down one standing Up or Down. Anywhere without a Pipe allows any direction.
    function pipeAllows(cell, direction){
      let pipe = pipes.get(cellKey(cell));
      if (!pipe) return true;
      let across = (d) => d === 'Left' || d === 'Right';
      return across(pipe.direction) === across(direction);
    }

    // Every Pipe a quarter turn anticlockwise, which also turns it from lying across to standing up, or back.
    const ANTICLOCKWISE = { Right: 'Up', Up: 'Left', Left: 'Down', Down: 'Right' };
    function turnPipes(){
      if (pipes.size === 0) return null;
      version++;
      for (const pipe of pipes.values()) pipe.direction = ANTICLOCKWISE[pipe.direction] ?? 'Up';
      return { pipesTurned: true };
    }

    function onBoard(cell){
      return cell.col >= 0 && cell.col < BOARD_SIZE && cell.row >= 0 && cell.row < BOARD_SIZE;
    }

    // Where a Push Block would go if pushed along a direction: the next square, if it's on the board, has nothing
    // on it, and isn't a Stream flowing straight back at it. Otherwise null, and it can't be pushed.
    function pushedTo(block, direction){
      let to = nextCell(block, direction);
      let there = onBoard(to) ? objectAt(to) : null;
      let openGate = there?.kind === 'Gate' && there.open;
      if (!onBoard(to) || (there && !openGate) || streams.get(cellKey(to)) === OPPOSITES[direction]) return null;
      if (!pipeAllows(block, direction) || !pipeAllows(to, direction)) return null;
      return to;
    }

    // Push Blocks with the same symbol touching side by side sink into the ground together, two or more at a time.
    // Returns the ones that sank, taken off the board, or null if none did.
    function sinkMatches(){
      let blocks = objects.filter(object => object.kind === 'PushBlock');
      let sinking = new Set();
      for (const block of blocks) {
        for (const other of blocks) {
          let touching = Math.abs(block.col - other.col) + Math.abs(block.row - other.row) === 1;
          if (other !== block && touching && other.symbol === block.symbol) sinking.add(block).add(other);
        }
      }
      if (sinking.size === 0) return null;
      objects = objects.filter(object => !sinking.has(object));
      return [...sinking];
    }

    // Where a Jump Tile launches the ship: 2 squares along, or just 1 if it can't land that far, over whatever's
    // in between. Only somewhere on the board with nothing solid on it. Null if it can land on neither.
    function jumpFrom(tile){
      let delta = DIRECTION_DELTAS[tile.direction];
      for (const distance of [2, 1]) {
        let to = { col: tile.col + delta.x * distance, row: tile.row + delta.y * distance };
        let there = objectAt(to);
        if (onBoard(to) && !(there && isSolid(there)) && pipeAllows(to, tile.direction)) return to;
      }
      return null;
    }

    function nextCell(cell, direction){
      let delta = DIRECTION_DELTAS[direction];
      return { col: cell.col + delta.x, row: cell.row + delta.y };
    }

    // Everything within reach of a lit Lantern comes into view, and stays there.
    function revealLitAreas(){
      for (const lantern of objects) {
        if (!lantern.lit) continue;
        for (const thing of [...floors, ...objects]) {
          let dx = thing.col - lantern.col, dy = thing.row - lantern.row;
          if (dx * dx + dy * dy <= LANTERN_REACH * LANTERN_REACH) thing.revealed = true;
        }
      }
    }

    // What standing on a square does to the board, and where that leaves the ship: null, or
    // { teleportTo }, { jumpTo }, { finished }, { reset } (with the objects as they were), { pipesTurned } or { lit,
    // revealed } for the caller to act on. jumped says the ship landed here from a
    // Jump Tile, rather than walking or being carried.
    // What landing on a Switch, Lantern, Reset Switch or Pipe Switch does, whether it's the ship or a Slide Bug landing
    // there - see shipArrives and slideBugs. An event for the caller, or null.
    function trigger(object){
      switch (object.kind) {
        // A Gate that closes on a Push Block sitting in it sends the block back to the square it was pushed from, if
        // that's still clear. If it isn't, the block stays, and the square stays solid either way.
        case 'Switch': {
          if (!switchesActive()) return null;
          let returned = [];
          for (const gate of objects) {
            if (gate.kind !== 'Gate' || gate.letter !== object.letter) continue;
            gate.open = !gate.open;
            if (gate.open) continue;
            let block = objects.find(other => other.kind === 'PushBlock' && isAt(other, gate));
            let back = block?.cameFrom;
            if (!back || !onBoard(back) || objectAt(back) || isAt(shipCell, back)) continue;
            block.fromCol = block.col;
            block.fromRow = block.row;
            block.col = back.col;
            block.row = back.row;
            block.glide = 'return';
            returned.push(block);
          }
          if (returned.length === 0) return null;
          revealLitAreas();
          let sank = sinkMatches();
          return sank ? { returned, sank } : { returned };
        }

        // Lighting one says where, and what it brought into view, for its pulse to reveal as it spreads - see
        // renderBoard's pulses. One already lit does nothing more.
        case 'Lantern': {
          if (object.lit) return null;
          let hidden = [...floors, ...objects].filter(thing => !thing.revealed);
          object.lit = true;
          revealLitAreas();
          return { lit: { col: object.col, row: object.row }, revealed: hidden.filter(thing => thing.revealed) };
        }

        // Everything back as it started, but the ship: moved objects return, sunk blocks and collected Keys come
        // back, Gates close or open again, Lanterns go out, and what they revealed is hidden again.
        case 'ResetSwitch': {
          let before = objects;
          objects = startingObjects();
          for (const floor of floors) floor.revealed = false;
          for (const pipe of pipes.values()) pipe.direction = pipe.startDirection;
          return { reset: before };
        }

      }
      return null;
    }

    function shipArrives(cell, { jumped = false } = {}){
      version++;
      if (!isAt(shipCell, cell)) previousShipCell = shipCell;
      shipCell = cell;
      if (!jumped) jumpsInARow = 0;
      let object = objectAt(cell);
      if (!object) return null;

      switch (object.kind) {
        case 'Switch':
        case 'Lantern':
        case 'ResetSwitch':
        case 'PipeSwitch':
          return trigger(object);

        case 'Key':
          objects.splice(objects.indexOf(object), 1);
          return null;

        case 'Teleporter': {
          let partners = objects.filter(other => other.kind === 'Teleporter' && other.letter === object.letter);
          if (partners.length !== 2) return null;
          let partner = partners.find(other => other !== object);
          let destination = { col: partner.col, row: partner.row };
          shipCell = destination;
          return { teleportTo: destination };
        }

        case 'Finish':
          solved = true;
          return { finished: true };

        case 'PipeSwitch':
          return turnPipes();

        case 'JumpTile': {
          let landing = jumpFrom(object);
          if (!landing || jumpsInARow >= MAX_JUMPS_IN_A_ROW) return null;
          jumpsInARow++;
          shipCell = landing;
          return { jumpTo: landing };
        }
      }

      return null;
    }

    // Every Slide Bug takes its step, after the ship has: a square along its line towards the ship's column, or row -
    // its row when it faces Left or Right, its column facing Up or Down. Stopped by the board's edge, anything solid,
    // the ship itself, or a Pipe across its line, it waits there. Landing on a Switch, Lantern, Reset Switch or Pipe
    // Switch triggers it, as the ship would. { slid } and whatever they set off, or null if none moved.
    function slideBugs(){
      let slid = [];
      let set = {};
      for (const bug of objects.filter(object => object.kind === 'Archeton' && archetonDefinitions.get(object.archeton)?.parts?.some(part => part.kind === 'Slide'))) {
        let across = bug.direction !== 'Up' && bug.direction !== 'Down';
        let target = across ? shipCell.col : shipCell.row;
        let at = across ? bug.col : bug.row;
        if (target === at) continue;
        let direction = across ? (target > at ? 'Right' : 'Left') : (target > at ? 'Down' : 'Up');
        let to = nextCell(bug, direction);
        let there = onBoard(to) ? objectAt(to) : null;
        if (!onBoard(to) || isAt(shipCell, to) || (there && isSolid(there)) || !pipeAllows(bug, direction) || !pipeAllows(to, direction)) continue;

        bug.fromCol = bug.col;
        bug.fromRow = bug.row;
        bug.col = to.col;
        bug.row = to.row;
        bug.glide = 'slide';
        slid.push(bug);
        if (there) Object.assign(set, trigger(there) ?? {});
        // A Reset Switch puts every Slide Bug back where it started, so none of the rest move now.
        if (set.reset) break;
      }
      if (slid.length === 0) return null;
      version++;
      revealLitAreas();
      return { ...set, slid };
    }

    // The ship arriving on a square, then every Slide Bug following it a step - except when it's finished the board,
    // is about to land from a jump, when the bugs wait for it to land, or has reset the board, which put them back.
    function arriveAt(cell, options){
      let event = shipArrives(cell, options);
      if (event?.finished || event?.jumpTo || event?.reset) return event;
      let slid = slideBugs();
      if (!slid) return event;
      return event ? { ...slid, ...event } : slid;
    }


    // Which objects on a set of floor tiles can move this tick, all at once, so a full loop keeps
    // circulating. Starts from everything that might, then takes out whatever turns out to be blocked,
    // until what's left can all really go.
    function resolveMoves(track, occupiedByShip){
      let moves = new Map();
      for (const object of objects) {
        let direction = track.get(cellKey(object));
        if (!direction) continue;
        let to = nextCell(object, direction);
        if (track.has(cellKey(to))) moves.set(object, to);
      }

      let changed = true;
      while (changed) {
        changed = false;
        for (const [object, to] of moves) {
          let occupant = objectAt(to);
          let occupantLeaving = occupant && moves.has(occupant);
          let swapping = occupantLeaving && isAt(moves.get(occupant), object);
          let shipInTheWay = isSolid(object) && occupiedByShip.some(cell => isAt(cell, to));
          let contested = [...moves].some(([other, otherTo]) => other !== object && isAt(otherTo, to) && objects.indexOf(other) < objects.indexOf(object));

          if ((occupant && !occupantLeaving) || swapping || shipInTheWay || contested) {
            moves.delete(object);
            changed = true;
          }
        }
      }

      return moves;
    }

    // Moves everything on one set of floor tiles along by a square. shipHeadingTo is the square the ship
    // is stepping onto, if it's moving. Returns what something moving under a stationary ship did, in the
    // same form as shipArrivedAt.
    function moveAlong(track, glide, shipHeadingTo){
      for (const object of objects) {
        if (!track.has(cellKey(object))) continue;
        object.fromCol = object.col;
        object.fromRow = object.row;
        object.glide = glide;
      }

      let occupied = shipHeadingTo ? [shipCell, shipHeadingTo] : [shipCell];
      let moves = resolveMoves(track, occupied);
      if (moves.size > 0) version++;
      for (const [object, to] of moves) {
        object.col = to.col;
        object.row = to.row;
      }
      if (moves.size > 0) revealLitAreas();

      let sank = moves.size > 0 ? sinkMatches() : null;
      let cameUnder = !shipHeadingTo && [...moves.keys()].some(object => isAt(object, shipCell) && objects.includes(object));
      let arrived = cameUnder ? arriveAt(shipCell) : null;
      return sank ? { ...arrived, sank } : arrived;
    }

    return {
      start,
      get objects(){ return objects; },
      get shipCell(){ return shipCell; },
      get version(){ return version; },
      get isSolved(){ return solved; },
      get switchesActive(){ return switchesActive(); },
      // Whether the ship is on a Rotator Loop Switch, which is what makes Rotator tiles move.
      get onRotatorSwitch(){ return objectAt(shipCell)?.kind === 'RotatorSwitch'; },
      // Whether the ship is on a Pipe Switch, which turns the Pipes again each second it stays there.
      get onPipeSwitch(){ return objectAt(shipCell)?.kind === 'PipeSwitch'; },
      turnPipes,
      floors,

      canEnter,

      // The Archetons' Beams reaching the ship right now, { from, to }, for drawing their lasers.
      // A Beam that blocks shows its laser across its whole reach while the ship is in it or one square off it, and
      // any other shows it from its eye to the ship while it reaches the ship.
      get beams(){
        let blocking = beamPaths(true).filter(path => path.blocks && path.cells.length > 0 && nearPath(path))
          .map(path => ({ from: { col: path.archeton.col, row: path.archeton.row }, to: path.cells[path.cells.length - 1], archeton: path.archeton.archeton }));
        let hitting = beamsOnShip().filter(hit => !hit.blocks).map(hit => ({ from: hit.from, to: hit.to, archeton: hit.archeton.archeton }));
        return [...blocking, ...hitting];
      },
      // Every square an Archeton's Beam reaches right now, { col, row }, for outlining where it's dangerous to be.
      get reaches(){
        let seen = new Map();
        for (const path of beamPaths(true)) {
          if (path.part.showReach === false) continue;
          for (const cell of path.cells) seen.set(cellKey(cell), cell);
        }
        return [...seen.values()];
      },

      // Whether a Push Block can be pushed along a direction (sokoban.js's), for showing that it can.
      canPush(cell, moverDirection){
        let block = objectAt(cell);
        return block?.kind === 'PushBlock' && !!pushedTo(block, PUZZLE_DIRECTIONS[moverDirection]);
      },

      // For sokoban.js's onStepStart: the ship stepping into a Push Block pushes it on ahead, gliding along with
      // the ship - see renderBoard's pushAlong. Returns { sank } if that brought matching blocks together.
      pushFrom(from, to, moverDirection){
        version++;
        let block = objectAt(to);
        if (block?.kind !== 'PushBlock') return null;
        let next = pushedTo(block, PUZZLE_DIRECTIONS[moverDirection]);
        if (!next) return null;
        block.cameFrom = { col: block.col, row: block.row };
        block.fromCol = block.col;
        block.fromRow = block.row;
        block.glide = 'push';
        block.col = next.col;
        block.row = next.row;
        revealLitAreas();
        let sank = sinkMatches();
        return sank ? { sank } : null;
      },

      // Once a push has finished gliding, the block is simply where it is.
      settlePushes(){
        for (const object of objects) {
          if (object.glide !== 'push') continue;
          object.fromCol = object.col;
          object.fromRow = object.row;
        }
      },

      shipArrivedAt: arriveAt,

      // Puts the ship on a square without anything there happening, for coming back onto a board where it was.
      placeShip(cell){
        version++;
        shipCell = cell;
      },

      // Which way a Stream is carrying a ship on this square, as sokoban.js's direction, or null.
      // A Stream comes first, and otherwise an Archeton's Beam pushing it away, or a Block's laser sending it back
      // out of its reach, as long as it can go - see pushedByBeam and sentBackByBeam. Either way the caller moves the
      // ship along, a square at a time.
      carryDirection(cell){
        let direction = streams.get(cellKey(cell)) ?? pushedByBeam(cell) ?? sentBackByBeam(cell);
        return direction ? MOVER_DIRECTIONS[direction] : null;
      },

      tick: (shipHeadingTo) => moveAlong(streams, 'stream', shipHeadingTo),
      tickRotators: (shipHeadingTo) => moveAlong(rotators, 'rotator', shipHeadingTo),
    };
  }

  // ---------- timing ----------

  // How long things take on a board, shared by the game (main.js) and the Puzzle Editor's playtest, so that a puzzle
  // plays the same in both: a step, a Stream's and a Rotator tile's tick, a Pipe Switch's tick and the Pipes' swing,
  // a jump per square, a matched block sinking, and a lit Lantern's pulse spreading.
  const BOARD_TIMING = {
    stepMs: 180,
    streamTickMs: 360,
    rotatorTickMs: 1000,
    pipeTickMs: 1000,
    pipeTurnMs: 200,
    jumpMsPerSquare: 175,
    sinkMs: 500,
    pulseMs: 700,
  };

  // ---------- resetting ----------

  // A Reset Switch's sweep across the board, from the top-left corner to the bottom-right: as it passes each
  // object, the object fades out where it was, then fades back in where it started, each over RESET_FADE_MS. Each
  // diagonal of squares starts RESET_SWEEP_STEP_MS after the one before.
  const RESET_FADE_MS = 100;
  const RESET_SWEEP_STEP_MS = 20;

  // When the sweep reaches a square.
  function sweepReaches(object){
    return (Math.round(object.col) + Math.round(object.row)) * RESET_SWEEP_STEP_MS;
  }

  // Walls stay as they are, since nothing ever changes them.
  function sweeps(object){
    return object.kind !== 'Wall';
  }

  // When each object starting again (after) fades back in: once the sweep reaches where it starts, and once it's
  // faded out from where it was, if it was anywhere (before, matched by index).
  function fadesInAt(object, before){
    let was = before.find(other => other.index === object.index);
    return Math.max(sweepReaches(object), was ? sweepReaches(was) : 0) + RESET_FADE_MS;
  }

  // How long a whole sweep takes.
  function resetSweepMs(before, after){
    return Math.max(0, ...after.filter(sweeps).map(object => fadesInAt(object, before) + RESET_FADE_MS),
      ...before.filter(sweeps).map(object => sweepReaches(object) + RESET_FADE_MS));
  }

  // What to draw ms into a sweep: Walls as they are, the objects as they were with how far they've faded out, and
  // as they start again with how far they've faded in, each with its fade from 0 to 1. Leaves out anything not
  // showing at all.
  function resetSweepAt(before, after, ms){
    let clamp = (value) => Math.max(0, Math.min(1, value));
    let leaving = before.filter(sweeps)
      .map(object => ({ ...object, fade: clamp(1 - (ms - sweepReaches(object)) / RESET_FADE_MS) }));
    let arriving = after.filter(sweeps)
      .map(object => ({ ...object, fade: clamp((ms - fadesInAt(object, before)) / RESET_FADE_MS) }));
    return [...after.filter(object => !sweeps(object)), ...leaving, ...arriving].filter(object => (object.fade ?? 1) > 0);
  }

  return { BOARD_SIZE, DEFAULT_START, LETTERS, placeObject, eraseObject, exitDirectionOf, entranceFrom, entranceAfter, blockingEntrance, suggestLetter, hasFinish, createPuzzleGame, RESET_FADE_MS, RESET_SWEEP_STEP_MS, resetSweepMs, resetSweepAt, BOARD_TIMING, DIRECTION_DELTAS, LANTERN_REACH, isFloor };
});
