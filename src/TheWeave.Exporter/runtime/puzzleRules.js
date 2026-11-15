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
    // The ship's reflections, kept rather than worked out afresh each time, so they can move with the ship and shove
    // what's in their way as they go - see formReflections, stepReflections and settleReflections.
    let reflections = [];
    // Goes up whenever anything on the board changes, so that whatever's worked out from it, or drawn from it, can
    // be kept until it does - see beamPaths, and board.js's frame.
    let version = 0;
    let beamCache = new Map();
    // The square the ship last arrived from, for an Archeton that hurts it to send it back to - see hurtBack.
    let previousShipCell = null;
    // Whether the ship's on its way back from being hurt, when the Slide Bugs let it get there - see arriveAt.
    let recovering = false;
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

    // Whether something on a square stops a Beam there. Anything solid does, and a Push Block only if the Beam's
    // Blocked by Blocks says so - except for glass: a Reflect Mimic is a pane a photonic Beam goes straight through.
    // Materials are where this is headed, so that "does this stop a beam" can be a table rather than a condition.
    function stopsBeam(cell, part){
      let there = objectAt(cell);
      if (!there) return false;
      if (there.kind === 'PushBlock') return part.blockedByBlocks !== false;
      if (there.kind === 'Archeton' && hasPart(there, 'Reflect')) return false;
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

    // Being hurt by an Archeton always sends the ship back to the square it just came from: standing where a Block's
    // laser reaches (pushing a Push Block that was shielding it out of the way, say), or a Slide Bug sliding into it.
    // Failing that, it's sent on away from whatever hurt it. Which way, or null if it isn't hurt, or can't go either way.
    function hurtBack(cell){
      if (!isAt(shipCell, cell)) return null;
      let away = hurtAwayFrom(cell);
      if (away === undefined) return null;
      let direction = backDirection(cell);
      if (!direction) direction = away.find(way => canEnterAlone(cell, nextCell(cell, way), MOVER_DIRECTIONS[way])) ?? null;
      if (direction) recovering = true;
      return direction;
    }

    // The way back to the square the ship came from, if it can go that way - see hurtBack and hurtByReflection.
    function backDirection(cell){
      let back = previousShipCell;
      if (!back || Math.abs(back.col - cell.col) + Math.abs(back.row - cell.row) !== 1) return null;
      let towardsBack = back.col > cell.col ? 'Right' : back.col < cell.col ? 'Left' : back.row > cell.row ? 'Down' : 'Up';
      return canEnterAlone(cell, back, MOVER_DIRECTIONS[towardsBack]) ? towardsBack : null;
    }

    // Whether the ship's reflection is being hurt where it stands: a closed Gate shut on it, a Beam with a Block
    // reaching it, or a Stinging Archeton sitting there. Hurt there, the ship is sent back to the square it came from,
    // as it would be for being hurt itself - see carryDirection. One hurt reflection is enough, and only one way back.
    function hurtByReflection(cell){
      if (!isAt(shipCell, cell)) return null;
      let hurt = syncReflections().some(reflection => {
        let object = objectAt(reflection);
        return (object?.kind === 'Gate' && !object.open)
          || (object?.kind === 'Archeton' && hasPart(object, 'Sting'))
          || blockedByBeam(reflection);
      });
      if (!hurt) return null;
      let direction = backDirection(cell);
      if (direction) recovering = true;
      return direction;
    }

    // What's hurting the ship on a square, as the ways away from it, or undefined if nothing is: a Gate that's closed
    // on it, a Slide Bug that's slid into it, or a Block's laser reaching it.
    function hurtAwayFrom(cell){
      if (objects.some(object => object.kind === 'Gate' && !object.open && isAt(object, cell))) return [];
      // A bug that's moved onto the ship sends it on the way the bug was going; one it stepped into, nowhere else.
      let bug = objects.find(object => object.kind === 'Archeton' && isAt(object, cell));
      if (bug) return (bug.glide === 'slide' || bug.glide === 'hop') && bug.fromCol !== undefined && (bug.fromCol !== bug.col || bug.fromRow !== bug.row)
        ? [wayFrom({ col: bug.fromCol, row: bug.fromRow }, bug)]
        : [];
      if (!blockedByBeam(cell)) return undefined;
      return beamPaths(true).filter(path => path.blocks && path.cells.some(reached => isAt(reached, cell))).map(path => path.direction);
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
        if (hit.pushes && canEnterAlone(cell, nextCell(cell, hit.direction), MOVER_DIRECTIONS[hit.direction])) return hit.direction;
      }
      return null;
    }

    // For sokoban.js's canEnter. A Stream holds a ship until it pushes it off: the only way to leave
    // one is the way it's going. It can't be stepped onto head-on either.
    function canEnter(from, to, moverDirection){
      return canEnterAlone(from, to, moverDirection)
        && (!isAt(from, shipCell) || reflectionsFollow(moverDirection));
    }

    // Whether a square can be entered at all, whatever else is moving with it: not off the board, not against a Stream or
    // a Pipe it doesn't run along, not through a Beam, and not into anything solid - though a Push Block that can be
    // pushed on isn't solid, and an Archeton with a Sting is solid to everything but the ship, which is hurt for it.
    // Anything the board moves without asking - a Stream, a Beam, a Slide Bug - uses this, since a forced move can't be
    // refused.
    function canEnterAlone(from, to, moverDirection){
      if (!onBoard(to)) return false;
      let direction = PUZZLE_DIRECTIONS[moverDirection];
      let holding = streams.get(cellKey(from));
      if (holding && holding !== direction) return false;
      if (streams.get(cellKey(to)) === OPPOSITES[direction]) return false;
      if (!pipeAllows(from, direction) || !pipeAllows(to, direction)) return false;
      if (blockedByBeam(to)) return false;
      let object = objectAt(to);
      if (object?.kind === 'PushBlock') return !!pushedTo(object, direction);
      // An Archeton with a Sting is solid to everything but the ship, which can step into it - and is hurt.
      if (object?.kind === 'Archeton' && hasPart(object, 'Sting')) return true;
      return !(object && isSolid(object));
    }

    // Whether every reflection could take the step its pane shows it taking if the ship stepped this way: each steps the
    // way the ship's step mirrors across its own pane, so a Wall in a reflection's way is a Wall in the ship's, and the
    // ship stays where it is. Chained reflections are in it too, since each takes its own step. The board's edge is not a
    // Wall in that sense: a reflection with no board left to be shown on simply goes, and comes back when there is - see
    // settleReflections, which drops it, and formReflections, which makes it again.
    function reflectionsFollow(moverDirection){
      let direction = PUZZLE_DIRECTIONS[moverDirection];
      return syncReflections().every(reflection => {
        let mirrored = mirroredDirection(reflection.pane, direction);
        let target = nextCell(reflection, mirrored);
        if (!onBoard(target)) return true;
        return canEnterAlone(reflection, target, MOVER_DIRECTIONS[mirrored]);
      });
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
        // A Gate that closes on anything sitting in it - a Push Block, a Slide Bug - passes it back the way it came: to
        // the last square it was on that's clear, past any that now have a closed Gate in them too. With nowhere clear
        // behind it, it stays, and the square stays solid either way. All the Switch's Gates change before any of it.
        case 'Switch': {
          if (!switchesActive()) return null;
          settle('return');
          let gates = objects.filter(gate => gate.kind === 'Gate' && gate.letter === object.letter);
          for (const gate of gates) gate.open = !gate.open;
          let returned = [];
          for (const gate of gates.filter(gate => !gate.open)) {
            for (const caught of objects.filter(other => other.kind !== 'Gate' && isAt(other, gate))) {
              if (passBack(caught)) returned.push(caught);
            }
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

        case 'PipeSwitch':
          return turnPipes();

      }
      return null;
    }

    // What arriving on something does, whether it's the ship or its reflection arriving: a Switch, Lantern, Pipe Switch
    // or Reset Switch set off, a Key taken, the Finish finishing, a Teleporter or a Jump Tile moving the ship. An event
    // for the caller, or null. See shipArrives and reflectionArrivals.
    function arriveOn(object){
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

    // Two arrivals' worth of news as one, for a step that sets off more than one thing.
    function mergeEvent(event, more){
      if (!more) return event;
      return event ? { ...event, ...more } : more;
    }

    function shipArrives(cell, { jumped = false } = {}){
      version++;
      let step = null;
      if (!isAt(shipCell, cell)) {
        previousShipCell = shipCell;
        if (Math.abs(cell.col - shipCell.col) + Math.abs(cell.row - shipCell.row) === 1) step = { direction: wayFrom(shipCell, cell) };
      }
      shipCell = cell;
      if (!jumped) jumpsInARow = 0;
      let object = objectAt(cell);
      let event = object ? arriveOn(object) : null;
      // A Reset or a Finish ends the arrival there, and the reflections go with the board.
      if (event?.reset || event?.finished) {
        reflections = [];
        return event;
      }
      // The reflections move with the ship - so a ship that jumps or teleports somewhere else finds them fresh, and one
      // that walks has them walk too - and then act where they've landed, whether they walked there or appeared.
      let pushed = stepReflections(step);
      settleReflections();
      formReflections();
      let mirrored = reflectArrivals();
      return mergeEvent(mergeEvent(event, pushed), mirrored);
    }

    // Everything that last moved in a way that's had time to finish - a slide, or being passed back from a Gate - is
    // simply where it is now, so it isn't drawn moving there again the next time something else moves that way.
    function settle(glide){
      for (const object of objects) {
        if (object.glide !== glide) continue;
        object.fromCol = object.col;
        object.fromRow = object.row;
      }
    }

    // Whether an Archeton has a part of a kind - see TheWeave.Core's ArchetonPartKind.
    function hasPart(object, kind){
      return !!archetonDefinitions.get(object.archeton)?.parts?.some(part => part.kind === kind);
    }

    // ---------- Reflect Mimics ----------

    // Where an Archeton with a Reflect part mirrors a point to, or null if the point isn't in its line: a pane turned
    // Left or Right stands upright, mirroring columns across its own, and one turned Up or Down lies flat, mirroring
    // rows. The mirror is the middle of its square, so a point as far one side lands as far the other.
    // Whether a pane stands upright, mirroring columns, rather than lying flat and mirroring rows: one placed facing
    // Left or Right does, one facing Up or Down doesn't - see puzzleDrawing.js's FLOW_TURNS.
    function uprightPane(pane){
      return pane.direction !== 'Up' && pane.direction !== 'Down';
    }

    function reflectedBy(pane, cell){
      if (uprightPane(pane)) return cell.row === pane.row ? { col: pane.col * 2 - cell.col, row: pane.row } : null;
      return cell.col === pane.col ? { col: pane.col, row: pane.row * 2 - cell.row } : null;
    }

    // Whether nothing at all stands on the squares between two in the same row or column, the two of them aside: a
    // Wall between the ship and a pane hides it, as it would hide the ship from a Beam.
    function clearBetween(from, to){
      let dc = Math.sign(to.col - from.col), dr = Math.sign(to.row - from.row);
      for (let cell = { col: from.col + dc, row: from.row + dr }; !isAt(cell, to); cell = { col: cell.col + dc, row: cell.row + dr }) {
        if (!onBoard(cell) || objectAt(cell)) return false;
      }
      return true;
    }

    // The first square between two in the same row or column that has something on it, or that's off the board, or null
    // if there's nothing between them - see clearBetween.
    function firstBetween(from, to){
      let dc = Math.sign(to.col - from.col), dr = Math.sign(to.row - from.row);
      for (let cell = { col: from.col + dc, row: from.row + dr }; !isAt(cell, to); cell = { col: cell.col + dc, row: cell.row + dr }) {
        if (!onBoard(cell) || objectAt(cell)) return cell;
      }
      return null;
    }

    // Panes that have the ship in their line but can't see it, because something's between: { pane, blocker } each, the
    // blocker being the first square in the way. Nothing shows a reflection when it's blocked, so this is what lets the
    // drawing show the line of sight stopping short - see reflectionSightLine.
    function blockedSights(){
      let blocked = [];
      for (const archeton of objects) {
        if (archeton.kind !== 'Archeton' || !hasPart(archeton, 'Reflect')) continue;
        let pane = { col: archeton.col, row: archeton.row, direction: archeton.direction };
        if (!reflectedBy(pane, shipCell) || clearBetween(shipCell, pane)) continue;
        let blocker = firstBetween(shipCell, pane);
        if (blocker) blocked.push({ pane, blocker });
      }
      return blocked;
    }

    // For sokoban.js's onStepStart: something stepping into a Push Block pushes it on ahead, gliding along with it - see
    // renderBoard's pushAlong. Returns { sank } if that brought matching blocks together. The ship does this through the
    // board's own pushFrom, and a reflection as it moves - see stepReflections.
    function pushFrom(from, to, moverDirection){
      version++;
      let block = objectAt(to);
      if (block?.kind !== 'PushBlock') return null;
      let next = pushedTo(block, PUZZLE_DIRECTIONS[moverDirection]);
      if (!next) return null;
      leaving(block);
      block.fromCol = block.col;
      block.fromRow = block.row;
      block.glide = 'push';
      block.col = next.col;
      block.row = next.row;
      revealLitAreas();
      let sank = sinkMatches();
      return sank ? { sank } : null;
    }

    // Whether the ship's reflection can be on a square: anywhere the ship could stand, and anywhere it would be hurt - a
    // closed Gate, or a Stinging Archeton - so that the ship is sent back for it. A Wall, a Push Block or another
    // Archeton is somewhere an image can't be, though a Block on a reflection's way is shoved on ahead as it moves - see
    // stepReflections. Everything else it lands on, it acts on, as the ship would: a Switch, a Key, the Finish.
    function canHoldReflection(cell){
      let object = objectAt(cell);
      if (!object) return true;
      if (object.kind === 'Gate') return true;
      if (object.kind === 'PushBlock') return false;
      if (object.kind === 'Archeton') return hasPart(object, 'Sting');
      return !isSolid(object);
    }

    // Every Reflect pane with a point in its line, and nothing solid between them.
    function panesInLine(cell){
      let panes = [];
      for (const archeton of objects) {
        if (archeton.kind !== 'Archeton' || !hasPart(archeton, 'Reflect')) continue;
        let pane = { col: archeton.col, row: archeton.row, direction: archeton.direction };
        if (!reflectedBy(pane, cell) || !clearBetween(cell, pane)) continue;
        panes.push(pane);
      }
      return panes;
    }

    // The chain a reflection hangs from: its pane's square after whatever it reflects, so that each pane shows one
    // reflection of each thing it can see, and a reflection can be told from its parent's.
    function chainOf(source, pane){
      let here = pane.col + ',' + pane.row;
      return source.chain ? source.chain + '>' + here : here;
    }

    // A square to hang reflections from: the ship's own, with nothing else about it.
    function shipSource(){
      return { col: shipCell.col, row: shipCell.row };
    }

    // A direction mirrored across a pane, as puzzleRules names them: left and right swap across an upright pane, up and
    // down across a flat one.
    function mirroredDirection(pane, direction){
      if (uprightPane(pane)) return direction === 'Left' ? 'Right' : direction === 'Right' ? 'Left' : direction;
      return direction === 'Up' ? 'Down' : direction === 'Down' ? 'Up' : direction;
    }

    // Every reflection the board should be showing: from the ship outwards, a pane shows what's in its line, and what it
    // shows is in the line of other panes in turn, so panes facing each other bounce a reflection between them as far as
    // the board allows. Only where there's room to stand on the reflection's square - see canHoldReflection.
    function formReflections(){
      let queue = [shipSource()];
      let seen = new Set();
      while (queue.length > 0) {
        let source = queue.shift();
        if (seen.has(source.chain ?? '')) continue;
        seen.add(source.chain ?? '');
        for (const pane of panesInLine(source)) {
          let image = reflectedBy(pane, source);
          if (!image || !onBoard(image) || isAt(image, shipCell) || isAt(image, source)) continue;
          let chain = chainOf(source, pane);
          // One pane shows one reflection of what it sees, once: one that's already there is still a source for the
          // panes in its own line, which is what gives a chain its second reflection.
          let existing = reflections.find(reflection => reflection.chain === chain);
          if (existing) {
            queue.push(existing);
            continue;
          }
          // And one reflection to a square, whichever panes would put it there - which is also what stops panes facing
          // each other showing the same reflection round and round.
          if (reflections.some(reflection => isAt(reflection, image))) continue;
          if (!canHoldReflection(image)) continue;
          let reflection = {
            col: image.col, row: image.row, fromCol: image.col, fromRow: image.row,
            pane, from: source, fromShip: !source.chain, chain: chainOf(source, pane),
          };
          reflections.push(reflection);
          queue.push(reflection);
        }
      }
    }

    // The reflection moves with the ship: it takes a step the way the ship's was, mirrored across its pane, shoving a
    // Push Block on ahead as the ship would. One that can't go where its pane shows it is gone - a reflection is only
    // there while the pane has the ship to show. Returns what the shoving did, for the caller.
    function stepReflections(step){
      let events = null;
      if (!step) return events;
      for (const reflection of reflections.slice()) {
        let direction = mirroredDirection(reflection.pane, step.direction);
        let target = nextCell(reflection, direction);
        if (!canEnterAlone(reflection, target, MOVER_DIRECTIONS[direction])) continue;
        let pushed = objectAt(target)?.kind === 'PushBlock' ? pushFrom(reflection, target, MOVER_DIRECTIONS[direction]) : null;
        reflection.fromCol = reflection.col;
        reflection.fromRow = reflection.row;
        reflection.col = target.col;
        reflection.row = target.row;
        events = mergeEvent(events, pushed);
      }
      return events;
    }

    // What a reflection shows: the ship, or the reflection its pane reflects - which has moved since the reflection was
    // made, so the ship's square is read fresh rather than kept.
    function sourceOf(reflection){
      return reflection.fromShip ? shipCell : reflection.from;
    }

    // The Push Blocks the reflections will shove as the ship's step begins: each shoves what's in the way of the step its
    // pane shows it taking, so the block glides along with the ship rather than jumping once the step is over - see
    // stepReflections, and board.js's onStepStart. Returns what the shoving did, for the caller.
    function pushForReflections(moverDirection){
      let direction = PUZZLE_DIRECTIONS[moverDirection];
      let events = null;
      for (const reflection of syncReflections()) {
        let mirrored = mirroredDirection(reflection.pane, direction);
        let target = nextCell(reflection, mirrored);
        if (objectAt(target)?.kind !== 'PushBlock') continue;
        events = mergeEvent(events, pushFrom(reflection, target, MOVER_DIRECTIONS[mirrored]));
      }
      return events;
    }

    // Whatever stopped the ship stepping this way by being in the way on the reflection's side: a Wall, a shut Gate, an
    // Archeton, or a Push Block it couldn't shove. Mirrored back across its pane it stands on the square the ship was
    // trying to walk into, which is where the callers flash it - see board.js's refusedFlash. Null if the ship couldn't
    // have stepped there anyway - then the reason is on the ship's own side, not the reflection's, and nothing should be
    // shown on it - and null for a reflection that would step off the board, since that refuses nothing: it goes.
    function reflectionObstacleInTheWay(from, to, moverDirection){
      if (!isAt(from, shipCell) || !canEnterAlone(from, to, moverDirection)) return null;
      let direction = PUZZLE_DIRECTIONS[moverDirection];
      for (const reflection of syncReflections()) {
        let mirrored = mirroredDirection(reflection.pane, direction);
        let target = nextCell(reflection, mirrored);
        if (!onBoard(target) || canEnterAlone(reflection, target, MOVER_DIRECTIONS[mirrored])) continue;
        return { object: objectAt(target) ?? null };
      }
      return null;
    }

    // Every reflection has to be exactly where its pane shows what it reflects. One that isn't - because the ship walked
    // out of the pane's line, or a shove didn't go as far as it did - is gone, and so is anything reflected from it.
    function settleReflections(){
      for (const reflection of reflections.slice()) {
        let expected = reflectedBy(reflection.pane, sourceOf(reflection));
        if (expected && isAt(reflection, expected)) continue;
        dropReflection(reflection);
      }
    }

    // Takes a reflection off the board, and anything reflected from it.
    function dropReflection(reflection){
      reflections = reflections.filter(other => other !== reflection);
      for (const child of reflections.filter(other => other.from === reflection)) dropReflection(child);
    }

    // What the reflections set off where they stand, as the ship arriving would: Switches, Lanterns, Pipe Switches,
    // Reset Switches, Keys and the Finish. Not a Teleporter or a Jump Tile: they carry off whatever stands on them, and
    // a reflection is only ever where its pane shows the ship, so there's nowhere for it to be carried to.
    function reflectArrivals(){
      let events = null;
      for (const reflection of reflections.slice()) {
        let object = objectAt(reflection);
        if (!object || object.kind === 'PushBlock' || object.kind === 'Teleporter' || object.kind === 'JumpTile') continue;
        let event = arriveOn(object);
        events = mergeEvent(events, event);
        if (event?.reset || event?.finished) break;
      }
      return events;
    }

    // Whether the ship or one of its reflections is standing on one of these: the reflections count for everything the
    // ship standing there would set off, and for the switches that keep working while something stays on them.
    function haunts(kind){
      return [shipCell, ...syncReflections()].some(cell => objectAt(cell)?.kind === kind);
    }

    // The board's reflections as they should be right now: anything that's no longer where its pane shows it gone, and
    // any pane that's come to have the ship in its line showing one.
    function syncReflections(){
      settleReflections();
      formReflections();
      return reflections;
    }

    // The way from one square to another, along whichever of across and down it goes further.
    function wayFrom(from, to){
      let dc = to.col - from.col, dr = to.row - from.row;
      return Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? 'Right' : 'Left') : (dr > 0 ? 'Down' : 'Up');
    }

    // Notes the square an object's leaving, for a closing Gate to pass it back along - see passBack. Only the last
    // few are kept.
    function leaving(object){
      (object.trail ??= []).push({ col: object.col, row: object.row });
      if (object.trail.length > 24) object.trail.shift();
    }

    // Moves an object caught in a closing Gate back along the squares it came through, to the last one that's clear,
    // passing over any with a closed Gate in them. Whether it moved.
    function passBack(object){
      let trail = object.trail ?? [];
      for (let i = trail.length - 1; i >= 0; i--) {
        let back = trail[i];
        let other = objects.find(o => o !== object && o.kind !== 'Gate' && isAt(o, back));
        if (!onBoard(back) || other || isAt(shipCell, back)) return false;
        if (objects.some(o => o.kind === 'Gate' && !o.open && isAt(o, back))) continue;
        trail.length = i;
        object.fromCol = object.col;
        object.fromRow = object.row;
        object.col = back.col;
        object.row = back.row;
        object.glide = 'return';
        return true;
      }
      return false;
    }

    // Whether the ship, on its square, could be sent back to where it came from, or on along a direction, without going
    // through anything - see hurtBack.
    function canBeSentBack(cell, onwards){
      let back = previousShipCell;
      let canGo = (to, way) => onBoard(to) && canEnterAlone(cell, to, MOVER_DIRECTIONS[way]);
      if (back && Math.abs(back.col - cell.col) + Math.abs(back.row - cell.row) === 1) {
        let towardsBack = back.col > cell.col ? 'Right' : back.col < cell.col ? 'Left' : back.row > cell.row ? 'Down' : 'Up';
        if (canGo(back, towardsBack)) return true;
      }
      return canGo(nextCell(cell, onwards), onwards);
    }

    // Every Slide Bug takes its step, after the ship has: a square along its line towards the ship's column, or row -
    // its row when it faces Left or Right, its column facing Up or Down. Stopped by the board's edge, anything solid, or
    // a Pipe across its line, it waits there. Sliding into the ship hurts it - see hurtBack. Landing on a Switch, Lantern, Reset Switch or Pipe
    // Switch triggers it, as the ship would. { slid } and whatever they set off, or null if none moved.
    function slideBugs(){
      // Whatever slid last time has long since got there, so it's simply where it is now - otherwise it would be drawn
      // sliding in again whenever another bug slides.
      settle('slide');
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
        if (!onBoard(to) || (there && isSolid(there)) || !pipeAllows(bug, direction) || !pipeAllows(to, direction)) continue;
        // Sliding into the ship hurts it, sending it back where it came from - only if it can go somewhere.
        if (isAt(shipCell, to) && !canBeSentBack(to, direction)) continue;

        leaving(bug);
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

    // Every Archeton with a Move Sequence hops to the next square of it, after the ship's step: its moves are counted
    // from the square it started on, so it always comes back round. A move onto anything solid, or off the board, it
    // stays put for, and carries on with the next. Landing on the ship hurts it, with a Sting, as long as the ship can
    // be sent somewhere - otherwise it stays put for that one too. It sets off what it lands on, as a Slide Bug does.
    // { hopped } and whatever they set off, or null if none moved.
    function hopBugs(){
      settle('hop');
      let hopped = [];
      let set = {};
      for (const bug of objects.filter(object => object.kind === 'Archeton' && hasPart(object, 'Sequence'))) {
        let moves = archetonDefinitions.get(bug.archeton).parts.find(part => part.kind === 'Sequence').moves ?? [];
        if (moves.length === 0) continue;
        bug.homeCol ??= bug.col;
        bug.homeRow ??= bug.row;
        let beat = bug.beat ?? 0;
        bug.beat = (beat + 1) % moves.length;
        let target = { col: bug.homeCol, row: bug.homeRow };
        for (let i = 0; i <= beat; i++) target = nextCell(target, moves[i]);
        if (isAt(bug, target) || !onBoard(target)) continue;
        let there = objects.find(other => other !== bug && isAt(other, target) && isSolid(other));
        if (there) continue;
        if (isAt(shipCell, target) && !(hasPart(bug, 'Sting') && canBeSentBack(target, wayFrom(bug, target)))) continue;

        leaving(bug);
        bug.fromCol = bug.col;
        bug.fromRow = bug.row;
        bug.col = target.col;
        bug.row = target.row;
        bug.glide = 'hop';
        hopped.push(bug);
        let under = objects.find(other => other !== bug && isAt(other, target));
        if (under) Object.assign(set, trigger(under) ?? {});
        if (set.reset) break;
      }
      if (hopped.length === 0) return null;
      version++;
      revealLitAreas();
      return { ...set, hopped };
    }

    // The ship arriving on a square, then every Slide Bug following it a step - except when it's finished the board,
    // is about to land from a jump, when the bugs wait for it to land, or has reset the board, which put them back.
    // A ship arriving back from being hurt isn't followed, so it has a moment to get its bearings rather than being hurt
    // again straight away.
    function arriveAt(cell, options){
      let event = shipArrives(cell, options);
      if (recovering) {
        recovering = false;
        return event;
      }
      if (event?.finished || event?.jumpTo || event?.reset) return event;
      // Stepping into a stinging Archeton hurts the ship there and then, before it can move away.
      if (objects.some(object => object.kind === 'Archeton' && isAt(object, cell) && hasPart(object, 'Sting'))) return event;
      let slid = slideBugs();
      let hopped = slid?.reset ? null : hopBugs();
      let moved = slid || hopped ? { ...(hopped ?? {}), ...(slid ?? {}) } : null;
      if (moved && slid && hopped) moved = { ...moved, slid: slid.slid, hopped: hopped.hopped };
      if (!moved) return event;
      return event ? { ...moved, ...event } : moved;
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
        leaving(object);
        object.col = to.col;
        object.row = to.row;
      }
      if (moves.size > 0) revealLitAreas();

      let sank = moves.size > 0 ? sinkMatches() : null;
      let cameUnder = !shipHeadingTo && [...moves.keys()].some(object => isAt(object, shipCell) && objects.includes(object));
      let arrived = cameUnder ? arriveAt(shipCell) : null;
      return sank ? { ...arrived, sank } : arrived;
    }

    // A board with panes in line with the ship starts with its reflections already showing.
    formReflections();

    return {
      start,
      get objects(){ return objects; },
      get shipCell(){ return shipCell; },
      get version(){ return version; },
      get isSolved(){ return solved; },
      get switchesActive(){ return switchesActive(); },
      // Whether the ship is on a Rotator Loop Switch, which is what makes Rotator tiles move - or one of its reflections
      // is, which counts as the ship standing there would, since that's the whole of what a reflection does.
      get onRotatorSwitch(){ return haunts('RotatorSwitch'); },
      // Whether the ship is on a Pipe Switch, which turns the Pipes again each second it stays there - or a reflection is.
      get onPipeSwitch(){ return haunts('PipeSwitch'); },
      // Where the ship's reflections are right now, one for each Reflect pane it's in the line of and one more for each
      // pane those are in the line of - see formReflections, stepReflections and settleReflections.
      get reflections(){ return syncReflections(); },
      // Panes in line with the ship whose sight something is in the way of, { pane, blocker } each - see blockedSights.
      get blockedSights(){ return blockedSights(); },
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
      pushFrom,
      pushForReflections,
      reflectionObstacleInTheWay,

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
        // Reflections are images, not state to be replayed: they're worked out again from wherever the ship now is.
        reflections = [];
        formReflections();
      },

      // Which way a Stream is carrying a ship on this square, as sokoban.js's direction, or null.
      // A Stream comes first, and otherwise an Archeton's Beam pushing it away, or a Block's laser sending it back
      // out of its reach, as long as it can go - see pushedByBeam and hurtBack. Either way the caller moves the
      // ship along, a square at a time.
      carryDirection(cell){
        let direction = streams.get(cellKey(cell)) ?? pushedByBeam(cell) ?? hurtBack(cell) ?? hurtByReflection(cell);
        return direction ? MOVER_DIRECTIONS[direction] : null;
      },

      tick: (shipHeadingTo) => moveAlong(streams, 'stream', shipHeadingTo),
      tickRotators: (shipHeadingTo) => moveAlong(rotators, 'rotator', shipHeadingTo),
    };
  }

  // ---------- reflections ----------

  // Which way a reflection faces: the way the ship faces, mirrored across the pane - so a ship facing the pane sees a
  // reflection facing back at it, and one walking along the pane's line sees it facing its own way. A chained reflection
  // is mirrored again for each pane it's been reflected through, so two upright panes give it the ship's facing back.
  function reflectionFacing(reflection, facing){
    let mirrored = reflection.from?.pane ? reflectionFacing(reflection.from, facing) : facing;
    let upright = reflection.pane.direction !== 'Up' && reflection.pane.direction !== 'Down';
    if (upright) return mirrored === 'left' ? 'right' : mirrored === 'right' ? 'left' : mirrored;
    return mirrored === 'up' ? 'down' : mirrored === 'down' ? 'up' : mirrored;
  }

  // Where a reflection is drawn: its pane's mirror of where the thing it reflects is being drawn - the ship, or another
  // reflection, all the way back through the chain - so the whole chain glides with the ship rather than jumping between
  // squares. Tile size in art pixels; the ship's position is where board.js's shipPosition has it.
  function reflectionPosition(reflection, ship, tilePx, drawn = new Map()){
    if (drawn.has(reflection)) return drawn.get(reflection);
    let source = reflection.from?.pane ? reflectionPosition(reflection.from, ship, tilePx, drawn) : ship;
    let { col, row, direction } = reflection.pane;
    let upright = direction !== 'Up' && direction !== 'Down';
    let position = upright
      ? { x: (2 * col + 1) * tilePx - source.x, y: source.y }
      : { x: source.x, y: (2 * row + 1) * tilePx - source.y };
    drawn.set(reflection, position);
    return position;
  }

  // The line of sight between a reflection and whatever it's an image of - the ship, or the reflection its pane
  // reflects - as two points in art pixels, from wherever each is being drawn. What the renderers put a dotted line
  // between, so it's plain which pane is showing the ship and from how far away - see reflectionPosition.
  function reflectionSightLine(reflection, ship, tilePx){
    let from = reflection.from?.pane ? reflectionPosition(reflection.from, ship, tilePx) : ship;
    return { from, to: reflectionPosition(reflection, ship, tilePx) };
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

  return { BOARD_SIZE, DEFAULT_START, LETTERS, placeObject, eraseObject, exitDirectionOf, entranceFrom, entranceAfter, blockingEntrance, suggestLetter, hasFinish, createPuzzleGame, RESET_FADE_MS, RESET_SWEEP_STEP_MS, resetSweepMs, resetSweepAt, BOARD_TIMING, DIRECTION_DELTAS, LANTERN_REACH, isFloor, reflectionPosition, reflectionFacing, reflectionSightLine };
});
