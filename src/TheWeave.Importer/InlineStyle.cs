using System.Globalization;

namespace TheWeave.Importer;

/// <summary>
/// A minimal parser for the simple inline style="..." strings used across the site
/// (property:value pairs, no url()/nested functions), avoiding a dependency on AngleSharp's
/// separate CSS parsing module for something this small.
/// </summary>
internal static class InlineStyle
{
    public static Dictionary<string, string> Parse(string? styleAttr)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(styleAttr))
            return result;

        foreach (var declaration in styleAttr.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var separatorIndex = declaration.IndexOf(':');
            if (separatorIndex < 0)
                continue;

            var property = declaration[..separatorIndex].Trim();
            var value = declaration[(separatorIndex + 1)..].Trim();

            if (property.Length > 0)
                result[property] = value;
        }

        return result;
    }

    public static double? ParsePx(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var trimmed = value.Trim();
        if (trimmed.EndsWith("px", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[..^2];

        return double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }
}
