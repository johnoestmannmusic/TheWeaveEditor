using System.Text;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Converts aadd.md (the repo-root AI-assisted-development disclosure statement, embedded via
/// RuntimeAssets) into a plain standalone HTML page. Not markdown syntax - just blank-line-
/// separated paragraphs with bare https:// URLs auto-linked (see TextLinkifier). Every export
/// gets this page unconditionally (see SiteExporter), the same way it gets the shared runtime.
/// </summary>
public static class DisclosurePageRenderer
{
    public const string OutputFileName = "aadd.html";

    public static string Render()
    {
        var blocks = RuntimeAssets.ReadAaddMd()
            .Replace("\r\n", "\n")
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(b => b.Trim())
            .Where(b => b.Length > 0)
            .ToList();

        if (blocks.Count == 0)
            throw new InvalidOperationException("aadd.md is empty.");

        // The first block is a short header - its first line is the page title, any further
        // lines in that same block (a site name, a "last updated" date, ...) render as byline
        // meta text underneath it. Every later block is an ordinary paragraph.
        var headerLines = blocks[0].Split('\n', StringSplitOptions.RemoveEmptyEntries);
        var title = headerLines[0].Trim();

        var sb = new StringBuilder();
        sb.AppendLine("<!DOCTYPE html>");
        sb.AppendLine("<html><head>");
        sb.AppendLine("<meta http-equiv=\"content-type\" content=\"text/html; charset=UTF-8\">");
        sb.AppendLine("  <meta charset=\"utf-8\">");
        sb.AppendLine("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\">");
        sb.AppendLine($"  <title>{TextLinkifier.EscapeText(title)}</title>");
        sb.AppendLine("  <style>");
        sb.AppendLine("    body { font-family: Georgia, 'Times New Roman', serif; max-width: 640px; margin: 60px auto; padding: 0 24px 60px; line-height: 1.6; color: #222; background: #faf7f2; }");
        sb.AppendLine("    h1 { font-size: 28px; margin-bottom: 4px; }");
        sb.AppendLine("    .meta { color: #666; font-size: 14px; margin: 2px 0; }");
        sb.AppendLine("    p { margin: 20px 0; }");
        sb.AppendLine("    a { color: #a56b2f; }");
        sb.AppendLine("  </style>");
        sb.AppendLine("</head>");
        sb.AppendLine("<body>");
        sb.AppendLine($"  <h1>{TextLinkifier.EscapeText(title)}</h1>");

        foreach (var metaLine in headerLines.Skip(1))
            sb.AppendLine($"  <p class=\"meta\">{TextLinkifier.EscapeText(metaLine.Trim())}</p>");

        foreach (var block in blocks.Skip(1))
        {
            var paragraphText = string.Join(" ", block.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()));
            sb.AppendLine($"  <p>{TextLinkifier.Linkify(paragraphText)}</p>");
        }

        sb.AppendLine("</body>");
        sb.AppendLine("</html>");

        return sb.ToString();
    }
}
