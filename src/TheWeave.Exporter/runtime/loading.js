// loading.js
// John Oestmann
// The loading screen, the progress carried over from the last page, the brief screens shown while leaving and
// while a scene's art loads, and telling the site's shell about the visitor's interactions.
//
// Part of the page script, split from main.js by concern. Every part shares one set of page-wide names, loaded in
// order after main.js - see main.js for the page's state and setup. Part of the canonical shared runtime owned by
// TheWeave.Exporter - generated into every exported site's jsx/ folder, not hand-edited there.

// ---------- loading screen ----------
//
// "Entering.." over a dulled screen, with a pixel-art progress bar, whenever a new page or scene is coming:
// travelling between pages, the site's first load, opening Track Focus, and jumping to the next part's board.
//
// Travelling hands it from one page to the next with no gap. The page being left shows it the moment the
// visitor travels, and the browser keeps that page on screen until the new one is ready to draw. The new
// page has the same screen in its HTML, so its very first frame shows it too, then it fills the bar as its
// images load. The bar never goes back: the page being left records how far it got - see showLeavingScreen.

const LOADING_SEGMENTS = 20;
const LOADING_FADE_MS = 200;
// How long a scene that's already loaded shows it for, so it reads as a transition rather than a flicker.
const LOADING_SCENE_MS = 400;
// While leaving, how far the bar creeps towards, and how quickly: browsers don't say how far along the next
// page is until it arrives.
const LOADING_CREEP_TO = 0.6;
const LOADING_CREEP_MS = 1500;
const LOADING_PROGRESS_KEY = 'weave-loading-progress';

let loadingEl = null;
let loadingProgress = 0;
let loadingHideTimer = null;
let loadingRun = 0; // bumped by each show, so an older animation knows to stop

// Picked up as this script runs, in the page's <head>, so that the bar already shows it on the very first
// frame, which can be drawn before the rest of this file gets to run. Set on <html> for #loadingFill to
// inherit until then - see initLoadingScreen.
const carriedLoadingProgress = readCarriedProgress();
document.documentElement.style.setProperty('--loading-segments', Math.floor(carriedLoadingProgress * LOADING_SEGMENTS));

// The screen is in the HTML so that it paints first, but that puts it in <body>, which later gets a transform
// (see updateView) that would make its position: fixed relative to the whole world rather than the window.
// So it moves out to <html>, like #screenFrame, before that happens.
function initLoadingScreen(){
  loadingEl = document.getElementById('loadingScreen');
  if (!loadingEl) return;
  document.documentElement.appendChild(loadingEl);

  setLoadingProgress(carriedLoadingProgress);

  // A page brought back from the browser's back/forward cache was left showing it, mid-creep.
  window.addEventListener('pageshow', (e) => { if (e.persisted) hideLoadingScreen(true); });
}

// How far the page that sent us here got, so this page's bar carries on from there. Storage can be blocked,
// in which case it starts from empty - see hasSeenModal on why that's guarded.
function readCarriedProgress(){
  try {
    let carried = parseFloat(sessionStorage.getItem(LOADING_PROGRESS_KEY));
    sessionStorage.removeItem(LOADING_PROGRESS_KEY);
    return isNaN(carried) ? 0 : carried;
  } catch (e) {
    return 0;
  }
}

// In whole segments, and only ever forward unless restarting.
function setLoadingProgress(fraction, restart){
  if (!loadingEl) return;
  loadingProgress = restart ? fraction : Math.max(loadingProgress, fraction);
  let segments = Math.floor(Math.min(1, loadingProgress) * LOADING_SEGMENTS);
  loadingEl.style.setProperty('--loading-segments', segments);
}

function showLoadingScreen(){
  if (!loadingEl) return;
  clearTimeout(loadingHideTimer);
  loadingRun++;
  loadingEl.hidden = false;
  loadingEl.classList.remove('loadingDone');
  setLoadingProgress(0, true);
  return loadingRun;
}

// Fills the bar, then fades out. immediately skips both, for a page that's already in view.
function hideLoadingScreen(immediately){
  if (!loadingEl) return;
  loadingRun++;
  clearTimeout(loadingHideTimer);
  if (immediately) {
    loadingEl.hidden = true;
    return;
  }
  setLoadingProgress(1);
  loadingEl.classList.add('loadingDone');
  loadingHideTimer = setTimeout(() => { loadingEl.hidden = true; }, LOADING_FADE_MS);
}

// Fills the bar as this page's images (the map and every card's album art) and its font finish loading, or
// fail to, and hides it once they all have.
function trackPageLoading(){
  if (!loadingEl) return;
  let start = loadingProgress;
  let images = [...document.images];
  let total = images.length + 1;
  let done = 0;
  let fontsDone = false;

  let update = () => {
    setLoadingProgress(start + (1 - start) * (done + (fontsDone ? 1 : 0)) / total);
    if (done === images.length && fontsDone) hideLoadingScreen();
  };

  for (const image of images) {
    if (image.complete) {
      done++;
      continue;
    }
    let finished = () => { done++; update(); };
    image.addEventListener('load', finished, { once: true });
    image.addEventListener('error', finished, { once: true });
  }

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { fontsDone = true; update(); });
  update();
}

// Shown on the page being left, creeping forward until the next page takes over, and noting how far it got.
function showLeavingScreen(){
  let run = showLoadingScreen();
  if (run === undefined) return;
  let started = performance.now();

  let creep = (now) => {
    if (run !== loadingRun) return;
    setLoadingProgress(LOADING_CREEP_TO * (1 - Math.exp(-(now - started) / LOADING_CREEP_MS)));
    try { sessionStorage.setItem(LOADING_PROGRESS_KEY, String(loadingProgress)); } catch (e) { /* see readCarriedProgress */ }
    requestAnimationFrame(creep);
  };
  requestAnimationFrame(creep);
}

// For a scene whose art is already loaded with the page: shown for LOADING_SCENE_MS, or until the art has
// finished decoding if that takes longer.
function showSceneLoading(image){
  let run = showLoadingScreen();
  if (run === undefined) return;
  let started = performance.now();
  let decoded = false;
  (image?.decode ? image.decode() : Promise.resolve()).catch(() => {}).then(() => { decoded = true; });

  let step = (now) => {
    if (run !== loadingRun) return;
    let elapsed = now - started;
    setLoadingProgress(Math.min(0.95, elapsed / LOADING_SCENE_MS));
    if (decoded && elapsed >= LOADING_SCENE_MS) hideLoadingScreen();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Tells the shell the visitor has actually interacted with this page - keyboard or gamepad
// input. This is what lets the shell unmute its hub-theme track (autoplay policies require a
// genuine gesture, and a keypress that lands inside this iframe is one even though the shell's
// own top-level document never directly saw it - see shell.js's bindBackgroundMusic). Sent at
// most once per page load; every input source that can trigger it shares this one flag.
let shellInteractionNotified = false;
function notifyShellOfInteraction(){
  if (shellInteractionNotified || window.parent === window) return;
  shellInteractionNotified = true;
  window.parent.postMessage({ source: 'weave-interaction' }, '*');
}

// When this page is embedded in the persistent shell's iframe (see shell.js), arrow-key movement
// needs real keyboard events to land in THIS document, not the shell's. The shell tries to
// help by calling this iframe's contentWindow.focus() from the outside, but that's a parent
// reaching into a child - browsers are free to silently ignore it as focus-stealing protection,
// and Chrome in particular does exactly that whenever the two documents don't share an origin
// (which is every local file:// export, since Chrome gives each file:// document its own
// opaque origin - confirmed empirically, not assumed). Left unclaimed, focus stays on the
// <iframe> element itself in the shell's own document, and the browser's default action for
// arrow keys on a focused, scrollable iframe is to nudge *its own viewport* by a small native
// increment - which is exactly what reads as "the page slides around a little, ship staying
// still": the game's own keydown listener below never sees the event at all.
//
// The fix is for this document to claim its own focus instead of waiting to be given it - a
// frame focusing itself is always allowed, regardless of cross-origin embedding, since nothing
// is reaching across the boundary. document.body needs a tabindex to be focusable at all (plain
// <body> isn't by default); preventScroll avoids any incidental scroll-into-view side effect
// from the focus() call itself.
function claimOwnFocus(){
  document.body.setAttribute('tabindex', '-1');
  document.body.focus({ preventScroll: true });
}
