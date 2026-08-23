using TheWeave.Core.Model;
using TheWeave.Exporter.Templates;

namespace TheWeave.Exporter;

/// <summary>Top-level entry point: renders a whole WeaveProject out to a static site directory.</summary>
public sealed class SiteExporter
{
    /// <param name="project">The project to export.</param>
    /// <param name="outputDir">Directory to write the site into (created if missing).</param>
    /// <param name="contentSourceRoot">
    /// Directory containing the project's content assets (img/, fnt/, as configured on
    /// project.Assets), to be copied alongside the generated HTML. Null skips asset copying -
    /// useful for tests that only care about the generated markup.
    /// </param>
    public void Export(WeaveProject project, string outputDir, string? contentSourceRoot = null)
    {
        Directory.CreateDirectory(outputDir);

        // Every path (relative to outputDir) this run writes or expects to already be present -
        // used at the end to remove anything left over from a previous export that this run
        // didn't touch (a renamed/deleted page's stale .html, an image nothing references
        // anymore, etc.) without resorting to wiping the whole directory first. See
        // ExportCleanup's own header for why that's deliberately not the chosen approach.
        var written = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Copies each individually-referenced image (cover images, backgrounds, effect
        // sprites) into the export as it's encountered while rendering, regardless of whether
        // it happens to live inside contentSourceRoot's own img/ tree - unlike
        // AssetCopier.CopyContentAssets below, which only mirrors that tree wholesale and has
        // no way to reach a file referenced from outside it (e.g. a cover image picked from
        // some other folder on disk).
        var assetResolver = contentSourceRoot is not null ? new AssetResolver(contentSourceRoot, outputDir) : null;
        var renderer = new PageRenderer(project, assetResolver);

        foreach (var page in project.Pages)
        {
            var html = renderer.RenderPage(page);
            var fileName = PageRenderer.OutputFileNameFor(page, project);
            var path = Path.Combine(outputDir, fileName);

            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            File.WriteAllText(path, html);
            written.Add(fileName);
        }

        if (project.HomePageId is not null)
        {
            var homePage = project.Pages.FirstOrDefault(p => p.Id == project.HomePageId)
                ?? throw new InvalidOperationException($"HomePageId '{project.HomePageId}' does not match any page.");

            var conflict = project.Pages.FirstOrDefault(p => p.Id != homePage.Id && p.OutputFileName == "index.html");
            if (conflict is not null)
                throw new InvalidOperationException(
                    $"Page '{conflict.Id}' is configured to export as index.html, but the site's shell (see WeaveProject.HomePageId) " +
                    "always owns that filename. Give that page a different Output File Name.");

            var shellHtml = ShellRenderer.Render(project, PageRenderer.OutputFileNameFor(homePage, project));
            File.WriteAllText(Path.Combine(outputDir, "index.html"), shellHtml);
            written.Add("index.html");
        }

        written.UnionWith(AssetCopier.CopyRuntime(project, outputDir));

        if (contentSourceRoot is not null)
        {
            written.UnionWith(AssetCopier.CopyContentAssets(project, contentSourceRoot, outputDir));
            written.UnionWith(assetResolver!.ResolvedDestinations);

            ExportCleanup.RemoveOrphans(outputDir, project, written);
        }
    }
}
