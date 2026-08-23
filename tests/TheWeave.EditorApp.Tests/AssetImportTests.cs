using TheWeave.Core.Model;
using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

public class AssetImportTests
{
    [Fact]
    public void ResolveDestination_FileAlreadyInsideContentRoot_ReturnsItsExistingRelativePath()
    {
        using var contentRoot = new TempDirectory();
        var existing = Path.Combine(contentRoot.Path, "img", "ouros", "ouros.png");
        Directory.CreateDirectory(Path.GetDirectoryName(existing)!);
        File.WriteAllText(existing, "bytes");

        var result = AssetImport.ResolveDestination(contentRoot.Path, "img", existing, "index", "some-node");

        Assert.Equal("img/ouros/ouros.png", result);
        // Doesn't touch the file just because it was "resolved".
        Assert.Single(Directory.GetFiles(Path.Combine(contentRoot.Path, "img", "ouros")));
    }

    [Fact]
    public void ResolveDestination_FileOutsideContentRoot_UsesPageIdAndNodeSlug()
    {
        using var outer = new TempDirectory();
        var contentRoot = Path.Combine(outer.Path, "project");
        var elsewhere = Path.Combine(outer.Path, "elsewhere");
        Directory.CreateDirectory(contentRoot);
        Directory.CreateDirectory(elsewhere);
        var source = Path.Combine(elsewhere, "photo.png");
        File.WriteAllText(source, "bytes");

        var result = AssetImport.ResolveDestination(contentRoot, "img", source, "index", "salmon-town");

        Assert.Equal("img/index/salmon-town.png", result);
    }

    [Fact]
    public void ResolveDestination_NoPageOrNodeContext_FallsBackToImportedAndSourceFileName()
    {
        using var outer = new TempDirectory();
        var contentRoot = Path.Combine(outer.Path, "project");
        var elsewhere = Path.Combine(outer.Path, "elsewhere");
        Directory.CreateDirectory(contentRoot);
        Directory.CreateDirectory(elsewhere);
        var source = Path.Combine(elsewhere, "photo.png");
        File.WriteAllText(source, "bytes");

        var result = AssetImport.ResolveDestination(contentRoot, "img", source, pageFolderId: null, nodeSlug: null);

        Assert.Equal("img/imported/photo.png", result);
    }

    [Fact]
    public void FindAvailableDestination_NameTakenByADifferentFile_AppendsNumericSuffix()
    {
        using var contentRoot = new TempDirectory();
        var takenDir = Path.Combine(contentRoot.Path, "img", "index");
        Directory.CreateDirectory(takenDir);
        File.WriteAllText(Path.Combine(takenDir, "salmon-town.png"), "different-bytes");

        var source = Path.Combine(contentRoot.Path, "source.png");
        File.WriteAllText(source, "new-bytes");

        var result = AssetImport.FindAvailableDestination(contentRoot.Path, "img/index", "salmon-town", ".png", source);

        Assert.Equal("img/index/salmon-town-2.png", result);
    }

    [Fact]
    public void FindAvailableDestination_NameTakenByTheSameContent_ReusesItRatherThanDuplicating()
    {
        using var contentRoot = new TempDirectory();
        var takenDir = Path.Combine(contentRoot.Path, "img", "index");
        Directory.CreateDirectory(takenDir);
        var existingBytes = "identical-bytes";
        File.WriteAllText(Path.Combine(takenDir, "salmon-town.png"), existingBytes);

        var source = Path.Combine(contentRoot.Path, "source.png");
        File.WriteAllText(source, existingBytes);

        var result = AssetImport.FindAvailableDestination(contentRoot.Path, "img/index", "salmon-town", ".png", source);

        Assert.Equal("img/index/salmon-town.png", result);
    }

    [Fact]
    public void RenameCoverImageIfOwned_CoverMatchesOldId_RenamesFileAndReturnsNewPath()
    {
        using var contentRoot = new TempDirectory();
        var dir = Path.Combine(contentRoot.Path, "img", "index");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "salmon-town.png"), "bytes");

        var project = new WeaveProject();
        var page = new Page { Id = "index", Title = "Index", OutputFileName = "index.html" };
        var node = new Node { Id = "salmontown", Card = new Card { HeadingText = "Salmon Town", CoverImagePath = "img/index/salmon-town.png" } };
        page.Nodes.Add(node);
        project.Pages.Add(page);

        var result = AssetImport.RenameCoverImageIfOwned(contentRoot.Path, project, node, oldId: "salmon-town");

        Assert.Equal("img/index/salmontown.png", result);
        Assert.False(File.Exists(Path.Combine(dir, "salmon-town.png")));
        Assert.True(File.Exists(Path.Combine(dir, "salmontown.png")));
    }

    [Fact]
    public void RenameCoverImageIfOwned_CoverSharedWithAnotherNode_LeavesFileAlone()
    {
        using var contentRoot = new TempDirectory();
        var dir = Path.Combine(contentRoot.Path, "img", "index");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "salmon-town.png"), "bytes");

        var project = new WeaveProject();
        var page = new Page { Id = "index", Title = "Index", OutputFileName = "index.html" };
        var node = new Node { Id = "salmontown", Card = new Card { HeadingText = "Salmon Town", CoverImagePath = "img/index/salmon-town.png" } };
        var otherNode = new Node { Id = "other", Card = new Card { HeadingText = "Other", CoverImagePath = "img/index/salmon-town.png" } };
        page.Nodes.Add(node);
        page.Nodes.Add(otherNode);
        project.Pages.Add(page);

        var result = AssetImport.RenameCoverImageIfOwned(contentRoot.Path, project, node, oldId: "salmon-town");

        Assert.Null(result);
        Assert.True(File.Exists(Path.Combine(dir, "salmon-town.png"))); // untouched
    }

    [Fact]
    public void RenameCoverImageIfOwned_CoverDoesNotMatchOldId_LeavesFileAlone()
    {
        using var contentRoot = new TempDirectory();
        var dir = Path.Combine(contentRoot.Path, "img", "index");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "hand-picked-name.png"), "bytes");

        var project = new WeaveProject();
        var page = new Page { Id = "index", Title = "Index", OutputFileName = "index.html" };
        var node = new Node { Id = "salmontown", Card = new Card { HeadingText = "Salmon Town", CoverImagePath = "img/index/hand-picked-name.png" } };
        page.Nodes.Add(node);
        project.Pages.Add(page);

        var result = AssetImport.RenameCoverImageIfOwned(contentRoot.Path, project, node, oldId: "salmon-town");

        Assert.Null(result);
        Assert.True(File.Exists(Path.Combine(dir, "hand-picked-name.png")));
    }

    [Fact]
    public void ResolveRootRelativeDestination_FileAlreadyInsideRoot_ReturnsPathRelativeToRoot()
    {
        using var contentRoot = new TempDirectory();
        var existing = Path.Combine(contentRoot.Path, "mus", "DISCOVERYSQUAD.ogg");
        Directory.CreateDirectory(Path.GetDirectoryName(existing)!);
        File.WriteAllText(existing, "bytes");

        var result = AssetImport.ResolveRootRelativeDestination(contentRoot.Path, "mus", existing);

        Assert.Equal("DISCOVERYSQUAD.ogg", result); // not "mus/DISCOVERYSQUAD.ogg" - relative to root, not contentRoot
    }

    [Fact]
    public void ResolveRootRelativeDestination_FileOutsideRoot_UsesFlatSourceFileName()
    {
        using var outer = new TempDirectory();
        var contentRoot = Path.Combine(outer.Path, "project");
        var elsewhere = Path.Combine(outer.Path, "elsewhere");
        Directory.CreateDirectory(contentRoot);
        Directory.CreateDirectory(elsewhere);
        var source = Path.Combine(elsewhere, "track.ogg");
        File.WriteAllText(source, "bytes");

        var result = AssetImport.ResolveRootRelativeDestination(contentRoot, "mus", source);

        Assert.Equal("track.ogg", result);
    }

    [Fact]
    public void ResolveRootRelativeDestination_NameCollisionWithDifferentFile_GetsSuffixed()
    {
        using var contentRoot = new TempDirectory();
        var musDir = Path.Combine(contentRoot.Path, "mus");
        Directory.CreateDirectory(musDir);
        File.WriteAllText(Path.Combine(musDir, "track.ogg"), "existing-bytes");

        using var elsewhere = new TempDirectory();
        var source = Path.Combine(elsewhere.Path, "track.ogg");
        File.WriteAllText(source, "different-bytes");

        var result = AssetImport.ResolveRootRelativeDestination(contentRoot.Path, "mus", source);

        Assert.Equal("track-2.ogg", result);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"weave-assetimport-test-{Guid.NewGuid():N}");

        public TempDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            if (Directory.Exists(Path))
                Directory.Delete(Path, recursive: true);
        }
    }
}
