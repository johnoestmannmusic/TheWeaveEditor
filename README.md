# The Weave Editor

A cross-platform, open-source WYSIWYG editor and static-site exporter for
[The Weave Explorer](https://jomusic.neocities.org) — an explorable galaxy map for the
fictional universe of *The Weave*.

One project file (JSON) holds every page, planet, location, and node in the site. This tool
edits that file visually and exports it to the plain HTML/CSS/JS site that gets deployed to
Neocities, replacing hand-authoring HTML per location.

## Features

**Editor**

- A Puzzle Editor for each track with album art, opened from its location's panel: the art with a 10x10
  board over it, for placing Walls, a Finish, Gates and Switches, Teleporters, Streams, Keys and the
  ship's Start. Its colours are picked from the art itself, and problems like an unmatched Gate are
  listed as you go. A puzzle's layout can be exported to a JSON file and imported onto another track,
  where it takes on that track's colours and textures. What the objects look like and how they're placed lives in `runtime/puzzle.js`,
  shared with the exported site.
- Drawings for the puzzles' objects, painted pixel by pixel in the Puzzle Editor's Drawings view and
  shared by every puzzle in the project. Each kind of object can have as many as you like, besides its
  Standard drawing, which can be redrawn too. Drawings can be grouped into named Drawing Sets, such as one
  per colour balance. Clicking an object's tool opens a tray of its sets to place from, or a Default one of
  its Standard drawing while it has none, and placing from a set gives each square one of its drawings at random. A drawing is painted in the outline
  and light colours, its own mix of up to 4 palette colours, or Grain: that mix laid out in the album art's
  own pattern, each colour covering its percentage of it. Every album recolours a drawing from its own
  palette, and Gates have an Open frame too. Puzzle files carry the drawings they use.
- A Generate panel in the Drawings view, offering patterns to start a new drawing from: patches of the
  album art, natural textures (clouds, speckle, moss, veins and stones, which tile seamlessly) and dithers.
  Any of the palette's colours can be laid out across them, each covering the percentage you choose. Picking
  one makes it a new drawing of the current shape, in solid colours to edit pixel by pixel.
- Tree navigator + Inspector: browse every page and (nested) location in a project, and edit
  a location's full card — heading, position, icon style, persistence, card size, cover
  image/audio, poetry lines, and its download/travel action (including arrival position) — or
  a page's metadata, all through forms.
- A dedicated **Tutorial Modal** tab for the screen-centered popup shown the first time a
  visitor opens the site (heading, cover, audio, poetry, plus a separate "Updates" panel) — kept
  out of the tree/canvas since it isn't a real map location.
- Live map canvas: select a page and its real background renders with every top-level location
  as a draggable, color-coded marker, always centered in a square of the map's grid. Click to
  select (syncs with the tree/Inspector), drag to move it to another free square, double-click an
  empty square to add a new location, scroll to zoom, click-drag to pan. Dashed lines show where
  the exported site's static screens meet.
- Live Effects panel: add/edit/delete a page's crossfade or drifting-sprite effects and watch
  them actually animate on the canvas while you edit, using the same rendering the exported site
  uses.
- Add/delete pages and locations (including nested "next part of the story" locations via the
  tree's "+ Add nested location").
- Import an existing hand-authored site into a new project file, for one-time migration.
- Undo/redo (toolbar or Ctrl+Z / Ctrl+Shift+Z) covering every project edit, up to 10 steps back,
  persisted alongside the project so history survives closing and reopening the editor.
- No manual save step: every edit auto-saves to disk immediately (prompting once for a
  destination on a brand-new project, like a "Save As"); Export Site remembers its destination
  folder after the first run.
- Imported cover images are copied into an organized `img/<page>/<location>.<ext>` path inside
  the project automatically, so a project's asset tree stays tidy as content is added.

**Exported site**

- A genuinely multi-page static site (real navigation between pages, not a single-page app).
- Location music: each track plays on its own square of the map. Crossing the square without
  stopping gives a soft swell, and stopping brings it to full volume.
- A hub theme (set per-project) that survives page navigation via a thin iframe "shell", playing on
  the home page and on the square of any node that travels back to it.
- Configurable ship spawn points: a page's own default landing spot, plus directional defaults
  for travel links (a planet is entered at the top of its number column, where its node back to the
  starting map also sits; returning lands right on the hub icon you left) — all overridable per
  travel link.
- Sokoban-style grid movement along the grid drawn on every map (the number column and columns A-S,
  rows 0-9): hold an
  arrow key, D-pad direction, or stick direction to walk square by square, and let go to stop on
  the square you're heading into. Every map has hard edges. The movement itself lives in
  `runtime/sokoban.js`, with no knowledge of the DOM or these maps, so other boards can reuse it.
- Keyboard and gamepad controls: Z/gamepad A to interact (travel, open a track's Track Focus screen,
  start its Sokoban board, or close a popup), X/gamepad X in Track Focus to step through a multi-part
  location's nested parts, C/gamepad B to back out. Contextual hints show next to whichever action
  is actually available.
- Track Focus: a full-screen view of a track, with its album art enlarged to use the space on the
  left and its title and poetry on the right (a track's card on the map skips the poetry), over the dimmed map and a blurred, blown-up copy
  of the art. C, gamepad B, or clicking the backdrop closes it; the track keeps playing throughout.
- A Sokoban board over the album art, started with Z/gamepad A from Track Focus: the ship walks a
  10x10 grid using the same movement as the map.
- Puzzles on that board, built in the Editor's Puzzle Editor, with objects drawn as pixel art lined up
  with the album art's own pixels, and textured from it. Walls block the way, Switches toggle Gates with
  the same letter (which can start open or closed), Keys have to be collected before Switches work, and
  Teleporters jump to their partner. Streams carry the ship and any objects on them, and hold the ship
  until they push it onto a non-Stream square. X restarts the puzzle.
- Rotator Tiles work like Streams, but only move what's on them, once per second, while the ship is on a
  Rotator Switch, and the ship can walk over them freely. Any object but Finish can start out Invisible,
  behaving exactly the same but unseen until the ship lights a Lantern within reach of it. A lit Lantern
  stays lit, and reveals a circle reaching 3 squares in every direction.
- A location's puzzle boards connect edge to edge, like the map's screens: a part that leads on to another
  puzzle has one Finish, on an edge, and the next part's ship comes in directly across from it, its Start set
  to match automatically. Finishing scrolls the album art and board across to the next.
- A location's parts play like game levels. Each part stays locked until the puzzle of every part before
  it is solved: X can still step to it, but Track Focus only shows its dimmed art and the word Locked, and
  it can't be played or heard. Reaching a Finish remembers that in the visitor's browser and moves straight
  on to the next part's puzzle, or back to Track Focus if it doesn't have one. A part with no puzzle, or
  one with no Finish, never locks anything.
- Each track's square on a planet's map shows its album art, see-through, with its puzzle shrunk on top,
  drawn at the map's own pixel size, like a zoomed-out view of the boards.
- Black fog over a planet's unexplored squares, with a checkered pixel edge. It clears in a circle 3 squares
  around the ship and stays cleared, saved in the visitor's browser. The minimap is fogged too. The Weave isn't.
- Static screens instead of a follow camera: each map splits into 10x5-square screens (4 per map, 8
  on The Weave), and walking off one slides the view to the next. The picture scales to fill the
  window's width. Cards always fit on the screen.
- Entering a planet lands on its number column's top square, on the node back to The Weave. That node
  stays asleep on arrival: its card only opens, and Z only travels, once the ship has stepped off it
  and come back. Leaving a planet lands on that planet's own node on The Weave.
- An "Entering.." screen with a pixel-art progress bar whenever a new page or scene loads: travelling
  between pages, the site's first load, opening Track Focus, and jumping to the next part's puzzle board.
  The bar follows the new page's images loading, and hands over from one page to the next with no gap.
- A minimap in the bottom-right corner of each map screen, showing the whole map, the screen in view,
  and every location. It fades back when the ship, a location, or an open card is under it.
- Contrails from both of the ship's engines, on the map and on a Sokoban board, following the path it
  took, sweeping around its turns in smooth curves, and fading out after about a second: orange on The
  Weave and white-grey on planets.
- An optional cosmetic globe-curvature vignette around each screen, toggleable per page.
- Export cleans up after itself: files from a previous export that the current run didn't
  (re)write — a renamed/deleted page, an orphaned cover image — are removed, so exporting
  repeatedly to the same folder doesn't accumulate stale files. It only ever touches the
  specific subfolders it manages, so anything else kept in that export folder is left alone.

## Solution layout

- `src/TheWeave.Core` — the project file schema, serialization, and validation. No UI or I/O
  framework dependencies beyond the .NET BCL, so it's fully unit-testable in isolation.
- `src/TheWeave.Exporter` — renders a project to a static HTML/CSS/JS site. Also owns the
  canonical shared runtime (`runtime/main.css`, `runtime/main.js`, `runtime/sokoban.js`,
  `runtime/shell.js`) embedded in the assembly.
- `src/TheWeave.Importer` — parses an existing hand-authored site into a project file, for
  one-time migration. Built on [AngleSharp](https://anglesharp.github.io/).
- `src/TheWeave.EditorApp` — the desktop editor shell, built on
  [Photino.NET](https://www.tryphotino.io/) (a thin native window hosting the OS's own webview,
  rather than a bundled Chromium). `wwwroot/` is the plain HTML/CSS/JS UI.
- `tests/` — one test project per `src/` project, plus a full import → export round-trip suite
  validated against a real snapshot of The Weave Explorer (`fixtures/weave-explorer-snapshot/`).

## Building

Requires the .NET SDK (developed against .NET 10).

```
dotnet test
node --test tests/runtime/*.test.js
```

The second command covers the runtime's grid movement module and needs Node.js 20 or newer.

To run the editor itself:

```
cd src/TheWeave.EditorApp
dotnet run
```

Pass a `.json` project file path as an argument to open it directly on launch (e.g. for a
double-click-to-open file association) instead of starting empty:

```
dotnet run -- /path/to/project.json
```

### Linux: window doesn't appear / process hangs after "Load(...)"

If `dotnet run` prints Photino's setup log lines and then just sits there with no window ever
showing (WebKitNetworkProcess/WebKitWebProcess spawn in `ps` but nothing renders), it's almost
certainly `WAYLAND_DISPLAY` being set in your environment: GTK auto-detects a Wayland compositor
and tries that first, and on some setups that path just hangs rather than falling back to X11.
Force X11:

```
GDK_BACKEND=x11 dotnet run
```

## Known limitations

- No drag-a-node-onto-a-card-to-reparent gesture yet — nested locations are created via the
  tree's "+ Add nested location" instead, which is fully functional.
- The Cover Image file picker lists image types as separate single-extension filters (PNG,
  JPEG, GIF, WebP, All Files) rather than one combined "Image" filter, working around a Photino
  Linux/GTK bug where a filter listing more than one extension silently matches nothing.

## How the exported HTML's node nesting works

Worth reading before touching `PageRenderer` or `main.js`'s chain-cycling logic — this shape has
caused real, hard-to-spot bugs before.

**The basic shape.** Every location is a `<div class="node">` containing an
`<img class="nodeImage">` and exactly one `<div class="floatInfo">` (the card — cover, audio,
heading, poetry, action link). A page's top-level locations are direct children of `<body>`.

**Nesting = literally inside the parent's card.** A "next part of the story" location (e.g.
Ouros' Salanth Town Gardens → Jherop Phantom → The Gardener's Funeral) is not a sibling with a
`ParentId` — its whole `<div class="node">` is placed *inside* its parent's
`<div class="floatInfo">`, as one more child alongside the poetry text. `PageRenderer.RenderCard`
reflects this directly — `foreach (var child in node.Children) RenderNode(...)` runs *inside* the
method that also opens/closes that same `.floatInfo`.

**A nested node isn't a place on the map.** Its stored `Node.X`/`Node.Y`
aren't used, its icon is hidden (see `main.css`), and its card never opens. It stays in the DOM
because that's where Track Focus reads its content from: X there steps through the chain (`main.js`'s
`cycleChainNode`), and `renderTrackFocus` reads that member's card directly, whether or not it's
displayed.

**Closing tags matter more than they look like they should.** A childless node's `.floatInfo`
must be explicitly closed before the *next sibling* `.node` starts. Miss that and the browser's
own tag-recovery makes the next sibling a descendant of the unclosed card instead — which
doesn't just misplace one node, it compounds: node 3 becomes a fourth-generation descendant of
node 1, etc. `PageRenderer` closes `.floatInfo` *after* rendering `node.Children`, not before, so
a childless node closes cleanly but a parent's card still structurally contains its child.

**Testing gotcha worth remembering:** `getComputedStyle(el).display !== 'none'` (or checking an
element's own inline `style.display`) only tells you about that one element — it says nothing
about whether an *ancestor* is hidden, so it will happily report a genuinely-invisible nested
card as "visible." `el.offsetParent !== null` (or an actual screenshot) reflects real rendered
visibility.

## License

MIT — see `LICENSE`.
