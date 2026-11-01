namespace TheWeave.Core.Model;

/// <summary>
/// The grid of walkable squares on a page's map, in world pixels. Nothing here is stored in the
/// project file: every map image has the same grid drawn into it, so this is worked out from the
/// page's world size and that drawing's fixed geometry.
///
/// One 500x281 source map has lines every 25 source pixels: a one-square label strip along the top
/// and left, then columns A-S and rows 0-9, then 6 unused pixels along the bottom. A wider map (The
/// Weave's own page) is several of those side by side, each repeating its own left label strip -
/// which isn't a walkable column, so it's reported in GapColumns instead.
/// </summary>
public sealed class GridLayout
{
    public const int ColumnsPerSector = 19;
    public const int RowCount = 10;

    private const double SourceCellPx = 25;
    private const double SourceSectorWidthPx = 500;
    private const double SourceHeightPx = 281;

    public int Columns { get; private init; }
    public int Rows => RowCount;
    public double CellWidth { get; private init; }
    public double CellHeight { get; private init; }

    /// <summary>Top-left corner of the first square - just past both label strips.</summary>
    public double OriginX => CellWidth;
    public double OriginY => CellHeight;

    /// <summary>Columns with one square's width of unwalkable label strip immediately to their left.</summary>
    public IReadOnlyList<int> GapColumns { get; private init; } = Array.Empty<int>();

    public static GridLayout For(Page page, WeaveProject project)
    {
        var worldWidth = (double)(page.WorldWidthPx ?? project.DefaultWorldWidthPx);
        var worldHeight = (double)(page.WorldHeightPx ?? project.DefaultWorldHeightPx);

        var sectors = Math.Max(1, (int)Math.Round(worldWidth / worldHeight * SourceHeightPx / SourceSectorWidthPx));
        var squaresPerSector = SourceSectorWidthPx / SourceCellPx;

        return new GridLayout
        {
            Columns = ColumnsPerSector * sectors,
            CellWidth = worldWidth / (squaresPerSector * sectors),
            CellHeight = worldHeight * SourceCellPx / SourceHeightPx,
            GapColumns = Enumerable.Range(1, sectors - 1).Select(s => s * ColumnsPerSector).ToArray(),
        };
    }
}
