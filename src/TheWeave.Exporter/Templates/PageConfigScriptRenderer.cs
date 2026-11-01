using System.Text.Json;
using TheWeave.Core.Model;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Emits the small window.__weavePage config object that runtime/main.js reads at load to size
/// the world (body/#bgmap dimensions) and lay out the grid the ship walks on. Unlike
/// EffectsScriptRenderer, this always renders - every page needs a world size and a grid, not
/// just pages with effects.
/// </summary>
public static class PageConfigScriptRenderer
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Render(Page page, WeaveProject project)
    {
        var grid = GridLayout.For(page, project);
        var payload = new
        {
            globeEffect = page.GlobeEffect,
            worldWidth = page.WorldWidthPx ?? project.DefaultWorldWidthPx,
            worldHeight = page.WorldHeightPx ?? project.DefaultWorldHeightPx,
            defaultSpawnX = page.DefaultSpawnX,
            defaultSpawnY = page.DefaultSpawnY,
            listeningRadiusPx = project.ListeningRadiusPx,
            // Drives main.js's updateHubMusicSignal - the shell's hub theme (see
            // WeaveProject.BackgroundMusicPath) plays at full ambient volume while true.
            isHomePage = project.HomePageId is not null && page.Id == project.HomePageId,
            // Handed straight to sokoban.js's createGrid - see main.js's loadPageConfig.
            grid = new
            {
                columns = grid.Columns,
                rows = grid.Rows,
                cellWidth = grid.CellWidth,
                cellHeight = grid.CellHeight,
                originX = grid.OriginX,
                originY = grid.OriginY,
                gapColumns = grid.GapColumns,
            },
        };
        var json = JsonSerializer.Serialize(payload, Options);

        return $"  <script>\n    window.__weavePage = {json};\n  </script>";
    }
}
