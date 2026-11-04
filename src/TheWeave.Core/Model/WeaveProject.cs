using System.Text.Json.Serialization;

namespace TheWeave.Core.Model;

/// <summary>The whole site: every page, node, and asset reference, in one file.</summary>
public sealed class WeaveProject
{
    /// <summary>Which shape this project is in - see ProjectMigrations.</summary>
    public int SchemaVersion { get; set; } = 3;
    public string Title { get; set; } = "";

    public int DefaultWorldWidthPx { get; set; } = GridLayout.SectorWorldWidthPx;
    public int DefaultWorldHeightPx { get; set; } = GridLayout.WorldHeightPx;

    public ProjectAssets Assets { get; set; } = new();

    /// <summary>
    /// Absolute folder the "Export Site" toolbar button writes to. Once set, Export Site
    /// overwrites here directly instead of prompting for a folder every time; a separate
    /// "Change Export Folder..." action re-prompts and updates this.
    /// </summary>
    public string? ExportPath { get; set; }

    /// <summary>Editor-tree organization only - no runtime meaning.</summary>
    public List<PageGroup> Groups { get; set; } = new();

    public List<Page> Pages { get; set; } = new();

    /// <summary>
    /// Id of the Page the site's persistent shell (see SiteExporter) loads into its iframe by
    /// default. Null means no shell is exported at all - every page is written out exactly as
    /// it is today, standalone, with no persistent cross-page background music. When set, the
    /// referenced page is exported under a fixed filename ("theweave.html") instead of its own
    /// OutputFileName, since the shell needs to own the site's actual index.html.
    /// </summary>
    public string? HomePageId { get; set; }

    /// <summary>
    /// Path (relative to Assets.MusRoot) of the shell's "hub theme" track - the home page's own
    /// identity music (e.g. DISCOVERY SQUAD). Null means the shell has no such track. Only
    /// meaningful when HomePageId is also set - a shell with no destination page never gets
    /// exported.
    ///
    /// Not a constant site-wide loop: shell.js plays it at full ambient volume only while the
    /// visitor is actually on the home page, or on the square of a node elsewhere whose travel
    /// action leads back to it - see main.js's updateHubMusicSignal.
    /// </summary>
    public string? BackgroundMusicPath { get; set; }

    /// <summary>
    /// The project's library of Sokoban object drawings, shared by every puzzle - see PuzzleDrawing. Null
    /// rather than empty while there are none, so a project without any is saved exactly as before.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<PuzzleDrawing>? PuzzleDrawings { get; set; }

    /// <summary>Groups of those drawings to place from - see PuzzleDrawingSet. Null rather than empty while there are none.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<PuzzleDrawingSet>? PuzzleDrawingSets { get; set; }
}
