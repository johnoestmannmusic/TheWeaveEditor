using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;
using TheWeave.Core.Validation;
using Xunit;

namespace TheWeave.Core.Tests;

public class ProjectValidatorTests
{
    private static Page MakePage(string id, params Node[] nodes) => new()
    {
        Id = id,
        Title = id,
        OutputFileName = $"{id}.html",
        Background = new ImageRef { ImagePath = $"img/{id}/{id}.png" },
        Nodes = nodes.ToList(),
    };

    [Fact]
    public void ValidProject_HasNoIssues()
    {
        var project = new WeaveProject
        {
            Pages =
            {
                MakePage("index"),
                MakePage("ouros", new Node
                {
                    Id = "shrine-of-zadra",
                    Card = new Card { HeadingText = "Shrine of Zadra", Action = new CardAction { Kind = ActionKind.None } },
                }),
            },
        };

        var issues = ProjectValidator.Validate(project);

        Assert.Empty(issues);
    }

    [Fact]
    public void DuplicatePageId_IsReportedAsError()
    {
        var project = new WeaveProject
        {
            Pages = { MakePage("ouros"), MakePage("ouros") },
        };

        var issues = ProjectValidator.Validate(project);

        Assert.Contains(issues, i => i.Severity == ValidationSeverity.Error && i.Message.Contains("Duplicate page id"));
    }

    [Fact]
    public void DuplicateNodeId_AcrossPages_IsReportedAsError()
    {
        var node1 = new Node { Id = "dup", Card = new Card { HeadingText = "A" } };
        var node2 = new Node { Id = "dup", Card = new Card { HeadingText = "B" } };

        var project = new WeaveProject
        {
            Pages = { MakePage("a", node1), MakePage("b", node2) },
        };

        var issues = ProjectValidator.Validate(project);

        Assert.Contains(issues, i => i.Severity == ValidationSeverity.Error && i.Message.Contains("Duplicate node id 'dup'"));
    }

    [Fact]
    public void DuplicateNodeId_InNestedChild_IsDetected()
    {
        var parent = new Node
        {
            Id = "parent",
            Card = new Card { HeadingText = "Parent" },
            Children = { new Node { Id = "parent", Card = new Card { HeadingText = "Nested dup" } } },
        };

        var project = new WeaveProject { Pages = { MakePage("a", parent) } };

        var issues = ProjectValidator.Validate(project);

        Assert.Contains(issues, i => i.Message.Contains("Duplicate node id 'parent'"));
    }

    [Fact]
    public void TravelAction_ToMissingPage_IsReportedAsError()
    {
        var node = new Node
        {
            Id = "hub",
            Card = new Card { HeadingText = "Pentura", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "does-not-exist" } },
        };

        var project = new WeaveProject { Pages = { MakePage("index", node) } };

        var issues = ProjectValidator.Validate(project);

        Assert.Contains(issues, i => i.Severity == ValidationSeverity.Error && i.Message.Contains("travels to missing page"));
    }

    [Fact]
    public void TravelAction_ToExistingPage_IsValid()
    {
        var node = new Node
        {
            Id = "hub",
            Card = new Card { HeadingText = "Pentura", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "pentura" } },
        };

        var project = new WeaveProject { Pages = { MakePage("index", node), MakePage("pentura") } };

        var issues = ProjectValidator.Validate(project);

        Assert.DoesNotContain(issues, i => i.Message.Contains("travels to missing page"));
    }

    [Fact]
    public void MissingAssetFiles_AreReportedAsWarnings_WhenBasePathGiven()
    {
        var node = new Node
        {
            Id = "loc",
            Card = new Card { HeadingText = "Loc", CoverImagePath = "img/does-not-exist.png" },
        };

        var project = new WeaveProject { Pages = { MakePage("a", node) } };

        using var tempDir = new TempDirectory();
        var issues = ProjectValidator.Validate(project, tempDir.Path);

        Assert.Contains(issues, i => i.Severity == ValidationSeverity.Warning && i.Message.Contains("Cover image not found"));
        Assert.Contains(issues, i => i.Message.Contains("Background image not found"));
    }

    [Fact]
    public void DriftingSpriteEffect_WithNoAxes_IsReportedAsWarning()
    {
        var page = MakePage("shrine");
        page.Effects.Add(new DriftingSpriteEffect { Id = "fx", ImagePath = "img/flame.gif" });

        var project = new WeaveProject { Pages = { page } };

        var issues = ProjectValidator.Validate(project);

        Assert.Contains(issues, i => i.Message.Contains("won't move"));
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"weave-test-{Guid.NewGuid():N}");

        public TempDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            if (Directory.Exists(Path))
                Directory.Delete(Path, recursive: true);
        }
    }
}
