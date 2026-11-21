# The Weave Editor

A cross-platform WYSIWYG editor and static-site exporter for [The Weave Explorer](https://jomusic.neocities.org):
one JSON project holds every page, planet, location and puzzle, edited here and exported as plain HTML/CSS/JS.

`Core` is the schema and validation, `Exporter` renders the site and owns the shared `runtime/` game scripts, `Importer`
migrates a hand-authored site, `EditorApp` is the Photino window over a plain `wwwroot/` UI, and `tests/` is a suite per
project plus a round trip against a real snapshot. Node nesting: [`docs/exported-html-nesting.md`](docs/exported-html-nesting.md).

## Build and test

    dotnet test
    node --test tests/runtime/*.test.js      # Node 20+
    dotnet run --project src/TheWeave.EditorApp

Pass a `.json` project path after `--` to open it on launch. On Linux, if no window ever appears, force X11:
`GDK_BACKEND=x11 dotnet run --project src/TheWeave.EditorApp`.

MIT — see `LICENSE`.
