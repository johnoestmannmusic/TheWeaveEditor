using AngleSharp;
using TheWeave.Core.Model;

namespace TheWeave.Importer;

/// <summary>Parses a directory of hand-authored site HTML into a single WeaveProject.</summary>
public sealed class SiteImporter
{
    public async Task<ImportResult> ImportDirectoryAsync(string sourceDir, string projectTitle = "Imported Project")
    {
        var ctx = new ImportContext();
        // Version 1: positions come straight from the hand-authored pages, not yet on the grid - see
        // ProjectMigrations.
        var project = new WeaveProject { Title = projectTitle, SchemaVersion = 1 };

        var browsingContext = BrowsingContext.New(Configuration.Default);

        var files = Directory.EnumerateFiles(sourceDir, "*.html", SearchOption.TopDirectoryOnly)
            .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var filePath in files)
        {
            var fileName = Path.GetFileName(filePath);

            if (ShouldSkip(fileName))
            {
                ctx.Warnings.Add(new ImportWarning($"Skipped '{fileName}' (backup/template file, not part of the live site) - review it manually if it has content worth keeping."));
                continue;
            }

            var html = await File.ReadAllTextAsync(filePath);
            var document = await browsingContext.OpenAsync(req => req.Content(html));

            project.Pages.Add(HtmlPageParser.Parse(document, fileName, ctx));
        }

        ResolveTravelLinks(project, ctx);

        return new ImportResult { Project = project, Warnings = ctx.Warnings };
    }

    private static bool ShouldSkip(string fileName) =>
        fileName.EndsWith("-copy.html", StringComparison.OrdinalIgnoreCase) ||
        fileName.StartsWith("_", StringComparison.Ordinal);

    private static void ResolveTravelLinks(WeaveProject project, ImportContext ctx)
    {
        var pageIdByFileName = project.Pages.ToDictionary(p => p.OutputFileName, p => p.Id, StringComparer.OrdinalIgnoreCase);

        foreach (var pending in ctx.PendingTravelLinks)
        {
            var (fileName, query) = SplitHref(pending.RawHref);

            if (pageIdByFileName.TryGetValue(fileName, out var targetId))
            {
                pending.Node.Card.Action.TargetPageId = targetId;
            }
            else
            {
                ctx.Warnings.Add(new ImportWarning(
                    $"Travel link '{pending.RawHref}' doesn't match any imported page - left unresolved (will fail validation).",
                    pending.PageId,
                    pending.Node.Id));
            }

            ApplyTravelQuery(pending, query, ctx);
        }
    }

    private static void ApplyTravelQuery(PendingTravelLink pending, string query, ImportContext ctx)
    {
        if (query.Length == 0)
            return;

        var recognized = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "x", "y", "tutorial" };
        double? x = null, y = null;

        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            if (eq < 0)
                continue;

            var key = pair[..eq];
            var value = pair[(eq + 1)..];

            if (key.Equals("x", StringComparison.OrdinalIgnoreCase))
                x = ParseLeadingNumber(value);
            else if (key.Equals("y", StringComparison.OrdinalIgnoreCase))
                y = ParseLeadingNumber(value);
            else if (key.Equals("tutorial", StringComparison.OrdinalIgnoreCase) && value.Equals("off", StringComparison.OrdinalIgnoreCase))
                pending.Node.Card.Action.TravelSkipTutorial = true;
            else if (!recognized.Contains(key))
            {
                ctx.Warnings.Add(new ImportWarning(
                    $"Travel link '{pending.RawHref}' has an unrecognized query parameter '{key}' - it was dropped.",
                    pending.PageId,
                    pending.Node.Id));
            }
        }

        if (x is not null && y is not null)
        {
            pending.Node.Card.Action.TravelSpawnX = x;
            pending.Node.Card.Action.TravelSpawnY = y;
        }
    }

    // Real query values are inconsistently authored - some bare ("445"), some with a stray
    // "px" suffix ("445px") - parseInt-style leading-number parsing handles both.
    private static double? ParseLeadingNumber(string value)
    {
        var digits = new string(value.TakeWhile(c => char.IsDigit(c) || c is '-' or '.').ToArray());
        return double.TryParse(digits, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static (string FileName, string Query) SplitHref(string href)
    {
        var clean = href.StartsWith("./", StringComparison.Ordinal) ? href[2..] : href;
        var queryIndex = clean.IndexOf('?');
        return queryIndex < 0 ? (clean, "") : (clean[..queryIndex], clean[(queryIndex + 1)..]);
    }
}
