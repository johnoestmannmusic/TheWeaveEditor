// puzzleDrawings.js
// The Puzzle Editor's Drawings view: the project's library of pixel art for Sokoban objects, shared by every
// puzzle. Each drawing is painted 24x24, one pixel per pixel of the album art, in paints that puzzle.js
// recolours from each album's palette (see its buildSprite and mixTexture). Like the board, nothing here is
// the real copy: every change sends the whole new library to the C# side, and comes back in the next
// project-state (see syncDrawings), which is also how undo reaches this view.

const DRAWING_PAINTS = [
  { paint: '.', label: 'Clear', hint: 'Nothing: the art shows through.' },
  { paint: 'O', label: 'Outline', hint: 'The art\'s darkest colour.' },
  { paint: 'H', label: 'Light', hint: 'The art\'s lightest colour.' },
  { paint: 'G', label: 'Grain', hint: 'The mix, laid out in the album art\'s own pattern.' },
  { paint: '1', label: 'Colour 1', hint: 'The mix\'s darkest colour, on its own.' },
  { paint: '2', label: 'Colour 2', hint: 'The mix\'s second colour, on its own.' },
  { paint: '3', label: 'Colour 3', hint: 'The mix\'s third colour, on its own.' },
  { paint: '4', label: 'Colour 4', hint: 'The mix\'s fourth colour, on its own.' },
];

const DRAWING_SHADES = ['Darkest', 'Dark', 'Main', 'Light'];
const DRAWING_ROLE_LABELS = {
  wall: 'Wall', finish: 'Finish', gate: 'Gate + Switch', teleporter: 'Teleporter', stream: 'Stream',
  key: 'Key', rotator: 'Rotator', lantern: 'Lantern', outline: 'Outline', light: 'Light',
};
const DRAWING_MAX_MIX = 4;
const DRAWING_LETTERED = ['Gate', 'Switch', 'Teleporter'];
const DRAWING_PREVIEW_TILES = 3;
const DRAWING_CANDIDATES = 8;

function drawingKindLabel(kind) {
  return PUZZLE_TOOLS.find((tool) => tool.kind === kind)?.label ?? kind;
}

// Every drawing a kind can be placed with, Standard first: the library's redrawn one, or the built-in one.
function drawingsOfKind(kind) {
  const library = (project?.puzzleDrawings ?? []).filter((drawing) => drawing.kind === kind);
  return [library.find((drawing) => drawing.id === kind) ?? WeavePuzzle.standardDrawing(kind), ...library.filter((drawing) => drawing.id !== kind)];
}

// A kind's drawing sets, in the order they were made - see PuzzleDrawingSet.
function drawingSetsOfKind(kind) {
  return (project?.puzzleDrawingSets ?? []).filter((set) => set.kind === kind);
}

// The drawings in a set that still exist, Standard first.
function setMembers(set) {
  return set ? drawingsOfKind(set.kind).filter((drawing) => set.drawings.includes(drawing.id)) : [];
}

function isStandardDrawing(drawing) {
  return drawing.id === drawing.kind;
}

// How many objects across every puzzle in the project are placed with a drawing.
function drawingUses(drawing) {
  let objects = 0;
  let puzzles = 0;
  const visit = (nodes) => nodes.forEach((node) => {
    const count = (node.puzzle?.objects ?? []).filter((object) => object.kind === drawing.kind && object.variant === drawing.id).length;
    objects += count;
    if (count > 0) puzzles++;
    visit(node.children ?? []);
  });
  (project?.pages ?? []).forEach((page) => visit(page.nodes));
  return { objects, puzzles };
}

// ---------- drawing them ----------

// One object drawn with a drawing, onto a canvas at the art's own pixels, starting at a square's corner. A
// drawing that isn't in the library yet, like a generated one, comes with a look that includes it.
function renderDrawingOnto(context, drawing, options = {}) {
  const look = options.look ?? puzzleLook();
  if (!look) return;

  const tiles = options.tiles ?? 1;
  const image = context.createImageData(PUZZLE_TILE_PX * tiles, PUZZLE_TILE_PX * tiles);
  const objects = [];
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      objects.push({
        kind: drawing.kind,
        col,
        row,
        lit: true,
        ...(isStandardDrawing(drawing) ? {} : { variant: drawing.id }),
        ...(options.open ? { open: true } : {}),
        ...(options.letter && DRAWING_LETTERED.includes(drawing.kind) ? { letter: 'A' } : {}),
      });
    }
  }
  WeavePuzzle.renderBoard(image, objects, look, { switchesActive: true });

  // putImageData replaces what's underneath, see-through pixels included, so it's drawn over by way of a canvas.
  const layer = document.createElement('canvas');
  layer.width = image.width;
  layer.height = image.height;
  layer.getContext('2d').putImageData(image, 0, 0);
  context.drawImage(layer, 0, 0);
}

function drawingThumbnail(drawing) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pd-thumb';
  canvas.width = PUZZLE_TILE_PX;
  canvas.height = PUZZLE_TILE_PX;
  renderDrawingOnto(canvas.getContext('2d'), drawing, { letter: true });
  return canvas;
}

// ---------- the view ----------

function openDrawings() {
  const tool = puzzleEditor.tool;
  const kind = WeavePuzzle.DRAWN_KINDS.includes(tool) ? tool : 'Wall';
  const setId = placingSet(kind).id || null;
  puzzleEditor.drawings = {
    kind,
    id: kind,
    setId, // the set being looked at, which new drawings join
    frame: 'closed',
    paint: 'G',
    tool: 'pencil',
    mirror: false,
    letter: false,
    working: null, // the drawing as it's being painted, until the stroke is saved
    stroke: null, // { paint, field, last } during a stroke
    deleting: false,
    generator: null, // the Generate panel's state while it's open - see openGenerator
  };

  document.getElementById('pe-main').classList.add('drawing-mode');
  document.getElementById('pe-drawings').hidden = false;
  document.getElementById('pe-drawings-toggle').textContent = 'Back to Board';
  document.getElementById('pd-kind').replaceChildren(...WeavePuzzle.DRAWN_KINDS.map((drawnKind) => {
    const option = document.createElement('option');
    option.value = drawnKind;
    option.textContent = drawingKindLabel(drawnKind);
    return option;
  }));

  renderDrawings();
  layoutDrawingCanvas();
}

function closeDrawings() {
  // The board places from whichever set was last being looked at.
  const { kind, setId } = puzzleEditor.drawings;
  if (setId) puzzleEditor.choices[kind] = setId;
  puzzleEditor.drawings = null;

  document.getElementById('pe-main').classList.remove('drawing-mode');
  document.getElementById('pe-drawings').hidden = true;
  document.getElementById('pe-drawings-toggle').textContent = 'Drawings';
  showPuzzleTool();
}

function escapeDrawings() {
  if (puzzleEditor.drawings.generator) {
    closeGenerator();
  } else if (puzzleEditor.drawings.deleting) {
    puzzleEditor.drawings.deleting = false;
    renderDrawings();
  } else {
    closeDrawings();
  }
}

// Brings the view back in step with the saved library, after a save, an undo, or a rejected change.
function syncDrawings() {
  const view = puzzleEditor?.drawings;
  if (!view) return;
  if (!view.stroke) view.working = null;
  if (!drawingsOfKind(view.kind).some((drawing) => drawing.id === view.id)) view.id = view.kind;
  if (!drawingSetsOfKind(view.kind).some((set) => set.id === view.setId)) view.setId = null;
  renderDrawings();
}

function currentDrawing() {
  const view = puzzleEditor.drawings;
  return view.working ?? drawingsOfKind(view.kind).find((drawing) => drawing.id === view.id);
}

// The field of a drawing the current frame paints: a Gate's open frame has its own.
function frameField(drawing) {
  return drawing.kind === 'Gate' && puzzleEditor.drawings.frame === 'open' ? 'openPixels' : 'pixels';
}

function framePixels(drawing) {
  return frameField(drawing) === 'openPixels'
    ? drawing.openPixels ?? WeavePuzzle.standardDrawing('Gate').openPixels
    : drawing.pixels;
}

// Rebuilds a part of the view only when what it shows has changed, so that a project-state can't replace a
// button mid-click, or a field while it's being typed in.
function rebuildIfChanged(element, key, build) {
  if (element.dataset.key === key) return false;
  element.dataset.key = key;
  build();
  return true;
}

function renderDrawings() {
  const view = puzzleEditor.drawings;
  const drawing = currentDrawing();
  const standard = isStandardDrawing(drawing);
  const look = puzzleLook();

  document.getElementById('pd-kind').value = view.kind;

  const variants = document.getElementById('pd-variants');
  const choices = drawingsOfKind(view.kind);
  const rebuilt = rebuildIfChanged(variants, JSON.stringify([choices.map((choice) => [choice.id, choice.name]), !!look]), () => {
    variants.replaceChildren(...choices.map((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.id = choice.id;
      button.append(drawingThumbnail(choice), choice.name);
      button.addEventListener('click', () => chooseDrawing(choice.id));
      return button;
    }));
  });
  for (const button of variants.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.id === view.id);
    // A thumbnail is only worth redrawing when its drawing has changed, or the colours have.
    const thumb = button.querySelector('canvas');
    const shown = choices.find((choice) => choice.id === button.dataset.id);
    const shownKey = JSON.stringify(shown);
    if (rebuilt || thumb.dataset.key !== shownKey || thumb.look !== look) {
      thumb.dataset.key = shownKey;
      thumb.look = look;
      const context = thumb.getContext('2d');
      context.clearRect(0, 0, thumb.width, thumb.height);
      renderDrawingOnto(context, button.dataset.id === drawing.id ? drawing : shown, { letter: true });
    }
  }

  const name = document.getElementById('pd-name');
  if (document.activeElement !== name) name.value = drawing.name;
  name.disabled = standard;

  const remove = document.getElementById('pd-delete');
  const redrawn = (project?.puzzleDrawings ?? []).some((saved) => saved.id === view.kind && saved.kind === view.kind);
  remove.textContent = standard ? 'Reset' : 'Delete';
  remove.title = standard ? 'Puts the Standard drawing back the way it was built in' : '';
  remove.disabled = standard && !redrawn;

  const confirm = document.getElementById('pd-confirm');
  confirm.hidden = !view.deleting;
  if (view.deleting) {
    const { objects, puzzles } = drawingUses(drawing);
    document.getElementById('pd-confirm-text').textContent =
      `'${drawing.name}' is used by ${objects} object${objects === 1 ? '' : 's'} on ${puzzles} board${puzzles === 1 ? '' : 's'}. They'll go back to the Standard drawing.`;
  }

  const frames = document.getElementById('pd-frames');
  frames.hidden = view.kind !== 'Gate';
  for (const button of frames.querySelectorAll('button')) button.classList.toggle('active', button.dataset.frame === view.frame);
  for (const button of document.querySelectorAll('#pd-stage-tools [data-drawing-tool]'))
    button.classList.toggle('active', button.dataset.drawingTool === view.tool);
  document.getElementById('pd-mirror').classList.toggle('active', view.mirror);
  const letter = document.getElementById('pd-letter');
  letter.hidden = !DRAWING_LETTERED.includes(view.kind);
  letter.classList.toggle('active', view.letter);

  renderDrawingSets(look);
  renderDrawingPaints(drawing, look);
  renderDrawingMix(drawing, look);
  renderGenerator(drawing, look);
  drawDrawingCanvas();
}

// The kind's sets, and which drawings are in the one being looked at.
function renderDrawingSets(look) {
  const view = puzzleEditor.drawings;
  const sets = drawingSetsOfKind(view.kind);
  const selected = sets.find((set) => set.id === view.setId) ?? null;

  const list = document.getElementById('pd-sets');
  rebuildIfChanged(list, JSON.stringify(sets.map((set) => [set.id, set.name, setMembers(set).length])), () => {
    list.replaceChildren(...sets.map((set) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.id = set.id;
      button.textContent = `${set.name} (${setMembers(set).length})`;
      button.title = 'Shows which drawings are in it. Click again to put it away.';
      button.addEventListener('click', () => {
        view.setId = view.setId === set.id ? null : set.id;
        renderDrawings();
      });
      return button;
    }));
    if (sets.length === 0) {
      const none = document.createElement('div');
      none.className = 'field-hint';
      none.textContent = 'None yet.';
      list.append(none);
    }
  });
  for (const button of list.querySelectorAll('button')) button.classList.toggle('active', button.dataset.id === view.setId);

  document.getElementById('pd-set-delete').disabled = !selected;
  document.getElementById('pd-set-detail').hidden = !selected;
  if (!selected) return;

  const name = document.getElementById('pd-set-name');
  if (document.activeElement !== name) name.value = selected.name;

  const members = document.getElementById('pd-set-members');
  const choices = drawingsOfKind(view.kind);
  rebuildIfChanged(members, JSON.stringify([selected.id, choices.map((choice) => [choice.id, choice.name]), !!look]), () => {
    members.replaceChildren(...choices.map((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.id = choice.id;
      button.title = 'Click to put it in this set, or take it out';
      button.append(drawingThumbnail(choice), choice.name);
      button.addEventListener('click', () => toggleSetMember(choice.id));
      return button;
    }));
  });
  for (const button of members.querySelectorAll('button')) button.classList.toggle('active', selected.drawings.includes(button.dataset.id));
}

function saveSets(sets) {
  sendDrawings(project?.puzzleDrawings ?? [], sets);
}

function toggleSetMember(id) {
  const view = puzzleEditor.drawings;
  saveSets((project?.puzzleDrawingSets ?? []).map((set) => {
    if (set.id !== view.setId) return set;
    return { ...set, drawings: set.drawings.includes(id) ? set.drawings.filter((member) => member !== id) : [...set.drawings, id] };
  }));
}

function renderDrawingPaints(drawing, look) {
  const view = puzzleEditor.drawings;
  const mix = look ? WeavePuzzle.mixTexture(look, drawing.mix) : null;
  const colorCount = mix?.colors.length ?? drawing.mix.length;
  const paints = DRAWING_PAINTS.filter((entry) => !/[1-4]/.test(entry.paint) || Number(entry.paint) <= colorCount);

  const list = document.getElementById('pd-paints');
  rebuildIfChanged(list, String(paints.length), () => {
    list.replaceChildren(...paints.map((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.paint = entry.paint;
      button.title = entry.hint;
      const swatch = document.createElement('canvas');
      swatch.className = 'pd-swatch';
      swatch.width = PUZZLE_TILE_PX;
      swatch.height = PUZZLE_TILE_PX;
      button.append(swatch, entry.label);
      button.addEventListener('click', () => {
        puzzleEditor.drawings.paint = entry.paint;
        renderDrawings();
      });
      return button;
    }));
  });

  if (!paints.some((entry) => entry.paint === view.paint)) view.paint = 'G';
  for (const button of list.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.paint === view.paint);
    const swatch = button.querySelector('canvas');
    const context = swatch.getContext('2d');
    context.clearRect(0, 0, swatch.width, swatch.height);
    if (!look) continue;
    swatch.classList.toggle('pd-clear', button.dataset.paint === '.');
    const hex = { O: look.palette.outline, H: look.palette.light }[button.dataset.paint];
    if (hex) {
      context.fillStyle = hex;
      context.fillRect(0, 0, swatch.width, swatch.height);
    } else if (button.dataset.paint === 'G') {
      const image = context.createImageData(PUZZLE_TILE_PX, PUZZLE_TILE_PX);
      mix.pixels.forEach((index, i) => {
        const color = mix.colors[index];
        image.data.set([color.r, color.g, color.b, 255], i * 4);
      });
      context.putImageData(image, 0, 0);
    } else if (button.dataset.paint !== '.') {
      const color = mix.colors[Number(button.dataset.paint) - 1];
      context.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      context.fillRect(0, 0, swatch.width, swatch.height);
    }
  }
}

function renderDrawingMix(drawing, look) {
  renderMixRows(document.getElementById('pd-mix'), drawing.mix, look, `${drawing.kind}|${drawing.id}`, {
    change: changeMixRow,
    remove: (index) => saveDrawing({ ...currentDrawing(), mix: currentDrawing().mix.filter((_, i) => i !== index) }),
  });
  document.getElementById('pd-mix-add').disabled = drawing.mix.length >= DRAWING_MAX_MIX;
  document.getElementById('pd-mix-total').textContent = mixTotalText(drawing.mix);
}

function mixTotalText(rows) {
  const total = rows.reduce((sum, row) => sum + row.percent, 0);
  return total === 100 ? 'Total 100%' : `Total ${total}%, taken in proportion`;
}

// A row per colour of a mix: which palette colour, which of its shades, and how much. Shared by a drawing's
// own mix and the Generate panel's balance.
function renderMixRows(list, rows, look, key, { change, remove }) {
  rebuildIfChanged(list, `${key}|${rows.length}`, () => {
    list.replaceChildren(...rows.map((row, index) => {
      const line = document.createElement('div');
      line.className = 'pd-mix-row';

      const swatch = document.createElement('span');
      swatch.className = 'pe-swatch';

      const role = document.createElement('select');
      role.className = 'pd-mix-role';
      role.title = 'Which of the palette\'s colours';
      role.append(...PUZZLE_PALETTE_ROLES.map((value) => new Option(DRAWING_ROLE_LABELS[value], value)));
      role.addEventListener('change', () => change(index, { role: role.value, ...(['outline', 'light'].includes(role.value) ? { shade: 0 } : {}) }));

      const shade = document.createElement('select');
      shade.className = 'pd-mix-shade';
      shade.title = 'Which of its shades';
      shade.append(...DRAWING_SHADES.map((label, value) => new Option(label, value)));
      shade.addEventListener('change', () => change(index, { shade: Number(shade.value) }));

      const percent = document.createElement('input');
      percent.type = 'number';
      percent.className = 'pd-mix-percent';
      percent.min = 0;
      percent.max = 100;
      percent.step = 5;
      percent.title = 'How much of the square it covers';
      percent.addEventListener('change', () => {
        const value = Math.max(0, Math.min(100, Math.round(Number(percent.value) || 0)));
        change(index, { percent: value });
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'small';
      removeButton.textContent = '×';
      removeButton.title = 'Takes this colour out';
      removeButton.addEventListener('click', () => remove(index));

      line.append(swatch, role, shade, percent, '%', removeButton);
      return line;
    }));
  });

  [...list.children].forEach((line, index) => {
    const row = rows[index];
    const [swatch, role, shade, percent] = line.querySelectorAll('.pe-swatch, select, input');
    if (document.activeElement !== role) role.value = row.role;
    if (document.activeElement !== shade) shade.value = String(row.shade);
    if (document.activeElement !== percent) percent.value = String(row.percent);
    shade.disabled = row.role === 'outline' || row.role === 'light';
    line.querySelector('button').disabled = rows.length === 1;
    if (look) {
      const color = mixRowColor(look, row);
      swatch.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
    }
  });
}

function mixRowColor(look, row) {
  return WeavePuzzle.mixTexture(look, [{ ...row, percent: 100 }]).colors[0];
}

function changeMixRow(index, change) {
  const drawing = currentDrawing();
  saveDrawing({ ...drawing, mix: drawing.mix.map((row, i) => (i === index ? { ...row, ...change } : row)) });
}

// ---------- generating ----------

// Patterns to start a new drawing from, each with the panel's balance of colours laid out across it, in the
// current drawing's shape. The same seed always gives the same patterns, so changing the balance only
// recolours them; More moves on to a new seed.
function openGenerator() {
  const view = puzzleEditor.drawings;
  view.generator = {
    seed: Math.floor(Math.random() * 1e9),
    families: [...WeaveGrains.FAMILIES],
    balance: currentDrawing().mix.map((row) => ({ ...row })),
    candidates: [],
  };
  generateCandidates();
  renderDrawings();
}

function closeGenerator() {
  puzzleEditor.drawings.generator = null;
  renderDrawings();
  layoutDrawingCanvas();
}

function generateCandidates() {
  const generator = puzzleEditor.drawings.generator;
  generator.candidates = WeaveGrains.candidates({
    seed: generator.seed,
    count: DRAWING_CANDIDATES,
    families: generator.families,
    art: puzzleEditor.art,
  });
}

// The balance's colours that cover anything, darkest first in this album's colours, which is the order a
// drawing's Colour 1 to 4 paints are in.
function sortedBalance(look, balance) {
  return balance
    .filter((row) => row.percent > 0)
    .map((row) => ({ row, lightness: (({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b)(mixRowColor(look, row)) }))
    .sort((a, b) => a.lightness - b.lightness)
    .map(({ row }) => ({ ...row }));
}

// A candidate as a drawing of the current one's shape, its pattern painted in as solid colours.
function candidateDrawing(candidate, index, look) {
  const drawing = currentDrawing();
  const mix = sortedBalance(look, puzzleEditor.drawings.generator.balance);
  const colors = WeaveGrains.bake(candidate.values, mix.map((row) => row.percent));
  const generated = {
    id: `generated-${index}`,
    kind: drawing.kind,
    name: `${drawingKindLabel(drawing.kind)} ${candidate.name.toLowerCase()}`,
    pixels: WeaveGrains.paintInto(drawing.pixels, colors),
    mix,
  };
  if (drawing.kind === 'Gate')
    generated.openPixels = WeaveGrains.paintInto(drawing.openPixels ?? WeavePuzzle.standardDrawing('Gate').openPixels, colors);
  return generated;
}

function renderGenerator(drawing, look) {
  const generator = puzzleEditor.drawings.generator;
  const panel = document.getElementById('pd-generator');
  panel.hidden = !generator;
  document.getElementById('pd-board').hidden = !!generator;
  document.getElementById('pd-stage-tools').hidden = !!generator;
  document.getElementById('pd-stage-hint').hidden = !!generator;
  if (!generator) return;

  for (const button of document.querySelectorAll('#pd-families button')) {
    const family = button.dataset.family;
    button.classList.toggle('active', generator.families.includes(family));
    button.disabled = family === 'album' && !puzzleEditor.art;
  }

  renderMixRows(document.getElementById('pd-balance'), generator.balance, look, 'balance', {
    change: (index, change) => {
      generator.balance = generator.balance.map((row, i) => (i === index ? { ...row, ...change } : row));
      renderDrawings();
    },
    remove: (index) => {
      generator.balance = generator.balance.filter((_, i) => i !== index);
      renderDrawings();
    },
  });
  document.getElementById('pd-balance-add').disabled = generator.balance.length >= DRAWING_MAX_MIX;
  document.getElementById('pd-balance-total').textContent = mixTotalText(generator.balance);

  const list = document.getElementById('pd-candidates');
  const usable = look && generator.balance.some((row) => row.percent > 0);
  const key = JSON.stringify([generator.seed, generator.families, generator.balance, drawing.pixels, drawing.openPixels, !!usable]);
  if (list.dataset.key === key && list.look === look) return;
  list.dataset.key = key;
  list.look = look;

  list.replaceChildren(...(usable ? generator.candidates : []).map((candidate, index) => {
    const generated = candidateDrawing(candidate, index, look);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pd-candidate';
    button.title = `Makes '${generated.name}', a new drawing to edit`;

    const canvas = document.createElement('canvas');
    canvas.width = PUZZLE_TILE_PX;
    canvas.height = PUZZLE_TILE_PX;
    renderDrawingOnto(canvas.getContext('2d'), generated, { letter: true, look: { ...look, drawings: [...look.drawings, generated] } });

    button.append(canvas, candidate.name);
    button.addEventListener('click', () => {
      puzzleEditor.drawings.generator = null;
      addDrawing(generated, generated.name);
      layoutDrawingCanvas();
    });
    return button;
  }));
}

// Two to four of the palette's colours at random, in random amounts that add up to 100, as a place to start.
function shuffledBalance() {
  const count = 2 + Math.floor(Math.random() * 3);
  // Twenty lots of 5%, one to each colour first so that none is left out.
  const lots = Array(count).fill(1);
  for (let i = count; i < 20; i++) lots[Math.floor(Math.random() * count)]++;
  return lots.map((lot) => {
    const percent = lot * 5;
    const role = PUZZLE_PALETTE_ROLES[Math.floor(Math.random() * PUZZLE_PALETTE_ROLES.length)];
    return { role, shade: ['outline', 'light'].includes(role) ? 0 : Math.floor(Math.random() * DRAWING_SHADES.length), percent };
  });
}

document.getElementById('pd-generate').addEventListener('click', openGenerator);
document.getElementById('pd-generate-close').addEventListener('click', closeGenerator);

document.getElementById('pd-generate-more').addEventListener('click', () => {
  puzzleEditor.drawings.generator.seed += 1;
  generateCandidates();
  renderDrawings();
});

for (const button of document.querySelectorAll('#pd-families button')) {
  button.addEventListener('click', () => {
    const generator = puzzleEditor.drawings.generator;
    const family = button.dataset.family;
    const families = generator.families.includes(family)
      ? generator.families.filter((other) => other !== family)
      : [...generator.families, family];
    // Always at least one, so there's something to show.
    if (families.length === 0) return;
    generator.families = WeaveGrains.FAMILIES.filter((other) => families.includes(other));
    generateCandidates();
    renderDrawings();
  });
}

document.getElementById('pd-balance-add').addEventListener('click', () => {
  const generator = puzzleEditor.drawings.generator;
  if (generator.balance.length >= DRAWING_MAX_MIX) return;
  generator.balance = [...generator.balance, { role: WeavePuzzle.SPRITE_ROLES[puzzleEditor.drawings.kind], shade: 3, percent: 10 }];
  renderDrawings();
});

document.getElementById('pd-balance-shuffle').addEventListener('click', () => {
  puzzleEditor.drawings.generator.balance = shuffledBalance();
  renderDrawings();
});

// ---------- the canvas ----------

// The largest whole-number zoom that fits, so that every pixel of the drawing is the same size.
function layoutDrawingCanvas() {
  if (!puzzleEditor?.drawings) return;
  const stage = document.getElementById('pd-board').parentElement;
  const room = Math.min(stage.clientWidth - 24, stage.clientHeight - 140);
  const zoom = Math.max(4, Math.min(24, Math.floor(room / PUZZLE_TILE_PX)));
  const board = document.getElementById('pd-board');
  board.style.width = `${zoom * PUZZLE_TILE_PX}px`;
  board.style.height = `${zoom * PUZZLE_TILE_PX}px`;
  board.style.setProperty('--pd-zoom', `${zoom}px`);
}

function drawDrawingCanvas() {
  const view = puzzleEditor.drawings;
  const drawing = currentDrawing();
  const canvas = document.getElementById('pd-canvas');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  renderDrawingOnto(context, drawing, { open: frameField(drawing) === 'openPixels', letter: view.letter });

  const preview = document.getElementById('pd-preview');
  const previewContext = preview.getContext('2d');
  previewContext.clearRect(0, 0, preview.width, preview.height);
  // A patch from the middle of the art, dulled as the game dulls it behind a board.
  const art = document.getElementById('pe-art');
  if (art.naturalWidth) {
    const size = PUZZLE_TILE_PX * DRAWING_PREVIEW_TILES;
    previewContext.filter = 'brightness(0.65) saturate(0.7)';
    previewContext.drawImage(art, (art.naturalWidth - size) / 2, (art.naturalHeight - size) / 2, size, size, 0, 0, size, size);
    previewContext.filter = 'none';
  }
  renderDrawingOnto(previewContext, drawing, { tiles: DRAWING_PREVIEW_TILES, letter: true, open: frameField(drawing) === 'openPixels' });
}

function drawingPixelAt(e) {
  const box = document.getElementById('pd-canvas').getBoundingClientRect();
  const x = Math.floor((e.clientX - box.left) / (box.width / PUZZLE_TILE_PX));
  const y = Math.floor((e.clientY - box.top) / (box.height / PUZZLE_TILE_PX));
  return x >= 0 && x < PUZZLE_TILE_PX && y >= 0 && y < PUZZLE_TILE_PX ? { x, y } : null;
}

// Every pixel on a straight line between two, so that a quick drag doesn't leave gaps.
function drawingLine(from, to) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const along = steps === 0 ? 0 : i / steps;
    points.push({ x: Math.round(from.x + (to.x - from.x) * along), y: Math.round(from.y + (to.y - from.y) * along) });
  }
  return points;
}

// Every pixel joined to one by pixels of the same paint, side to side.
function drawingFillArea(pixels, start) {
  const target = pixels[start.y * PUZZLE_TILE_PX + start.x];
  const seen = new Set();
  const queue = [start];
  const area = [];
  while (queue.length > 0) {
    const { x, y } = queue.pop();
    const index = y * PUZZLE_TILE_PX + x;
    if (x < 0 || y < 0 || x >= PUZZLE_TILE_PX || y >= PUZZLE_TILE_PX || seen.has(index) || pixels[index] !== target) continue;
    seen.add(index);
    area.push({ x, y });
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return area;
}

function paintDrawingPixels(points) {
  const view = puzzleEditor.drawings;
  const field = view.stroke.field;
  const pixels = [...framePixels(view.working)];
  for (const { x, y } of points) {
    pixels[y * PUZZLE_TILE_PX + x] = view.stroke.paint;
    if (view.mirror) pixels[y * PUZZLE_TILE_PX + (PUZZLE_TILE_PX - 1 - x)] = view.stroke.paint;
  }
  view.working = { ...view.working, [field]: pixels.join('') };
  drawDrawingCanvas();
}

const drawingCanvas = document.getElementById('pd-canvas');

drawingCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

drawingCanvas.addEventListener('pointerdown', (e) => {
  const view = puzzleEditor?.drawings;
  const pixel = drawingPixelAt(e);
  if (!view || !pixel || (e.button !== 0 && e.button !== 2) || !puzzleLook()) return;

  const drawing = currentDrawing();
  view.working = { ...drawing, mix: drawing.mix.map((row) => ({ ...row })) };
  view.stroke = { paint: e.button === 2 ? '.' : view.paint, field: frameField(drawing), last: pixel };

  if (view.tool === 'fill' && e.button === 0) {
    paintDrawingPixels(drawingFillArea(framePixels(view.working), pixel));
    finishDrawingStroke();
    return;
  }
  drawingCanvas.setPointerCapture(e.pointerId);
  paintDrawingPixels([pixel]);
});

drawingCanvas.addEventListener('pointermove', (e) => {
  const stroke = puzzleEditor?.drawings?.stroke;
  if (!stroke) return;
  const pixel = drawingPixelAt(e);
  if (!pixel || (pixel.x === stroke.last.x && pixel.y === stroke.last.y)) return;
  paintDrawingPixels(drawingLine(stroke.last, pixel));
  stroke.last = pixel;
});

// A whole stroke is one change, so that it's also one undo.
function finishDrawingStroke() {
  const view = puzzleEditor?.drawings;
  if (!view?.stroke) return;
  view.stroke = null;
  saveDrawing(view.working);
}

drawingCanvas.addEventListener('pointerup', finishDrawingStroke);
drawingCanvas.addEventListener('pointercancel', finishDrawingStroke);

// ---------- changes ----------

// Saves one drawing into the library, as the whole new library. A Standard one that's never been redrawn
// goes in under its kind's name.
// Saves one drawing into the library, as the whole new library. A Standard one that's never been redrawn
// goes in under its kind's name. A newly made one also joins the set being looked at, in the same change.
function saveDrawing(drawing, { joinSet = false } = {}) {
  const view = puzzleEditor.drawings;
  view.working = drawing;
  const library = project?.puzzleDrawings ?? [];
  const saved = { id: drawing.id, kind: drawing.kind, name: drawing.name, pixels: drawing.pixels, mix: drawing.mix };
  if (drawing.kind === 'Gate') saved.openPixels = drawing.openPixels ?? WeavePuzzle.standardDrawing('Gate').openPixels;
  const drawings = library.some((existing) => existing.id === drawing.id)
    ? library.map((existing) => (existing.id === drawing.id ? saved : existing))
    : [...library, saved];
  const sets = joinSet && view.setId
    ? (project?.puzzleDrawingSets ?? []).map((set) => (set.id === view.setId ? { ...set, drawings: [...set.drawings, drawing.id] } : set))
    : undefined;
  sendDrawings(drawings, sets);
  renderDrawings();
}

// Sets are only sent when they change. Otherwise the C# side keeps them, less any drawing that's gone.
function sendDrawings(drawings, sets) {
  send('update-puzzle-drawings', { drawings, ...(sets ? { drawingSets: sets } : {}) });
}

function newDrawingId(kind) {
  const taken = new Set((project?.puzzleDrawings ?? []).map((drawing) => drawing.id));
  let n = drawingsOfKind(kind).length + 1;
  while (taken.has(`${kind.toLowerCase()}-${n}`)) n++;
  return `${kind.toLowerCase()}-${n}`;
}

function addDrawing(from, name) {
  const view = puzzleEditor.drawings;
  const id = newDrawingId(view.kind);
  view.id = id;
  view.deleting = false;
  saveDrawing({ ...from, id, name, mix: from.mix.map((row) => ({ ...row })) }, { joinSet: true });
}

function chooseDrawing(id) {
  const view = puzzleEditor.drawings;
  if (view.stroke) return;
  view.id = id;
  view.working = null;
  view.deleting = false;
  renderDrawings();
}

document.getElementById('pd-kind').addEventListener('change', (e) => {
  const view = puzzleEditor.drawings;
  view.kind = e.target.value;
  view.frame = 'closed';
  view.setId = placingSet(view.kind).id || null;
  chooseDrawing(view.kind);
});

document.getElementById('pd-set-new').addEventListener('click', () => {
  const view = puzzleEditor.drawings;
  const all = project?.puzzleDrawingSets ?? [];
  const taken = new Set(all.map((set) => set.id));
  let n = drawingSetsOfKind(view.kind).length + 1;
  while (taken.has(`${view.kind.toLowerCase()}-set-${n}`)) n++;
  const set = { id: `${view.kind.toLowerCase()}-set-${n}`, kind: view.kind, name: `${drawingKindLabel(view.kind)} set ${n}`, drawings: [view.id] };
  view.setId = set.id;
  saveSets([...all, set]);
  renderDrawings();
});

// Nothing placed changes, since a set is only a way of placing, so there's no need to ask first.
document.getElementById('pd-set-delete').addEventListener('click', () => {
  const view = puzzleEditor.drawings;
  const id = view.setId;
  view.setId = null;
  saveSets((project?.puzzleDrawingSets ?? []).filter((set) => set.id !== id));
  renderDrawings();
});

document.getElementById('pd-set-name').addEventListener('change', (e) => {
  const view = puzzleEditor.drawings;
  const name = e.target.value.trim();
  const set = drawingSetsOfKind(view.kind).find((candidate) => candidate.id === view.setId);
  if (!set || !name || name === set.name) {
    if (set) e.target.value = set.name;
    return;
  }
  saveSets((project?.puzzleDrawingSets ?? []).map((candidate) => (candidate.id === set.id ? { ...candidate, name } : candidate)));
});

document.getElementById('pd-new').addEventListener('click', () => {
  const kind = puzzleEditor.drawings.kind;
  addDrawing(WeavePuzzle.standardDrawing(kind), `${drawingKindLabel(kind)} ${drawingsOfKind(kind).length + 1}`);
});

document.getElementById('pd-duplicate').addEventListener('click', () => {
  const drawing = currentDrawing();
  addDrawing(drawing, `${drawing.name} copy`);
});

// Deleting one that boards use asks first, since those squares will change. Resetting a Standard one doesn't
// need to, since nothing is placed any differently.
document.getElementById('pd-delete').addEventListener('click', () => {
  const view = puzzleEditor.drawings;
  const drawing = currentDrawing();
  if (!isStandardDrawing(drawing) && drawingUses(drawing).objects > 0) {
    view.deleting = true;
    renderDrawings();
    return;
  }
  deleteDrawing(drawing);
});

function deleteDrawing(drawing) {
  const view = puzzleEditor.drawings;
  view.deleting = false;
  view.working = null;
  view.id = view.kind;
  sendDrawings((project?.puzzleDrawings ?? []).filter((existing) => existing.id !== drawing.id));
  renderDrawings();
}

document.getElementById('pd-confirm-yes').addEventListener('click', () => deleteDrawing(currentDrawing()));
document.getElementById('pd-confirm-no').addEventListener('click', () => {
  puzzleEditor.drawings.deleting = false;
  renderDrawings();
});

document.getElementById('pd-name').addEventListener('change', (e) => {
  const name = e.target.value.trim();
  const drawing = currentDrawing();
  if (!name || name === drawing.name || isStandardDrawing(drawing)) {
    e.target.value = drawing.name;
    return;
  }
  saveDrawing({ ...drawing, name });
});

document.getElementById('pd-mix-add').addEventListener('click', () => {
  const drawing = currentDrawing();
  if (drawing.mix.length >= DRAWING_MAX_MIX) return;
  const role = WeavePuzzle.SPRITE_ROLES[drawing.kind];
  saveDrawing({ ...drawing, mix: [...drawing.mix, { role, shade: 3, percent: 10 }] });
});

for (const button of document.querySelectorAll('#pd-frames button')) {
  button.addEventListener('click', () => {
    puzzleEditor.drawings.frame = button.dataset.frame;
    renderDrawings();
  });
}

for (const button of document.querySelectorAll('#pd-stage-tools [data-drawing-tool]')) {
  button.addEventListener('click', () => {
    puzzleEditor.drawings.tool = button.dataset.drawingTool;
    renderDrawings();
  });
}

document.getElementById('pd-mirror').addEventListener('click', () => {
  puzzleEditor.drawings.mirror = !puzzleEditor.drawings.mirror;
  renderDrawings();
});

document.getElementById('pd-letter').addEventListener('click', () => {
  puzzleEditor.drawings.letter = !puzzleEditor.drawings.letter;
  renderDrawings();
});

document.getElementById('pe-drawings-toggle').addEventListener('click', () => {
  if (puzzleEditor.drawings) closeDrawings();
  else openDrawings();
});

window.addEventListener('resize', layoutDrawingCanvas);
