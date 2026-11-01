using TheWeave.Core.Model;

namespace TheWeave.Core.Serialization;

/// <summary>
/// Brings a project file written by an older version of the editor up to date. Runs on every
/// deserialize (see WeaveProjectSerializer), so an opened project and a persisted undo snapshot
/// from before an upgrade both end up in the current shape, and is a no-op on a current project.
/// </summary>
public static class ProjectMigrations
{
    public const int CurrentSchemaVersion = 2;

    /// <returns>
    /// Null if the project was already current. Otherwise a note for every location that couldn't
    /// just move to the square it was already over - empty if none needed one.
    /// </returns>
    public static List<string>? Upgrade(WeaveProject project)
    {
        if (project.SchemaVersion >= CurrentSchemaVersion)
            return null;

        var notes = UpgradeToGrid(project);
        project.SchemaVersion = CurrentSchemaVersion;
        return notes;
    }

    // Version 2: exact 6x worlds, so the drawn grid lands on whole 150px squares, and every location
    // centered in a square. Every old position is resolved against its page's *old* grid, since
    // that's the one it was placed against.
    private static List<string> UpgradeToGrid(WeaveProject project)
    {
        var notes = new List<string>();
        var oldGrids = project.Pages.ToDictionary(p => p.Id, p => GridLayout.For(p, project));

        foreach (var page in project.Pages)
        {
            if (page.WorldWidthPx is not null || page.WorldHeightPx is not null)
            {
                page.WorldWidthPx = GridLayout.SectorWorldWidthPx * oldGrids[page.Id].Sectors;
                page.WorldHeightPx = GridLayout.WorldHeightPx;
            }
        }
        project.DefaultWorldWidthPx = GridLayout.SectorWorldWidthPx;
        project.DefaultWorldHeightPx = GridLayout.WorldHeightPx;

        foreach (var page in project.Pages)
        {
            var oldGrid = oldGrids[page.Id];
            var grid = GridLayout.For(page, project);

            PlaceNodes(page, oldGrid, grid, notes);

            if (page.DefaultSpawnX is double spawnX && page.DefaultSpawnY is double spawnY)
            {
                var cell = oldGrid.CellAt(spawnX, spawnY);
                page.DefaultSpawnX = grid.ColumnCenter(cell.Col);
                page.DefaultSpawnY = grid.RowCenter(cell.Row);
            }

            foreach (var node in page.Nodes)
                UpgradeTravelSpawns(node, project, oldGrids);
        }

        return notes;
    }

    private static void PlaceNodes(Page page, GridLayout oldGrid, GridLayout grid, List<string> notes)
    {
        var mapNodes = page.Nodes.Where(n => n.Card.Size != CardSize.Modal).ToList();

        // Anything already over a real square claims it before anything that has to be pulled in
        // from a label strip does, so a node that was placed deliberately never gets displaced by
        // one that just happens to clamp onto the same square.
        bool IsOverSquare(Node n) => oldGrid.IsOnSquare(n.X + GridLayout.NodeIconSizePx / 2, n.Y + GridLayout.NodeIconSizePx / 2);

        var taken = new HashSet<GridCell>();

        foreach (var node in mapNodes.OrderByDescending(IsOverSquare))
        {
            var wasOverSquare = IsOverSquare(node);
            var preferred = oldGrid.CellOf(node);
            var cell = grid.NearestFreeCell(preferred, taken)
                ?? throw new InvalidDataException($"Page '{page.Id}' has more locations than squares.");

            taken.Add(cell);
            (node.X, node.Y) = grid.NodePositionFor(cell);

            if (cell != preferred)
                notes.Add($"{page.Title}: '{node.Card.HeadingText}' moved to {grid.LabelOf(cell)}, since {grid.LabelOf(preferred)} was already taken.");
            else if (!wasOverSquare)
                notes.Add($"{page.Title}: '{node.Card.HeadingText}' moved to {grid.LabelOf(cell)}, since it was outside the grid.");
        }
    }

    private static void UpgradeTravelSpawns(Node node, WeaveProject project, Dictionary<string, GridLayout> oldGrids)
    {
        var action = node.Card.Action;
        var targetPage = project.Pages.FirstOrDefault(p => p.Id == action.TargetPageId);

        if (targetPage is not null && action.TravelSpawnX is double x && action.TravelSpawnY is double y)
        {
            var cell = oldGrids[targetPage.Id].CellAt(x, y);
            var grid = GridLayout.For(targetPage, project);
            action.TravelSpawnX = grid.ColumnCenter(cell.Col);
            action.TravelSpawnY = grid.RowCenter(cell.Row);
        }

        foreach (var child in node.Children)
            UpgradeTravelSpawns(child, project, oldGrids);
    }
}
