using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Shared by DisclosurePageRenderer and UpdateLogPageRenderer: escapes a run of plain text and
/// wraps any bare https:// URL within it in a real link, rather than escaping the whole string
/// up front (which would also mangle a URL's own '&amp;' before it got a chance to become a
/// link target).
/// </summary>
internal static class TextLinkifier
{
    private static readonly Regex UrlPattern = new(@"https?://\S+", RegexOptions.Compiled);

    public static string Linkify(string text)
    {
        var result = new StringBuilder();
        var lastEnd = 0;

        foreach (Match match in UrlPattern.Matches(text))
        {
            result.Append(EscapeText(text[lastEnd..match.Index]));
            result.Append($"<a href=\"{EscapeAttr(match.Value)}\" target=\"_blank\" rel=\"noreferrer noopener\">{EscapeText(match.Value)}</a>");
            lastEnd = match.Index + match.Length;
        }
        result.Append(EscapeText(text[lastEnd..]));

        return result.ToString();
    }

    public static string EscapeText(string value) => WebUtility.HtmlEncode(value);

    public static string EscapeAttr(string value) => WebUtility.HtmlEncode(value);
}
