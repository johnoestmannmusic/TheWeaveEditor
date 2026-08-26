using TheWeave.Core.Model;
using Xunit;

namespace TheWeave.Exporter.Tests;

public class SiteExporterTests
{
    [Fact]
    public void Export_WritesOnePageAndTheSharedRuntime()
    {
        var project = new WeaveProject { Title = "Test" };
        project.Pages.Add(new Page
        {
            Id = "index",
            Title = "Index",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/x.png" },
        });

        using var outDir = new TempDirectory();

        new SiteExporter().Export(project, outDir.Path);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "index.html")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "css", "main.css")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "jsx", "main.js")));

        var js = File.ReadAllText(Path.Combine(outDir.Path, "jsx", "main.js"));
        Assert.Contains("applyPageEffects", js);
        Assert.Contains("dataset.persistent", js);
    }

    [Fact]
    public void Export_WithContentSourceRoot_CopiesImgAndFntDirectories()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page
        {
            Id = "index",
            Title = "Index",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/x.png" },
        });

        using var srcDir = new TempDirectory();
        using var outDir = new TempDirectory();

        var imgDir = Path.Combine(srcDir.Path, "img", "sub");
        Directory.CreateDirectory(imgDir);
        File.WriteAllText(Path.Combine(imgDir, "x.png"), "fake-png-bytes");

        var fntDir = Path.Combine(srcDir.Path, "fnt");
        Directory.CreateDirectory(fntDir);
        File.WriteAllText(Path.Combine(fntDir, "Medodica.otf"), "fake-font-bytes");

        new SiteExporter().Export(project, outDir.Path, srcDir.Path);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "img", "sub", "x.png")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "fnt", "Medodica.otf")));
    }

    // Regression test for a real bug: a cover image picked (via the Inspector's file dialog)
    // from outside the project's own content folder gets stored as a path that climbs out via
    // "../" - AssetCopier's wholesale copy of Assets.ImgRoot never reaches it, so it exported
    // as a broken image link. The exporter now copies every individually-referenced image
    // (cover images, backgrounds, effect sprites) directly, regardless of where it lives.
    [Fact]
    public void Export_CoverImageOutsideContentRoot_IsCopiedIntoExportAndReferencePointsAtIt()
    {
        using var outerDir = new TempDirectory();
        var srcDir = Path.Combine(outerDir.Path, "project");
        var elsewhereDir = Path.Combine(outerDir.Path, "elsewhere");
        Directory.CreateDirectory(srcDir);
        Directory.CreateDirectory(elsewhereDir);
        File.WriteAllText(Path.Combine(elsewhereDir, "cover.png"), "fake-png-bytes");

        var project = new WeaveProject();
        var page = new Page
        {
            Id = "index",
            Title = "Index",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/bg.png" },
        };
        page.Nodes.Add(new Node
        {
            Id = "salmon-town",
            Card = new Card { HeadingText = "SALMON TOWN", CoverImagePath = "../elsewhere/cover.png" },
        });
        project.Pages.Add(page);

        using var outDir = new TempDirectory();

        new SiteExporter().Export(project, outDir.Path, srcDir);

        var html = File.ReadAllText(Path.Combine(outDir.Path, "index.html"));
        Assert.DoesNotContain("../elsewhere/cover.png", html);
        Assert.Contains("img/imported/cover.png", html);
        Assert.True(File.Exists(Path.Combine(outDir.Path, "img", "imported", "cover.png")));
    }

    [Fact]
    public void Export_RemovesStaleImageNoLongerReferenced_ButKeepsUnrelatedFilesInOutputDir()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page
        {
            Id = "index",
            Title = "Index",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/current.png" },
        });

        using var srcDir = new TempDirectory();
        using var outDir = new TempDirectory();

        var imgDir = Path.Combine(srcDir.Path, "img");
        Directory.CreateDirectory(imgDir);
        File.WriteAllText(Path.Combine(imgDir, "current.png"), "current-bytes");

        // A leftover from a previous export - not present in the source content root anymore,
        // and nothing in the project references it.
        Directory.CreateDirectory(Path.Combine(outDir.Path, "img"));
        File.WriteAllText(Path.Combine(outDir.Path, "img", "orphaned.png"), "stale-bytes");

        // Something unrelated to the exporter's own output that just happens to live in the
        // same folder - must never be touched by cleanup.
        File.WriteAllText(Path.Combine(outDir.Path, "notes.txt"), "keep me");
        Directory.CreateDirectory(Path.Combine(outDir.Path, "unrelated-folder"));
        File.WriteAllText(Path.Combine(outDir.Path, "unrelated-folder", "keep.txt"), "keep me too");

        new SiteExporter().Export(project, outDir.Path, srcDir.Path);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "img", "current.png")));
        Assert.False(File.Exists(Path.Combine(outDir.Path, "img", "orphaned.png")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "notes.txt")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "unrelated-folder", "keep.txt")));
    }

    [Fact]
    public void Export_RemovesStaleHtmlForARenamedOrDeletedPage()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page
        {
            Id = "index",
            Title = "Index",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/x.png" },
        });

        using var outDir = new TempDirectory();
        // Simulates a previous export that included a page since renamed/deleted.
        File.WriteAllText(Path.Combine(outDir.Path, "old-page.html"), "<html>stale</html>");

        using var srcDir = new TempDirectory();
        new SiteExporter().Export(project, outDir.Path, srcDir.Path);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "index.html")));
        Assert.False(File.Exists(Path.Combine(outDir.Path, "old-page.html")));
    }

    [Fact]
    public void Export_WithNoContentSourceRoot_SkipsCleanupEntirely()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page
        {
            Id = "index",
            Title = "Index",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/x.png" },
        });

        using var outDir = new TempDirectory();
        File.WriteAllText(Path.Combine(outDir.Path, "old-page.html"), "<html>stale</html>");

        new SiteExporter().Export(project, outDir.Path); // no contentSourceRoot

        // Nothing is known about what "should" exist without a content root, so cleanup - which
        // needs that context to be safe - doesn't run at all rather than guessing.
        Assert.True(File.Exists(Path.Combine(outDir.Path, "old-page.html")));
    }

    [Fact]
    public void Export_WithHomePageId_WritesShellAtIndexAndHomePageAtFixedFileName()
    {
        var project = new WeaveProject { Title = "The Weave", HomePageId = "ouros", BackgroundMusicPath = "DISCOVERYSQUAD.ogg" };
        project.Pages.Add(new Page
        {
            Id = "ouros",
            Title = "Ouros",
            OutputFileName = "ouros.html", // ignored in favor of the shell's fixed home filename
            Background = new ImageRef { ImagePath = "img/ouros.png" },
        });

        using var outDir = new TempDirectory();

        new SiteExporter().Export(project, outDir.Path);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "index.html")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "theweave.html")));
        Assert.False(File.Exists(Path.Combine(outDir.Path, "ouros.html")));

        var shell = File.ReadAllText(Path.Combine(outDir.Path, "index.html"));
        Assert.Contains("id=\"weaveStage\" src=\"theweave.html\"", shell);
        // The shell's site-wide background track is intentionally disabled (see
        // ShellRenderer) in favor of location-zoned audio - never emitted even when
        // BackgroundMusicPath is set.
        Assert.DoesNotContain("weaveBgMusic", shell);
        Assert.Contains("jsx/shell.js", shell);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "jsx", "shell.js")));
    }

    [Fact]
    public void Export_WithoutHomePageId_NeverWritesAShell()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page
        {
            Id = "ouros",
            Title = "Ouros",
            OutputFileName = "ouros.html",
            Background = new ImageRef { ImagePath = "img/ouros.png" },
        });

        using var outDir = new TempDirectory();

        new SiteExporter().Export(project, outDir.Path);

        Assert.False(File.Exists(Path.Combine(outDir.Path, "index.html")));
        Assert.True(File.Exists(Path.Combine(outDir.Path, "ouros.html")));
    }

    [Fact]
    public void Export_HomePageId_CopiesMusRootDirectory()
    {
        var project = new WeaveProject { HomePageId = "ouros", BackgroundMusicPath = "DISCOVERYSQUAD.ogg" };
        project.Pages.Add(new Page
        {
            Id = "ouros",
            Title = "Ouros",
            OutputFileName = "ouros.html",
            Background = new ImageRef { ImagePath = "img/ouros.png" },
        });

        using var srcDir = new TempDirectory();
        using var outDir = new TempDirectory();

        var musDir = Path.Combine(srcDir.Path, "mus");
        Directory.CreateDirectory(musDir);
        File.WriteAllText(Path.Combine(musDir, "DISCOVERYSQUAD.ogg"), "fake-ogg-bytes");

        new SiteExporter().Export(project, outDir.Path, srcDir.Path);

        Assert.True(File.Exists(Path.Combine(outDir.Path, "mus", "DISCOVERYSQUAD.ogg")));
    }

    [Fact]
    public void Export_HomePageId_ConflictingIndexHtmlPageThrows()
    {
        var project = new WeaveProject { HomePageId = "ouros" };
        project.Pages.Add(new Page
        {
            Id = "ouros",
            Title = "Ouros",
            OutputFileName = "ouros.html",
            Background = new ImageRef { ImagePath = "img/ouros.png" },
        });
        project.Pages.Add(new Page
        {
            Id = "azurus",
            Title = "Azurus",
            OutputFileName = "index.html", // collides with the shell's own reserved filename
            Background = new ImageRef { ImagePath = "img/azurus.png" },
        });

        using var outDir = new TempDirectory();

        Assert.Throws<InvalidOperationException>(() => new SiteExporter().Export(project, outDir.Path));
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"weave-export-test-{Guid.NewGuid():N}");

        public TempDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            if (Directory.Exists(Path))
                Directory.Delete(Path, recursive: true);
        }
    }
}
