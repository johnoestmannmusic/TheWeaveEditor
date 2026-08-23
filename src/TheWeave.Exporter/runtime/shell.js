// shell.js
// John Oestmann
// The persistent site shell: an <iframe> that every actual page (map, planet, shrine, ...)
// loads into, plus whatever needs to survive travel between them without restarting - today
// just the looping background track, ducking out whenever a location's own song is playing.
//
// This file is the canonical shared runtime owned by TheWeave.Exporter - it's generated into
// every exported site's jsx/shell.js, not hand-edited there. See main.js's own header for the
// per-page runtime this loads inside its iframe.

const BG_MUSIC_VOLUME = 0.5;
const BG_MUSIC_FADE_MS = 900;

let bgMusic;
let stage;
let musicUnlocked = false; // see unlockMusic()
let desiredVolume = BG_MUSIC_VOLUME;
let fadeHandle = null;

document.addEventListener('DOMContentLoaded', function() {
  stage = document.getElementById('weaveStage');
  bgMusic = document.getElementById('weaveBgMusic');

  if (stage) bindStageFocus(stage);
  if (bgMusic) bindBackgroundMusic(bgMusic);
});

// Keyboard (arrow keys, Z, X) drives the ship inside the iframe's own document, so it needs to
// actually hold focus - without this, a visitor who lands on the shell and immediately starts
// pressing arrow keys (never having clicked anything) gets no response, since by default no
// element in the top document is focused into the iframe. Re-focused on every (re)load - i.e.
// every in-iframe navigation between pages too - so it stays true throughout a whole visit.
function bindStageFocus(stage) {
  const focusStage = () => {
    try { stage.contentWindow.focus(); } catch (e) { /* cross-origin - not expected here */ }
  };
  focusStage();
  stage.addEventListener('load', focusStage);
  window.addEventListener('focus', focusStage);
}

// Most browsers refuse to autoplay audible sound before the visitor has interacted with the
// page at all. Rather than block on that with a "click to enter" splash, the track starts
// muted (always allowed) and unmutes/fades in on the first real user gesture - a click/tap
// anywhere in the shell, a keypress there, or (via postMessage - see main.js's own
// notifyShellOfInteraction/notifyShellOfTrackState) the first keyboard/gamepad input inside
// the iframe itself, which is just as real a gesture even though it happens in a nested
// document. That's also why the 'weave-track' branch below only unlocks on playing:true
// (a location's song actually starting): main.js announces playing:false unconditionally on
// every single page load, including the very first one, and that particular message carries
// no gesture behind it at all - unlocking on it would start audible playback before the
// visitor had done anything.
function bindBackgroundMusic(bgMusic) {
  bgMusic.loop = true;
  bgMusic.volume = 0;
  bgMusic.muted = true;
  bgMusic.play().catch(() => {});

  const unlockMusic = () => {
    if (musicUnlocked) return;
    musicUnlocked = true;
    bgMusic.muted = false;
    bgMusic.play().catch(() => {});
    fadeTo(desiredVolume);
    window.removeEventListener('pointerdown', unlockMusic);
    window.removeEventListener('keydown', unlockMusic);
  };
  window.addEventListener('pointerdown', unlockMusic);
  window.addEventListener('keydown', unlockMusic);

  window.addEventListener('message', function(e) {
    if (!e.data) return;

    if (e.data.source === 'weave-track') {
      desiredVolume = e.data.playing ? 0 : BG_MUSIC_VOLUME;
      if (musicUnlocked) fadeTo(desiredVolume);
      else if (e.data.playing) unlockMusic(); // starting a track is itself a real gesture
    } else if (e.data.source === 'weave-interaction') {
      unlockMusic();
    }
  });
}

function fadeTo(targetVolume) {
  if (fadeHandle) cancelAnimationFrame(fadeHandle);

  const startVolume = bgMusic.volume;
  const startTime = performance.now();

  fadeHandle = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - startTime) / BG_MUSIC_FADE_MS);
    bgMusic.volume = startVolume + (targetVolume - startVolume) * t;
    fadeHandle = t < 1 ? requestAnimationFrame(step) : null;
  });
}
