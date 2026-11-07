// puzzleColours.js
// John Oestmann
// A puzzle's colours, from its album's art: the palette, each colour's textures from the art's grain, and the
// mixes a drawing's colours are laid out in.
// Knows nothing about the DOM. One of the parts of WeavePuzzle, brought together by puzzle.js - see there.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into every exported
// site's jsx/ folder, and linked into the Editor, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./puzzleRules.js'));
  else root.WeavePuzzleColours = factory(root.WeavePuzzleRules);
})(this, function (WeavePuzzleRules) {

  const { BOARD_SIZE } = WeavePuzzleRules;

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
    let archeton = choose(different);

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
      archeton: toHex(archeton),
      outline: toHex(outline),
      light: toHex(light),
    };
  }

  // ---------- textures ----------

  // One square of the board, and the album art, in the art's own pixels.
  const TILE_PX = 24;
  const ART_PX = TILE_PX * BOARD_SIZE;

  // Every role that has a texture of its own. A Switch shares its Gate's, as it does its colour.
  const TEXTURE_ROLES = ['wall', 'finish', 'gate', 'teleporter', 'stream', 'key', 'rotator', 'lantern', 'block', 'jump', 'reset', 'pipe', 'archeton'];
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

  return { TILE_PX, ART_PX, pickPalette, pickTextures, TEXTURE_SHADES, standardMix, mixTexture, PALETTE_MIN_CONTRAST, hexToColor, lightnessOf };
});
