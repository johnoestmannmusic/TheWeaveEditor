// cards.js
// John Oestmann
// Location cards: modal cards and the ones already seen, opening and placing a location's card, persistent
// cards, a location's parts locking until the part before is solved, solved puzzles, locations locked by their
// requirements, and what Z, X and C do on the map.
//
// Part of the page script, split from main.js by concern. Every part shares one set of page-wide names, loaded in
// order after main.js - see main.js for the page's state and setup. Part of the canonical shared runtime owned by
// TheWeave.Exporter - generated into every exported site's jsx/ folder, not hand-edited there.

function hasSeenModal(modalId){
  if (!modalId) return false;
  try {
    return sessionStorage.getItem(MODAL_SEEN_KEY_PREFIX + modalId) === "true";
  } catch (e) {
    return false;
  }
}

function markModalSeen(modalId){
  if (!modalId) return;
  try {
    sessionStorage.setItem(MODAL_SEEN_KEY_PREFIX + modalId, "true");
  } catch (e) {
    // storage unavailable - the modal will just show again next page load, see header above.
  }
}

// Shows modalQueue[0] (a no-op if the queue is empty - e.g. every page load with no modal card
// due, or none left to show), creating the dimming backdrop on first use. Clicking the backdrop
// itself also dismisses the current modal, same as Z/gamepad A - a common enough modal
// convention that leaving it out would read as a missing feature, not a deliberate omission.
function showCurrentModal(){
  if (modalQueue.length === 0) return;

  if (!modalBackdrop) {
    modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'modalBackdrop';
    modalBackdrop.addEventListener('click', closeCurrentModal);
    document.documentElement.appendChild(modalBackdrop);
  }

  nodeMeta.get(modalQueue[0]).info.style.display = '';
}

// Dismisses modalQueue[0] and reveals the next queued modal, if any; removes the backdrop once
// none are left. Bound to Z/gamepad A while the queue is non-empty (see bindInput/updateInput) -
// callers don't need to check modalQueue.length themselves first, this is already a no-op on an
// empty queue.
function closeCurrentModal(){
  if (modalQueue.length === 0) return;

  let meta = nodeMeta.get(modalQueue[0]);
  meta.info.style.display = 'none';
  markModalSeen(meta.modalId);
  modalQueue.shift();

  if (modalQueue.length > 0) {
    showCurrentModal();
  } else if (modalBackdrop) {
    modalBackdrop.remove();
    modalBackdrop = null;
  }
}

// Marks whether a node's card is currently open, driving .node.cardOpen (see main.css) so an
// open card's own icon-bearing .node paints above every plain (closed) .node - without this,
// nearby nodes on the map stack purely by document order and can draw their icon over this
// card's cover art/content. Kept as a single setter (rather than each call site touching
// classList directly) so it can't drift out of sync with the display toggle it always pairs with.
function setCardOpen(node, meta, open){
  meta.info.style.display = open ? '' : 'none';
  node.classList.toggle('cardOpen', open);
  if (open) placeCard(node, meta);
}

// Keeps a card fully inside its node's screen, now that there's no camera to bring it into view. It
// goes where it was authored if that fits; otherwise it flips to the other side of the icon, then
// slides up or down as needed. Works from the authored offset every time, so a card that had to move
// doesn't stay moved for no reason.
function placeCard(node, meta){
  let info = meta.info;
  if (meta.cardLeft === undefined) {
    meta.cardLeft = parseFloat(info.style.left) || 0;
    meta.cardTop = parseFloat(info.style.top) || 0;
  }

  let nodeX = parseFloat(node.style.left) || 0;
  let nodeY = parseFloat(node.style.top) || 0;
  let screen = screenOriginOf(meta.cell);
  let screenRight = screen.x + weavePage.screen.width - CARD_SCREEN_MARGIN;
  let screenBottom = screen.y + weavePage.screen.height - CARD_SCREEN_MARGIN;

  let x = nodeX + meta.cardLeft;
  let y = nodeY + meta.cardTop;

  if (x + info.offsetWidth > screenRight) {
    // The same gap from the icon's left edge as the authored position has from its right.
    x = nodeX - (meta.cardLeft - NODE_ICON_SIZE) - info.offsetWidth;
  }

  x = clamp(x, screen.x + CARD_SCREEN_MARGIN, screenRight - info.offsetWidth);
  y = clamp(y, screen.y + CARD_SCREEN_MARGIN, screenBottom - info.offsetHeight);

  info.style.left = (x - nodeX) + "px";
  info.style.top = (y - nodeY) + "px";
}

// A persistent card is already open by the time anything knows where screens are - see loadNodes.
function placePersistentCards(){
  nodeMeta.forEach((meta, node) => {
    if (meta.isTopLevel && !meta.isModal && meta.persistent && meta.info.style.display !== 'none') {
      placeCard(node, meta);
      // Shown whatever's been explored, so it's kept above the fog - see main.css's #fog.
      node.classList.add('persistentCard');
    }
  });
}

// Closes a location's card when the ship leaves it.
function hideLocation(root){
  let meta = nodeMeta.get(root);
  if (!meta.persistent) {
    setCardOpen(root, meta, false);
    meta.img.src = restingIcon(meta);
  }
  activeNode = null;
}

// Opens a location's card once the ship stops on it. Always the root's own: a chain's later parts
// are only ever reached in Track Focus (see cycleChainNode), so their cards never open on the map.
function showLocation(root){
  let meta = nodeMeta.get(root);
  if (!meta.persistent) {
    setCardOpen(root, meta, true);
    meta.img.src = 'img/node-active.png';
  }
  activeNode = root;
}

// A location's parts are levels: each is locked until the puzzle of every part before it is solved. Returns
// the earliest part still holding this one back, or null if it's unlocked. A part with no puzzle, or one with
// no Finish, can't be solved, so it holds nothing back - otherwise what's after it could never be reached.
function partLockedBy(member){
  let chain = nodeMeta.get(activeRoot).chain;
  for (const earlier of chain.slice(0, chain.indexOf(member))) {
    let puzzle = nodeMeta.get(earlier).puzzle;
    if (WeavePuzzle.hasFinish(puzzle) && !isPuzzleSolved(puzzle)) return earlier;
  }
  return null;
}

// localStorage (not sessionStorage, as with hasSeenModal) because what a visitor has unlocked should
// still be unlocked when they come back. Wrapped defensively for the same reasons as hasSeenModal, which
// degrades to having to solve it again next time rather than breaking the page. Remembered for the page's
// lifetime as well, for when storage isn't available at all.
const PUZZLE_SOLVED_KEY_PREFIX = "weave-puzzle-solved:";
const solvedThisPage = new Set();

function isPuzzleSolved(puzzle){
  if (solvedThisPage.has(puzzle.id)) return true;
  try {
    return localStorage.getItem(PUZZLE_SOLVED_KEY_PREFIX + puzzle.id) === "true";
  } catch (e) {
    return false;
  }
}

function markPuzzleSolved(puzzle){
  solvedThisPage.add(puzzle.id);
  try {
    localStorage.setItem(PUZZLE_SOLVED_KEY_PREFIX + puzzle.id, "true");
  } catch (e) {
    // storage unavailable - see above.
  }
  refreshNodeLocks();
}

// Whether a stage has been solved, from its id alone, since it may be on another planet's page.
function isStageSolved(id){
  return isPuzzleSolved({ id });
}

// Which locations on the map are locked, waiting on their requirements (see Node.Requirements), and which are
// fully completed, every one of their stages solved. Worked out on load and whenever a puzzle is solved, so that
// finishing the last stage of one location opens another straight away. A locked one's icon is greyed out, and
// its card only says what it's waiting for - see main.css's .node.locked.
// The icon a location shows while the ship isn't on it: its own, or a locked one if it's waiting on requirements.
function restingIcon(meta){
  return meta.locked ? lockedIconSrc() : (meta.restingSrc ?? 'img/node.png');
}

// A locked location's icon: the location icon's own 8-pixel octagon, but in a dull red, and more solid, so it stands
// out on any map. Drawn once, rather than recoloured from the icon's image, which a page opened from a file can't read.
const LOCKED_ICON_ROWS = ['..####..', '.#oooo#.', '#oooooo#', '#oooooo#', '#oooooo#', '#oooooo#', '.#oooo#.', '..####..'];
const LOCKED_ICON_COLOURS = { '#': 'rgba(104, 34, 30, 0.9)', 'o': 'rgba(150, 56, 48, 0.72)' };
let lockedIcon = null;

function lockedIconSrc(){
  if (lockedIcon) return lockedIcon;
  let canvas = document.createElement('canvas');
  canvas.width = canvas.height = LOCKED_ICON_ROWS.length;
  let context = canvas.getContext('2d');
  LOCKED_ICON_ROWS.forEach((row, y) => [...row].forEach((paint, x) => {
    if (!LOCKED_ICON_COLOURS[paint]) return;
    context.fillStyle = LOCKED_ICON_COLOURS[paint];
    context.fillRect(x, y, 1, 1);
  }));
  return lockedIcon = canvas.toDataURL();
}

function refreshNodeLocks(){
  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    let waitingOn = meta.requires
      .map(requirement => ({ ...requirement, solved: requirement.stages.filter(isStageSolved).length }))
      .filter(requirement => requirement.solved < requirement.stages.length);
    meta.locked = waitingOn.length > 0;
    let completed = meta.stages.length > 0 && meta.stages.every(isStageSolved);

    node.classList.toggle('locked', meta.locked);
    node.classList.toggle('completed', completed && !meta.locked);
    meta.minimapIcon?.classList.toggle('locked', meta.locked);
    meta.minimapIcon?.classList.toggle('completed', completed && !meta.locked);

    // A locked location's icon is its own dull red one, unless the ship's standing on it - see restingIcon.
    meta.restingSrc ??= meta.img.getAttribute('src');
    if (!node.classList.contains('cardOpen')) meta.img.src = restingIcon(meta);
    if (meta.minimapIcon) meta.minimapIcon.src = restingIcon(meta);

    meta.info.querySelector(':scope > .lockedPanel')?.remove();
    if (meta.locked) meta.info.prepend(buildLockedPanel(waitingOn));
  });
}

// What a locked location's card says instead of anything about it: what it's waiting for, and how far along each
// is, in stages.
function buildLockedPanel(waitingOn){
  let panel = document.createElement('div');
  panel.className = 'lockedPanel';
  let heading = document.createElement('h3');
  heading.textContent = 'Locked';
  panel.appendChild(heading);
  for (const requirement of waitingOn) {
    let line = document.createElement('div');
    line.className = 'lockedRequirement';
    let name = document.createElement('div');
    name.textContent = 'Complete ' + requirement.name + (requirement.planet ? ', on ' + requirement.planet : '');
    let progress = document.createElement('div');
    progress.className = 'lockedProgress';
    progress.textContent = requirement.solved + ' / ' + requirement.stages.length + ' stages complete';
    line.append(name, progress);
    panel.appendChild(line);
  }
  return panel;
}

// X (keyboard) / X (gamepad): restarts the puzzle on the board, otherwise steps through a location's parts.
function onSwitchButton(){
  if (focusTransition) return;
  if (boardMover) restartBoardGame();
  else cycleChainNode();
}

// X (keyboard) / X (gamepad): in Track Focus, step to the next part of the current location, wrapping
// back to the first. A locked part can be stepped to, but only shows that it's locked - see
// renderTrackFocus. Music crossfades on its own, since updateLocationAudio follows activeNode.
function cycleChainNode(){
  if (!trackFocusEl || boardMover) return;

  let chain = nodeMeta.get(activeRoot).chain;
  if (chain.length <= 1) return;

  chainIndex = (chainIndex + 1) % chain.length;
  activeNode = chain[chainIndex];
  renderTrackFocus();
}

// Whether something is covering the whole screen, leaving the map underneath out of reach.
function isScreenCovered(){
  return modalQueue.length > 0 || trackFocusEl !== null;
}

// Z (keyboard) / A (gamepad). Whatever is covering the screen takes this over entirely: a modal
// card (see modalQueue) first, then Track Focus, which starts its board. It has no use on the board
// itself yet.
function onInteractButton(){
  if (modalQueue.length > 0) closeCurrentModal();
  else if (boardMover) return;
  else if (trackFocusEl) startBoardGame();
  else onInteract();
}

// C (keyboard) / B (gamepad): back out one level, from the board to Track Focus to the map.
function onBackButton(){
  if (boardMover) leaveBoardGame();
  else closeTrackFocus();
}

function onInteract(){
  if (!activeNode) return;

  let meta = nodeMeta.get(activeNode);
  // A locked location can't be entered or travelled through, and its card stays as it is.
  if (nodeMeta.get(activeRoot)?.locked) return;
  let travelLink = meta.info.querySelector('.poetry-travel a');

  if (travelLink) {
    showLeavingScreen();
    window.location.href = travelLink.getAttribute('href');
  } else if (meta.audio) {
    openTrackFocus();
  } else {
    // Informational-only card (e.g. tutorial) - interact just toggles it
    setCardOpen(activeNode, meta, meta.info.style.display === 'none');
  }
}
