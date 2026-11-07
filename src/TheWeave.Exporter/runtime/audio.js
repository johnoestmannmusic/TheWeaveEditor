// audio.js
// John Oestmann
// Location music, which swells as the ship stands on a location's square, and the signal the site's shell uses
// for its hub theme.
//
// Part of the page script, split from main.js by concern. Every part shares one set of page-wide names, loaded in
// order after main.js - see main.js for the page's state and setup. Part of the canonical shared runtime owned by
// TheWeave.Exporter - generated into every exported site's jsx/ folder, not hand-edited there.

// Location music: a root's own track (or whichever chain member the player has X-cycled to - see
// cycleChainNode) plays while the ship is on that root's square, and only then. "On" means the
// square nearest the ship right now, so it changes halfway through a step rather than at either end
// of it. Walking straight across a square gets a soft swell rather than the whole track - see
// AUDIO_VOLUME_EASE.
//
// Every other (non-active) member of the same chain is eased toward 0 right alongside the active
// one, rather than snapped to pause immediately - that's what makes X-cycling from a root to a
// child (or back) read as a crossfade instead of a hard cut.
function updateLocationAudio(dt){
  let ease = 1 - Math.pow(AUDIO_VOLUME_EASE, dt);
  let shipCell = weavePage.grid.cellAt(ship.x, ship.y);

  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    // Start buffering before the track needs to be audible - see PRELOAD_SQUARES's own comment on
    // why. The whole chain preloads together (not just whichever member happens to be active right
    // now) so stepping into a child with X once close doesn't hit a cold, unbuffered element.
    let squaresAway = Math.abs(meta.cell.col - shipCell.col) + Math.abs(meta.cell.row - shipCell.row);
    if (squaresAway <= PRELOAD_SQUARES) {
      for (const member of meta.chain) {
        let memberMeta = nodeMeta.get(member);
        if (memberMeta.audio && !memberMeta.audioPreloaded) {
          memberMeta.audioPreloaded = true;
          memberMeta.audio.preload = 'auto';
          memberMeta.audio.load();
        }
      }
    }

    let activeMember = (node === activeRoot && activeNode) ? playableMember(activeNode) : node;
    // A locked location keeps its music to itself.
    if (meta.locked) activeMember = null;

    for (const member of meta.chain) {
      let memberMeta = nodeMeta.get(member);
      let audio = memberMeta.audio;
      if (!audio) continue;

      // Only touched while it's still easing towards where it's headed, then set there exactly.
      let target = (squaresAway === 0 && member === activeMember) ? 1 : 0;
      if (audio.volume !== target) {
        let volume = audio.volume + (target - audio.volume) * ease;
        if (volume < 0.004 || Math.abs(target - volume) < 0.004) volume = target;
        audio.volume = volume;
      }

      if (audio.volume > 0) {
        if (audio.paused) audio.play().catch(() => {});
      } else if (!audio.paused) {
        audio.pause();
      }
    }
  });
}

// The part whose music should be playing while Track Focus is on this one. A locked part keeps its music to
// itself until it's unlocked, so the last part that's open carries on instead.
function playableMember(member){
  return partLockedBy(member) ?? member;
}

// Tells the persistent shell (see shell.js) how audible its "hub theme" track
// (WeaveProject.BackgroundMusicPath) should be right now: full ambient volume while this is the
// home page itself, or on the square of a node whose Travel action leads back to the home page (see
// PageRenderer's data-travel-home marker) - so stepping onto one of those "return to the hub" nodes
// previews the hub theme before you actually leave. Silent anywhere else; shell.js eases between the
// two. A no-op when this page isn't embedded in the shell's iframe at all (e.g. opened directly),
// same guard as notifyShellOfInteraction.
function updateHubMusicSignal(){
  if (window.parent === window) return;

  let audibility = 0;

  if (weavePage.isHomePage) {
    audibility = 1;
  } else {
    let root = rootByCell.get(cellKey(weavePage.grid.cellAt(ship.x, ship.y)));
    if (root && nodeMeta.get(root).travelHome) audibility = 1;
  }

  window.parent.postMessage({ source: 'weave-hub-music', audibility }, '*');
}
