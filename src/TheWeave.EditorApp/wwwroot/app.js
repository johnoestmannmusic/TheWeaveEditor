// app.js
// UI-only glue between the Photino webview and the C# host. All project logic lives in
// TheWeave.Core/Importer/Exporter/ProjectEditing on the C# side - after every edit the whole
// current project comes back and this file re-renders the tree + inspector from it.
//
// Text/number/textarea fields save on blur (leaving the field) rather than on every keystroke:
// since every edit triggers a full re-render from the authoritative C# state, saving on `input`
// would blow away focus/cursor position on every keypress. Select/checkbox fields save
// immediately on change - no such conflict there.

let project = null;
let projectPath = null;
let contentRoot = null; // absolute folder the project's img/fnt paths are relative to, or null
let selectedPageId = null;
let selectedNodeId = null; // null = the page itself is selected, not a node within it
let showingTutorialModal = false; // true = the Tutorial Modal tab is showing instead of Page/Node
const expandedPageIds = new Set();
const expandedNodeIds = new Set();
const canvasViewByPage = new Map(); // pageId -> { scale, offsetX, offsetY, worldW, worldH }
let effectFormState = null; // { pageId, effectId (null if adding), kind } while the effect form is open
let grids = {}; // pageId -> that page's grid of squares, worked out by Program.cs's BuildGridPayload

function send(type, extra) {
  window.external.sendMessage(JSON.stringify({ type, ...extra }));
}

document.getElementById('btn-undo').addEventListener('click', () => send('undo'));
document.getElementById('btn-redo').addEventListener('click', () => send('redo'));
document.getElementById('btn-new').addEventListener('click', () => send('new-project'));
document.getElementById('btn-open').addEventListener('click', () => send('open-project'));
document.getElementById('btn-import').addEventListener('click', () => send('import-legacy-site'));
document.getElementById('btn-export').addEventListener('click', () => send('export-site'));
document.getElementById('btn-change-export-path').addEventListener('click', () => send('change-export-path'));
document.getElementById('btn-add-page').addEventListener('click', () => {
  const title = window.prompt('New page title:', 'New Page');
  if (title === null) return;
  send('add-page', { page: { title } });
});

document.getElementById('btn-problems').addEventListener('click', () => {
  const drawer = document.getElementById('problems-drawer');
  drawer.hidden = !drawer.hidden;
});

// Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) for undo/redo - skipped while a text field has focus so
// the browser's own per-field undo (reverting the user's last keystrokes, not a project-level
// change) still works there instead of being shadowed by this.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault();
    send(e.shiftKey ? 'redo' : 'undo');
  } else if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault();
    send('redo');
  }
});

send('ready');

window.external.receiveMessage((raw) => {
  const message = JSON.parse(raw);

  if (message.type === 'project-state') {
    project = message.project;
    grids = message.grids ?? {};
    projectPath = message.path;
    contentRoot = message.contentRoot;
    reconcileSelection();
    renderAll();
    renderList('issues', 'issues-list', message.validationIssues);
    renderList('warnings', 'warnings-list', message.warnings);
    updateProblemsButton((message.validationIssues ?? []).length, (message.warnings ?? []).length);
    const nodeCount = (project?.pages ?? []).reduce((sum, p) => sum + countNodes(p.nodes), 0);
    setStatus(project ? `${project.pages.length} pages, ${nodeCount} nodes.` : 'No project open.', false);
    document.getElementById('btn-export').title = project?.exportPath
      ? `Exports to ${project.exportPath}`
      : 'No export folder set yet - will prompt on first export.';
    document.getElementById('btn-undo').disabled = !message.canUndo;
    document.getElementById('btn-redo').disabled = !message.canRedo;
  } else if (message.type === 'status') {
    setStatus(message.message, false);
    showToast(message.message, false);
  } else if (message.type === 'error') {
    // A rejected edit (e.g. a square that's already taken) changes nothing on the C# side, so this
    // puts the form back in step with what's actually saved.
    if (project) renderAll();
    setStatus(message.message, true);
    showToast(message.message, true);
  } else if (message.type === 'image-picked') {
    // Both tabs can trigger a pick-cover-image - route the result to whichever one is actually
    // showing (its input field exists in the DOM either way, just hidden, since a tab's own
    // innerHTML isn't torn down when you navigate away from it).
    const inputId = showingTutorialModal ? 'f-tm-cover' : 'f-cover';
    const previewId = showingTutorialModal ? 'f-tm-cover-preview' : 'f-cover-preview';
    const input = document.getElementById(inputId);
    if (input) {
      input.value = message.path;
      updateCoverPreview(message.path, previewId);
    }
  } else if (message.type === 'music-picked') {
    send('update-project', { project: { backgroundMusicPath: message.path } });
  } else if (message.type === 'node-renamed') {
    // Arrives just before the project-state resync that follows it, so selection tracks the
    // node's new id rather than reconcileSelection() finding the old one gone and clearing it.
    if (selectedPageId === message.pageId && selectedNodeId === message.oldId)
      selectedNodeId = message.newId;
  }
});

let toastHideTimer = null;

function showToast(text, isError) {
  const toast = document.getElementById('toast');
  clearTimeout(toastHideTimer);
  toast.textContent = text;
  toast.hidden = false;
  toast.classList.toggle('error', !!isError);
  // Force layout so the "show" transition re-triggers even if a toast is already visible.
  void toast.offsetWidth;
  toast.classList.add('show');
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastHideTimer = setTimeout(() => { toast.hidden = true; }, 200);
  }, 2600);
}

function updateProblemsButton(issueCount, warningCount) {
  const btn = document.getElementById('btn-problems');
  const total = issueCount + warningCount;
  btn.hidden = total === 0;
  btn.textContent = `${total} problem${total === 1 ? '' : 's'}`;
  if (total === 0)
    document.getElementById('problems-drawer').hidden = true;
}

// ---------- selection ----------

function reconcileSelection() {
  // Drop a selection that no longer exists (e.g. the selected node was just deleted).
  if (selectedPageId && !findPage(selectedPageId)) {
    selectedPageId = null;
    selectedNodeId = null;
  } else if (selectedNodeId && !findNode(selectedPageId, selectedNodeId)) {
    selectedNodeId = null;
  }
}

function selectPage(pageId) {
  selectedPageId = pageId;
  selectedNodeId = null;
  showingTutorialModal = false;
  effectFormState = null;
  expandedPageIds.add(pageId);
  renderAll();
}

function selectNode(pageId, nodeId) {
  selectedPageId = pageId;
  selectedNodeId = nodeId;
  showingTutorialModal = false;
  effectFormState = null;
  expandedPageIds.add(pageId);
  renderAll();
}

function selectTutorialModal() {
  selectedPageId = null;
  selectedNodeId = null;
  showingTutorialModal = true;
  effectFormState = null;
  renderAll();
}

// The one CardSize.Modal node on the project's home page, if any - see ProjectEditing's own
// FindTutorialModalNode (this mirrors it client-side so the tab can render before any save).
function findTutorialModalNode() {
  if (!project?.homePageId) return null;
  const page = findPage(project.homePageId);
  return page?.nodes.find((n) => n.card.size === 'Modal') ?? null;
}

function isModalNode(node) {
  return node.card.size === 'Modal';
}

function findPage(pageId) {
  return project?.pages.find((p) => p.id === pageId) ?? null;
}

function findNode(pageId, nodeId) {
  const page = findPage(pageId);
  if (!page) return null;
  return findNodeIn(page.nodes, nodeId);
}

function findNodeIn(nodes, nodeId) {
  for (const n of nodes) {
    if (n.id === nodeId) return n;
    const found = findNodeIn(n.children, nodeId);
    if (found) return found;
  }
  return null;
}

// A CardSize.Modal node (the Tutorial Modal - see selectTutorialModal/isModalNode) is edited
// through its own dedicated tab, not the generic tree/count/canvas - it isn't a real world
// location, so counting or listing it alongside actual locations would be misleading.
function countNodes(nodes) {
  return nodes.reduce((sum, n) => sum + (isModalNode(n) ? 0 : 1 + countNodes(n.children)), 0);
}

// ---------- top-level render ----------

function renderAll() {
  renderProjectSettings();
  renderTree();
  renderInspector();
  renderCanvas();
}

// ---------- project settings ----------

function renderProjectSettings() {
  const el = document.getElementById('project-settings');
  const input = document.getElementById('f-project-music');

  el.hidden = !project;
  if (!project) return;

  input.value = project.backgroundMusicPath ?? '';
}

document.getElementById('f-project-music').addEventListener('blur', () => {
  send('update-project', { project: { backgroundMusicPath: document.getElementById('f-project-music').value } });
});

document.getElementById('btn-browse-music').addEventListener('click', () => send('pick-background-music'));

// ---------- tree ----------

function renderTree() {
  const treeEl = document.getElementById('tree');
  const emptyEl = document.getElementById('empty-state');
  const modalRowEl = document.getElementById('tutorial-modal-row');

  modalRowEl.hidden = !project;
  modalRowEl.classList.toggle('selected', showingTutorialModal);

  if (!project) {
    emptyEl.hidden = false;
    treeEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  treeEl.hidden = false;
  treeEl.innerHTML = '';

  for (const page of project.pages) {
    treeEl.appendChild(renderPageRow(page));
  }
}

document.getElementById('tutorial-modal-row').addEventListener('click', selectTutorialModal);

function renderPageRow(page) {
  const li = document.createElement('li');
  const expanded = expandedPageIds.has(page.id);
  const visibleNodes = page.nodes.filter((n) => !isModalNode(n));

  const row = document.createElement('div');
  row.className = 'tree-row' + (selectedPageId === page.id && !selectedNodeId ? ' selected' : '');
  row.dataset.kind = 'page';
  row.dataset.pageId = page.id;
  row.innerHTML = `
    <span class="caret" data-toggle="page">${visibleNodes.length > 0 ? (expanded ? '▾' : '▸') : ''}</span>
    <span>${escapeHtml(page.title || page.id)}</span>
    <span class="badge">${countNodes(page.nodes)}</span>
    <button class="small" data-action="delete-page" data-page-id="${page.id}" title="Delete page">×</button>
  `;
  li.appendChild(row);

  if (expanded) {
    const ul = document.createElement('ul');
    for (const node of visibleNodes)
      ul.appendChild(renderNodeRow(page.id, node));

    const addLi = document.createElement('li');
    const addRow = document.createElement('div');
    addRow.className = 'tree-row tree-add-node';
    addRow.textContent = '+ Add location';
    addRow.dataset.action = 'add-node';
    addRow.dataset.pageId = page.id;
    addLi.appendChild(addRow);
    ul.appendChild(addLi);

    li.appendChild(ul);
  }

  return li;
}

function renderNodeRow(pageId, node) {
  const li = document.createElement('li');
  const expanded = expandedNodeIds.has(node.id);

  const row = document.createElement('div');
  row.className = 'tree-row' + (selectedNodeId === node.id ? ' selected' : '');
  row.dataset.kind = 'node';
  row.dataset.pageId = pageId;
  row.dataset.nodeId = node.id;
  row.innerHTML = `
    <span class="caret" data-toggle="node">${node.children.length > 0 ? (expanded ? '▾' : '▸') : ''}</span>
    <span>${escapeHtml(node.card.headingText || node.id)}</span>
    <button class="small" data-action="delete-node" data-page-id="${pageId}" data-node-id="${node.id}" title="Delete location">×</button>
  `;
  li.appendChild(row);

  if (expanded) {
    const ul = document.createElement('ul');
    for (const child of node.children)
      ul.appendChild(renderNodeRow(pageId, child));

    const addLi = document.createElement('li');
    const addRow = document.createElement('div');
    addRow.className = 'tree-row tree-add-node';
    addRow.textContent = '+ Add nested location';
    addRow.dataset.action = 'add-node';
    addRow.dataset.pageId = pageId;
    addRow.dataset.parentNodeId = node.id;
    addLi.appendChild(addRow);
    ul.appendChild(addLi);

    li.appendChild(ul);
  }

  return li;
}

document.getElementById('tree').addEventListener('click', (e) => {
  const delPage = e.target.closest('[data-action="delete-page"]');
  if (delPage) {
    e.stopPropagation();
    if (window.confirm('Delete this page and everything on it?'))
      send('delete-page', { pageId: delPage.dataset.pageId });
    return;
  }

  const delNode = e.target.closest('[data-action="delete-node"]');
  if (delNode) {
    e.stopPropagation();
    if (window.confirm('Delete this location?'))
      send('delete-node', { pageId: delNode.dataset.pageId, nodeId: delNode.dataset.nodeId });
    return;
  }

  const addNode = e.target.closest('[data-action="add-node"]');
  if (addNode) {
    e.stopPropagation();
    send('add-node', { pageId: addNode.dataset.pageId, parentNodeId: addNode.dataset.parentNodeId || null });
    return;
  }

  const caret = e.target.closest('.caret');
  const row = e.target.closest('.tree-row');
  if (!row) return;

  if (row.dataset.kind === 'page') {
    if (caret) {
      togglePage(row.dataset.pageId);
    } else {
      selectPage(row.dataset.pageId);
    }
  } else if (row.dataset.kind === 'node') {
    if (caret) {
      toggleNode(row.dataset.nodeId);
    } else {
      selectNode(row.dataset.pageId, row.dataset.nodeId);
    }
  }
});

function togglePage(pageId) {
  if (expandedPageIds.has(pageId)) expandedPageIds.delete(pageId);
  else expandedPageIds.add(pageId);
  renderTree();
}

function toggleNode(nodeId) {
  if (expandedNodeIds.has(nodeId)) expandedNodeIds.delete(nodeId);
  else expandedNodeIds.add(nodeId);
  renderTree();
}

// ---------- inspector ----------

function renderInspector() {
  const emptyEl = document.getElementById('inspector-empty');
  const pageEl = document.getElementById('inspector-page');
  const nodeEl = document.getElementById('inspector-node');
  const modalEl = document.getElementById('inspector-tutorial-modal');

  emptyEl.hidden = true;
  pageEl.hidden = true;
  nodeEl.hidden = true;
  modalEl.hidden = true;

  if (showingTutorialModal) {
    modalEl.hidden = false;
    renderTutorialModalInspector(modalEl);
  } else if (selectedNodeId) {
    const node = findNode(selectedPageId, selectedNodeId);
    if (!node) { emptyEl.hidden = false; return; }
    nodeEl.hidden = false;
    renderNodeInspector(nodeEl, selectedPageId, node);
  } else if (selectedPageId) {
    const page = findPage(selectedPageId);
    if (!page) { emptyEl.hidden = false; return; }
    pageEl.hidden = false;
    renderPageInspector(pageEl, page);
  } else {
    emptyEl.hidden = false;
  }
}

function renderPageInspector(container, page) {
  container.innerHTML = `
    <h2>Page</h2>
    <div class="id-line">id: ${escapeHtml(page.id)}</div>

    <div class="field">
      <label>Title</label>
      <input type="text" id="f-page-title" value="${escapeAttr(page.title)}">
    </div>
    <div class="field">
      <label>Output file name</label>
      <input type="text" id="f-page-file" value="${escapeAttr(page.outputFileName)}">
    </div>
    <div class="field">
      <label>Background image path</label>
      <input type="text" id="f-page-bg" value="${escapeAttr(page.background?.imagePath ?? '')}">
    </div>
    <div class="field checkbox">
      <input type="checkbox" id="f-page-globe-effect" ${page.globeEffect !== false ? 'checked' : ''}>
      <label for="f-page-globe-effect">Globe curvature visual (edge vignette - e.g. turn off for a building interior)</label>
    </div>
    <div class="field checkbox">
      <input type="checkbox" id="f-page-is-home" ${project.homePageId === page.id ? 'checked' : ''}>
      <label for="f-page-is-home">Starting map (the persistent shell loads this page by default - see Hub theme)</label>
    </div>
    ${cellPickerHtml('f-page-spawn', 'Default spawn', grids[page.id], page.defaultSpawnX, page.defaultSpawnY, '#0')}
    <div class="field-hint">Where the ship starts when this page is opened with no travel link or query string at all (e.g. a bare URL, or the shell's iframe on first load). Doesn't affect arriving via a travel link - that's each link's own Arrival square on the destination location's Action, further down.</div>

    <fieldset>
      <legend>Effects</legend>
      <div id="effects-list"></div>
      <div id="effect-form-container"></div>
      <div class="form-actions">
        <button id="btn-add-crossfade" class="small">+ Crossfade</button>
        <button id="btn-add-drift" class="small">+ Drift Sprite</button>
      </div>
    </fieldset>
  `;

  const savePage = () => {
    const spawn = readCellCenter('f-page-spawn', grids[page.id]);
    send('update-page', {
    pageId: page.id,
    page: {
      title: document.getElementById('f-page-title').value,
      outputFileName: document.getElementById('f-page-file').value,
      backgroundImagePath: document.getElementById('f-page-bg').value,
      globeEffect: document.getElementById('f-page-globe-effect').checked,
      isHome: document.getElementById('f-page-is-home').checked,
      defaultSpawnX: spawn?.x ?? null,
      defaultSpawnY: spawn?.y ?? null,
    },
    });
  };

  // Auto-saves as soon as a field loses focus, rather than requiring a separate "Save
  // Changes" click - safe to do on blur (unlike on every keystroke) since the full
  // re-render this triggers only ever happens after the user has already moved on from
  // the field they were editing.
  for (const id of ['f-page-title', 'f-page-file', 'f-page-bg'])
    document.getElementById(id).addEventListener('blur', savePage);

  // A checkbox or select has no meaningful "blur to commit" moment - it saves on change instead.
  for (const id of ['f-page-globe-effect', 'f-page-is-home', 'f-page-spawn-col', 'f-page-spawn-row'])
    document.getElementById(id).addEventListener('change', savePage);

  renderEffectsList(page);

  document.getElementById('btn-add-crossfade').addEventListener('click', () => {
    effectFormState = { pageId: page.id, effectId: null, kind: 'Crossfade' };
    renderEffectForm(page, null);
  });
  document.getElementById('btn-add-drift').addEventListener('click', () => {
    effectFormState = { pageId: page.id, effectId: null, kind: 'Drift' };
    renderEffectForm(page, null);
  });

  if (effectFormState && effectFormState.pageId === page.id) {
    const existing = (page.effects ?? []).find((fx) => fx.id === effectFormState.effectId) ?? null;
    renderEffectForm(page, existing);
  }
}

// The Tutorial Modal tab - edits the project's one CardSize.Modal node (on the home page) plus
// its "Updates:" panel, without it ever appearing in the tree/canvas as a location (see
// selectTutorialModal/isModalNode and countNodes/renderPageRow/renderCanvas). Works even before
// that node exists yet - ApplyTutorialModalEdit creates it (and its Updates panel) on first save.
function renderTutorialModalInspector(container) {
  if (!project.homePageId) {
    container.innerHTML = `
      <h2>Tutorial Modal</h2>
      <p class="muted">Set a Starting Map page first (the Page inspector's "Starting map"
      checkbox) - the Tutorial Modal always lives on that page.</p>
    `;
    return;
  }

  const node = findTutorialModalNode();
  const card = node?.card ?? {};
  const updates = card.extraPanels?.[0] ?? {};

  container.innerHTML = `
    <h2>Tutorial Modal</h2>
    <p class="field-hint">Shown once per visit, centered on screen, on the Starting Map page -
    see the Page inspector. ${node ? '' : 'Not created yet - filling this in and leaving a field creates it.'}</p>

    <fieldset>
      <legend>Tutorial</legend>
      <div class="field">
        <label>Heading</label>
        <input type="text" id="f-tm-heading" value="${escapeAttr(card.headingText ?? 'Tutorial:')}">
      </div>
      <div class="field">
        <label>Cover image</label>
        <div class="cover-field">
          <img id="f-tm-cover-preview" class="cover-preview" ${card.coverImagePath ? '' : 'hidden'}
               src="${card.coverImagePath ? escapeAttr(toFileUrl(contentRoot, card.coverImagePath)) : ''}">
          <div class="cover-field-main">
            <input type="text" id="f-tm-cover" value="${escapeAttr(card.coverImagePath ?? '')}">
            <button type="button" id="btn-tm-browse-cover" class="small">Browse…</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Audio URL</label>
        <input type="text" id="f-tm-audio" value="${escapeAttr(card.audio?.url ?? '')}">
      </div>
      <div class="field">
        <label>Poetry lines (one per line)</label>
        <textarea id="f-tm-poetry">${escapeHtml((card.poetryLines ?? []).join('\n'))}</textarea>
      </div>
    </fieldset>

    <fieldset>
      <legend>Updates</legend>
      <div class="field">
        <label>Heading</label>
        <input type="text" id="f-tm-updates-heading" value="${escapeAttr(updates.headingText ?? 'Updates:')}">
      </div>
      <div class="field">
        <label>Lines (one per line)</label>
        <textarea id="f-tm-updates-lines">${escapeHtml((updates.lines ?? []).join('\n'))}</textarea>
      </div>
    </fieldset>
  `;

  document.getElementById('f-tm-cover').addEventListener('input', (e) => updateCoverPreview(e.target.value, 'f-tm-cover-preview'));
  document.getElementById('btn-tm-browse-cover').addEventListener('click', () =>
    send('pick-cover-image', { pageId: project.homePageId, nodeId: node?.id ?? null }));

  const saveTutorialModal = () => send('update-tutorial-modal', {
    tutorialModal: {
      headingText: document.getElementById('f-tm-heading').value,
      coverImagePath: document.getElementById('f-tm-cover').value,
      audioUrl: document.getElementById('f-tm-audio').value,
      poetryLines: document.getElementById('f-tm-poetry').value.split('\n').filter((l) => l.length > 0),
      updatesHeadingText: document.getElementById('f-tm-updates-heading').value,
      updatesLines: document.getElementById('f-tm-updates-lines').value.split('\n').filter((l) => l.length > 0),
    },
  });

  for (const id of ['f-tm-heading', 'f-tm-cover', 'f-tm-audio', 'f-tm-poetry', 'f-tm-updates-heading', 'f-tm-updates-lines'])
    document.getElementById(id).addEventListener('blur', saveTutorialModal);
}

function effectSummary(fx) {
  if (fx.$type === 'crossfade')
    return `Crossfade · opacity ${fx.opacityFrom}→${fx.opacityTo} · ${fx.durationMs}ms`;

  const axes = [fx.driftX ? 'X' : null, fx.driftY ? 'Y' : null].filter(Boolean).join('+') || 'none';
  return `Drift · axes: ${axes}`;
}

function renderEffectsList(page) {
  const listEl = document.getElementById('effects-list');
  const effects = page.effects ?? [];

  if (effects.length === 0) {
    listEl.innerHTML = '<p class="muted">No effects on this page.</p>';
    return;
  }

  listEl.innerHTML = effects.map((fx) => `
    <div class="effect-row">
      <span title="${escapeAttr(fx.id)}">${fx.$type === 'crossfade' ? '◐' : '✳'} ${escapeHtml(effectSummary(fx))}</span>
      <button class="small" data-action="edit-effect" data-effect-id="${escapeAttr(fx.id)}">Edit</button>
      <button class="small" data-action="delete-effect" data-effect-id="${escapeAttr(fx.id)}">×</button>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-action="edit-effect"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fx = effects.find((e) => e.id === btn.dataset.effectId);
      effectFormState = { pageId: page.id, effectId: fx.id, kind: fx.$type === 'crossfade' ? 'Crossfade' : 'Drift' };
      renderEffectForm(page, fx);
    });
  });

  listEl.querySelectorAll('[data-action="delete-effect"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.confirm('Delete this effect?'))
        send('delete-effect', { pageId: page.id, effectId: btn.dataset.effectId });
    });
  });
}

function renderEffectForm(page, fx) {
  const formContainer = document.getElementById('effect-form-container');
  if (!effectFormState) {
    formContainer.innerHTML = '';
    return;
  }

  const kind = effectFormState.kind;
  const e = fx ?? {};
  const driftX = e.driftX ?? null;
  const driftY = e.driftY ?? null;
  const directions = ['alternate', 'alternate-reverse', 'normal', 'reverse'];

  formContainer.innerHTML = `
    <div class="effect-form">
      <h4>${effectFormState.effectId ? 'Edit' : 'Add'} ${kind === 'Crossfade' ? 'Crossfade' : 'Drift Sprite'}</h4>

      <div class="field">
        <label>Image path</label>
        <input type="text" id="ef-image" value="${escapeAttr(e.imagePath ?? '')}">
      </div>

      ${kind === 'Crossfade' ? `
        <div class="field-row">
          <div class="field"><label>Opacity from</label><input type="number" step="0.01" id="ef-opacity-from" value="${e.opacityFrom ?? 0}"></div>
          <div class="field"><label>Opacity to</label><input type="number" step="0.01" id="ef-opacity-to" value="${e.opacityTo ?? 0.82}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Duration (ms)</label><input type="number" id="ef-duration" value="${e.durationMs ?? 8000}"></div>
          <div class="field"><label>Direction</label><select id="ef-direction">${selectOptions(directions, e.direction ?? 'alternate')}</select></div>
        </div>
        <div class="field"><label>Easing</label><input type="text" id="ef-easing" value="${escapeAttr(e.easing ?? 'ease-in-out')}"></div>
      ` : `
        <div class="field-row">
          <div class="field"><label>X</label><input type="number" id="ef-x" value="${e.x ?? 0}"></div>
          <div class="field"><label>Y</label><input type="number" id="ef-y" value="${e.y ?? 0}"></div>
        </div>
        <div class="field"><label>Blend mode</label><input type="text" id="ef-blend" value="${escapeAttr(e.blendMode ?? '')}" placeholder="e.g. exclusion"></div>

        <div class="field checkbox"><input type="checkbox" id="ef-has-driftx" ${driftX ? 'checked' : ''}><label for="ef-has-driftx">Drift on X</label></div>
        <div class="field-row">
          <div class="field"><label>X from (px)</label><input type="number" id="ef-driftx-from" value="${driftX?.fromPx ?? 0}"></div>
          <div class="field"><label>X to (px)</label><input type="number" id="ef-driftx-to" value="${driftX?.toPx ?? 1000}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>X duration (ms)</label><input type="number" id="ef-driftx-duration" value="${driftX?.durationMs ?? 5000}"></div>
          <div class="field"><label>X direction</label><select id="ef-driftx-direction">${selectOptions(directions, driftX?.direction ?? 'alternate-reverse')}</select></div>
        </div>

        <div class="field checkbox"><input type="checkbox" id="ef-has-drifty" ${driftY ? 'checked' : ''}><label for="ef-has-drifty">Drift on Y</label></div>
        <div class="field-row">
          <div class="field"><label>Y from (px)</label><input type="number" id="ef-drifty-from" value="${driftY?.fromPx ?? -50}"></div>
          <div class="field"><label>Y to (px)</label><input type="number" id="ef-drifty-to" value="${driftY?.toPx ?? 50}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Y duration (ms)</label><input type="number" id="ef-drifty-duration" value="${driftY?.durationMs ?? 1000}"></div>
          <div class="field"><label>Y direction</label><select id="ef-drifty-direction">${selectOptions(directions, driftY?.direction ?? 'alternate')}</select></div>
        </div>
      `}

      <div class="form-actions">
        <button id="btn-save-effect">Save Effect</button>
        <button id="btn-cancel-effect" class="small">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('btn-cancel-effect').addEventListener('click', () => {
    effectFormState = null;
    formContainer.innerHTML = '';
  });

  document.getElementById('btn-save-effect').addEventListener('click', () => {
    const payload = { kind, imagePath: document.getElementById('ef-image').value };

    if (kind === 'Crossfade') {
      Object.assign(payload, {
        opacityFrom: Number(document.getElementById('ef-opacity-from').value),
        opacityTo: Number(document.getElementById('ef-opacity-to').value),
        durationMs: Number(document.getElementById('ef-duration').value),
        direction: document.getElementById('ef-direction').value,
        easing: document.getElementById('ef-easing').value,
      });
    } else {
      Object.assign(payload, {
        x: Number(document.getElementById('ef-x').value),
        y: Number(document.getElementById('ef-y').value),
        blendMode: document.getElementById('ef-blend').value,
        hasDriftX: document.getElementById('ef-has-driftx').checked,
        driftXFromPx: Number(document.getElementById('ef-driftx-from').value),
        driftXToPx: Number(document.getElementById('ef-driftx-to').value),
        driftXDurationMs: Number(document.getElementById('ef-driftx-duration').value),
        driftXDirection: document.getElementById('ef-driftx-direction').value,
        driftXEasing: 'ease-in-out',
        hasDriftY: document.getElementById('ef-has-drifty').checked,
        driftYFromPx: Number(document.getElementById('ef-drifty-from').value),
        driftYToPx: Number(document.getElementById('ef-drifty-to').value),
        driftYDurationMs: Number(document.getElementById('ef-drifty-duration').value),
        driftYDirection: document.getElementById('ef-drifty-direction').value,
        driftYEasing: 'ease-in-out',
      });
    }

    if (effectFormState.effectId) {
      send('update-effect', { pageId: page.id, effectId: effectFormState.effectId, effect: payload });
    } else {
      send('add-effect', { pageId: page.id, effect: payload });
    }
    effectFormState = null;
  });
}

// The index in a list of square centers that's nearest a position. A position off either end of the
// list just lands on that end's square.
function nearestCenterIndex(centers, value) {
  let nearest = 0;
  centers.forEach((center, i) => {
    if (Math.abs(center - value) < Math.abs(centers[nearest] - value)) nearest = i;
  });
  return nearest;
}

function cellAtPoint(grid, x, y) {
  return { col: nearestCenterIndex(grid.columnCenters, x), row: nearestCenterIndex(grid.rowCenters, y) };
}

function cellOfNode(grid, node) {
  return cellAtPoint(grid, node.x + grid.nodeIconSize / 2, node.y + grid.nodeIconSize / 2);
}

// Whichever map location (other than exceptNodeId) is already on a square, or undefined.
function nodeOnCell(page, grid, cell, exceptNodeId) {
  return page.nodes.find((n) => {
    if (isModalNode(n) || n.id === exceptNodeId) return false;
    const c = cellOfNode(grid, n);
    return c.col === cell.col && c.row === cell.row;
  });
}

function nodePositionForCell(grid, cell) {
  return {
    x: grid.columnCenters[cell.col] - grid.nodeIconSize / 2,
    y: grid.rowCenters[cell.row] - grid.nodeIconSize / 2,
  };
}

// Column + Row dropdowns for choosing a square. x/y are the world position currently stored, shown
// as whichever square is nearest. With emptyLabel, the dropdowns also offer leaving it unset.
function cellPickerHtml(idPrefix, label, grid, x, y, emptyLabel) {
  const cell = x != null && y != null ? cellAtPoint(grid, x, y) : null;
  const option = (value, text, selected) => `<option value="${value}"${selected ? ' selected' : ''}>${escapeHtml(text)}</option>`;
  const empty = emptyLabel ? option('', `Default (${emptyLabel})`, !cell) : '';

  return `
    <div class="field-row">
      <div class="field">
        <label>${escapeHtml(label)} column</label>
        <select id="${idPrefix}-col">
          ${empty}
          ${grid.columnLabels.map((text, i) => option(i, text, cell?.col === i)).join('')}
        </select>
      </div>
      <div class="field">
        <label>${escapeHtml(label)} row</label>
        <select id="${idPrefix}-row">
          ${empty}
          ${grid.rowCenters.map((_, i) => option(i, String(i), cell?.row === i)).join('')}
        </select>
      </div>
    </div>
  `;
}

// The chosen square as { col, row }, or null if the picker isn't showing or is left on Default.
function readCellPicker(idPrefix) {
  const col = document.getElementById(`${idPrefix}-col`)?.value;
  const row = document.getElementById(`${idPrefix}-row`)?.value;
  return col && row ? { col: Number(col), row: Number(row) } : null;
}

// The chosen square's center, for a spawn position - or null, same as readCellPicker.
function readCellCenter(idPrefix, grid) {
  const cell = readCellPicker(idPrefix);
  return cell ? { x: grid.columnCenters[cell.col], y: grid.rowCenters[cell.row] } : null;
}

function renderNodeInspector(container, pageId, node) {
  const otherPages = (project.pages ?? []).filter((p) => p.id !== pageId || true); // any page, including self-links if ever wanted
  const action = node.card.action ?? { kind: 'None' };
  const grid = grids[pageId];
  const onMap = findPage(pageId).nodes.includes(node) && !isModalNode(node);
  const arrivalGrid = grids[action.targetPageId];

  container.innerHTML = `
    <h2>Location</h2>

    <div class="field">
      <label>ID / slug</label>
      <input type="text" id="f-node-id" value="${escapeAttr(node.id)}">
      <div class="field-hint">Renaming also renames its cover image file, if that image is only used here.</div>
    </div>

    <div class="field">
      <label>Heading</label>
      <input type="text" id="f-heading" value="${escapeAttr(node.card.headingText)}">
    </div>

    ${onMap
      ? cellPickerHtml('f-square', 'Map', grid, node.x + grid.nodeIconSize / 2, node.y + grid.nodeIconSize / 2)
      : isModalNode(node) ? '' : '<div class="field-hint">Shares its parent\'s square on the map - press X in Track Focus to reach it.</div>'}

    <div class="field-row">
      <div class="field">
        <label>Icon style</label>
        <select id="f-icon-style">
          ${selectOptions(['Default', 'Race'], node.iconStyle)}
        </select>
      </div>
      <div class="field checkbox" style="margin-top: 20px;">
        <input type="checkbox" id="f-persistent" ${node.persistent ? 'checked' : ''}>
        <label for="f-persistent">Persistent (card open by default)</label>
      </div>
    </div>

    <fieldset>
      <legend>Card</legend>

      <div class="field">
        <label>Size</label>
        <select id="f-card-size">
          ${selectOptions(['Standard', 'Hub', 'Custom', 'Modal'], node.card.size)}
        </select>
        ${node.card.size === 'Modal' ? '<div class="field-hint">Modal: a screen-centered popup with a dimmed backdrop, shown on load (if Persistent is checked below) and dismissed only by pressing Z / gamepad A - ignores this location\'s map position entirely.</div>' : ''}
      </div>
      <div class="field-row" id="f-custom-size-row" ${(node.card.size !== 'Custom' && node.card.size !== 'Modal') ? 'hidden' : ''}>
        <div class="field">
          <label>${node.card.size === 'Modal' ? 'Width (px, default 520)' : 'Custom width (px)'}</label>
          <input type="number" id="f-custom-width" value="${node.card.customWidthPx ?? ''}">
        </div>
        <div class="field">
          <label>${node.card.size === 'Modal' ? 'Height (px, default 360)' : 'Custom height (px)'}</label>
          <input type="number" id="f-custom-height" value="${node.card.customHeightPx ?? ''}">
        </div>
      </div>

      <div class="field">
        <label>Cover image</label>
        <div class="cover-field">
          <img id="f-cover-preview" class="cover-preview" ${node.card.coverImagePath ? '' : 'hidden'}
               src="${node.card.coverImagePath ? escapeAttr(toFileUrl(contentRoot, node.card.coverImagePath)) : ''}">
          <div class="cover-field-main">
            <input type="text" id="f-cover" value="${escapeAttr(node.card.coverImagePath ?? '')}">
            <button type="button" id="btn-browse-cover" class="small">Browse…</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Audio URL</label>
        <input type="text" id="f-audio" value="${escapeAttr(node.card.audio?.url ?? '')}">
      </div>
      <div class="field">
        <label>Poetry lines (one per line)</label>
        <textarea id="f-poetry">${escapeHtml((node.card.poetryLines ?? []).join('\n'))}</textarea>
      </div>
    </fieldset>

    <fieldset>
      <legend>Action</legend>

      <div class="field">
        <label>Kind</label>
        <select id="f-action-kind">
          ${selectOptions(['None', 'Download', 'Travel'], action.kind)}
        </select>
      </div>

      <div id="f-download-fields" ${action.kind !== 'Download' ? 'hidden' : ''}>
        <div class="field">
          <label>Download URL</label>
          <input type="text" id="f-action-url" value="${escapeAttr(action.url ?? '')}">
        </div>
      </div>

      <div id="f-travel-fields" ${action.kind !== 'Travel' ? 'hidden' : ''}>
        <div class="field">
          <label>Target page</label>
          <select id="f-target-page">
            <option value="">(none)</option>
            ${otherPages.map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === action.targetPageId ? 'selected' : ''}>${escapeHtml(p.title || p.id)}</option>`).join('')}
          </select>
        </div>
        ${arrivalGrid ? cellPickerHtml('f-spawn', 'Arrival', arrivalGrid, action.travelSpawnX, action.travelSpawnY, 'automatic') : ''}
        <div class="field checkbox">
          <input type="checkbox" id="f-skip-tutorial" ${action.travelSkipTutorial ? 'checked' : ''}>
          <label for="f-skip-tutorial">Skip destination's tutorial/intro card</label>
        </div>
      </div>
    </fieldset>

  `;

  document.getElementById('f-card-size').addEventListener('change', (e) => {
    document.getElementById('f-custom-size-row').hidden = e.target.value !== 'Custom' && e.target.value !== 'Modal';
  });

  document.getElementById('f-cover').addEventListener('input', (e) => updateCoverPreview(e.target.value));
  document.getElementById('btn-browse-cover').addEventListener('click', () => send('pick-cover-image', { pageId, nodeId: node.id }));

  document.getElementById('f-node-id').addEventListener('blur', (e) => {
    const newId = e.target.value.trim();
    if (newId && newId !== node.id)
      send('rename-node-id', { pageId, nodeId: node.id, newId });
  });

  document.getElementById('f-action-kind').addEventListener('change', (e) => {
    document.getElementById('f-download-fields').hidden = e.target.value !== 'Download';
    document.getElementById('f-travel-fields').hidden = e.target.value !== 'Travel';
  });

  const saveNode = () => {
    const numOrNull = (id) => {
      const v = document.getElementById(id).value;
      return v === '' ? null : Number(v);
    };

    const square = onMap ? readCellPicker('f-square') : null;
    const position = square ? nodePositionForCell(grid, square) : { x: node.x, y: node.y };
    const arrival = arrivalGrid ? readCellCenter('f-spawn', arrivalGrid) : null;

    send('update-node', {
      pageId,
      nodeId: node.id,
      node: {
        x: position.x,
        y: position.y,
        persistent: document.getElementById('f-persistent').checked,
        iconStyle: document.getElementById('f-icon-style').value,
        cardSize: document.getElementById('f-card-size').value,
        customWidthPx: numOrNull('f-custom-width'),
        customHeightPx: numOrNull('f-custom-height'),
        headingText: document.getElementById('f-heading').value,
        coverImagePath: document.getElementById('f-cover').value,
        audioUrl: document.getElementById('f-audio').value,
        poetryLines: document.getElementById('f-poetry').value.split('\n').filter((l) => l.length > 0),
        actionKind: document.getElementById('f-action-kind').value,
        actionUrl: document.getElementById('f-action-url')?.value ?? null,
        targetPageId: document.getElementById('f-target-page')?.value || null,
        travelSpawnX: arrival?.x ?? null,
        travelSpawnY: arrival?.y ?? null,
        travelSkipTutorial: document.getElementById('f-skip-tutorial')?.checked ?? false,
      },
    });
  };

  // Text/number/textarea fields save on blur (leaving the field) rather than on every
  // keystroke - a keystroke-triggered save would fight the user's own typing, since every
  // save re-renders this whole form from the authoritative C# state. Select/checkbox fields
  // have no such conflict, so they save immediately on change.
  for (const id of ['f-heading', 'f-custom-width', 'f-custom-height', 'f-cover',
                     'f-audio', 'f-poetry', 'f-action-url'])
    document.getElementById(id).addEventListener('blur', saveNode);

  for (const id of ['f-icon-style', 'f-persistent', 'f-card-size', 'f-action-kind',
                     'f-target-page', 'f-skip-tutorial'])
    document.getElementById(id).addEventListener('change', saveNode);

  // The square pickers only exist where a square applies - see the form above.
  for (const id of ['f-square-col', 'f-square-row', 'f-spawn-col', 'f-spawn-row'])
    document.getElementById(id)?.addEventListener('change', saveNode);
}

// Live-updates the cover image <img> preview as the path field changes, whether typed by hand
// or filled in via the native file picker - so it always reflects whatever f-cover currently
// says, without needing a re-render of the whole inspector.
function updateCoverPreview(path, previewId = 'f-cover-preview') {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  if (path) {
    preview.src = toFileUrl(contentRoot, path);
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }
}

function selectOptions(values, current) {
  return values.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
}

// ---------- map canvas ----------
//
// The background image and each top-level node's marker live in #canvas-world, which carries
// a single CSS transform (translate + scale) per page - dragging a marker only ever needs to
// convert a *screen-space* pointer delta into a *world-space* one by dividing by the current
// scale, since the transform's translation cancels out of any delta. Markers only ever sit in the
// middle of a grid square - see the pointermove handler. Nested nodes aren't placed on the canvas
// at all (they share their parent's square); they stay reachable via the tree's "+ Add nested
// location".

function toFileUrl(root, relativePath) {
  if (!root || !relativePath) return '';
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const full = `${cleanRoot}/${relativePath}`;
  return 'file://' + full.split('/').map(encodeURIComponent).join('/');
}

function getOrInitCanvasView(pageId) {
  if (!canvasViewByPage.has(pageId))
    canvasViewByPage.set(pageId, computeFitView(pageId));
  return canvasViewByPage.get(pageId);
}

function computeFitView(pageId) {
  const page = findPage(pageId);
  const worldW = page?.worldWidthPx ?? project?.defaultWorldWidthPx ?? 3000;
  const worldH = page?.worldHeightPx ?? project?.defaultWorldHeightPx ?? 1686;
  const viewportEl = document.getElementById('canvas-viewport');
  const vw = viewportEl.clientWidth || 800;
  const vh = viewportEl.clientHeight || 600;
  const scale = Math.min(vw / worldW, vh / worldH, 1);
  return { scale, offsetX: 16, offsetY: 16, worldW, worldH };
}

function applyCanvasTransform(pageId) {
  const view = getOrInitCanvasView(pageId);
  document.getElementById('canvas-world').style.transform =
    `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`;
}

function renderCanvas() {
  const emptyEl = document.getElementById('canvas-empty');
  const viewportEl = document.getElementById('canvas-viewport');
  const hintEl = document.getElementById('canvas-hint');

  const page = selectedPageId ? findPage(selectedPageId) : null;

  if (!page) {
    emptyEl.hidden = false;
    viewportEl.hidden = true;
    hintEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  viewportEl.hidden = false;
  hintEl.hidden = false;

  const view = getOrInitCanvasView(page.id);

  const worldEl = document.getElementById('canvas-world');
  worldEl.style.width = view.worldW + 'px';
  worldEl.style.height = view.worldH + 'px';

  const bgEl = document.getElementById('canvas-bg');
  const bgUrl = toFileUrl(contentRoot, page.background?.imagePath);
  if (bgEl.dataset.src !== bgUrl) {
    bgEl.src = bgUrl;
    bgEl.dataset.src = bgUrl;
  }
  // Same as the exported site's own loadPageConfig: the map art fills the world exactly.
  bgEl.style.width = view.worldW + 'px';
  bgEl.style.height = view.worldH + 'px';

  const nodesEl = document.getElementById('canvas-nodes');
  nodesEl.innerHTML = '';
  for (const node of page.nodes) {
    // A modal card ignores its own X/Y entirely (see main.js's modalQueue) - a marker for it
    // here would be pure noise, and it's edited via its own tab instead (selectTutorialModal).
    if (isModalNode(node)) continue;
    nodesEl.appendChild(renderCanvasMarker(node, grids[page.id]));
  }

  renderScreenLines(grids[page.id], view);
  renderEffectPreviews(page);

  applyCanvasTransform(page.id);
}

// Outlines the static screens the map splits into on the exported site, so it's clear which screen a
// location will land on.
function renderScreenLines(grid, view) {
  const layer = document.getElementById('canvas-screens');
  layer.innerHTML = '';

  const line = (className, left, top) => {
    const el = document.createElement('div');
    el.className = className;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    layer.appendChild(el);
  };

  for (const x of grid.screenLinesX) line('screen-line-x', x, grid.screenLinesY[0]);
  for (const y of grid.screenLinesY) line('screen-line-y', 0, y);

  layer.style.setProperty('--screen-lines-height', (grid.screenLinesY.at(-1) - grid.screenLinesY[0]) + 'px');
  layer.style.setProperty('--screen-lines-width', view.worldW + 'px');
}

// Live preview of this page's effects, using the same technique (and close to the same code)
// as applyPageEffects() in the exported site's own runtime/main.js - genuinely animated, not
// just a static list, since the canvas is a real webview. Re-running this on every render is
// cheap (at most a couple of elements) and simplest: it always matches the current effects
// list without needing to diff against what was there last render.
function renderEffectPreviews(page) {
  const layer = document.getElementById('canvas-effects');
  layer.innerHTML = '';

  for (const fx of page.effects ?? []) {
    if (fx.$type === 'crossfade') {
      const img = document.createElement('img');
      img.className = 'effect-preview-crossfade';
      img.style.width = (page.worldWidthPx ?? project?.defaultWorldWidthPx ?? 3000) + 'px';
      img.style.opacity = '0';
      img.src = toFileUrl(contentRoot, fx.imagePath);
      layer.appendChild(img);
      img.animate(
        [{ opacity: fx.opacityFrom }, { opacity: fx.opacityTo }],
        { duration: fx.durationMs, direction: fx.direction || 'alternate', iterations: Infinity, easing: fx.easing || 'ease-in-out' }
      );
    } else if (fx.$type === 'drift') {
      const outer = document.createElement('div');
      outer.style.position = 'absolute';
      outer.style.left = fx.x + 'px';
      outer.style.top = fx.y + 'px';
      if (fx.blendMode) outer.style.mixBlendMode = fx.blendMode;

      const img = document.createElement('img');
      img.className = 'effect-preview-sprite';
      img.src = toFileUrl(contentRoot, fx.imagePath);
      outer.appendChild(img);
      layer.appendChild(outer);

      if (fx.driftX) {
        img.animate(
          { transform: `translateX(${fx.driftX.toPx}px)` },
          { duration: fx.driftX.durationMs, direction: fx.driftX.direction || 'alternate-reverse', iterations: Infinity, easing: fx.driftX.easing || 'ease-in-out' }
        );
      }
      if (fx.driftY) {
        outer.animate(
          [{ transform: `translateY(${fx.driftY.fromPx}px)` }, { transform: `translateY(${fx.driftY.toPx}px)` }],
          { duration: fx.driftY.durationMs, direction: fx.driftY.direction || 'alternate', iterations: Infinity, easing: fx.driftY.easing || 'ease-in-out' }
        );
      }
    }
  }
}

function renderCanvasMarker(node, grid) {
  const el = document.createElement('div');
  const kind = (node.card.action?.kind ?? 'None').toLowerCase();
  el.className = `canvas-marker kind-${kind}` + (node.id === selectedNodeId ? ' selected' : '');
  el.dataset.nodeId = node.id;
  el.style.left = (node.x + grid.nodeIconSize / 2) + 'px';
  el.style.top = (node.y + grid.nodeIconSize / 2) + 'px';
  el.innerHTML = `<div class="dot"></div><div class="label">${escapeHtml(node.card.headingText || node.id)}</div>`;
  return el;
}

function nodeToEditPayload(node) {
  const action = node.card.action ?? { kind: 'None' };
  return {
    x: node.x,
    y: node.y,
    persistent: node.persistent,
    iconStyle: node.iconStyle,
    cardSize: node.card.size,
    customWidthPx: node.card.customWidthPx ?? null,
    customHeightPx: node.card.customHeightPx ?? null,
    headingText: node.card.headingText,
    coverImagePath: node.card.coverImagePath ?? '',
    audioUrl: node.card.audio?.url ?? '',
    poetryLines: node.card.poetryLines ?? [],
    actionKind: action.kind,
    actionUrl: action.url ?? '',
    targetPageId: action.targetPageId ?? null,
    travelSpawnX: action.travelSpawnX ?? null,
    travelSpawnY: action.travelSpawnY ?? null,
    travelSkipTutorial: action.travelSkipTutorial ?? false,
  };
}

const canvasViewportEl = document.getElementById('canvas-viewport');

let panState = null;
let nodeDragState = null;
const DRAG_THRESHOLD_PX = 3;
const MARKER_HIT_RADIUS_PX = 16; // screen-space; deliberately independent of DOM hit-testing

// Marker hit-testing is done here in JS (forward-transforming each node's world position to
// screen space and comparing to the pointer) rather than relying on the browser to hit-test
// the small marker elements through #canvas-world's CSS scale transform - that turned out to
// be unreliable in this WebKit build (clicks landing dead-center on a visually huge, zoomed-in
// marker still missed it). This reuses the exact same transform math already proven reliable
// for pan/zoom/double-click, so it's also simpler than it looks.
function screenPositionOf(node, view, grid) {
  return {
    x: (node.x + grid.nodeIconSize / 2) * view.scale + view.offsetX,
    y: (node.y + grid.nodeIconSize / 2) * view.scale + view.offsetY,
  };
}

// Shows which square a dragged marker would land on, and whether it's free to.
function showCellHighlight(grid, cell, occupied) {
  const el = document.getElementById('canvas-cell-highlight');
  el.hidden = false;
  el.classList.toggle('occupied', occupied);
  el.style.left = (grid.columnCenters[cell.col] - grid.cellWidth / 2) + 'px';
  el.style.top = (grid.rowCenters[cell.row] - grid.cellHeight / 2) + 'px';
  el.style.width = grid.cellWidth + 'px';
  el.style.height = grid.cellHeight + 'px';
}

function findMarkerAtScreenPoint(page, view, sx, sy) {
  let closest = null;
  let closestDist = MARKER_HIT_RADIUS_PX;
  for (const node of page.nodes) {
    if (isModalNode(node)) continue; // not shown on the canvas at all - see renderCanvas
    const p = screenPositionOf(node, view, grids[page.id]);
    const d = Math.hypot(sx - p.x, sy - p.y);
    if (d < closestDist) {
      closestDist = d;
      closest = node;
    }
  }
  return closest;
}

function viewportPoint(e) {
  const rect = canvasViewportEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvasViewportEl.addEventListener('wheel', (e) => {
  if (!selectedPageId) return;
  e.preventDefault();

  const view = getOrInitCanvasView(selectedPageId);
  const { x: cx, y: cy } = viewportPoint(e);
  const worldXBefore = (cx - view.offsetX) / view.scale;
  const worldYBefore = (cy - view.offsetY) / view.scale;

  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  view.scale = Math.min(4, Math.max(0.02, view.scale * factor));
  view.offsetX = cx - worldXBefore * view.scale;
  view.offsetY = cy - worldYBefore * view.scale;

  applyCanvasTransform(selectedPageId);
}, { passive: false });

canvasViewportEl.addEventListener('pointerdown', (e) => {
  if (!selectedPageId) return;

  const page = findPage(selectedPageId);
  const view = getOrInitCanvasView(selectedPageId);
  const { x: sx, y: sy } = viewportPoint(e);
  const hit = findMarkerAtScreenPoint(page, view, sx, sy);

  canvasViewportEl.setPointerCapture(e.pointerId);

  if (hit) {
    nodeDragState = {
      nodeId: hit.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorldX: hit.x + grids[page.id].nodeIconSize / 2,
      startWorldY: hit.y + grids[page.id].nodeIconSize / 2,
      moved: false,
      cell: null, // the square the marker would land on right now, once it's been dragged at all
      cellOccupant: null,
    };
  } else {
    canvasViewportEl.classList.add('panning');
    panState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: view.offsetX,
      origOffsetY: view.offsetY,
      moved: false,
    };
  }
});

canvasViewportEl.addEventListener('pointermove', (e) => {
  const view = getOrInitCanvasView(selectedPageId);

  if (nodeDragState && e.pointerId === nodeDragState.pointerId) {
    const dxScreen = e.clientX - nodeDragState.startClientX;
    const dyScreen = e.clientY - nodeDragState.startClientY;
    if (Math.abs(dxScreen) > DRAG_THRESHOLD_PX || Math.abs(dyScreen) > DRAG_THRESHOLD_PX)
      nodeDragState.moved = true;

    const markerEl = document.querySelector(`.canvas-marker[data-node-id="${cssEscape(nodeDragState.nodeId)}"]`);
    if (markerEl && nodeDragState.moved) {
      const page = findPage(selectedPageId);
      const grid = grids[page.id];
      const cell = cellAtPoint(grid, nodeDragState.startWorldX + dxScreen / view.scale, nodeDragState.startWorldY + dyScreen / view.scale);

      nodeDragState.cell = cell;
      nodeDragState.cellOccupant = nodeOnCell(page, grid, cell, nodeDragState.nodeId) ?? null;

      markerEl.style.left = grid.columnCenters[cell.col] + 'px';
      markerEl.style.top = grid.rowCenters[cell.row] + 'px';
      markerEl.classList.add('dragging');
      showCellHighlight(grid, cell, !!nodeDragState.cellOccupant);
    }
    return;
  }

  if (panState && e.pointerId === panState.pointerId) {
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) panState.moved = true;
    view.offsetX = panState.origOffsetX + dx;
    view.offsetY = panState.origOffsetY + dy;
    applyCanvasTransform(selectedPageId);
  }
});

canvasViewportEl.addEventListener('pointerup', (e) => {
  canvasViewportEl.releasePointerCapture(e.pointerId);

  if (nodeDragState && e.pointerId === nodeDragState.pointerId) {
    const { nodeId, moved, cell, cellOccupant } = nodeDragState;
    const markerEl = document.querySelector(`.canvas-marker[data-node-id="${cssEscape(nodeId)}"]`);
    markerEl?.classList.remove('dragging');
    document.getElementById('canvas-cell-highlight').hidden = true;

    if (moved && cell) {
      const grid = grids[selectedPageId];
      const node = findNode(selectedPageId, nodeId);
      const current = cellOfNode(grid, node);

      if (cellOccupant) {
        setStatus(`That square already has '${cellOccupant.card.headingText}' on it.`, true);
        renderCanvas();
      } else if (cell.col !== current.col || cell.row !== current.row) {
        send('update-node', {
          pageId: selectedPageId,
          nodeId,
          node: { ...nodeToEditPayload(node), ...nodePositionForCell(grid, cell) },
        });
      }
    } else {
      selectNode(selectedPageId, nodeId);
    }
    nodeDragState = null;
    return;
  }

  if (panState && e.pointerId === panState.pointerId) {
    canvasViewportEl.classList.remove('panning');
    if (!panState.moved && selectedNodeId) {
      selectPage(selectedPageId); // click on empty canvas deselects the current node
    }
    panState = null;
  }
});

canvasViewportEl.addEventListener('dblclick', (e) => {
  if (!selectedPageId) return;

  const page = findPage(selectedPageId);
  const view = getOrInitCanvasView(selectedPageId);
  const { x: sx, y: sy } = viewportPoint(e);
  if (findMarkerAtScreenPoint(page, view, sx, sy)) return;

  const grid = grids[page.id];
  const cell = cellAtPoint(grid, (sx - view.offsetX) / view.scale, (sy - view.offsetY) / view.scale);
  const occupant = nodeOnCell(page, grid, cell);
  if (occupant) {
    setStatus(`That square already has '${occupant.card.headingText}' on it.`, true);
    return;
  }

  send('add-node', { pageId: selectedPageId, ...nodePositionForCell(grid, cell) });
});

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

// ---------- issues / warnings / status ----------

function renderList(sectionId, listId, items) {
  const section = document.getElementById(sectionId);
  const list = document.getElementById(listId);
  list.innerHTML = '';

  if (!items || items.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
}

function setStatus(text, isError) {
  const bar = document.getElementById('status-bar');
  document.getElementById('status-text').textContent = text;
  bar.classList.toggle('error', !!isError);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', '&quot;');
}
