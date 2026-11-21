# How the exported HTML's node nesting works

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
