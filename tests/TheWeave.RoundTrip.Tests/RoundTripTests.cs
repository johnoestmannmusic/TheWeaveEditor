using System.Text.RegularExpressions;
using AngleSharp;
using TheWeave.Core.Model;
using TheWeave.Core.Serialization;
using TheWeave.Core.Validation;
using TheWeave.Exporter;
using TheWeave.Importer;
using Xunit;

namespace TheWeave.RoundTrip.Tests;

/// <summary>
/// Imports the pinned snapshot of the real TheWeave-Explorer site (fixtures/weave-explorer-
/// snapshot/, ~18 hand-authored pages) and exports it back out, checking that nothing was
/// lost along the way. This is the highest-risk unknown in the whole project - if schema,
/// importer, and exporter can't faithfully round-trip the real site, no editor UI built on
/// top of them matters - so it's validated here before any UI work begins.
///
/// The comparison is structural (node counts, validation issues, effect counts), not
/// byte-for-byte: the original files have inconsistent hand-authored whitespace/comments that
/// will never match generated output, and that's not what round-tripping is meant to prove.
/// </summary>
public class RoundTripTests
{
    private static readonly Regex NodeTag = new("class=\"node\"", RegexOptions.Compiled);

    private static string SnapshotDir => Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "fixtures", "weave-explorer-snapshot");

    [Fact]
    public async Task Import_TheRealSite_ProducesOnlyExpectedSkipWarnings()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");

        // The only files the real site has that aren't part of the live site.
        var expectedSkips = new[] { "index-copy.html", "the-weave-ii-copy.html", "_planet-template.html" };

        foreach (var skip in expectedSkips)
            Assert.Contains(result.Warnings, w => w.Message.Contains(skip));

        Assert.Equal(expectedSkips.Length, result.Warnings.Count);
    }

    [Fact]
    public async Task Import_TheRealSite_ProducesAValidProject()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");
        ProjectMigrations.Upgrade(result.Project);

        var issues = ProjectValidator.Validate(result.Project, SnapshotDir);

        Assert.Empty(issues);
    }

    [Fact]
    public void UpgradingTheRealProjectFile_PutsEveryLocationOnItsOwnSquare()
    {
        var project = WeaveProjectSerializer.LoadFromFile(Path.Combine(SnapshotDir, "project.json"), out var notes);

        Assert.NotNull(notes);
        Assert.Equal(ProjectMigrations.CurrentSchemaVersion, project.SchemaVersion);
        Assert.Equal(3000, project.DefaultWorldWidthPx);
        Assert.Equal(1686, project.DefaultWorldHeightPx);

        foreach (var page in project.Pages)
        {
            var grid = GridLayout.For(page, project);
            var mapNodes = page.Nodes.Where(n => n.Card.Size != CardSize.Modal).ToList();

            foreach (var node in mapNodes)
                Assert.Equal(grid.NodePositionFor(grid.CellOf(node)), (node.X, node.Y));

            Assert.Equal(mapNodes.Count, mapNodes.Select(grid.CellOf).Distinct().Count());
            Assert.Equal(150, grid.CellWidth);
            Assert.Equal(150, grid.CellHeight);
        }

        var theWeave = project.Pages.Single(p => p.Id == "index");
        Assert.Equal(6000, theWeave.WorldWidthPx);
        Assert.Equal(1686, theWeave.WorldHeightPx);

        Assert.Empty(ProjectValidator.Validate(project, SnapshotDir));
    }

    [Fact]
    public void UpgradingTheRealProjectFile_KeepsLocationsOnTheSquaresTheyWereOver_AndReportsTheRest()
    {
        var project = WeaveProjectSerializer.LoadFromFile(Path.Combine(SnapshotDir, "project.json"), out var notes);

        var ouros = project.Pages.Single(p => p.Id == "ouros");
        var grid = GridLayout.For(ouros, project);

        // Salanth Town Gardens was already over A0; the return node just clamps there, so it yields.
        Assert.Equal(new GridCell(0, 0), grid.CellOf(ouros.Nodes.Single(n => n.Id == "salanth-town-gardens")));
        Assert.Equal(new GridCell(0, 1), grid.CellOf(ouros.Nodes.Single(n => n.Id == "the-weave-sector-a-6")));
        // Unremarkable nodes just land on the square they were over.
        Assert.Equal(new GridCell(10, 6), grid.CellOf(ouros.Nodes.Single(n => n.Id == "irf-outpost")));

        Assert.Contains(notes!, n => n.StartsWith("Ouros") && n.Contains("moved to A1") && n.Contains("A0 was already taken"));
        Assert.Contains(notes!, n => n.StartsWith("Ouros") && n.Contains("moved to S0") && n.Contains("outside the grid"));
    }

    [Fact]
    public void UpgradingTwice_ChangesNothing()
    {
        var once = WeaveProjectSerializer.LoadFromFile(Path.Combine(SnapshotDir, "project.json"));
        var serialized = WeaveProjectSerializer.Serialize(once);

        var twice = WeaveProjectSerializer.Deserialize(serialized, out var notes);

        Assert.Null(notes);
        Assert.Equal(serialized, WeaveProjectSerializer.Serialize(twice));
    }

    [Fact]
    public async Task ImportedChildNodes_RenderOnTopOfTheirParent()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");
        ProjectMigrations.Upgrade(result.Project);

        using var outputDir = new TempDirectory();
        new SiteExporter().Export(result.Project, outputDir.Path, SnapshotDir);

        var html = await File.ReadAllTextAsync(Path.Combine(outputDir.Path, "ouros.html"));
        Assert.Contains("left: -81px; top: 129px;", html);
        Assert.DoesNotContain("top: 193px;", html);
    }

    [Fact]
    public async Task ImportThenExport_PreservesEveryPageAndEveryNode()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");

        using var outputDir = new TempDirectory();
        new SiteExporter().Export(result.Project, outputDir.Path, SnapshotDir);

        foreach (var page in result.Project.Pages)
        {
            var originalPath = Path.Combine(SnapshotDir, page.OutputFileName);
            var exportedPath = Path.Combine(outputDir.Path, page.OutputFileName);

            Assert.True(File.Exists(exportedPath), $"Expected {page.OutputFileName} to be exported.");

            var originalNodeCount = NodeTag.Matches(await File.ReadAllTextAsync(originalPath)).Count;
            var exportedNodeCount = NodeTag.Matches(await File.ReadAllTextAsync(exportedPath)).Count;

            Assert.True(
                originalNodeCount == exportedNodeCount,
                $"{page.OutputFileName}: original had {originalNodeCount} nodes, export has {exportedNodeCount}.");
        }
    }

    // A regex node count (the test above) can't tell a genuine top-level sibling from one that
    // got HTML-parsed as a descendant of the previous node's still-open .floatInfo - a real bug
    // once found where every top-level node after the first compounded its effective on-page
    // position, invisible to a text-level count or a raw left/top string comparison. This
    // re-parses the exported HTML the same way a browser would and checks actual DOM structure:
    // every node the project models as top-level must render as a direct child of <body>.
    [Fact]
    public async Task ImportThenExport_TopLevelNodesRenderAsDirectChildrenOfBody_NotNestedInEachOther()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");

        using var outputDir = new TempDirectory();
        new SiteExporter().Export(result.Project, outputDir.Path, SnapshotDir);

        var browsingContext = BrowsingContext.New(Configuration.Default);

        foreach (var page in result.Project.Pages)
        {
            var exportedPath = Path.Combine(outputDir.Path, page.OutputFileName);
            var html = await File.ReadAllTextAsync(exportedPath);
            var document = await browsingContext.OpenAsync(req => req.Content(html));

            var topLevelNodeCount = document.Body!.Children
                .Count(c => c.LocalName == "div" && c.ClassList.Contains("node"));

            Assert.True(
                page.Nodes.Count == topLevelNodeCount,
                $"{page.OutputFileName}: project has {page.Nodes.Count} top-level nodes, " +
                $"but only {topLevelNodeCount} render as direct children of <body> - the rest " +
                "got swallowed as descendants of an earlier node's unclosed .floatInfo.");
        }
    }

    [Fact]
    public async Task ImportThenExport_ShrinePage_PreservesBothEffectTypes()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");

        using var outputDir = new TempDirectory();
        new SiteExporter().Export(result.Project, outputDir.Path, SnapshotDir);

        var exportedHtml = await File.ReadAllTextAsync(Path.Combine(outputDir.Path, "shrines-layer-0001.html"));

        Assert.Contains("id=\"bgmap2\"", exportedHtml);
        Assert.Contains("\"type\":\"crossfade\"", exportedHtml);
        // Two hand-authored flame sprites on the real page.
        Assert.Equal(2, Regex.Matches(exportedHtml, "\"type\":\"drift\"").Count);
    }

    [Fact]
    public async Task ImportThenExport_EveryExportedPage_ReferencesTheSharedRuntimeWithShipNavigation()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(SnapshotDir, "The Weave");

        using var outputDir = new TempDirectory();
        new SiteExporter().Export(result.Project, outputDir.Path, SnapshotDir);

        var js = await File.ReadAllTextAsync(Path.Combine(outputDir.Path, "jsx", "main.js"));
        Assert.Contains("applyPageEffects", js);
        Assert.Contains("dataset.persistent", js);

        var css = await File.ReadAllTextAsync(Path.Combine(outputDir.Path, "css", "main.css"));
        Assert.Contains(".playerShip", css);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"weave-roundtrip-{Guid.NewGuid():N}");

        public TempDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            if (Directory.Exists(Path))
                Directory.Delete(Path, recursive: true);
        }
    }
}
