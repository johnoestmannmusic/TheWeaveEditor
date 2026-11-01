using TheWeave.Core.Model;
using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

public class ProjectEditingTests
{
    private static WeaveProject MakeProjectWithNestedNodes()
    {
        var project = new WeaveProject();
        var page = new Page { Id = "ouros", Title = "Ouros", OutputFileName = "ouros.html" };

        var parent = new Node
        {
            Id = "salanth-town-gardens",
            Card = new Card { HeadingText = "Salanth Town Gardens" },
            Children =
            {
                new Node { Id = "jherop-phantom", Card = new Card { HeadingText = "Jherop Phantom" } },
            },
        };

        page.Nodes.Add(parent);
        project.Pages.Add(page);
        return project;
    }

    [Fact]
    public void FindNode_FindsTopLevelNode()
    {
        var project = MakeProjectWithNestedNodes();
        var found = ProjectEditing.FindNode(project.Pages[0].Nodes, "salanth-town-gardens");

        Assert.NotNull(found);
        Assert.Equal("Salanth Town Gardens", found!.Card.HeadingText);
    }

    [Fact]
    public void FindNode_FindsNestedNode()
    {
        var project = MakeProjectWithNestedNodes();
        var found = ProjectEditing.FindNode(project.Pages[0].Nodes, "jherop-phantom");

        Assert.NotNull(found);
        Assert.Equal("Jherop Phantom", found!.Card.HeadingText);
    }

    [Fact]
    public void FindNode_ReturnsNull_WhenNotFound()
    {
        var project = MakeProjectWithNestedNodes();
        Assert.Null(ProjectEditing.FindNode(project.Pages[0].Nodes, "does-not-exist"));
    }

    [Fact]
    public void RemoveNode_RemovesTopLevelNode()
    {
        var project = MakeProjectWithNestedNodes();
        var removed = ProjectEditing.RemoveNode(project.Pages[0].Nodes, "salanth-town-gardens");

        Assert.True(removed);
        Assert.Empty(project.Pages[0].Nodes);
    }

    [Fact]
    public void RemoveNode_RemovesNestedNode_LeavingParentIntact()
    {
        var project = MakeProjectWithNestedNodes();
        var removed = ProjectEditing.RemoveNode(project.Pages[0].Nodes, "jherop-phantom");

        Assert.True(removed);
        var parent = Assert.Single(project.Pages[0].Nodes);
        Assert.Empty(parent.Children);
    }

    [Fact]
    public void RemoveNode_ReturnsFalse_WhenNotFound()
    {
        var project = MakeProjectWithNestedNodes();
        Assert.False(ProjectEditing.RemoveNode(project.Pages[0].Nodes, "does-not-exist"));
    }

    [Fact]
    public void AddNode_TopLevel_GeneratesUniqueSlugFromDefaultSeed()
    {
        var project = MakeProjectWithNestedNodes();
        var node = ProjectEditing.AddNode(project, project.Pages[0], parentNodeId: null);

        Assert.Equal("new-location", node.Id);
        Assert.Contains(node, project.Pages[0].Nodes);
    }

    [Fact]
    public void AddNode_Nested_AddsToParentChildren()
    {
        var project = MakeProjectWithNestedNodes();
        var node = ProjectEditing.AddNode(project, project.Pages[0], parentNodeId: "salanth-town-gardens");

        var parent = ProjectEditing.FindNode(project.Pages[0].Nodes, "salanth-town-gardens")!;
        Assert.Contains(node, parent.Children);
    }

    [Fact]
    public void AddNode_DeduplicatesIdAcrossWholeProject_NotJustOnePage()
    {
        var project = MakeProjectWithNestedNodes();
        var second = new Page { Id = "pentura", Title = "Pentura", OutputFileName = "pentura.html" };
        project.Pages.Add(second);

        var first = ProjectEditing.AddNode(project, project.Pages[0], null);
        var duplicate = ProjectEditing.AddNode(project, second, null);

        Assert.Equal("new-location", first.Id);
        Assert.Equal("new-location-2", duplicate.Id);
    }

    [Fact]
    public void AddPage_GeneratesIdFromTitle_AndDefaultsFileNameAndBackground()
    {
        var project = new WeaveProject();
        var page = ProjectEditing.AddPage(project, "My New Planet", outputFileName: null, backgroundImagePath: null);

        Assert.Equal("my-new-planet", page.Id);
        Assert.Equal("my-new-planet.html", page.OutputFileName);
        Assert.Equal("img/placeholder.png", page.Background.ImagePath);
    }

    [Fact]
    public void AddPage_DeduplicatesId()
    {
        var project = new WeaveProject();
        var first = ProjectEditing.AddPage(project, "Ouros", null, null);
        var second = ProjectEditing.AddPage(project, "Ouros", null, null);

        Assert.Equal("ouros", first.Id);
        Assert.Equal("ouros-2", second.Id);
    }

    [Fact]
    public void ApplyNodeEdit_UpdatesCoreFields()
    {
        var node = new Node { Card = new Card() };
        var page = new Page { Nodes = { node } };
        var project = new WeaveProject { Pages = { page } };
        var edit = new NodeEditRequest
        {
            X = 501,
            Y = 351,
            Persistent = true,
            IconStyle = "Race",
            CardSize = "Hub",
            HeadingText = "Edited Heading",
            CoverImagePath = "img/edited.png",
            AudioUrl = "https://example.com/track.ogg",
            PoetryLines = new List<string> { "Line one", "**Line two**" },
            ActionKind = "Travel",
            TargetPageId = "pentura",
            TravelSpawnX = 10,
            TravelSpawnY = 20,
            TravelSkipTutorial = true,
        };

        ProjectEditing.ApplyNodeEdit(project, page, node, edit);

        Assert.Equal(501, node.X);
        Assert.Equal(351, node.Y);
        Assert.True(node.Persistent);
        Assert.Equal(IconStyle.Race, node.IconStyle);
        Assert.Equal(CardSize.Hub, node.Card.Size);
        Assert.Equal("Edited Heading", node.Card.HeadingText);
        Assert.Equal("img/edited.png", node.Card.CoverImagePath);
        Assert.Equal("https://example.com/track.ogg", node.Card.Audio?.Url);
        Assert.Equal(2, node.Card.PoetryLines.Count);
        Assert.Equal(ActionKind.Travel, node.Card.Action.Kind);
        Assert.Equal("pentura", node.Card.Action.TargetPageId);
        Assert.Equal(10, node.Card.Action.TravelSpawnX);
        Assert.True(node.Card.Action.TravelSkipTutorial);
    }

    [Fact]
    public void ApplyNodeEdit_BlankCoverAndAudio_ClearsThemRatherThanStoringEmptyStrings()
    {
        var node = new Node
        {
            Card = new Card
            {
                CoverImagePath = "img/old.png",
                Audio = new AudioRef { Url = "https://old.example.com" },
            },
        };

        var page = new Page { Nodes = { node } };
        ProjectEditing.ApplyNodeEdit(new WeaveProject { Pages = { page } }, page, node, new NodeEditRequest { CoverImagePath = "  ", AudioUrl = "" });

        Assert.Null(node.Card.CoverImagePath);
        Assert.Null(node.Card.Audio);
    }

    [Fact]
    public void ApplyNodeEdit_TopLevel_SnapsToTheCenterOfWhicheverSquareItLandsIn()
    {
        var node = new Node();
        var page = new Page { Nodes = { node } };

        ProjectEditing.ApplyNodeEdit(new WeaveProject { Pages = { page } }, page, node, new NodeEditRequest { X = 530, Y = 330 });

        Assert.Equal(501, node.X); // column C: icon centered at 525
        Assert.Equal(351, node.Y); // row 1: icon centered at 375
    }

    [Fact]
    public void ApplyNodeEdit_SquareAlreadyTaken_ThrowsAndLeavesTheNodeUntouched()
    {
        var other = new Node { X = 501, Y = 351, Card = new Card { HeadingText = "Other" } };
        var node = new Node { X = 201, Y = 201, Card = new Card { HeadingText = "Original" } };
        var page = new Page { Nodes = { other, node } };
        var edit = new NodeEditRequest { X = 501, Y = 351, HeadingText = "Edited" };

        var ex = Assert.Throws<InvalidOperationException>(() =>
            ProjectEditing.ApplyNodeEdit(new WeaveProject { Pages = { page } }, page, node, edit));

        Assert.Contains("C1", ex.Message);
        Assert.Contains("Other", ex.Message);
        Assert.Equal(201, node.X);
        Assert.Equal("Original", node.Card.HeadingText);
    }

    [Fact]
    public void ApplyNodeEdit_KeepingItsOwnSquare_IsNotAConflict()
    {
        var node = new Node { X = 201, Y = 201 };
        var page = new Page { Nodes = { node } };

        ProjectEditing.ApplyNodeEdit(new WeaveProject { Pages = { page } }, page, node, new NodeEditRequest { X = 201, Y = 201, HeadingText = "Edited" });

        Assert.Equal("Edited", node.Card.HeadingText);
    }

    [Fact]
    public void ApplyNodeEdit_NestedNode_IsNotHeldToTheGrid()
    {
        var child = new Node { X = -81, Y = 129 };
        var parent = new Node { X = 201, Y = 201, Children = { child } };
        var page = new Page { Nodes = { parent } };

        ProjectEditing.ApplyNodeEdit(new WeaveProject { Pages = { page } }, page, child, new NodeEditRequest { X = -81, Y = 129 });

        Assert.Equal(-81, child.X);
        Assert.Equal(129, child.Y);
    }

    [Fact]
    public void AddNode_AtAPosition_LandsInThatSquare()
    {
        var page = new Page();
        var node = ProjectEditing.AddNode(new WeaveProject { Pages = { page } }, page, null, 530, 330);

        Assert.Equal(501, node.X);
        Assert.Equal(351, node.Y);
    }

    [Fact]
    public void AddNode_AtATakenSquare_ThrowsWithoutAddingAnything()
    {
        var page = new Page { Nodes = { new Node { X = 501, Y = 351 } } };

        Assert.Throws<InvalidOperationException>(() =>
            ProjectEditing.AddNode(new WeaveProject { Pages = { page } }, page, null, 530, 330));

        Assert.Single(page.Nodes);
    }

    [Fact]
    public void AddNode_WithNoPosition_TakesTheFirstFreeSquare()
    {
        var page = new Page { Nodes = { new Node { X = 201, Y = 201 } } };
        var node = ProjectEditing.AddNode(new WeaveProject { Pages = { page } }, page, null);

        Assert.Equal(351, node.X); // B0: A0 is taken
        Assert.Equal(201, node.Y);
    }

    [Fact]
    public void ApplyPageEdit_OnlyOverwritesNonBlankFields()
    {
        var page = new Page
        {
            Id = "ouros",
            Title = "Ouros",
            OutputFileName = "ouros.html",
            Background = new ImageRef { ImagePath = "img/ouros/ouros.png" },
        };
        var project = new WeaveProject();
        project.Pages.Add(page);

        ProjectEditing.ApplyPageEdit(project, page, new PageEditRequest { Title = "Ouros Renamed", OutputFileName = "", BackgroundImagePath = null });

        Assert.Equal("Ouros Renamed", page.Title);
        Assert.Equal("ouros.html", page.OutputFileName); // untouched - blank input means "leave as-is"
        Assert.Equal("img/ouros/ouros.png", page.Background.ImagePath);
    }

    [Fact]
    public void ApplyPageEdit_GlobeEffect_OnlyAppliedWhenPresent()
    {
        var page = new Page { Id = "ouros", Title = "Ouros", OutputFileName = "ouros.html" };
        var project = new WeaveProject();
        project.Pages.Add(page);
        Assert.True(page.GlobeEffect); // default

        ProjectEditing.ApplyPageEdit(project, page, new PageEditRequest { GlobeEffect = false });
        Assert.False(page.GlobeEffect);

        ProjectEditing.ApplyPageEdit(project, page, new PageEditRequest { Title = "Ouros" }); // GlobeEffect omitted
        Assert.False(page.GlobeEffect); // untouched - null means "leave as-is"

        ProjectEditing.ApplyPageEdit(project, page, new PageEditRequest { GlobeEffect = true });
        Assert.True(page.GlobeEffect);
    }

    [Fact]
    public void ApplyPageEdit_IsHome_SetsAndClearsHomePageId()
    {
        var pageA = new Page { Id = "ouros", Title = "Ouros", OutputFileName = "ouros.html" };
        var pageB = new Page { Id = "azurus", Title = "Azurus", OutputFileName = "azurus.html" };
        var project = new WeaveProject();
        project.Pages.Add(pageA);
        project.Pages.Add(pageB);

        ProjectEditing.ApplyPageEdit(project, pageA, new PageEditRequest { IsHome = true });
        Assert.Equal("ouros", project.HomePageId);

        // Setting a different page home takes over, rather than needing the old one unset first.
        ProjectEditing.ApplyPageEdit(project, pageB, new PageEditRequest { IsHome = true });
        Assert.Equal("azurus", project.HomePageId);

        // Unchecking a page that isn't actually the current home is a no-op.
        ProjectEditing.ApplyPageEdit(project, pageA, new PageEditRequest { IsHome = false });
        Assert.Equal("azurus", project.HomePageId);

        ProjectEditing.ApplyPageEdit(project, pageB, new PageEditRequest { IsHome = false });
        Assert.Null(project.HomePageId);
    }

    [Fact]
    public void ApplyProjectEdit_BackgroundMusicPath_BlankClearsToNull()
    {
        var project = new WeaveProject { BackgroundMusicPath = "old-track.ogg" };

        ProjectEditing.ApplyProjectEdit(project, new ProjectEditRequest { BackgroundMusicPath = "DISCOVERYSQUAD.ogg" });
        Assert.Equal("DISCOVERYSQUAD.ogg", project.BackgroundMusicPath);

        ProjectEditing.ApplyProjectEdit(project, new ProjectEditRequest { BackgroundMusicPath = "  " });
        Assert.Null(project.BackgroundMusicPath);
    }

    [Fact]
    public void ApplyProjectEdit_ListeningRadiusPx_UpdatesOnPositiveValue_IgnoresMissingOrNonPositive()
    {
        var project = new WeaveProject(); // default ListeningRadiusPx = 105

        ProjectEditing.ApplyProjectEdit(project, new ProjectEditRequest { ListeningRadiusPx = 180 });
        Assert.Equal(180, project.ListeningRadiusPx);

        // Unlike BackgroundMusicPath, a missing or non-positive value never clears/resets this -
        // it just leaves whatever the project already had.
        ProjectEditing.ApplyProjectEdit(project, new ProjectEditRequest { ListeningRadiusPx = null });
        Assert.Equal(180, project.ListeningRadiusPx);

        ProjectEditing.ApplyProjectEdit(project, new ProjectEditRequest { ListeningRadiusPx = 0 });
        Assert.Equal(180, project.ListeningRadiusPx);

        ProjectEditing.ApplyProjectEdit(project, new ProjectEditRequest { ListeningRadiusPx = -5 });
        Assert.Equal(180, project.ListeningRadiusPx);
    }

    [Theory]
    [InlineData("Salmon Town", "salmon-town")]
    [InlineData("  Trailing spaces  ", "trailing-spaces")]
    [InlineData("Already-slugged", "already-slugged")]
    [InlineData("!!!", "")] // nothing alphanumeric left - caller decides this is invalid, not this method
    public void NormalizeId_SlugsWithoutAutoDedup(string raw, string expected) =>
        Assert.Equal(expected, ProjectEditing.NormalizeId(raw));

    [Fact]
    public void IsNodeIdInUse_FindsTopLevelAndNestedIds()
    {
        var project = MakeProjectWithNestedNodes();

        Assert.True(ProjectEditing.IsNodeIdInUse(project, "salanth-town-gardens"));
        Assert.True(ProjectEditing.IsNodeIdInUse(project, "jherop-phantom")); // nested
        Assert.False(ProjectEditing.IsNodeIdInUse(project, "not-a-real-id"));
    }

    [Fact]
    public void CountCoverImageReferences_CountsAcrossTopLevelAndNestedNodes()
    {
        var project = MakeProjectWithNestedNodes();
        project.Pages[0].Nodes[0].Card.CoverImagePath = "img/ouros/shared.png";
        project.Pages[0].Nodes[0].Children[0].Card.CoverImagePath = "img/ouros/shared.png";

        Assert.Equal(2, ProjectEditing.CountCoverImageReferences(project, "img/ouros/shared.png"));
        Assert.Equal(0, ProjectEditing.CountCoverImageReferences(project, "img/ouros/unused.png"));
    }

    [Fact]
    public void ApplyTutorialModalEdit_NoHomePageId_Throws()
    {
        var project = new WeaveProject();

        Assert.Throws<InvalidOperationException>(() =>
            ProjectEditing.ApplyTutorialModalEdit(project, new TutorialModalEditRequest { HeadingText = "Tutorial:" }));
    }

    [Fact]
    public void ApplyTutorialModalEdit_NoExistingModalNode_CreatesOne()
    {
        var project = new WeaveProject { HomePageId = "index" };
        var page = new Page { Id = "index", Title = "The Weave", OutputFileName = "index.html" };
        project.Pages.Add(page);

        var node = ProjectEditing.ApplyTutorialModalEdit(project, new TutorialModalEditRequest
        {
            HeadingText = "Tutorial:",
            PoetryLines = new List<string> { "Arrow keys to fly" },
            UpdatesHeadingText = "Updates:",
            UpdatesLines = new List<string> { "[01JAN26] First release" },
        });

        Assert.Same(node, Assert.Single(page.Nodes));
        Assert.Equal(CardSize.Modal, node.Card.Size);
        Assert.True(node.Persistent);
        Assert.Equal("Tutorial:", node.Card.HeadingText);
        Assert.Equal(new[] { "Arrow keys to fly" }, node.Card.PoetryLines);
        var updates = Assert.Single(node.Card.ExtraPanels);
        Assert.Equal("Updates:", updates.HeadingText);
        Assert.Equal(new[] { "[01JAN26] First release" }, updates.Lines);
    }

    [Fact]
    public void ApplyTutorialModalEdit_ExistingModalNode_UpdatesInPlaceRatherThanDuplicating()
    {
        var project = new WeaveProject { HomePageId = "index" };
        var page = new Page { Id = "index", Title = "The Weave", OutputFileName = "index.html" };
        var existing = new Node
        {
            Id = "tutorialnode",
            Persistent = true,
            Card = new Card { Size = CardSize.Modal, HeadingText = "Old heading" },
        };
        page.Nodes.Add(existing);
        project.Pages.Add(page);

        var node = ProjectEditing.ApplyTutorialModalEdit(project, new TutorialModalEditRequest { HeadingText = "New heading" });

        Assert.Same(existing, node);
        Assert.Single(page.Nodes); // not duplicated
        Assert.Equal("New heading", node.Card.HeadingText);
    }

    [Fact]
    public void FindTutorialModalNode_NoHomePageIdOrNoModalNode_ReturnsNull()
    {
        var projectNoHome = new WeaveProject();
        Assert.Null(ProjectEditing.FindTutorialModalNode(projectNoHome));

        var projectNoModal = new WeaveProject { HomePageId = "index" };
        var page = new Page { Id = "index", Title = "The Weave", OutputFileName = "index.html" };
        page.Nodes.Add(new Node { Id = "azurus", Card = new Card { Size = CardSize.Standard } });
        projectNoModal.Pages.Add(page);
        Assert.Null(ProjectEditing.FindTutorialModalNode(projectNoModal));
    }
}
