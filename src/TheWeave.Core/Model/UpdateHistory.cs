using System.Text.RegularExpressions;

namespace TheWeave.Core.Model;

/// <summary>
/// The site's update history, as the Editor's "Update History" tab keeps it: one entry per line, written in the same
/// shape updatelog.md used to be - an optional leading "[DATE]" tag, then the entry's headline, and any <em>indented</em>
/// line under it a sub-item of that entry rather than an entry of its own. Blank lines are separators and are ignored,
/// including the "&amp;nbsp;" spacer lines the Tutorial Modal's Updates panel puts between entries.
///
/// One reading of it, so the exported updatelog.html and the Tutorial Modal's own panel can't disagree: the page is
/// rendered from these entries (see UpdateLogPageRenderer) and the panel is generated from the first few of them (see
/// PanelLines and PageRenderer).
/// </summary>
public static class UpdateHistory
{
    /// <summary>One dated entry: its tag as typed ("26AUG26"), its headline, and any indented sub-items under it.</summary>
    public sealed record Entry(string? DateTag, string Headline, IReadOnlyList<string> SubItems);

    /// <summary>The line the Tutorial Modal puts under its entries, on to the page itself.</summary>
    public const string FullLogLinkLine =
        "<a href=\"updatelog.html\" target=\"_blank\" rel=\"noreferrer noopener\">Full update history..</a>";

    /// <summary>What the Tutorial Modal shows when the project hasn't said how many entries it wants.</summary>
    public const int DefaultModalEntryCount = 6;

    // Group 1: the tag's own text, kept verbatim rather than reformatted - e.g. "26AUG26". Group 2: the rest of the line.
    private static readonly Regex DateTagPattern = new(@"^\[([^\]]+)\]\s*(.*)$", RegexOptions.Compiled);

    /// <summary>Whether there's anything to write a page from. Nothing means the export leaves updatelog.html out.</summary>
    public static bool HasEntries(IEnumerable<string>? lines) => Parse(lines).Count > 0;

    /// <summary>The entries, in the order they were written - newest first, as the site has always listed them.</summary>
    public static List<Entry> Parse(IEnumerable<string>? lines)
    {
        var entries = new List<Entry>();
        string? dateTag = null;
        var headline = new List<string>();
        var subItems = new List<string>();

        void Flush()
        {
            if (headline.Count > 0 || subItems.Count > 0)
                entries.Add(new Entry(dateTag, string.Join(" ", headline), subItems.ToArray()));

            dateTag = null;
            headline = new List<string>();
            subItems = new List<string>();
        }

        foreach (var rawLine in lines ?? [])
        {
            if (IsBlank(rawLine)) continue;

            // Indented: a sub-item of the entry above it. With nothing above it there's nothing to belong to, so it
            // reads as an entry of its own rather than being dropped.
            if (char.IsWhiteSpace(rawLine[0]))
            {
                if (headline.Count == 0 && subItems.Count == 0) headline.Add(rawLine.Trim());
                else subItems.Add(rawLine.Trim());
                continue;
            }

            // Anything else starts a new entry.
            Flush();

            var match = DateTagPattern.Match(rawLine.Trim());
            if (match.Success)
            {
                dateTag = match.Groups[1].Value;
                headline.Add(match.Groups[2].Value.Trim());
            }
            else
            {
                headline.Add(rawLine.Trim());
            }
        }

        Flush();
        return entries;
    }

    /// <summary>
    /// The lines the Tutorial Modal's Updates panel shows: the newest <paramref name="count"/> entries, each as
    /// "[DATE] headline" with its sub-items indented under it, a spacer line between entries, and the link to the full
    /// page last. Empty when there's no history, or when the project asks for none.
    /// </summary>
    public static List<string> PanelLines(IEnumerable<string>? lines, int count, string? linkLine = FullLogLinkLine)
    {
        var shown = Parse(lines).Take(Math.Max(0, count)).ToList();
        var panelLines = new List<string>();

        foreach (var entry in shown)
        {
            panelLines.Add(entry.DateTag is null ? entry.Headline : $"[{entry.DateTag}] {entry.Headline}");
            panelLines.AddRange(entry.SubItems.Select(item => "    " + item));
            panelLines.Add("&nbsp;&nbsp;&nbsp;&nbsp;");
        }

        if (panelLines.Count > 0 && !string.IsNullOrEmpty(linkLine))
            panelLines.Add(linkLine);

        return panelLines;
    }

    // A separator: nothing at all, or the "&nbsp;" the modal's panel uses to space its entries apart.
    private static bool IsBlank(string line) =>
        string.IsNullOrWhiteSpace(line) || line.Replace("&nbsp;", "").Trim().Length == 0;
}
