using System.Text;
using System.Text.RegularExpressions;

namespace TheWeave.Exporter.Templates;

/// <summary>
/// Converts updatelog.md (the repo-root site changelog, embedded via RuntimeAssets) into a
/// plain standalone HTML page - same idea as DisclosurePageRenderer, but as a chronological
/// list rather than prose: each blank-line-separated block is one entry, an optional leading
/// "[DATE]" tag (e.g. "[26AUG26] ...") becomes a small date label rather than reflowing into the
/// entry's own text, and any indented follow-up lines become a nested sub-list under that entry
/// instead of running together into one paragraph. Every export gets this page unconditionally
/// (see SiteExporter), the same way it gets the shared runtime.
///
/// An optional leading heading block - one or more lines starting with "#"/"##"/etc (real
/// Markdown heading syntax, e.g. "# Update Log" / "## The Weave Explorer") - sets the page's own
/// title/subtitle instead of being treated as an entry, so the title is editable in updatelog.md
/// itself rather than hardcoded here. Falls back to a plain "Update Log" title with no subtitle
/// when the file doesn't start with one (so existing changelogs without a heading still work).
/// </summary>
public static class UpdateLogPageRenderer
{
    public const string OutputFileName = "updatelog.html";
    private const string DefaultTitle = "Update Log";

    // Group 1: the tag's own text (kept verbatim, not reformatted - e.g. "26AUG26"). Group 2:
    // the rest of that first line.
    private static readonly Regex DateTagPattern = new(@"^\[([^\]]+)\]\s*(.*)$", RegexOptions.Compiled);

    // Real Markdown heading syntax: one or more '#' then whitespace then the heading text.
    private static readonly Regex HeadingLinePattern = new(@"^(#{1,6})\s+(.*)$", RegexOptions.Compiled);

    public static string Render() => RenderFromText(RuntimeAssets.ReadUpdateLogMd());

    // Split out from Render() so tests can exercise the actual parsing/rendering logic (heading
    // block, date tags, nested sub-items, continuation lines) against small, controlled fixtures
    // instead of only the live, ever-changing updatelog.md content.
    internal static string RenderFromText(string rawText)
    {
        var blocks = rawText
            .Replace("\r\n", "\n")
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Where(b => b.Trim().Length > 0)
            .ToList();

        var title = DefaultTitle;
        var subtitleLines = new List<string>();

        if (blocks.Count > 0 && IsHeadingBlock(blocks[0]))
        {
            ParseHeadingBlock(blocks[0], ref title, subtitleLines);
            blocks.RemoveAt(0);
        }

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
        sb.AppendLine("    .subtitle { color: #666; font-size: 14px; margin: 2px 0; }");
        sb.AppendLine("    ul.updates { list-style: none; margin: 24px 0 0; padding: 0; }");
        sb.AppendLine("    ul.updates > li { margin: 0 0 20px; }");
        sb.AppendLine("    ul.updates ul { margin: 6px 0 0; padding-left: 22px; }");
        sb.AppendLine("    .date { display: inline-block; font-weight: 700; color: #a56b2f; margin-right: 8px; }");
        sb.AppendLine("    a { color: #a56b2f; }");
        sb.AppendLine("  </style>");
        sb.AppendLine("</head>");
        sb.AppendLine("<body>");
        sb.AppendLine($"  <h1>{TextLinkifier.EscapeText(title)}</h1>");

        foreach (var subtitle in subtitleLines)
            sb.AppendLine($"  <p class=\"subtitle\">{TextLinkifier.EscapeText(subtitle)}</p>");

        sb.AppendLine("  <ul class=\"updates\">");

        foreach (var block in blocks)
            sb.AppendLine(RenderEntry(block));

        sb.AppendLine("  </ul>");
        sb.AppendLine("</body>");
        sb.AppendLine("</html>");

        return sb.ToString();
    }

    // A block "looks like" a heading block only when every one of its (non-empty) lines uses
    // real heading syntax - a single "[DATE] ..." entry line never does, so this can't
    // accidentally swallow the file's first real changelog entry.
    private static bool IsHeadingBlock(string block) =>
        block.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).All(l => HeadingLinePattern.IsMatch(l));

    private static void ParseHeadingBlock(string block, ref string title, List<string> subtitleLines)
    {
        var sawTitle = false;

        foreach (var rawLine in block.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0) continue;

            var match = HeadingLinePattern.Match(line);
            var text = match.Groups[2].Value.Trim();

            // The first "# " (level-1) line found is the title; every other heading line -
            // "##", a second "#", whatever - becomes its own subtitle line underneath it.
            if (match.Groups[1].Value.Length == 1 && !sawTitle)
            {
                title = text;
                sawTitle = true;
            }
            else
            {
                subtitleLines.Add(text);
            }
        }
    }

    private static string RenderEntry(string block)
    {
        var lines = block.Split('\n');

        var match = DateTagPattern.Match(lines[0].Trim());
        var dateTag = match.Success ? match.Groups[1].Value : null;
        var headlineParts = new List<string> { match.Success ? match.Groups[2].Value : lines[0].Trim() };

        // A line indented in the source (a leading space/tab, before trimming) is a sub-item of
        // this entry; anything else is just a continuation of the headline's own text, reflowed
        // into it the same way DisclosurePageRenderer reflows a multi-line paragraph block.
        var subItems = new List<string>();
        foreach (var line in lines.Skip(1))
        {
            if (line.Length == 0) continue;
            if (char.IsWhiteSpace(line[0])) subItems.Add(line.Trim());
            else headlineParts.Add(line.Trim());
        }

        var sb = new StringBuilder("    <li>");
        if (dateTag is not null)
            sb.Append($"<span class=\"date\">{TextLinkifier.EscapeText(dateTag)}</span>");
        sb.Append(TextLinkifier.Linkify(string.Join(" ", headlineParts)));

        if (subItems.Count > 0)
        {
            sb.Append("<ul>");
            foreach (var item in subItems)
                sb.Append($"<li>{TextLinkifier.Linkify(item)}</li>");
            sb.Append("</ul>");
        }

        sb.Append("</li>");
        return sb.ToString();
    }
}
