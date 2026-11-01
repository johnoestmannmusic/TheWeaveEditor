using TheWeave.Core.Model.Effects;

namespace TheWeave.Core.Model;

/// <summary>
/// One exported .html file (a planet, a galaxy sector, a shrine layer, ...). Sectors and
/// planets aren't modeled as distinct types - both are just a background image with nodes;
/// what makes a page a "hub" is only that some of its nodes carry Travel actions.
/// </summary>
public sealed class Page
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string OutputFileName { get; set; } = "";
    public string? GroupId { get; set; }

    /// <summary>Null = use the project default (one map drawn at exactly 6x - 3000x1686).</summary>
    public int? WorldWidthPx { get; set; }
    public int? WorldHeightPx { get; set; }

    /// <summary>
    /// True (the default) draws a faint vignette around the edges of this page's screens, to sell
    /// a sense of a curved horizon. Purely visual - e.g. toggled off for a building interior, where
    /// "curved horizon" makes no sense.
    /// </summary>
    public bool GlobeEffect { get; set; } = true;

    /// <summary>
    /// Where the ship spawns landing on this page with no travel/query-string position at all -
    /// e.g. opening it directly with a bare URL, or via the shell's iframe on first load. The ship
    /// lands on whichever square is nearest. Null falls back to GridLayout.EntrySquare. Doesn't affect arriving via
    /// a travel link - that's governed by CardAction.TravelSpawnX/Y (or the exporter's own
    /// reciprocal/center-of-map defaults when those aren't set - see PageRenderer.BuildTravelQuery).
    /// </summary>
    public double? DefaultSpawnX { get; set; }
    public double? DefaultSpawnY { get; set; }

    public ImageRef Background { get; set; } = new();

    /// <summary>Present iff a CrossfadeLayerEffect in Effects targets this page.</summary>
    public ImageRef? SecondaryBackground { get; set; }

    /// <summary>Top-level nodes only; nesting lives in each Node's Children.</summary>
    public List<Node> Nodes { get; set; } = new();

    public List<PageEffect> Effects { get; set; } = new();
}
