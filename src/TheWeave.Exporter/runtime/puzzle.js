// puzzle.js
// John Oestmann
// Sokoban puzzles played over a track's album art: what each object looks like, what colours they're
// drawn in, the rules for placing them on a board, and the rules for playing one. Knows nothing about
// the DOM - callers pass in plain pixel data, and get plain pixel data back. Shared by the Editor's
// Puzzle Editor and the exported site, so that a puzzle looks the same in both.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into
// every exported site's jsx/puzzle.js, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WeavePuzzle = factory();
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
    let solved = false;
    // How many Jump Tiles in a row the ship has been launched from, so two facing each other can't go on forever.
    let jumpsInARow = 0;

    function cellKey(cell){
      return cell.col + "," + cell.row;
    }

    function objectAt(cell){
      return objects.find(object => isAt(object, cell)) ?? null;
    }

    function switchesActive(){
      return !objects.some(object => object.kind === 'Key');
    }

    function isSolid(object){
      return object.kind === 'Wall' || object.kind === 'PushBlock' || (object.kind === 'Gate' && !object.open);
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
      if (!onBoard(to) || objectAt(to) || streams.get(cellKey(to)) === OPPOSITES[direction]) return null;
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
    // { teleportTo }, { jumpTo }, { finished }, { reset } (with the objects as they were) or { pipesTurned } for the
    // caller to act on. jumped says the ship landed here from a
    // Jump Tile, rather than walking or being carried.
    function arriveAt(cell, { jumped = false } = {}){
      shipCell = cell;
      if (!jumped) jumpsInARow = 0;
      let object = objectAt(cell);
      if (!object) return null;

      switch (object.kind) {
        case 'Key':
          objects.splice(objects.indexOf(object), 1);
          return null;

        case 'Switch':
          if (!switchesActive()) return null;
          for (const gate of objects) {
            if (gate.kind === 'Gate' && gate.letter === object.letter) gate.open = !gate.open;
          }
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

        case 'Lantern':
          object.lit = true;
          revealLitAreas();
          return null;

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
      get isSolved(){ return solved; },
      get switchesActive(){ return switchesActive(); },
      // Whether the ship is on a Rotator Loop Switch, which is what makes Rotator tiles move.
      get onRotatorSwitch(){ return objectAt(shipCell)?.kind === 'RotatorSwitch'; },
      // Whether the ship is on a Pipe Switch, which turns the Pipes again each second it stays there.
      get onPipeSwitch(){ return objectAt(shipCell)?.kind === 'PipeSwitch'; },
      turnPipes,
      floors,

      // For sokoban.js's canEnter. A Stream holds a ship until it pushes it off: the only way to leave
      // one is the way it's going. It can't be stepped onto head-on either.
      canEnter(from, to, moverDirection){
        let direction = PUZZLE_DIRECTIONS[moverDirection];
        let holding = streams.get(cellKey(from));
        if (holding && holding !== direction) return false;
        if (streams.get(cellKey(to)) === OPPOSITES[direction]) return false;
        if (!pipeAllows(from, direction) || !pipeAllows(to, direction)) return false;
        let object = objectAt(to);
        if (object?.kind === 'PushBlock') return !!pushedTo(object, direction);
        return !(object && isSolid(object));
      },

      // Whether a Push Block can be pushed along a direction (sokoban.js's), for showing that it can.
      canPush(cell, moverDirection){
        let block = objectAt(cell);
        return block?.kind === 'PushBlock' && !!pushedTo(block, PUZZLE_DIRECTIONS[moverDirection]);
      },

      // For sokoban.js's onStepStart: the ship stepping into a Push Block pushes it on ahead, gliding along with
      // the ship - see renderBoard's pushAlong. Returns { sank } if that brought matching blocks together.
      pushFrom(from, to, moverDirection){
        let block = objectAt(to);
        if (block?.kind !== 'PushBlock') return null;
        let next = pushedTo(block, PUZZLE_DIRECTIONS[moverDirection]);
        if (!next) return null;
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
        shipCell = cell;
      },

      // Which way a Stream is carrying a ship on this square, as sokoban.js's direction, or null.
      carryDirection(cell){
        let direction = streams.get(cellKey(cell));
        return direction ? MOVER_DIRECTIONS[direction] : null;
      },

      tick: (shipHeadingTo) => moveAlong(streams, 'stream', shipHeadingTo),
      tickRotators: (shipHeadingTo) => moveAlong(rotators, 'rotator', shipHeadingTo),
    };
  }

  // ---------- colours ----------

  // How many groups of similar colours an album's art gets split into before choosing from them.
  const PALETTE_GROUPS = 24;
  // A group smaller than this share of the art's pixels is too much of a speck to represent it.
  const PALETTE_MIN_SHARE = 0.002;
  // How much the board dims the art behind it (see main.css's .boardPlaying), and how different in
  // lightness from that a fill colour has to be to stand out.
  const PALETTE_ART_DIMMING = 0.65;
  const PALETTE_MIN_CONTRAST = 25;

  function toHex(color){
    return '#' + [color.r, color.g, color.b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function lightnessOf(color){
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  }

  function vividnessOf(color){
    return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  }

  // Roughly how different two colours look, weighting channels by how much the eye responds to them.
  function colorDistance(a, b){
    return Math.sqrt(2 * (a.r - b.r) ** 2 + 4 * (a.g - b.g) ** 2 + 3 * (a.b - b.b) ** 2);
  }

  // Splits the colours into groups, always cutting the group with the widest spread of any channel at its
  // midpoint by pixel count, and returns each group's most common exact colour.
  function groupColors(counts){
    let groups = [[...counts.values()]];

    while (groups.length < PALETTE_GROUPS) {
      let widest = null;
      for (const group of groups) {
        if (group.length < 2) continue;
        for (const channel of ['r', 'g', 'b']) {
          let values = group.map(color => color[channel]);
          let spread = Math.max(...values) - Math.min(...values);
          if (!widest || spread > widest.spread) widest = { group, channel, spread };
        }
      }
      if (!widest || widest.spread === 0) break;

      let sorted = [...widest.group].sort((a, b) => a[widest.channel] - b[widest.channel]);
      let half = sorted.reduce((sum, color) => sum + color.count, 0) / 2;
      let split = 1;
      for (let walked = sorted[0].count; split < sorted.length - 1 && walked < half; split++) walked += sorted[split].count;

      groups.splice(groups.indexOf(widest.group), 1, sorted.slice(0, split), sorted.slice(split));
    }

    return groups.map(group => {
      let main = group.reduce((best, color) => color.count > best.count ? color : best);
      return { r: main.r, g: main.g, b: main.b, count: group.reduce((sum, color) => sum + color.count, 0) };
    });
  }

  // Chooses every colour a puzzle is drawn in from an album's art (RGBA bytes, as canvas's getImageData
  // gives), each one an exact colour from the art. Each object's shape is what really tells it apart, with
  // an outline taken from the art's darkest colour keeping it readable on anything, so art with few colours
  // in it still works. Otherwise: the rarest things on a board get the most eye-catching colours, and each
  // new choice is whichever differs most from those already made.
  function pickPalette(pixels){
    let counts = new Map();
    let total = 0;
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      let key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      let color = counts.get(key);
      if (color) color.count++;
      else counts.set(key, { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], count: 1 });
      total++;
    }
    if (total === 0) counts.set(0, { r: 0, g: 0, b: 0, count: 1 });

    let groups = groupColors(counts);
    let usable = groups.filter(group => group.count >= total * PALETTE_MIN_SHARE);
    if (usable.length === 0) usable = groups;

    let byLightness = [...usable].sort((a, b) => lightnessOf(a) - lightnessOf(b));
    let outline = byLightness[0];
    let light = byLightness[byLightness.length - 1];

    // Fill colours have to show up on the art, which is dimmed behind the board. A strong colour can do
    // that with less of a difference in lightness.
    let average = usable.reduce((sum, group) => sum + lightnessOf(group) * group.count, 0) / usable.reduce((sum, group) => sum + group.count, 0);
    let dimmedArt = average * PALETTE_ART_DIMMING;
    let fills = usable.filter(group => {
      let contrast = Math.abs(lightnessOf(group) - dimmedArt);
      let clearOfOutline = lightnessOf(group) - lightnessOf(outline) >= PALETTE_MIN_CONTRAST;
      return clearOfOutline && (contrast >= PALETTE_MIN_CONTRAST || (contrast >= PALETTE_MIN_CONTRAST / 2 && vividnessOf(group) >= 110));
    });
    if (fills.length === 0) fills = usable;

    let chosen = [];
    let choose = (score) => {
      let candidates = fills.filter(group => !chosen.includes(group));
      if (candidates.length === 0) candidates = fills;
      let best = candidates.reduce((winner, group) => score(group) > score(winner) ? group : winner);
      chosen.push(best);
      return best;
    };
    let vivid = (group) => vividnessOf(group) + lightnessOf(group) * 0.4;
    let different = (group) => chosen.length === 0
      ? vivid(group)
      : Math.min(...chosen.map(other => colorDistance(group, other))) + vivid(group) * 0.5;

    let finish = choose(vivid);
    let key = choose(different);
    let teleporter = choose(different);
    let gate = choose(different); // a Gate and its Switch are one idea, so they share a colour
    let stream = choose(different);
    // The most common object, so the one thing here that shouldn't be shouting: the plainest of what's left.
    let wall = choose((group) => lightnessOf(group) * 0.5 - vividnessOf(group) + (chosen.length ? Math.min(...chosen.map(other => colorDistance(group, other))) * 0.25 : 0));
    // Added after the others, so that they keep the colours they've always had.
    let rotator = choose(different); // a Rotator tile and its Switch are one idea, like a Gate and its Switch
    let lantern = choose(different);
    // A Push Block's metal: a plain, mid-toned colour, away from the lightest, which its symbol is drawn in, and
    // standing apart from what's been chosen. Art with only a few colours may still leave it near the lightest - see
    // buildSprite, which draws the symbol dark then.
    let block = choose((group) => -vividnessOf(group) * 0.5 - Math.abs(lightnessOf(group) - 95) + Math.min(...chosen.map(other => colorDistance(group, other))) * 0.25 + Math.min(colorDistance(group, light), 150) * 0.3);
    let jump = choose(different);
    let reset = choose(different);
    let pipe = choose(different);

    return {
      wall: toHex(wall),
      finish: toHex(finish),
      gate: toHex(gate),
      switch: toHex(gate),
      teleporter: toHex(teleporter),
      stream: toHex(stream),
      key: toHex(key),
      rotator: toHex(rotator),
      rotatorSwitch: toHex(rotator),
      lantern: toHex(lantern),
      block: toHex(block),
      jump: toHex(jump),
      reset: toHex(reset),
      pipe: toHex(pipe),
      outline: toHex(outline),
      light: toHex(light),
    };
  }

  // ---------- textures ----------

  // One square of the board, and the album art, in the art's own pixels.
  const TILE_PX = 24;
  const ART_PX = TILE_PX * BOARD_SIZE;

  // Every role that has a texture of its own. A Switch shares its Gate's, as it does its colour.
  const TEXTURE_ROLES = ['wall', 'finish', 'gate', 'teleporter', 'stream', 'key', 'rotator', 'lantern', 'block', 'jump', 'reset', 'pipe'];
  // The 4 shades of a role's colour, darkest first: how far each is aimed from the main colour in lightness,
  // and how much of an object it covers unless a drawing's mix says otherwise. A shade the art has nothing
  // like is filled in by its neighbour towards the main colour.
  const TEXTURE_SHADES = [
    { offset: -30, share: 0.15 },
    { offset: -14, share: 0.25 },
    { offset: 0, share: 0.45 },
    { offset: 16, share: 0.15 },
  ];
  const MAIN_SHADE = 2;
  // How close a colour in the art has to be to count as a shade of one, or towards finding a patch of it.
  const TEXTURE_SHADE_DISTANCE = 110;
  const TEXTURE_PATCH_DISTANCE = 70;
  const TEXTURE_PATCH_STEP = 4;
  // How many levels of lightness a grain is stored in, as one base-36 digit per pixel.
  const GRAIN_LEVELS = 36;

  function hexToColor(hex){
    let value = parseInt(hex.slice(1), 16);
    return { r: value >> 16, g: (value >> 8) & 255, b: value & 255 };
  }

  // Works out what each object's colour needs from an album's art (RGBA bytes, width x height): its 4 shades,
  // each an exact colour from the art, and the grain of wherever the art has the most of it, as a lightness
  // per pixel. A drawing's mix lays its colours out in that grain (see mixTexture), so objects carry the
  // album's own texture and dithering, but still read as themselves rather than blending into the art. Also
  // which shade goes where in the colour's Standard look, worked out as it always has been, so that a
  // Standard object looks just as it did before mixes.
  function pickTextures(pixels, width, height, palette){
    let colors = new Map();
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      let key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      colors.set(key, (colors.get(key) ?? 0) + 1);
    }
    let artColors = [...colors.keys()].map(key => ({ r: key >> 16, g: (key >> 8) & 255, b: key & 255 }));

    let textures = {};
    for (const role of TEXTURE_ROLES) {
      let color = hexToColor(palette[role]);
      let found = pickShades(color, artColors);
      let patch = findPatch(pixels, width, height, color);
      textures[role] = {
        ramp: fillShades(found).map(toHex),
        grain: grainOf(pixels, width, height, patch),
        pixels: patternOf(pixels, width, height, patch, found),
      };
    }
    return textures;
  }

  // The art's colours nearest each shade wanted, darkest first, or null for one the art has nothing like.
  function pickShades(color, artColors){
    let near = artColors.filter(other => colorDistance(other, color) <= TEXTURE_SHADE_DISTANCE);

    return TEXTURE_SHADES.map(shade => {
      if (shade.offset === 0) return color;
      let wanted = lightnessOf(color) + shade.offset;
      let best = null;
      for (const other of near) {
        let miss = Math.abs(lightnessOf(other) - wanted);
        if (miss <= Math.abs(shade.offset) / 2 && (!best || miss < best.miss)) best = { other, miss };
      }
      return best?.other ?? null;
    });
  }

  // Each missing shade filled in by its neighbour towards the main colour.
  function fillShades(shades){
    return shades.map((shade, index) => {
      let step = index < MAIN_SHADE ? 1 : -1;
      for (let i = index; shade === null; i += step) shade = shades[i + step];
      return shade;
    });
  }

  // The top-left of the square of art holding the most of a colour, using a running total of matching
  // pixels so that trying every position stays quick.
  function findPatch(pixels, width, height, color){
    let totals = new Int32Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let i = (y * width + x) * 4;
        let matches = colorDistance({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }, color) <= TEXTURE_PATCH_DISTANCE ? 1 : 0;
        totals[(y + 1) * (width + 1) + x + 1] = matches + totals[y * (width + 1) + x + 1] + totals[(y + 1) * (width + 1) + x] - totals[y * (width + 1) + x];
      }
    }

    let best = { x: 0, y: 0, score: -1 };
    for (let y = 0; y + TILE_PX <= height; y += TEXTURE_PATCH_STEP) {
      for (let x = 0; x + TILE_PX <= width; x += TEXTURE_PATCH_STEP) {
        let bottom = y + TILE_PX, right = x + TILE_PX, row = width + 1;
        let score = totals[bottom * row + right] - totals[y * row + right] - totals[bottom * row + x] + totals[y * row + x];
        if (score > best.score) best = { x, y, score };
      }
    }
    return best;
  }

  // The lightness of each pixel of a square patch of art.
  function patchLightness(pixels, width, height, patch){
    let values = [];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let i = (Math.min(patch.y + y, height - 1) * width + Math.min(patch.x + x, width - 1)) * 4;
        values.push(lightnessOf({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }));
      }
    }
    return values;
  }

  // A patch of art as one digit per pixel, each the shade to draw there in the Standard look. Stretches the
  // patch's own range of lightness across the shades the art has, so that even a nearly flat patch shows its
  // pattern, sharing them out in proportion to the first that many shares, which is how it's always been done.
  function patternOf(pixels, width, height, patch, found){
    let values = patchLightness(pixels, width, height, patch);
    let sorted = [...values].sort((a, b) => a - b);
    let flat = sorted[0] === sorted[sorted.length - 1];

    // Which of the 4 shades each one the art has is, and how far through the patch's lightness each ends.
    let present = found.map((shade, index) => shade ? index : -1).filter(index => index !== -1);
    let shares = TEXTURE_SHADES.slice(0, present.length);
    let walked = 0;
    let total = shares.reduce((sum, shade) => sum + shade.share, 0);
    let limits = shares.map(shade => {
      walked += shade.share / total;
      return sorted[Math.min(sorted.length - 1, Math.floor(walked * sorted.length))];
    });

    return values.map(value => {
      if (flat) return MAIN_SHADE;
      let index = limits.findIndex(limit => value <= limit);
      return present[index === -1 ? present.length - 1 : index];
    }).join('');
  }

  // A patch of art as one base-36 digit per pixel, its lightness there. Stretches the patch's own range of
  // lightness across every level, so that even a nearly flat patch shows its pattern.
  function grainOf(pixels, width, height, patch){
    let values = patchLightness(pixels, width, height, patch);
    let darkest = Math.min(...values), lightest = Math.max(...values);
    let range = lightest - darkest || 1;
    return values.map(value => Math.round((value - darkest) / range * (GRAIN_LEVELS - 1)).toString(36)).join('');
  }

  // ---------- mixes ----------

  // The mix an object has unless its drawing says otherwise: its own colour's 4 shades, mostly the main one.
  function standardMix(role){
    return TEXTURE_SHADES.map((shade, index) => ({ role, shade: index, percent: Math.round(shade.share * 100) }));
  }

  // One of a mix's colours: a shade of an object's colour, or the outline or light colour, which have no shades.
  function mixColorOf(look, row){
    let { palette, textures } = look;
    let texture = textures?.[row.role];
    if (!texture) return hexToColor(palette[row.role] ?? palette.wall);
    if (texture.grain) return hexToColor(texture.ramp[row.shade] ?? texture.ramp[MAIN_SHADE]);

    // Saved before textures had all 4 shades: only the shades the art had, with its own colour among them.
    let main = Math.max(0, texture.ramp.indexOf(palette[row.role]));
    let index = Math.min(texture.ramp.length - 1, Math.max(0, main + row.shade - MAIN_SHADE));
    return hexToColor(texture.ramp[index]);
  }

  // A texture's grain as a number per pixel, or null if it has none. One saved before grains were stored only
  // has which of its shades went where in its Standard look, which is a coarser grain but the same pattern.
  function grainValuesOf(texture){
    let digits = texture?.grain ?? texture?.pixels;
    return digits?.length === TILE_PX * TILE_PX ? [...digits].map(digit => parseInt(digit, 36)) : null;
  }

  function isMix(rows, other){
    return rows.length === other.length && rows.every((row, i) => row.role === other[i].role && row.shade === other[i].shade && row.percent === other[i].percent);
  }

  // Breaks ties between pixels of the same lightness in a scattered order, rather than top to bottom.
  function scatter(index){
    return Math.imul(index + 1, 2654435761) >>> 0;
  }

  const mixCaches = new WeakMap();

  // A mix of colours (a list of { role, shade, percent }) laid out across a square: colours, darkest first,
  // and for each pixel which of them goes there. The grain of the colour with the most of the mix decides
  // where: its darkest pixels get the darkest colour, and so on, each colour covering its percentage of them.
  function mixTexture(look, mix){
    let cache = mixCaches.get(look);
    if (!cache) mixCaches.set(look, cache = new Map());
    let key = JSON.stringify(mix);
    if (cache.has(key)) return cache.get(key);

    let rows = (mix ?? []).filter(row => row.percent > 0).slice(0, 4);
    if (rows.length === 0) rows = [{ role: 'wall', shade: MAIN_SHADE, percent: 100 }];
    let biggest = rows.reduce((best, row) => row.percent > best.percent ? row : best);

    let mixed;
    let own = look.textures?.[rows[0].role];
    if (own?.pixels && isMix(rows, standardMix(rows[0].role))) {
      // A colour's own standard mix keeps exactly the pattern its texture was made with: its Standard look.
      let colors = own.ramp.map(hexToColor);
      mixed = { colors, pixels: [...own.pixels].map(Number), main: Math.max(0, own.ramp.indexOf(look.palette[rows[0].role])) };
    } else {
      let colored = rows
        .map(row => ({ row, color: mixColorOf(look, row) }))
        .sort((a, b) => lightnessOf(a.color) - lightnessOf(b.color));
      let colors = colored.map(entry => entry.color);
      let main = colored.findIndex(entry => entry.row === biggest);

      let grainRow = [...rows].sort((a, b) => b.percent - a.percent).find(row => grainValuesOf(look.textures?.[row.role]));
      let grain = grainRow ? grainValuesOf(look.textures[grainRow.role]) : null;
      let pixels = new Array(TILE_PX * TILE_PX).fill(main);

      if (grain && new Set(grain).size > 1) {
        let order = grain.map((value, index) => index).sort((a, b) => grain[a] - grain[b] || scatter(a) - scatter(b));
        let total = colored.reduce((sum, entry) => sum + entry.row.percent, 0);
        let index = 0, reached = colored[0].row.percent;
        order.forEach((pixel, rank) => {
          while (index < colored.length - 1 && (rank + 0.5) / order.length * total > reached) reached += colored[++index].row.percent;
          pixels[pixel] = index;
        });
      }
      mixed = { colors, pixels, main };
    }

    cache.set(key, mixed);
    return mixed;
  }

  // ---------- drawing ----------

  // How long a Stream's liquid takes to flow one whole square. Its pattern repeats every square, so a run of them
  // flows on from one to the next without a seam.
  const STREAM_CYCLE_MS = 900;
  // A Rotator tile's chevrons: how far apart they are, and how long they take to move a square, as fast as things
  // on it do.
  const STREAM_LINE_SPACING = 8;
  const ROTATOR_CYCLE_MS = 1000;
  // A Stream's channel, across a square: from its bank on one side to its bank on the other.
  const STREAM_BANK_LOW = 3;
  const STREAM_BANK_HIGH = TILE_PX - 1 - STREAM_BANK_LOW;
  // Each streak running down a Stream: where it is across the channel, where along it starts, how long it is, how
  // far it wanders from side to side as it goes, and whether its leading pixel glints.
  const STREAM_STREAKS = [
    { across: 7, start: 0, length: 7, wander: 1, glint: true },
    { across: 11, start: 14, length: 5, wander: 1, glint: false },
    { across: 15, start: 6, length: 8, wander: 1, glint: true },
    { across: 18, start: 19, length: 4, wander: 0, glint: false },
  ];
  // Darker ripples between the streaks, for the body of the liquid.
  const STREAM_RIPPLES = [
    { across: 9, start: 9, length: 4, wander: 1 },
    { across: 13, start: 21, length: 6, wander: 1 },
    { across: 6, start: 17, length: 3, wander: 0 },
  ];

  // Each letter as 7 rows of 5 pixels.
  const PIXEL_LETTERS = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  };

  // Each shape as whether a pixel of a square is inside it, measuring from the square's center.
  const SHAPES = {
    octagon: (dx, dy) => Math.abs(dx) <= 11 && Math.abs(dy) <= 11 && Math.abs(dx) + Math.abs(dy) <= 16,
    octagonHole: (dx, dy) => Math.abs(dx) <= 7 && Math.abs(dy) <= 7 && Math.abs(dx) + Math.abs(dy) <= 10,
    roundedSquare: (dx, dy) => {
      let cornerX = Math.max(0, Math.abs(dx) - 6), cornerY = Math.max(0, Math.abs(dy) - 6);
      return Math.abs(dx) <= 9.5 && Math.abs(dy) <= 9.5 && cornerX * cornerX + cornerY * cornerY <= 3.5 * 3.5;
    },
    circle: (dx, dy) => dx * dx + dy * dy <= 10.8 * 10.8,
    diamond: (dx, dy) => Math.abs(dx) + Math.abs(dy) <= 12,
    triangle: (dx, dy) => dy >= -9.5 && dy <= 9.5 && Math.abs(dx) <= (dy + 10.5) * 0.55,
    // A ring with eight teeth.
    gear: (dx, dy) => {
      let radius = Math.hypot(dx, dy);
      let tooth = Math.cos(Math.atan2(dy, dx) * 8) > 0;
      return radius >= 3.5 && radius <= (tooth ? 11.5 : 8.5);
    },
    star: (dx, dy) => Math.abs(dx) <= 11.5 && Math.abs(dy) <= 11.5 && Math.sqrt(Math.abs(dx)) + Math.sqrt(Math.abs(dy)) <= 4.1,
  };

  const SPRITE_SHAPES = { Wall: 'octagon', Gate: 'octagon', Finish: 'roundedSquare', Switch: 'circle', Teleporter: 'diamond', Key: 'triangle', RotatorSwitch: 'gear', Lantern: 'star' };
  const SPRITE_ROLES = { Wall: 'wall', Gate: 'gate', Finish: 'finish', Switch: 'gate', Teleporter: 'teleporter', Key: 'key', Stream: 'stream', RotatorTile: 'rotator', RotatorSwitch: 'rotator', Lantern: 'lantern', PushBlock: 'block', JumpTile: 'jump', ResetSwitch: 'reset', Pipe: 'wall', PipeSwitch: 'pipe' };

  function maskOf(test){
    let mask = [];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) mask.push(test(x + 0.5 - TILE_PX / 2, y + 0.5 - TILE_PX / 2));
    }
    return mask;
  }

  // Whether a pixel of a mask is on its edge: inside it, with something outside it right next to it.
  function isEdge(mask, x, y){
    let inside = (ax, ay) => ax >= 0 && ax < TILE_PX && ay >= 0 && ay < TILE_PX && mask[ay * TILE_PX + ax];
    return inside(x, y) && !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1));
  }

  function drawPixelLetter(sprite, letter, color, halo, scale){
    let rows = PIXEL_LETTERS[letter]?.split(' ');
    if (!rows) return;

    let left = Math.floor((TILE_PX - 5 * scale) / 2), top = Math.floor((TILE_PX - 7 * scale) / 2);
    let isLetter = (x, y) => {
      let col = Math.floor((x - left) / scale), row = Math.floor((y - top) / scale);
      return rows[row]?.[col] === '1';
    };

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (isLetter(x, y)) sprite[y * TILE_PX + x] = color;
        else if (halo && (isLetter(x - 1, y) || isLetter(x + 1, y) || isLetter(x, y - 1) || isLetter(x, y + 1))) sprite[y * TILE_PX + x] = halo;
      }
    }
  }

  // ---------- drawings ----------

  // What each character of a drawing paints: nothing, the outline colour, the light colour, the drawing's mix
  // laid out in the album's grain, or one of the mix's colours (darkest first) on its own.
  const PAINTS = { clear: '.', outline: 'O', light: 'H', grain: 'G', colors: ['1', '2', '3', '4'] };

  // Floor tiles that move what's on them, and are animated to show it. Each is drawn flowing right, and turned for
  // the other directions: a Still layer that stays put, and a Flow layer that runs along it, wrapping around, so a
  // line of them flows on from one square to the next. A Stream also has a Bend, for where another pours into it
  // from its left - see streamJoins.
  const ANIMATED_KINDS = ['Stream', 'RotatorTile'];

  // Objects with a direction, drawn pointing right and turned the way they point, as animated tiles are.
  const TURNED_KINDS = ['JumpTile', 'Pipe'];

  // Every kind of object drawn from a drawing.
  const DRAWN_KINDS = [...Object.keys(SPRITE_SHAPES), 'PushBlock', ...TURNED_KINDS, 'ResetSwitch', 'PipeSwitch', ...ANIMATED_KINDS];

  const standardDrawings = new Map();

  // The drawing each kind has unless the project's library redraws it: its shape, outlined, in its standard
  // mix. Its id is the kind's own name, which is also how a library tells its redrawn Standard ones apart.
  function standardDrawing(kind){
    if (!standardDrawings.has(kind)) {
      let pixelsOf = (test) => {
        let mask = maskOf(test);
        let paints = '';
        for (let y = 0; y < TILE_PX; y++) {
          for (let x = 0; x < TILE_PX; x++) paints += !mask[y * TILE_PX + x] ? PAINTS.clear : isEdge(mask, x, y) ? PAINTS.outline : PAINTS.grain;
        }
        return paints;
      };

      let drawing;
      if (kind === 'Stream') drawing = { id: kind, kind, name: 'Standard', ...standardStreamLayers(), mix: standardMix('stream') };
      else if (kind === 'RotatorTile') drawing = { id: kind, kind, name: 'Standard', ...standardRotatorLayers(), mix: standardMix('rotator') };
      else if (kind === 'PushBlock') drawing = { id: kind, kind, name: 'Standard', pixels: standardPushBlockPixels(), mix: standardMix('block') };
      else if (kind === 'JumpTile') drawing = { id: kind, kind, name: 'Standard', pixels: standardJumpTilePixels(), mix: standardMix('jump') };
      else if (kind === 'ResetSwitch') drawing = { id: kind, kind, name: 'Standard', pixels: standardResetSwitchPixels(), mix: standardMix('reset') };
      else if (kind === 'Pipe') drawing = { id: kind, kind, name: 'Standard', pixels: standardPipePixels(), mix: standardMix('wall') };
      else if (kind === 'PipeSwitch') drawing = { id: kind, kind, name: 'Standard', pixels: standardPipeSwitchPixels(), mix: standardMix('pipe') };
      else {
        let body = SHAPES[SPRITE_SHAPES[kind]];
        drawing = { id: kind, kind, name: 'Standard', pixels: pixelsOf(body), mix: standardMix(SPRITE_ROLES[kind]) };
        if (kind === 'Gate') drawing.openPixels = pixelsOf((dx, dy) => body(dx, dy) && !SHAPES.octagonHole(dx, dy));
      }
      standardDrawings.set(kind, drawing);
    }
    return standardDrawings.get(kind);
  }

  // A layer of paints from a function of where each pixel is, flowing right: u along the flow, v across it.
  function layerOf(paintAt){
    let paints = '';
    for (let v = 0; v < TILE_PX; v++) {
      for (let u = 0; u < TILE_PX; u++) paints += paintAt(u, v);
    }
    return paints;
  }

  // A Stream's Standard layers: running liquid in its colours, so that the album decides whether it's water, lava
  // or anything else. A channel, outlined where it meets the floor and darker along its banks, with lighter
  // streaks and darker ripples wandering along it, and the odd glint.
  function standardStreamLayers(){
    // Its channel, straight through or bending in from the left, with the banks along its edges and the deeper
    // liquid just inside them. Beyond the square counts as more channel, since that's where it carries on.
    let channelPaints = (inChannel) => {
      let within = (u, v) => u < 0 || v < 0 || u >= TILE_PX || v >= TILE_PX || inChannel(u, v);
      let isBank = (u, v) => within(u, v) && (!within(u - 1, v) || !within(u + 1, v) || !within(u, v - 1) || !within(u, v + 1));
      return layerOf((u, v) => {
        if (!inChannel(u, v)) return PAINTS.clear;
        if (isBank(u, v)) return PAINTS.outline;
        if (isBank(u - 1, v) || isBank(u + 1, v) || isBank(u, v - 1) || isBank(u, v + 1)) return '1';
        return '3';
      });
    };
    let inBand = (v) => v >= STREAM_BANK_LOW && v <= STREAM_BANK_HIGH;
    let pixels = channelPaints((u, v) => inBand(v));
    let bendPixels = channelPaints((u, v) => u >= STREAM_BANK_LOW && (inBand(v) || (v < STREAM_BANK_LOW && u <= STREAM_BANK_HIGH)));

    let wrap = (value) => ((value % TILE_PX) + TILE_PX) % TILE_PX;
    let onLine = (line, u, v) => {
      let into = wrap(u - line.start);
      if (into >= line.length) return null;
      return v === line.across + Math.round(Math.sin(u / TILE_PX * Math.PI * 2) * line.wander) ? into : null;
    };
    let flowPixels = layerOf((u, v) => {
      let paint = PAINTS.clear;
      for (const line of STREAM_RIPPLES) if (onLine(line, u, v) !== null) paint = '2';
      for (const line of STREAM_STREAKS) {
        let into = onLine(line, u, v);
        if (into !== null) paint = line.glint && into === line.length - 1 ? PAINTS.light : '4';
      }
      return paint;
    });
    return { pixels, bendPixels, flowPixels };
  }

  // A Push Block's Standard drawing: a metal plate, bevelled, with a panel seam inset around its middle, where its
  // symbol goes (see drawSymbol), and a rivet in each corner.
  function standardPushBlockPixels(){
    let inPlate = (u, v) => {
      let dx = Math.abs(u - 11.5), dy = Math.abs(v - 11.5);
      let cornerX = Math.max(0, dx - 7.5), cornerY = Math.max(0, dy - 7.5);
      return dx <= 10.5 && dy <= 10.5 && cornerX * cornerX + cornerY * cornerY <= 9;
    };
    let rivets = [[4, 4], [19, 4], [4, 19], [19, 19]];
    return layerOf((u, v) => {
      if (!inPlate(u, v)) return PAINTS.clear;
      if (!inPlate(u - 1, v) || !inPlate(u + 1, v) || !inPlate(u, v - 1) || !inPlate(u, v + 1)) return PAINTS.outline;
      if (!inPlate(u - 2, v) || !inPlate(u, v - 2)) return '4';
      if (!inPlate(u + 2, v) || !inPlate(u, v + 2)) return '1';
      if (rivets.some(([x, y]) => x === u && y === v)) return PAINTS.light;
      let seam = (u === 5 || u === 18) && v >= 5 && v <= 18 || (v === 5 || v === 18) && u >= 5 && u <= 18;
      if (seam) return '2';
      // Brushed: faint lighter streaks running across it.
      return v % 4 === 2 && (u * 5 + v) % 7 > 2 ? '4' : '3';
    });
  }

  // A Jump Tile's Standard drawing, pointing right: a pad lying on the floor with a double chevron on it, each with
  // a darker edge below.
  function standardJumpTilePixels(){
    let onPad = (u, v) => u >= 0 && v >= 0 && u < TILE_PX && v < TILE_PX && SHAPES.roundedSquare(u + 0.5 - TILE_PX / 2, v + 0.5 - TILE_PX / 2);
    let onChevron = (u, v) => [5, 11].some(start => {
      let across = Math.abs(v - 11.5);
      let along = u - start - (5.5 - across);
      return across <= 5.5 && along >= -1 && along <= 0.5;
    });
    return layerOf((u, v) => {
      if (!onPad(u, v)) return PAINTS.clear;
      if (!onPad(u - 1, v) || !onPad(u + 1, v) || !onPad(u, v - 1) || !onPad(u, v + 1)) return PAINTS.outline;
      if (onChevron(u, v)) return '4';
      if (onChevron(u, v - 1)) return '1';
      return '2';
    });
  }

  // A Reset Switch's Standard drawing: a pad lying on the floor, like a Jump Tile's, with two arrows chasing each
  // other round anticlockwise, each with a darker edge below. One arc runs over the top and down the left, ending
  // in a head pointing down, and the other under the bottom and up the right, ending in one pointing up.
  function standardResetSwitchPixels(){
    let onPad = (u, v) => u >= 0 && v >= 0 && u < TILE_PX && v < TILE_PX && SHAPES.roundedSquare(u + 0.5 - TILE_PX / 2, v + 0.5 - TILE_PX / 2);
    let middle = (TILE_PX - 1) / 2;
    let inner = 3.9, outer = 5.9;
    // Each arc's span, in degrees anticlockwise from pointing right, its head at the end of it.
    let arcs = [[70, 180], [250, 360]];
    let onArrow = (u, v) => {
      let radius = Math.hypot(u - middle, v - middle);
      let degrees = (Math.atan2(middle - v, u - middle) * 180 / Math.PI + 360) % 360;
      if (radius >= inner && radius <= outer && arcs.some(([from, to]) => degrees >= from && degrees <= to)) return true;
      return arcs.some(([, to]) => {
        let angle = to * Math.PI / 180;
        let du = u - (middle + Math.cos(angle) * (inner + outer) / 2);
        let dv = v - (middle - Math.sin(angle) * (inner + outer) / 2);
        // How far along the way the arc is heading, and how far to either side of it.
        let along = -du * Math.sin(angle) - dv * Math.cos(angle);
        let across = du * Math.cos(angle) - dv * Math.sin(angle);
        // Its ends sit between half-pixels, so that it comes out the same either way round.
        return along >= -0.6 && along <= 3.6 && Math.abs(across) <= 3 - along * 0.95;
      });
    };
    return layerOf((u, v) => {
      if (!onPad(u, v)) return PAINTS.clear;
      if (!onPad(u - 1, v) || !onPad(u + 1, v) || !onPad(u, v - 1) || !onPad(u, v + 1)) return PAINTS.outline;
      if (onArrow(u, v)) return '4';
      if (onArrow(u, v - 1)) return '1';
      return '2';
    });
  }

  // A Pipe's Standard drawing, lying across: a Wall's top and bottom edges with the middle hollowed out, running
  // right across the square so that a line of them joins up. Turned to stand up.
  function standardPipePixels(){
    return layerOf((u, v) => {
      if (v === 2 || v === 6 || v === 17 || v === 21) return PAINTS.outline;
      if (v === 3) return '4';
      if (v === 20) return '1';
      if ((v > 3 && v < 6) || (v > 17 && v < 20)) return PAINTS.grain;
      return PAINTS.clear;
    });
  }

  // A Pipe Switch's Standard drawing: a Reset Switch's pad, with two lines across it in place of its arrows, each
  // with a darker edge below.
  function standardPipeSwitchPixels(){
    let onPad = (u, v) => u >= 0 && v >= 0 && u < TILE_PX && v < TILE_PX && SHAPES.roundedSquare(u + 0.5 - TILE_PX / 2, v + 0.5 - TILE_PX / 2);
    let onLine = (u, v) => u >= 6 && u <= 17 && (v === 8 || v === 9 || v === 14 || v === 15);
    return layerOf((u, v) => {
      if (!onPad(u, v)) return PAINTS.clear;
      if (!onPad(u - 1, v) || !onPad(u + 1, v) || !onPad(u, v - 1) || !onPad(u, v + 1)) return PAINTS.outline;
      if (onLine(u, v)) return '4';
      if (onLine(u, v - 1)) return '1';
      return '2';
    });
  }

  // A Rotator tile's Standard layers: two rails, with chevrons between them pointing along them.
  function standardRotatorLayers(){
    let pixels = layerOf((u, v) => {
      if (v === 1 || v === 3 || v === 20 || v === 22) return PAINTS.outline;
      return v === 2 || v === 21 ? PAINTS.grain : PAINTS.clear;
    });
    let flowPixels = layerOf((u, v) => {
      if (v <= 3 || v >= 20) return PAINTS.clear;
      let fromMiddle = Math.floor(Math.abs(v - (TILE_PX - 1) / 2));
      let moved = (u + fromMiddle) % STREAM_LINE_SPACING;
      if (moved > 3) return PAINTS.clear;
      return moved === 0 || moved === 3 ? PAINTS.outline : PAINTS.grain;
    });
    return { pixels, flowPixels };
  }

  // The drawing an object is drawn with: its variant from the library, or else its kind's Standard one, as
  // the library has it if it's been redrawn.
  function drawingFor(look, object){
    let find = (id) => look.drawings?.find(drawing => drawing.id === id && drawing.kind === object.kind);
    return (object.variant && find(object.variant)) || find(object.kind) || standardDrawing(object.kind);
  }

  function paintColor(paint, mix, index, outline, light){
    if (paint === PAINTS.outline) return outline;
    if (paint === PAINTS.light) return light;
    if (paint === PAINTS.grain) return mix.colors[mix.pixels[index]];
    let color = PAINTS.colors.indexOf(paint);
    return color === -1 ? null : mix.colors[Math.min(color, mix.colors.length - 1)];
  }

  // A square's worth of pixels for one object: a colour per pixel, or null where it's see-through.
  function buildSprite(object, look, switchesActive){
    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);

    let isOpenGate = object.kind === 'Gate' && object.open;
    let isDim = (object.kind === 'Switch' && !switchesActive) || (object.kind === 'Lantern' && !object.lit);

    let drawing = drawingFor(look, object);
    let paints = isOpenGate ? drawing.openPixels ?? standardDrawing('Gate').openPixels : drawing.pixels;
    let mix = mixTexture(look, drawing.mix);
    let turn = TURNED_KINDS.includes(object.kind) ? FLOW_TURNS[object.direction] ?? FLOW_TURNS.Right : null;

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let index = y * TILE_PX + x;
        let [u, v] = turn ? turn(x, y) : [x, y];
        let color = paintColor(paints[v * TILE_PX + u], mix, index, outline, light);
        if (!color) continue;
        // De-activated: every other pixel gives way to the outline's colour, the classic look of something disabled.
        sprite[index] = isDim && (x + y) % 2 === 0 ? outline : color;
      }
    }

    if (object.kind === 'Gate' || object.kind === 'Switch' || object.kind === 'Teleporter') {
      // Whichever of the art's lightest and darkest colours stands out from this shape the most. An open
      // Gate's letter has only the art behind it, so that one gets a dark edge to stand out from it.
      let fill = mix.colors[mix.main];
      let useDark = Math.abs(lightnessOf(fill) - lightnessOf(outline)) >= Math.abs(lightnessOf(fill) - lightnessOf(light));
      // Twice the alphabet's size where it fits. A diamond narrows too quickly for that, so its stays small.
      let scale = object.kind === 'Teleporter' ? 1 : 2;
      if (isOpenGate || isDim) drawPixelLetter(sprite, object.letter, light, outline, scale);
      else drawPixelLetter(sprite, object.letter, useDark ? outline : light, null, scale);
    }

    if (object.kind === 'PushBlock') {
      // In the light colour, unless the block's own colour is too near it to show, as with a Gate's letter.
      let fill = mix.colors[mix.main];
      let tooLight = Math.abs(lightnessOf(fill) - lightnessOf(light)) < PALETTE_MIN_CONTRAST;
      let lightest = mix.colors[mix.colors.length - 1];
      drawSymbol(sprite, object.symbol, tooLight ? outline : light, tooLight || lightest === fill ? null : lightest);
    }

    // Turned before its depth is added, so that its raised edge stays at the bottom whichever way round it is.
    if (object.spin) sprite = spunBy(sprite, object.spin);

    let solid = object.kind === 'Wall' || object.kind === 'PushBlock' || (object.kind === 'Gate' && !isOpenGate);
    return addDepth(sprite, look, solid, mix, outline, light);
  }

  // A Rotator Switch turns clockwise while the ship stands on it, in SPIN_STEPS steps a turn, each one's sprite kept
  // like any other. An object's spin is how many steps round it is.
  const SPIN_STEPS = 32;
  const SPIN_TURN_MS = 2000;

  // Which step of its turn a Rotator Switch is at, after being stood on for ms.
  function spinAt(ms){
    return Math.floor(ms / (SPIN_TURN_MS / SPIN_STEPS)) % SPIN_STEPS;
  }

  // A square's pixels turned clockwise about its middle, each pixel taken from wherever it turned from.
  function spunBy(sprite, steps){
    let angle = steps / SPIN_STEPS * Math.PI * 2;
    let cos = Math.cos(angle), sin = Math.sin(angle);
    let middle = (TILE_PX - 1) / 2;
    let spun = new Array(TILE_PX * TILE_PX).fill(null);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let dx = x - middle, dy = y - middle;
        let fromX = Math.round(middle + dx * cos + dy * sin);
        let fromY = Math.round(middle - dx * sin + dy * cos);
        if (fromX >= 0 && fromX < TILE_PX && fromY >= 0 && fromY < TILE_PX) spun[y * TILE_PX + x] = sprite[fromY * TILE_PX + fromX];
      }
    }
    return spun;
  }

  // A Push Block's symbol, as a hollow outline 9 pixels across, so that two that match read at a glance.
  const SYMBOLS = {
    Circle: '..XXXXX.. .X.....X. X.......X X.......X X.......X X.......X X.......X .X.....X. ..XXXXX..',
    Cross: 'X.......X .X.....X. ..X...X.. ...X.X... ....X.... ...X.X... ..X...X.. .X.....X. X.......X',
    Triangle: '....X.... ....X.... ...X.X... ...X.X... ..X...X.. ..X...X.. .X.....X. .X.....X. XXXXXXXXX',
    Square: 'XXXXXXXXX X.......X X.......X X.......X X.......X X.......X X.......X X.......X XXXXXXXXX',
    Star: '....X.... ...X.X... XXX...XXX X.......X .X.....X. ..X...X.. .X..X..X. .X.X.X.X. .XX...XX.',
  };
  const SYMBOL_PX = 9;

  // The symbol drawn in the light colour, glowing like neon: a halo just outside it, side by side with it, in glow (the
  // block's own lightest shade). Only outside, so that a hollow symbol stays hollow, and its shape stays clear.
  function drawSymbol(sprite, symbol, color, glow){
    let rows = SYMBOLS[symbol]?.split(' ');
    if (!rows) return;
    let start = Math.floor((TILE_PX - SYMBOL_PX) / 2);
    let on = (x, y) => rows[y - start]?.[x - start] === 'X';

    // Everything that can be reached from the edge of the square without crossing the symbol is outside it.
    let outside = new Set();
    let queue = [[0, 0]];
    while (queue.length > 0) {
      let [x, y] = queue.pop();
      let key = y * TILE_PX + x;
      if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX || outside.has(key) || on(x, y)) continue;
      outside.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let glowing = glow && outside.has(y * TILE_PX + x) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1));
        if (on(x, y)) sprite[y * TILE_PX + x] = color;
        else if (glowing) sprite[y * TILE_PX + x] = glow;
      }
    }
  }

  // ---------- depth ----------

  // Objects are drawn with depth, worked out from their flat sprite in their own colours, so that any drawing gets
  // it and it stays pixel art. Solid ones, that block the way, stand up like blocks seen from slightly above: their
  // top drawn RAISED_PX higher, into the square above, with a darker front face below it, a lit top-left edge, and a
  // dithered shadow. The ones stepped onto lie on the floor, with just the lit edge and a smaller shadow. look.depth
  // 'flat' leaves them as drawn, for the Editor's painter, where every pixel has to be where it's painted.
  const RAISED_PX = 3;

  // The light and dark that depth is shaded with: the mix's own lightest and darkest, or, for a mix of only one
  // colour, the art's lightest and darkest.
  function depthShades(mix, outline, light){
    return mix.colors.length > 1
      ? { lit: mix.colors[mix.colors.length - 1], dark: mix.colors[0] }
      : { lit: light, dark: outline };
  }

  // A sprite with depth added. One that rises above its square has extra rows on top, how many being its rise.
  function addDepth(flat, look, solid, mix, outline, light){
    if (look.depth === 'flat') return flat;

    let { lit, dark } = depthShades(mix, outline, light);
    let rise = solid ? RAISED_PX : 0;
    let sprite = new Array(TILE_PX * (TILE_PX + rise)).fill(null);
    // x and y in the square's own pixels, y going negative into the rows above it.
    let flatAt = (x, y) => x >= 0 && x < TILE_PX && y >= 0 && y < TILE_PX ? flat[y * TILE_PX + x] : null;
    let set = (x, y, color) => { sprite[(y + rise) * TILE_PX + x] = color; };

    // The front face: everything the object covers on its way up, darker, outlined where it meets the floor.
    if (rise) {
      let covered = (x, y) => { for (let k = 0; k <= rise; k++) if (flatAt(x, y + k)) return true; return false; };
      for (let y = -rise; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          if (!covered(x, y)) continue;
          set(x, y, !covered(x - 1, y) || !covered(x + 1, y) || !covered(x, y + 1) ? outline : dark);
        }
      }
    }

    // The face itself, lifted by its rise, lit along its top-left just inside its outline.
    let face = (x, y) => flatAt(x, y + rise);
    let insideAt = (x, y) => { let color = face(x, y); return color && color !== outline; };
    for (let y = -rise; y < TILE_PX - rise; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let color = face(x, y);
        if (!color) continue;
        if (mix.colors.includes(color) && (!insideAt(x - 1, y) || !insideAt(x, y - 1))) color = lit;
        set(x, y, color);
      }
    }

    // A dithered shadow down and to the right, on the floor within the square: smaller under something lying on it.
    let offset = solid ? 2 : 1;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if ((x + y) % 2 !== 0 || sprite[(y + rise) * TILE_PX + x]) continue;
        if (flatAt(x - offset, y - offset)) set(x, y, outline);
      }
    }

    sprite.rise = rise;
    return sprite;
  }

  // Which of a Stream's layers its square is drawn from: straight through, if a Stream flows in from straight
  // behind it or none flows in from anywhere (where a Stream begins, it runs in from the edge), and bending in from
  // either side that a Stream pours in from. So a run of them reads as one channel, a bend opens towards whatever
  // pours into it, and two side by side stay apart.
  function streamJoins(object, streams){
    let { x, y } = DIRECTION_DELTAS[object.direction];
    let flowsIn = (dx, dy) => {
      let from = streams.get((object.col + dx) + ',' + (object.row + dy));
      return !!from && DIRECTION_DELTAS[from].x === -dx && DIRECTION_DELTAS[from].y === -dy;
    };
    // Its left and right, looking downstream.
    let left = flowsIn(y, -x), right = flowsIn(-y, x);
    return { back: flowsIn(-x, -y) || (!left && !right), left, right };
  }

  // Where a pixel of a square is in a drawing flowing right, for a tile flowing each way: u along the flow and v
  // across it, so the drawing's top is always on the flow's left.
  const FLOW_TURNS = {
    Right: (x, y) => [x, y],
    Down: (x, y) => [y, TILE_PX - 1 - x],
    Left: (x, y) => [TILE_PX - 1 - x, TILE_PX - 1 - y],
    Up: (x, y) => [TILE_PX - 1 - y, x],
  };

  const isLiquid = (paint) => paint !== PAINTS.clear && paint !== PAINTS.outline;

  // A Stream or Rotator tile, turned to the way it flows, its Flow layer moved phase pixels along. A Stream's Flow
  // only shows on its liquid, so that it keeps to the channel round a bend; a Rotator tile's shows anywhere. Where
  // a Stream's straight and bending channels meet, liquid wins over a bank, and a bank over nothing.
  function buildAnimatedSprite(object, look, phase, joins = { back: true, left: false, right: false }){
    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let drawing = drawingFor(look, object);
    let standard = standardDrawing(object.kind);
    let still = drawing.pixels;
    let bend = drawing.bendPixels ?? standard.bendPixels;
    let flow = drawing.flowPixels ?? standard.flowPixels;
    let isStream = object.kind === 'Stream';
    let mix = mixTexture(look, drawing.mix);
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);
    let turn = FLOW_TURNS[object.direction] ?? FLOW_TURNS.Right;
    let rank = (paint) => paint === undefined ? -1 : isLiquid(paint) ? 2 : paint === PAINTS.outline ? 1 : 0;

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let [u, v] = turn(x, y);
        let paint = still[v * TILE_PX + u];
        if (isStream) {
          let layers = [joins.back ? paint : undefined, joins.left ? bend[v * TILE_PX + u] : undefined, joins.right ? bend[(TILE_PX - 1 - v) * TILE_PX + u] : undefined];
          paint = layers.reduce((best, layer) => rank(layer) > rank(best) ? layer : best, undefined) ?? PAINTS.clear;
        }
        let moving = flow[v * TILE_PX + (((u - phase) % TILE_PX) + TILE_PX) % TILE_PX];
        if (moving !== PAINTS.clear && (!isStream || isLiquid(paint))) paint = moving;

        let index = y * TILE_PX + x;
        sprite[index] = paintColor(paint, mix, index, outline, light);
      }
    }
    return sprite;
  }

  // A drawing's layer on its own, flowing right, for the Drawings view to paint on: Still or Bend, or Flow over the
  // Still layer, shown wherever it's painted, so that nothing painted is hidden.
  function renderDrawingLayer(image, drawing, look, layer){
    let standard = standardDrawing(drawing.kind);
    let mix = mixTexture(look, drawing.mix);
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);
    let base = layer === 'bend' ? drawing.bendPixels ?? standard.bendPixels : drawing.pixels;
    let flow = layer === 'flow' ? drawing.flowPixels ?? standard.flowPixels : null;
    image.data.fill(0);
    for (let index = 0; index < TILE_PX * TILE_PX; index++) {
      let paint = flow && flow[index] !== PAINTS.clear ? flow[index] : base[index];
      let color = paintColor(paint, mix, index, outline, light);
      if (color) image.data.set([color.r, color.g, color.b, 255], (Math.floor(index / TILE_PX) * image.width + index % TILE_PX) * 4);
    }
  }

  // Sprites are only worth working out once per look, since there are only so many things to be drawn.
  const spriteCaches = new WeakMap();

  function spriteKey(object, switchesActive, streamPhase, rotatorPhase, joins){
    if (object.kind === 'Stream') return `Stream|${object.variant ?? ''}|${object.direction}|${streamPhase}|${joins.back}|${joins.left}|${joins.right}`;
    if (object.kind === 'RotatorTile') return `RotatorTile|${object.variant ?? ''}|${object.direction}|${rotatorPhase}`;
    return `${object.kind}|${object.variant ?? ''}|${object.letter ?? ''}|${object.symbol ?? ''}|${object.direction ?? ''}|${object.kind === 'Gate' && !!object.open}|${object.kind === 'Switch' && !switchesActive}|${!!object.lit}|${object.spin ?? 0}`;
  }

  function spriteFor(object, look, switchesActive, streamPhase, rotatorPhase, streams){
    let cache = spriteCaches.get(look);
    if (!cache) spriteCaches.set(look, cache = new Map());

    let joins = object.kind === 'Stream' ? streamJoins(object, streams) : null;
    let key = spriteKey(object, switchesActive, streamPhase, rotatorPhase, joins);
    let sprite = cache.get(key);
    if (!sprite) {
      if (object.kind === 'Stream') sprite = buildAnimatedSprite(object, look, streamPhase, joins);
      else if (object.kind === 'RotatorTile') sprite = buildAnimatedSprite(object, look, rotatorPhase);
      else sprite = buildSprite(object, look, switchesActive);
      cache.set(key, sprite);
    }
    return sprite;
  }

  // For the Editor, where something invisible still has to be seen: every other pixel of it, see-through.
  function ghostOf(sprite){
    let rise = sprite.rise ?? 0;
    let ghost = sprite.map((color, i) => (Math.floor(i / TILE_PX) + rise + i % TILE_PX) % 2 === 0 ? color : null);
    ghost.rise = rise;
    return ghost;
  }

  // A sprite that rises above its square starts that many rows higher. Nothing is drawn from below clipBottom, which
  // is how something sinking into its square disappears into the ground. opacity below 1 lays it over whatever's
  // already there, partly see-through, which is how something fades in or out.
  function blit(image, sprite, left, top, clipBottom = Infinity, opacity = 1){
    let { data, width, height } = image;
    top -= sprite.rise ?? 0;
    for (let y = 0; y < sprite.length / TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let color = sprite[y * TILE_PX + x];
        let px = left + x, py = top + y;
        if (!color || px < 0 || px >= width || py < 0 || py >= height || py >= clipBottom) continue;
        let i = (py * width + px) * 4;
        if (opacity >= 1) {
          data[i] = color.r;
          data[i + 1] = color.g;
          data[i + 2] = color.b;
          data[i + 3] = 255;
          continue;
        }
        let under = data[i + 3] / 255 * (1 - opacity);
        let total = opacity + under;
        data[i] = (color.r * opacity + data[i] * under) / total;
        data[i + 1] = (color.g * opacity + data[i + 1] * under) / total;
        data[i + 2] = (color.b * opacity + data[i + 2] * under) / total;
        data[i + 3] = total * 255;
      }
    }
  }

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

  // Draws a whole board into RGBA pixel data the size of the album art, to be scaled up exactly as the art
  // is, so that every pixel of every object lands on one of the art's. Floor tiles go first, so that whatever's
  // on one sits on top of it. Start isn't drawn, since that's where the ship itself goes.
  //
  // look is { palette, textures, drawings }, drawings being the project's library (see drawingFor). Options:
  // - timeMs drives a Stream's animation, and rotatorTimeMs a Rotator tile's, which only moves when it's told to.
  // - switchesActive says whether Switches work yet.
  // - along and rotatorAlong are how far objects are through moving from their fromCol and fromRow, for
  //   ones in play, depending on which kind of tile moved them. They move in whole pixels, like everything else.
  // - showInvisible draws anything invisible and unrevealed as a ghost, rather than leaving it out.
  // - pushAlong is how far a Push Block being pushed is through its glide, along with the ship.
  // - An object's own sink, from 0 to 1, is how far it's sunk into its square, after matching - see sinkMatches.
  // - An object's own spin is how far round clockwise it's turned, as a Rotator Switch does while stood on - see spinAt.
  // - An object's own fade, from 0 to 1, is how much of it shows, as a Reset Switch's sweep passes - see resetSweepAt.
  // - pushHint ({ col, row, direction, bob }) shows that the Push Block on that square can be pushed: an arrow just
  //   past it, pointing the way it would go, bob pixels further out as it bobs.
  // - originY moves the whole board down by that many pixels, to leave room for objects rising above row 0.
  // Objects are drawn top row first, so that one rising into the square above it (see addDepth) is drawn over
  // whatever's there.
  function renderBoard(image, objects, look, options = {}){
    image.data.fill(0);

    let phaseOf = (timeMs, cycle) => Math.floor(((timeMs ?? 0) % cycle) / cycle * TILE_PX);
    let streamPhase = phaseOf(options.timeMs, STREAM_CYCLE_MS);
    let rotatorPhase = phaseOf(options.rotatorTimeMs, ROTATOR_CYCLE_MS);
    // Where every Stream is, and which way it flows, for how they join up - see streamJoins.
    let streams = new Map(objects.filter(object => object.kind === 'Stream').map(object => [object.col + ',' + object.row, object.direction]));
    let switchesActive = options.switchesActive ?? true;

    let alongFor = (object) => (object.glide === 'rotator' ? options.rotatorAlong : object.glide === 'push' ? options.pushAlong : options.along) ?? 1;
    let drawnRow = (object) => object.fromRow === undefined ? object.row : object.fromRow + (object.row - object.fromRow) * alongFor(object);
    let floorsFirst = objects
      .filter(object => object.kind !== 'Start')
      .sort((a, b) => isFloor(b) - isFloor(a) || drawnRow(a) - drawnRow(b));

    for (const object of floorsFirst) {
      let hidden = object.invisible && !object.revealed;
      if (hidden && !options.showInvisible) continue;

      let along = alongFor(object);
      let col = object.fromCol === undefined ? object.col : object.fromCol + (object.col - object.fromCol) * along;
      let row = object.fromRow === undefined ? object.row : object.fromRow + (object.row - object.fromRow) * along;
      let sprite = spriteFor(object, look, switchesActive, streamPhase, rotatorPhase, streams);
      let top = Math.round(row * TILE_PX) + (options.originY ?? 0);
      let sunk = Math.round((object.sink ?? 0) * TILE_PX);
      let opacity = object.fade ?? 1;
      if (opacity <= 0) continue;
      blit(image, hidden ? ghostOf(sprite) : sprite, Math.round(col * TILE_PX), top + sunk, object.sink ? top + TILE_PX : Infinity, opacity);
    }

    if (options.pushHint) drawPushHint(image, options.pushHint, look, options.originY ?? 0);
  }

  // An arrow pointing right, before it's turned the way a push would go.
  const PUSH_ARROW = ['...X...', '...XX..', 'XXXXXX.', 'XXXXXXX', 'XXXXXX.', '...XX..', '...X...'];
  const PUSH_ARROW_PX = 7;

  // The arrow just past a Push Block on the side it would be pushed to, in the light colour outlined in the dark.
  function drawPushHint(image, hint, look, originY){
    let light = hexToColor(look.palette.light);
    let outline = hexToColor(look.palette.outline);
    let last = PUSH_ARROW_PX - 1;
    let size = PUSH_ARROW_PX + 2;
    let turn = { Right: (u, v) => [u, v], Down: (u, v) => [last - v, u], Left: (u, v) => [last - u, last - v], Up: (u, v) => [v, last - u] }[hint.direction];
    if (!turn) return;

    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let on = (x, y) => {
      for (let v = 0; v < PUSH_ARROW_PX; v++) {
        for (let u = 0; u < PUSH_ARROW_PX; u++) {
          let [tx, ty] = turn(u, v);
          if (tx === x && ty === y && PUSH_ARROW[v][u] === 'X') return true;
        }
      }
      return false;
    };
    for (let y = -1; y <= PUSH_ARROW_PX; y++) {
      for (let x = -1; x <= PUSH_ARROW_PX; x++) {
        let color = on(x, y) ? light : [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => on(x + dx, y + dy))) ? outline : null;
        if (color) sprite[(y + 1) * TILE_PX + x + 1] = color;
      }
    }

    let gap = 1 + (hint.bob ?? 0);
    let middle = Math.floor((TILE_PX - size) / 2);
    let left = hint.col * TILE_PX, top = hint.row * TILE_PX + originY;
    let placed = {
      Right: [left + TILE_PX + gap, top + middle],
      Left: [left - size - gap, top + middle],
      Down: [left + middle, top + TILE_PX + gap],
      Up: [left + middle, top - size - gap],
    }[hint.direction];
    blit(image, sprite, placed[0], placed[1]);
  }

  return { BOARD_SIZE, DEFAULT_START, LETTERS, TILE_PX, ART_PX, placeObject, eraseObject, exitDirectionOf, entranceFrom, entranceAfter, blockingEntrance, suggestLetter, pickPalette, pickTextures, renderBoard, hasFinish, createPuzzleGame,
    RESET_FADE_MS, RESET_SWEEP_STEP_MS, resetSweepMs, resetSweepAt, spinAt, SPIN_STEPS,
    PAINTS, DRAWN_KINDS, ANIMATED_KINDS, TURNED_KINDS, SYMBOLS, SPRITE_ROLES, TEXTURE_SHADES, standardDrawing, standardMix, mixTexture, renderDrawingLayer, RAISED_PX };
});
