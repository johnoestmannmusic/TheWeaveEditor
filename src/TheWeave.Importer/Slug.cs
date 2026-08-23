using System.Text;
using System.Text.RegularExpressions;

namespace TheWeave.Importer;

/// <summary>
/// Most real nodes have no id attribute (only the two persistent ones do), so the importer
/// generates a stable, readable id from the node's heading text - deduplicated against every
/// id already used anywhere in the project, since Node ids must be unique project-wide.
/// </summary>
internal static class Slug
{
    private static readonly Regex NonAlphaNumeric = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    public static string Generate(string? seedText, HashSet<string> used)
    {
        var baseSlug = Slugify(seedText);
        if (baseSlug.Length == 0)
            baseSlug = "node";

        if (used.Add(baseSlug))
            return baseSlug;

        var i = 2;
        while (!used.Add($"{baseSlug}-{i}"))
            i++;

        return $"{baseSlug}-{i}";
    }

    private static string Slugify(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return "";

        var lowered = text.Trim().ToLowerInvariant();
        var slug = NonAlphaNumeric.Replace(lowered, "-").Trim('-');
        return slug;
    }
}
