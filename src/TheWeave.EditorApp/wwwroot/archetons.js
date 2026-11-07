// archetons.js
// John Oestmann
// The Archetons window, opened from the Puzzle Editor's Archeton tool: every Archeton in the project as a card, to
// choose one to place, and an editor for making them from a drawing and parts, rather than programming each one.
// What the parts do is in puzzle.js's createPuzzleGame, and the rules for saving them in ProjectEditing.ValidateArchetons.

const ARCHETON_PARTS = [
  { kind: 'Beam', label: 'Beam', hint: 'Sees the ship in a straight line, as far as its range, unless a Wall, closed Gate or another Archeton is in the way.' },
  { kind: 'Push', label: 'Push', hint: 'Pushes the ship away along whichever Beam sees it, a square at a time, until it\'s out of reach.' },
];
const ARCHETON_LOOKS = [
  { name: 'AllWays', label: 'All 4 ways' },
  { name: 'Facing', label: 'The way it faces' },
];

let archetonsView = null; // { selected, editing } while the window's open, editing being the copy being changed

function openArchetons() {
  if (!puzzleEditor || puzzleEditor.playtest) return;
  const archetons = project?.archetons ?? [];
  archetonsView = { selected: puzzleEditor.archeton ?? archetons[0]?.id ?? null, editing: null };
  archetonsWindow().hidden = false;
  renderArchetons();
}

function closeArchetons() {
  archetonsView = null;
  archetonsWindow().hidden = true;
}

// Built the first time it's needed, over the Puzzle Editor.
function archetonsWindow() {
  let element = document.getElementById('archetons');
  if (element) return element;

  element = document.createElement('div');
  element.id = 'archetons';
  element.hidden = true;
  element.innerHTML = `
    <div class="ar-box">
      <header><strong>Archetons</strong><div class="spacer"></div><button type="button" data-action="close">Close (Esc)</button></header>
      <div class="ar-main">
        <div class="ar-list"></div>
        <div class="ar-side"></div>
      </div>
    </div>`;
  element.querySelector('[data-action="close"]').addEventListener('click', closeArchetons);
  document.getElementById('puzzle-editor').append(element);
  return element;
}

// The drawing an Archeton is drawn with: its own from the library, or the Standard one, as redrawn if it has been.
function archetonDrawing(archeton) {
  const library = project?.puzzleDrawings ?? [];
  return library.find((drawing) => drawing.kind === 'Archeton' && drawing.id === archeton.drawing)
    ?? library.find((drawing) => drawing.kind === 'Archeton' && drawing.id === 'Archeton')
    ?? WeavePuzzle.standardDrawing('Archeton');
}

function describeArcheton(archeton) {
  return archeton.parts.map((part) => part.kind === 'Beam'
    ? `Beam ${part.range} ${part.look === 'Facing' ? 'ahead' : 'all ways'}${part.blockedByBlocks === false ? ', through blocks' : ''}`
    : part.kind).join(' + ') || 'No parts';
}

function renderArchetons() {
  if (!archetonsView) return;
  const archetons = project?.archetons ?? [];
  const list = archetonsWindow().querySelector('.ar-list');

  list.replaceChildren(...archetons.map((archeton) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ar-card';
    card.classList.toggle('active', archeton.id === archetonsView.selected);
    const name = document.createElement('strong');
    name.textContent = archeton.name;
    const parts = document.createElement('span');
    parts.textContent = describeArcheton(archeton);
    card.append(drawingThumbnail(archetonDrawing(archeton)), name, parts);
    card.addEventListener('click', () => {
      archetonsView.selected = archeton.id;
      archetonsView.editing = null;
      renderArchetons();
    });
    card.addEventListener('dblclick', () => placeArcheton(archeton.id));
    return card;
  }));
  if (archetons.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'field-hint';
    empty.textContent = 'No Archetons yet. Make one with New.';
    list.append(empty);
  }

  const side = archetonsWindow().querySelector('.ar-side');
  if (archetonsView.editing) renderArchetonEditor(side);
  else renderArchetonActions(side, archetons.find((archeton) => archeton.id === archetonsView.selected));
}

function renderArchetonActions(side, selected) {
  side.replaceChildren();
  const button = (label, action, disabled = false, className = '') => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.disabled = disabled;
    if (className) element.className = className;
    element.addEventListener('click', action);
    side.append(element);
  };
  button('Place', () => placeArcheton(selected.id), !selected, 'primary');
  button('New', () => editArcheton({ id: newArchetonId('Archeton'), name: 'New Archeton', drawing: null, parts: [{ kind: 'Beam', range: 2, look: 'AllWays', blockedByBlocks: true }, { kind: 'Push' }] }, true));
  button('Edit', () => editArcheton(selected, false), !selected);
  button('Duplicate', () => editArcheton({ ...structuredClone(selected), id: newArchetonId(selected.name), name: `${selected.name} copy` }, true), !selected);
  button('Delete', () => {
    archetonsView.selected = null;
    send('update-archetons', { archetons: (project?.archetons ?? []).filter((archeton) => archeton.id !== selected.id) });
  }, !selected, 'danger');
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Double-click a card to place it. Draw new bodies in Drawings, under Archeton.';
  side.append(hint);
}

function placeArcheton(id) {
  puzzleEditor.archeton = id;
  puzzleEditor.tool = 'Archeton';
  closeArchetons();
  showPuzzleTool();
  renderToolTray();
}

function newArchetonId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'archeton';
  const taken = new Set((project?.archetons ?? []).map((archeton) => archeton.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function editArcheton(archeton, isNew) {
  archetonsView.editing = { archeton: structuredClone(archeton), isNew };
  renderArchetons();
}

// The editor: a name, what it's drawn with, and its parts, each with its own settings.
function renderArchetonEditor(side) {
  const { archeton, isNew } = archetonsView.editing;
  side.replaceChildren();

  const field = (label, control) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(text, control);
    side.append(wrap);
    return control;
  };

  const name = document.createElement('input');
  name.value = archeton.name;
  name.addEventListener('input', () => { archeton.name = name.value; });
  field('Name', name);

  const drawing = document.createElement('select');
  const drawings = (project?.puzzleDrawings ?? []).filter((d) => d.kind === 'Archeton' && d.id !== 'Archeton');
  drawing.append(new Option('Standard', ''), ...drawings.map((d) => new Option(d.name, d.id)));
  drawing.value = archeton.drawing ?? '';
  drawing.addEventListener('change', () => { archeton.drawing = drawing.value || null; renderArchetons(); });
  field('Drawing', drawing);
  side.append(drawingThumbnail(archetonDrawing(archeton)));

  const parts = document.createElement('div');
  parts.className = 'ar-parts';
  archeton.parts.forEach((part, index) => {
    const row = document.createElement('div');
    row.className = 'ar-part';
    const title = document.createElement('strong');
    title.textContent = part.kind;
    title.title = ARCHETON_PARTS.find((p) => p.kind === part.kind)?.hint ?? '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove this part';
    remove.addEventListener('click', () => { archeton.parts.splice(index, 1); renderArchetons(); });
    row.append(title, remove);

    if (part.kind === 'Beam') {
      const range = document.createElement('input');
      range.type = 'number';
      range.min = 1;
      range.max = 9;
      range.value = part.range ?? 2;
      range.title = 'How many squares it reaches';
      range.addEventListener('input', () => { part.range = Math.max(1, Math.min(9, Number(range.value) || 1)); });
      const look = document.createElement('select');
      look.append(...ARCHETON_LOOKS.map((option) => new Option(option.label, option.name)));
      look.value = part.look ?? 'AllWays';
      look.addEventListener('change', () => { part.look = look.value; });
      const blocks = document.createElement('label');
      const blocksBox = document.createElement('input');
      blocksBox.type = 'checkbox';
      blocksBox.checked = part.blockedByBlocks !== false;
      blocksBox.addEventListener('change', () => { part.blockedByBlocks = blocksBox.checked; });
      blocks.append(blocksBox, ' Push Blocks stop it');
      const rangeLabel = document.createElement('label');
      rangeLabel.append('Range ', range);
      row.append(rangeLabel, look, blocks);
    }
    parts.append(row);
  });
  side.append(parts);

  const add = document.createElement('select');
  add.append(new Option('Add part…', ''), ...ARCHETON_PARTS.map((part) => new Option(part.label, part.kind)));
  add.title = ARCHETON_PARTS.map((part) => `${part.label}: ${part.hint}`).join('\n');
  add.addEventListener('change', () => {
    if (!add.value) return;
    archeton.parts.push(add.value === 'Beam' ? { kind: 'Beam', range: 2, look: 'AllWays', blockedByBlocks: true } : { kind: add.value });
    renderArchetons();
  });
  side.append(add);

  const buttons = document.createElement('div');
  buttons.className = 'ar-buttons';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary';
  save.textContent = 'Save';
  save.addEventListener('click', () => {
    const library = project?.archetons ?? [];
    const archetons = isNew ? [...library, archeton] : library.map((existing) => existing.id === archeton.id ? archeton : existing);
    archetonsView.selected = archeton.id;
    archetonsView.editing = null;
    send('update-archetons', { archetons });
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { archetonsView.editing = null; renderArchetons(); });
  buttons.append(save, cancel);
  side.append(buttons);
}

// Esc closes the window, ahead of the Puzzle Editor's own Esc.
document.addEventListener('keydown', (e) => {
  if (!archetonsView || e.key !== 'Escape') return;
  e.stopImmediatePropagation();
  closeArchetons();
}, true);
