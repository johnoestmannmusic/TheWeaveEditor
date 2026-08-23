using System.Text.Json;
using TheWeave.Core.Model;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Emits the small window.__weavePage config object that runtime/main.js reads at load to size
/// the world (body/#bgmap dimensions) and decide whether this page wraps like a globe. Unlike
/// EffectsScriptRenderer, this always renders - every page needs a world size and a wrap
/// decision, not just pages with effects.
/// </summary>
public static class PageConfigScriptRenderer
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Render(Page page, WeaveProject project)
    {
        var payload = new
        {
            wraps = page.Wraps,
            globeEffect = page.GlobeEffect,
            worldWidth = page.WorldWidthPx ?? project.DefaultWorldWidthPx,
            worldHeight = page.WorldHeightPx ?? project.DefaultWorldHeightPx,
            defaultSpawnX = page.DefaultSpawnX,
            defaultSpawnY = page.DefaultSpawnY,
        };
        var json = JsonSerializer.Serialize(payload, Options);

        return $"  <script>\n    window.__weavePage = {json};\n  </script>";
    }
}
