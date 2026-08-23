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

    /// <summary>Null = use the project default (today's fixed 3010x1696).</summary>
    public int? WorldWidthPx { get; set; }
    public int? WorldHeightPx { get; set; }

    /// <summary>
    /// True (the default) makes this page a globe: flying off any edge wraps seamlessly to the
    /// opposite edge, in both X and Y. Set false for a page with genuine hard edges - e.g. The
    /// Weave, whose two sectors are joined side-by-side into one wide, non-wrapping map.
    /// </summary>
    public bool Wraps { get; set; } = true;

    /// <summary>
    /// True (the default) draws a cosmetic globe-curvature hint on this page - a faint edge
    /// vignette plus nodes scaling/fading slightly as they near the screen edge, to sell a
    /// sense of a curved horizon. Purely visual, and independent of Wraps (a page can wrap
    /// without the visual, or vice versa), but in practice usually toggled off together with
    /// Wraps - e.g. for a building interior, where "curved horizon" makes no sense.
    /// </summary>
    public bool GlobeEffect { get; set; } = true;

    /// <summary>
    /// Where the ship spawns landing on this page with no travel/query-string position at all -
    /// e.g. opening it directly with a bare URL, or via the shell's iframe on first load. Null
    /// falls back to the runtime's own hardcoded default (120, 120). Doesn't affect arriving via
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
