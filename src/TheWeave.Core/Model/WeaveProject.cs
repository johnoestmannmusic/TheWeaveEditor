namespace TheWeave.Core.Model;

/// <summary>The whole site: every page, node, and asset reference, in one file.</summary>
public sealed class WeaveProject
{
    public int SchemaVersion { get; set; } = 1;
    public string Title { get; set; } = "";

    public int DefaultWorldWidthPx { get; set; } = 3010;
    public int DefaultWorldHeightPx { get; set; } = 1696;

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
    /// Path (relative to Assets.MusRoot) of the track the shell loops in the background for as
    /// long as the visitor is on the site, ducking out whenever a location's own song is
    /// playing. Null means the shell has no background music. Only meaningful when HomePageId
    /// is also set - a shell with no destination page never gets exported.
    /// </summary>
    public string? BackgroundMusicPath { get; set; }
}
