using System.Text.Json;
using TheWeave.Core.Model.Effects;
using TheWeave.Exporter;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Emits the small window.__weaveEffects config array that runtime/main.js's
/// applyPageEffects() reads. Returns null for pages with no effects, so those pages get no
/// script tag and no behavior change at all.
/// </summary>
public static class EffectsScriptRenderer
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string? Render(IReadOnlyList<PageEffect> effects, AssetResolver? assetResolver = null)
    {
        if (effects.Count == 0)
            return null;

        var payload = effects.Select(e => ToPayload(e, assetResolver)).ToList();
        var json = JsonSerializer.Serialize(payload, Options);

        return $"  <script>\n    window.__weaveEffects = {json};\n  </script>";
    }

    private static object ToPayload(PageEffect effect, AssetResolver? assets)
    {
        string Resolve(string path) => assets?.Resolve(path) ?? path;

        return effect switch
        {
            CrossfadeLayerEffect c => new
            {
                type = "crossfade",
                id = c.Id,
                imagePath = Resolve(c.ImagePath),
                opacityFrom = c.OpacityFrom,
                opacityTo = c.OpacityTo,
                durationMs = c.DurationMs,
                direction = c.Direction,
                easing = c.Easing,
            },
            DriftingSpriteEffect d => new
            {
                type = "drift",
                id = d.Id,
                imagePath = Resolve(d.ImagePath),
                x = d.X,
                y = d.Y,
                blendMode = d.BlendMode,
                driftX = ToAxisPayload(d.DriftX),
                driftY = ToAxisPayload(d.DriftY),
            },
            _ => throw new NotSupportedException($"Unknown effect type: {effect.GetType()}"),
        };
    }

    private static object? ToAxisPayload(DriftAxis? axis) => axis is null
        ? null
        : new
        {
            fromPx = axis.FromPx,
            toPx = axis.ToPx,
            durationMs = axis.DurationMs,
            direction = axis.Direction,
            easing = axis.Easing,
        };
}
