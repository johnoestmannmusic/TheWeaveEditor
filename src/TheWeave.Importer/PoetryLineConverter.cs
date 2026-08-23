using System.Text.RegularExpressions;

namespace TheWeave.Importer;

/// <summary>Reverses PageRenderer's poetry-line convention: &lt;b&gt; back to **bold**.</summary>
internal static class PoetryLineConverter
{
    private static readonly Regex BoldTag = new(@"<b>(.*?)</b>", RegexOptions.Compiled | RegexOptions.Singleline);

    // AngleSharp's InnerHtml serializes a literal non-breaking space as the character itself
    // rather than the &nbsp; entity text the exporter writes - normalize back so round-tripped
    // content matches what was authored. Built from its code point (0xA0) rather than pasted
    // as a literal, since it is visually indistinguishable from a normal space in source.
    private static readonly string NonBreakingSpace = char.ConvertFromUtf32(0xA0);

    public static string FromHtml(string innerHtml)
    {
        var normalized = innerHtml.Replace(NonBreakingSpace, "&nbsp;");
        return BoldTag.Replace(normalized, "**$1**").Trim();
    }
}
