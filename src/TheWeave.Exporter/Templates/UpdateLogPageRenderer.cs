using System.Text;
using TheWeave.Core.Model;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Renders the project's update history - the Editor's "Update History" tab, kept on the project as
/// WeaveProject.UpdateHistory - into the site's plain standalone updatelog.html page. Chronological rather than prose:
/// each entry is one item, an optional leading "[DATE]" tag (e.g. "[26AUG26] ...") becomes a small date label rather
/// than reflowing into the entry's own text, and any indented follow-up lines become a nested sub-list under that entry
/// instead of running together into one paragraph. All of that reading is UpdateHistory.Parse's, so the page and the
/// Tutorial Modal's own Updates panel are built from the same entries.
///
/// The page's title and subtitle are fixed here rather than stored in the project: it's the site's changelog, and one
/// heading is all it has ever had.
///
/// An export with no history leaves this page out altogether (see SiteExporter), rather than writing an empty one.
/// </summary>
public static class UpdateLogPageRenderer
{
    public const string OutputFileName = "updatelog.html";
    private const string Title = "Update Log";
    private const string Subtitle = "The Weave Explorer";

    /// <summary>The page for a project's history. Empty entries render as an empty page - the caller decides whether
    /// to write it at all, which is why SiteExporter asks UpdateHistory.HasEntries first.</summary>
    public static string Render(IEnumerable<string>? historyLines) => RenderFromEntries(UpdateHistory.Parse(historyLines));

    // Split out from Render so tests can exercise the markup against small, controlled entries instead of only the
    // project's live history.
    internal static string RenderFromEntries(IReadOnlyList<UpdateHistory.Entry> entries)
    {
        var sb = new StringBuilder();
        sb.AppendLine("<!DOCTYPE html>");
        sb.AppendLine("<html><head>");
        sb.AppendLine("<meta http-equiv=\"content-type\" content=\"text/html; charset=UTF-8\">");
        sb.AppendLine("  <meta charset=\"utf-8\">");
        sb.AppendLine("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\">");
        sb.AppendLine($"  <title>{TextLinkifier.EscapeText(Title)}</title>");
        sb.AppendLine("  <style>");
        sb.AppendLine("    body { font-family: Georgia, 'Times New Roman', serif; max-width: 640px; margin: 60px auto; padding: 0 24px 60px; line-height: 1.6; color: #222; background: #faf7f2; }");
        sb.AppendLine("    h1 { font-size: 28px; margin-bottom: 4px; }");
        sb.AppendLine("    .subtitle { color: #666; font-size: 14px; margin: 2px 0; }");
        sb.AppendLine("    ul.updates { list-style: none; margin: 24px 0 0; padding: 0; }");
        sb.AppendLine("    ul.updates > li { margin: 0 0 20px; }");
        sb.AppendLine("    ul.updates ul { margin: 6px 0 0; padding-left: 22px; }");
        sb.AppendLine("    .date { display: inline-block; font-weight: 700; color: #a56b2f; margin-right: 8px; }");
        sb.AppendLine("    a { color: #a56b2f; }");
        sb.AppendLine("  </style>");
        sb.AppendLine("</head>");
        sb.AppendLine("<body>");
        sb.AppendLine($"  <h1>{TextLinkifier.EscapeText(Title)}</h1>");
        sb.AppendLine($"  <p class=\"subtitle\">{TextLinkifier.EscapeText(Subtitle)}</p>");
        sb.AppendLine("  <ul class=\"updates\">");

        foreach (var entry in entries)
            sb.AppendLine(RenderEntry(entry));

        sb.AppendLine("  </ul>");
        sb.AppendLine("</body>");
        sb.AppendLine("</html>");

        return sb.ToString();
    }

    private static string RenderEntry(UpdateHistory.Entry entry)
    {
        var sb = new StringBuilder("    <li>");
        if (entry.DateTag is not null)
            sb.Append($"<span class=\"date\">{TextLinkifier.EscapeText(entry.DateTag)}</span>");
        sb.Append(TextLinkifier.Linkify(entry.Headline));

        if (entry.SubItems.Count > 0)
        {
            sb.Append("<ul>");
            foreach (var item in entry.SubItems)
                sb.Append($"<li>{TextLinkifier.Linkify(item)}</li>");
            sb.Append("</ul>");
        }

        sb.Append("</li>");
        return sb.ToString();
    }
}
