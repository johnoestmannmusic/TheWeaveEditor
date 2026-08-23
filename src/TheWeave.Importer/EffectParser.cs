using System.Globalization;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using TheWeave.Core.Model.Effects;

namespace TheWeave.Importer;

/// <summary>
/// Reverse-engineers the one hand-written effects script pattern that exists today (see
/// shrines-layer-0001.html): a #bgmap2 crossfade and paired drifting-sprite divs. This is
/// deliberately scoped to that one known pattern via targeted regex, not a general JS
/// decompiler - any other bespoke script won't be understood and needs a manual schema entry
/// after import (a warning is recorded when that happens).
/// </summary>
internal static class EffectParser
{
    private static readonly Regex CrossfadePattern = new(
        @"bgmap2\.animate\(\s*\[\s*\{\s*opacity\s*:\s*'([\d.]+)'\s*\}\s*,\s*\{\s*opacity\s*:\s*'([\d.]+)'\s*\}\s*,?\s*\]\s*,\s*\{\s*duration\s*:\s*(\d+)\s*,\s*direction\s*:\s*""([^""]+)""\s*,\s*iterations\s*:\s*Infinity\s*,\s*easing\s*:\s*""([^""]+)""\s*\}\s*\)",
        RegexOptions.Compiled | RegexOptions.Singleline);

    private static Regex DriftXPattern(string jsVar) => new(
        Regex.Escape(jsVar) + @"\.animate\(\s*\{\s*transform\s*:\s*""translateX\(([-\d.]+)px\)""\s*\}\s*,\s*\{\s*duration\s*:\s*(\d+)\s*,\s*direction\s*:\s*""([^""]+)""\s*,\s*iterations\s*:\s*Infinity\s*,\s*easing\s*:\s*""([^""]+)""\s*\}\s*\)",
        RegexOptions.Compiled | RegexOptions.Singleline);

    private static Regex DriftYPattern(string jsVarOuter) => new(
        Regex.Escape(jsVarOuter) + @"\.animate\(\s*\[\s*\{\s*transform\s*:\s*""translateY\(([-\d.]+)px\)""\s*\}\s*,\s*\{\s*transform\s*:\s*""translateY\(([-\d.]+)px\)""\s*\}\s*\]\s*,\s*\{\s*duration\s*:\s*(\d+)\s*,\s*direction\s*:\s*""([^""]+)""\s*,\s*iterations\s*:\s*Infinity\s*,\s*easing\s*:\s*""([^""]+)""\s*\}\s*\)",
        RegexOptions.Compiled | RegexOptions.Singleline);

    public static List<PageEffect> Parse(IDocument doc, string pageId, ImportContext ctx)
    {
        var effects = new List<PageEffect>();

        var scriptText = string.Join("\n", doc.QuerySelectorAll("script")
            .Where(s => !s.HasAttribute("src"))
            .Select(s => s.TextContent));

        if (scriptText.Length == 0)
            return effects;

        var crossfade = ParseCrossfade(doc, scriptText, pageId, ctx);
        if (crossfade is not null)
            effects.Add(crossfade);

        effects.AddRange(ParseDriftEffects(doc, scriptText, pageId, ctx));

        return effects;
    }

    private static CrossfadeLayerEffect? ParseCrossfade(IDocument doc, string scriptText, string pageId, ImportContext ctx)
    {
        var bgmap2 = doc.QuerySelector("#bgmap2");
        if (bgmap2 is null)
            return null;

        var match = CrossfadePattern.Match(scriptText);
        if (!match.Success)
        {
            ctx.Warnings.Add(new ImportWarning(
                "Found #bgmap2 but couldn't recognize its crossfade animation script - imported with a SecondaryBackground image but no CrossfadeLayerEffect (it won't animate). Add one manually.",
                pageId));
            return null;
        }

        return new CrossfadeLayerEffect
        {
            Id = "crossfade-" + (bgmap2.GetAttribute("id") ?? "bgmap2"),
            ImagePath = bgmap2.GetAttribute("src") ?? "",
            OpacityFrom = double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
            OpacityTo = double.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
            DurationMs = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture),
            Direction = match.Groups[4].Value,
            Easing = match.Groups[5].Value,
        };
    }

    private static List<DriftingSpriteEffect> ParseDriftEffects(IDocument doc, string scriptText, string pageId, ImportContext ctx)
    {
        var results = new List<DriftingSpriteEffect>();

        foreach (var outerEl in doc.QuerySelectorAll("div[id$='-outer']"))
        {
            var outerId = outerEl.GetAttribute("id")!;
            var baseName = outerId[..^"-outer".Length];
            var jsVar = baseName.Replace("-", "");

            var imgEl = outerEl.QuerySelector("img");
            if (imgEl is null)
            {
                ctx.Warnings.Add(new ImportWarning(
                    $"'{outerId}' looks like a drift-effect wrapper (id ends in -outer) but has no <img> inside - skipped.",
                    pageId));
                continue;
            }

            var style = InlineStyle.Parse(outerEl.GetAttribute("style"));

            var effect = new DriftingSpriteEffect
            {
                Id = "drift-" + baseName,
                ImagePath = imgEl.GetAttribute("src") ?? "",
                X = InlineStyle.ParsePx(style.GetValueOrDefault("left")) ?? 0,
                Y = InlineStyle.ParsePx(style.GetValueOrDefault("top")) ?? 0,
                BlendMode = style.GetValueOrDefault("mix-blend-mode"),
            };

            var xMatch = DriftXPattern(jsVar).Match(scriptText);
            if (xMatch.Success)
            {
                effect.DriftX = new DriftAxis
                {
                    FromPx = 0, // single-keyframe animate() implicitly starts from the element's current (unset) transform
                    ToPx = double.Parse(xMatch.Groups[1].Value, CultureInfo.InvariantCulture),
                    DurationMs = int.Parse(xMatch.Groups[2].Value, CultureInfo.InvariantCulture),
                    Direction = xMatch.Groups[3].Value,
                    Easing = xMatch.Groups[4].Value,
                };
            }

            var yMatch = DriftYPattern(jsVar + "outer").Match(scriptText);
            if (yMatch.Success)
            {
                effect.DriftY = new DriftAxis
                {
                    FromPx = double.Parse(yMatch.Groups[1].Value, CultureInfo.InvariantCulture),
                    ToPx = double.Parse(yMatch.Groups[2].Value, CultureInfo.InvariantCulture),
                    DurationMs = int.Parse(yMatch.Groups[3].Value, CultureInfo.InvariantCulture),
                    Direction = yMatch.Groups[4].Value,
                    Easing = yMatch.Groups[5].Value,
                };
            }

            if (effect.DriftX is null && effect.DriftY is null)
            {
                ctx.Warnings.Add(new ImportWarning(
                    $"'{outerId}' has a sprite but no recognizable drift animation script - imported with no motion.",
                    pageId));
            }

            results.Add(effect);
        }

        return results;
    }
}
