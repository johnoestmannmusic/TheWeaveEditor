// effects.js
// John Oestmann
// The page's visual effects, drifting sprites and a cross-fading second background, and pausing them while the map
// is covered by a card or Track Focus.
//
// Part of the page script, split from main.js by concern. Every part shares one set of page-wide names, loaded in
// order after main.js - see main.js for the page's state and setup. Part of the canonical shared runtime owned by
// TheWeave.Exporter - generated into every exported site's jsx/ folder, not hand-edited there.

// Generic per-page visual effects (drifting sprites, a cross-fading second
// background layer) - replaces what used to be hand-written inline <script>
// blocks per page. The exporter emits window.__weaveEffects only on pages
// that actually have effects configured; pages with none get no script tag
// and this function is a no-op.
function applyPageEffects(){
  if (!window.__weaveEffects) return;

  window.__weaveEffects.forEach(fx => {
    if (fx.type === "crossfade") {
      applyCrossfadeEffect(fx);
    } else if (fx.type === "drift") {
      applyDriftEffect(fx);
    }
  });
}

// #bgmap2 already exists in the static markup - PageRenderer renders it whenever
// Page.SecondaryBackground is set, and CrossfadeLayerEffect.ImagePath is always kept in sync
// with that (see ProjectEditing's SyncSecondaryBackground), so this animates the existing
// element rather than creating a second one. Creating a duplicate here used to be the actual
// bug: getElementById elsewhere (loadPageConfig, sizing it; buildWrapGhosts, tiling it) only
// ever finds the first, static #bgmap2 in document order, so the freshly-created second one -
// the one this function was calling .animate() on - never got sized or positioned at all, while
// the properly-positioned static one sat there forever at its unanimated inline opacity:0%.
function applyCrossfadeEffect(fx){
  let layer = document.getElementById('bgmap2');
  if (!layer) return;

  trackMapEffect(layer.animate(
    [{ opacity: fx.opacityFrom }, { opacity: fx.opacityTo }],
    {
      duration: fx.durationMs,
      direction: fx.direction || 'alternate',
      iterations: Infinity,
      easing: fx.easing || 'ease-in-out',
    }
  ));
}

function applyDriftEffect(fx){

  let outer = document.createElement('div');
  outer.style.left = fx.x + "px";
  outer.style.top = fx.y + "px";
  if (fx.blendMode) outer.style.mixBlendMode = fx.blendMode;

  let img = document.createElement('img');
  img.className = 'effect-drift-sprite';
  img.src = fx.imagePath;
  outer.appendChild(img);

  document.body.appendChild(outer);

  if (fx.driftX) {
    trackMapEffect(img.animate(
      { transform: "translateX(" + fx.driftX.toPx + "px)" },
      {
        duration: fx.driftX.durationMs,
        direction: fx.driftX.direction || 'alternate-reverse',
        iterations: Infinity,
        easing: fx.driftX.easing || 'ease-in-out',
      }
    ));
  }

  if (fx.driftY) {
    trackMapEffect(outer.animate(
      [
        { transform: "translateY(" + fx.driftY.fromPx + "px)" },
        { transform: "translateY(" + fx.driftY.toPx + "px)" },
      ],
      {
        duration: fx.driftY.durationMs,
        direction: fx.driftY.direction || 'alternate',
        iterations: Infinity,
        easing: fx.driftY.easing || 'ease-in-out',
      }
    ));
  }
}

// The map's drift and crossfade effects, which run forever. They're paused while the map is covered - see
// updateMapCovered - since anything blurred over them would otherwise be blurred again every frame.
let mapEffects = [];
let mapCovered = false;

function trackMapEffect(animation){
  mapEffects.push(animation);
  if (mapCovered) animation.pause();
}

// Whether the map is hidden behind something right now: Track Focus, once it's fully open, or an open card's
// backdrop. While it is, its effects are paused and nothing on it needs redrawing.
function updateMapCovered(){
  let covered = (!!trackFocusEl && !focusTransition) || !!modalBackdrop;
  if (covered === mapCovered) return;
  mapCovered = covered;
  for (const animation of mapEffects) covered ? animation.pause() : animation.play();
}
