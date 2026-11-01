namespace TheWeave.Core.Model;

/// <summary>A square on a page's grid: 0-based, with Col counting across every sector of a wide map.</summary>
public readonly record struct GridCell(int Col, int Row);

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

    /// <summary>
    /// How many squares one static screen shows. A sector's 19 columns can't divide evenly (19 is
    /// prime), but its label strip plus those columns make 20, which halves into 10 - so a left
    /// screen shows the label strip and A-I, and a right screen shows J-S. Rows 0-9 halve into 5.
    ///
    /// Screens are also a little taller than their rows, by the 6 source pixels left over along the
    /// bottom of the map, so the art down there (a planet's name, usually) isn't lost. A bottom screen
    /// ends at the map's bottom edge, and a top screen shows the same amount of its top label strip.
    /// </summary>
    public const int ScreenColumns = 10;
    public const int ScreenRows = 5;

    /// <summary>Matches .nodeImage's width in main.css - Node.X/Y is that icon's top-left corner.</summary>
    public const double NodeIconSizePx = 48;

    /// <summary>World size of one sector drawn at exactly 6x, which makes every square 150px.</summary>
    public const int SectorWorldWidthPx = 3000;
    public const int WorldHeightPx = 1686;

    private const double SourceCellPx = 25;
    private const double SourceSectorWidthPx = 500;
    private const double SourceHeightPx = 281;
    private const double SourceBottomStripPx = 6;

    public int Sectors { get; private init; }
    public int Columns => ColumnsPerSector * Sectors;
    public int Rows => RowCount;
    public double CellWidth { get; private init; }
    public double CellHeight { get; private init; }

    /// <summary>Top-left corner of the first square - just past both label strips.</summary>
    public double OriginX => CellWidth;
    public double OriginY => CellHeight;

    /// <summary>Columns with one square's width of unwalkable label strip immediately to their left.</summary>
    public IReadOnlyList<int> GapColumns => Enumerable.Range(1, Sectors - 1).Select(s => s * ColumnsPerSector).ToArray();

    public double ScreenWidth => CellWidth * ScreenColumns;
    public double ScreenHeight => CellHeight * ScreenRows + BottomStripHeight;

    private double BottomStripHeight => CellHeight * SourceBottomStripPx / SourceCellPx;

    /// <summary>World Y of the top of each row of screens, from the top of the map.</summary>
    public IReadOnlyList<double> ScreenTops =>
        new[] { OriginY - BottomStripHeight, OriginY + CellHeight * ScreenRows };

    /// <summary>World X of every line where one screen meets the next.</summary>
    public IReadOnlyList<double> ScreenLinesX =>
        Enumerable.Range(1, (Columns + Sectors) / ScreenColumns - 1).Select(i => i * ScreenWidth).ToArray();

    /// <summary>World Y of the top and bottom of every row of screens.</summary>
    public IReadOnlyList<double> ScreenLinesY =>
        ScreenTops.Append(ScreenTops[^1] + ScreenHeight).ToArray();

    public static GridLayout For(Page page, WeaveProject project)
    {
        var worldWidth = (double)(page.WorldWidthPx ?? project.DefaultWorldWidthPx);
        var worldHeight = (double)(page.WorldHeightPx ?? project.DefaultWorldHeightPx);

        var sectors = Math.Max(1, (int)Math.Round(worldWidth / worldHeight * SourceHeightPx / SourceSectorWidthPx));
        var squaresPerSector = SourceSectorWidthPx / SourceCellPx;

        return new GridLayout
        {
            Sectors = sectors,
            CellWidth = worldWidth / (squaresPerSector * sectors),
            CellHeight = worldHeight * SourceCellPx / SourceHeightPx,
        };
    }

    public double ColumnCenter(int col) => OriginX + (col + col / ColumnsPerSector + 0.5) * CellWidth;

    public double RowCenter(int row) => OriginY + (row + 0.5) * CellHeight;

    /// <summary>The square nearest a world position, clamped onto the board for a point outside it.</summary>
    public GridCell CellAt(double x, double y)
    {
        var col = Enumerable.Range(0, Columns).MinBy(c => Math.Abs(ColumnCenter(c) - x));
        var row = (int)Math.Floor((y - OriginY) / CellHeight);
        return new GridCell(col, Math.Clamp(row, 0, Rows - 1));
    }

    /// <summary>Whether a world position is actually inside a square, rather than on a label strip or off the map.</summary>
    public bool IsOnSquare(double x, double y)
    {
        var cell = CellAt(x, y);
        return Math.Abs(ColumnCenter(cell.Col) - x) <= CellWidth / 2
            && Math.Abs(RowCenter(cell.Row) - y) <= CellHeight / 2;
    }

    /// <summary>The Node.X/Y that centers a node's icon in a square.</summary>
    public (double X, double Y) NodePositionFor(GridCell cell) =>
        (ColumnCenter(cell.Col) - NodeIconSizePx / 2, RowCenter(cell.Row) - NodeIconSizePx / 2);

    public GridCell CellOf(Node node) =>
        CellAt(node.X + NodeIconSizePx / 2, node.Y + NodeIconSizePx / 2);

    public string ColumnLabel(int col)
    {
        var letter = (char)('A' + col % ColumnsPerSector);
        return Sectors > 1 ? $"Sector {col / ColumnsPerSector + 1}: {letter}" : letter.ToString();
    }

    public string LabelOf(GridCell cell) => $"{ColumnLabel(cell.Col)}{cell.Row}";

    /// <summary>
    /// The free square closest to a preferred one (which itself wins if free), or null if the board
    /// is full. Ties go to squares earlier in reading order, so the choice is always repeatable.
    /// </summary>
    public GridCell? NearestFreeCell(GridCell preferred, IReadOnlySet<GridCell> taken)
    {
        GridCell? best = null;
        var bestDistance = int.MaxValue;

        for (var row = 0; row < Rows; row++)
        {
            for (var col = 0; col < Columns; col++)
            {
                var cell = new GridCell(col, row);
                if (taken.Contains(cell)) continue;

                var distance = Math.Abs(col - preferred.Col) + Math.Abs(row - preferred.Row);
                if (distance < bestDistance)
                {
                    best = cell;
                    bestDistance = distance;
                }
            }
        }

        return best;
    }
}
