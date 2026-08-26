// shell.js
// John Oestmann
// The persistent site shell: an <iframe> that every actual page (map, planet, shrine, ...)
// loads into, plus whatever needs to survive travel between them without restarting - today
// just the "hub theme" track (WeaveProject.BackgroundMusicPath), whose volume main.js drives
// via postMessage: full ambient volume while the visitor is on the home page itself, fading in
// via the same proximity curve as location audio as they approach a node elsewhere that travels
// back to it (see main.js's updateHubMusicSignal).
//
// This file is the canonical shared runtime owned by TheWeave.Exporter - it's generated into
// every exported site's jsx/shell.js, not hand-edited there. See main.js's own header for the
// per-page runtime this loads inside its iframe.

const BG_MUSIC_VOLUME = 0.5;
// 'weave-hub-music' arrives every frame now (main.js's updateHubMusicSignal, a continuous
// proximity value), not on discrete events the way the old ducking signal did - so this can't be
// "start a fresh BG_MUSIC_FADE_MS-long animation on every message" (received every ~16ms, that
// would restart itself before ever finishing). Converted instead into a per-millisecond ease
// retention factor for a *persistent* loop (stepFade) that continuously nudges bgMusic.volume
// toward whatever desiredVolume currently is, same "ease toward a continuously-updated target"
// idiom main.js itself already uses (see e.g. its CAMERA_EASE/AUDIO_VOLUME_EASE) - picked so an
// unattended target still reads as "settled" in roughly the same ~900ms it always has.
const BG_MUSIC_FADE_MS = 900;
const BG_MUSIC_EASE_PER_MS = Math.exp(Math.log(0.05) / BG_MUSIC_FADE_MS);

let bgMusic;
let stage;
let musicUnlocked = false; // see unlockMusic()
let desiredVolume = BG_MUSIC_VOLUME;

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
// notifyShellOfInteraction) the first keyboard/gamepad input inside the iframe itself, which is
// just as real a gesture even though it happens in a nested document. The continuous
// 'weave-hub-music' audibility signal itself never unlocks playback on its own - it carries no
// gesture behind it (it's sent every frame regardless of what the visitor has done), so an
// explicit interaction is always what unmutes this.
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
    // stepFade (below) picks up the fade-in from here on its own, now that musicUnlocked is true.
    window.removeEventListener('pointerdown', unlockMusic);
    window.removeEventListener('keydown', unlockMusic);
  };
  window.addEventListener('pointerdown', unlockMusic);
  window.addEventListener('keydown', unlockMusic);

  window.addEventListener('message', function(e) {
    if (!e.data) return;

    if (e.data.source === 'weave-hub-music') {
      desiredVolume = BG_MUSIC_VOLUME * Math.max(0, Math.min(1, e.data.audibility));
    } else if (e.data.source === 'weave-interaction') {
      unlockMusic();
    }
  });

  requestAnimationFrame(stepFade);
}

let lastFadeFrameTime = null;

function stepFade(now){
  if (lastFadeFrameTime === null) lastFadeFrameTime = now;
  let dtMs = now - lastFadeFrameTime;
  lastFadeFrameTime = now;

  // Stays silent (bgMusic.volume already initialized to 0, still muted) until a real gesture
  // unlocks it - see bindBackgroundMusic's own comment on why this never self-unlocks.
  if (musicUnlocked) {
    let ease = 1 - Math.pow(BG_MUSIC_EASE_PER_MS, dtMs);
    bgMusic.volume += (desiredVolume - bgMusic.volume) * ease;
  }

  requestAnimationFrame(stepFade);
}
