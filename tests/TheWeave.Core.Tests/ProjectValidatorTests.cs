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

    private static List<string> PuzzleProblems(params PuzzleObject[] objects)
    {
        var node = new Node
        {
            Id = "track",
            Card = new Card { CoverImagePath = "img/track.png", Audio = new AudioRef { Url = "track.ogg" } },
            Puzzle = new Puzzle
            {
                PaletteSource = "img/track.png",
                Objects = objects.ToList(),
                Textures = { ["wall"] = new PuzzleTexture() },
            },
        };
        var project = new WeaveProject { Pages = { MakePage("ouros", node) } };

        return ProjectValidator.Validate(project)
            .Where(i => i.Message.StartsWith("Puzzle on 'track': "))
            .Select(i => i.Message["Puzzle on 'track': ".Length..])
            .ToList();
    }

    private static PuzzleObject Finish => new() { Kind = PuzzleObjectKind.Finish };
    private static PuzzleObject Lettered(PuzzleObjectKind kind, string letter) => new() { Kind = kind, Letter = letter };

    [Fact]
    public void CompletePuzzle_HasNoProblems()
    {
        Assert.Empty(PuzzleProblems(
            Finish,
            Lettered(PuzzleObjectKind.Gate, "A"),
            Lettered(PuzzleObjectKind.Gate, "A"),
            Lettered(PuzzleObjectKind.Switch, "A"),
            Lettered(PuzzleObjectKind.Teleporter, "A"),
            Lettered(PuzzleObjectKind.Teleporter, "A")));
    }

    [Fact]
    public void Puzzle_WithNoFinish_IsReported()
    {
        Assert.Contains("no Finish", Assert.Single(PuzzleProblems()));
    }

    [Fact]
    public void Puzzle_WithUnmatchedGateOrSwitch_IsReported()
    {
        var problems = PuzzleProblems(Finish, Lettered(PuzzleObjectKind.Gate, "A"), Lettered(PuzzleObjectKind.Switch, "B"));

        Assert.Equal(2, problems.Count);
        Assert.Contains(problems, p => p.StartsWith("Gate A has no Switch A"));
        Assert.Contains(problems, p => p.StartsWith("Switch B has no Gate B"));
    }

    [Theory]
    [InlineData(1, "there is 1")]
    [InlineData(3, "there are 3")]
    public void Puzzle_WithTeleportersNotInAPair_IsReported(int count, string expected)
    {
        var objects = Enumerable.Range(0, count).Select(_ => Lettered(PuzzleObjectKind.Teleporter, "A")).Append(Finish).ToArray();

        Assert.Contains(expected, Assert.Single(PuzzleProblems(objects)));
    }

    [Fact]
    public void Gate_PlacedOpen_WithNoSwitch_IsFine()
    {
        Assert.Empty(PuzzleProblems(Finish, new PuzzleObject { Kind = PuzzleObjectKind.Gate, Letter = "A", Open = true }));
    }

    [Fact]
    public void Letter_WithAClosedGateAndNoSwitch_IsStillReported()
    {
        var problems = PuzzleProblems(
            Finish,
            new PuzzleObject { Kind = PuzzleObjectKind.Gate, Letter = "A", Open = true, Col = 1 },
            new PuzzleObject { Kind = PuzzleObjectKind.Gate, Letter = "A", Col = 2 });

        Assert.StartsWith("Gate A has no Switch A", Assert.Single(problems));
    }

    private static PuzzleObject Stream(int col, int row, PuzzleDirection direction) =>
        new() { Kind = PuzzleObjectKind.Stream, Col = col, Row = row, Direction = direction };

    [Fact]
    public void Stream_EndingOnAnOpenSquare_IsFine()
    {
        Assert.Empty(PuzzleProblems(Finish, Stream(1, 1, PuzzleDirection.Right), Stream(2, 1, PuzzleDirection.Down)));
    }

    [Fact]
    public void Stream_RunningOffTheBoard_IsReportedOnce()
    {
        var problem = Assert.Single(PuzzleProblems(Finish, Stream(8, 1, PuzzleDirection.Right), Stream(9, 1, PuzzleDirection.Right)));

        Assert.Contains("column 10, row 2 runs off the board", problem);
    }

    [Fact]
    public void Stream_EndingAtAWall_IsReported()
    {
        var problem = Assert.Single(PuzzleProblems(Finish, Stream(1, 1, PuzzleDirection.Right), new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 2, Row = 1 }));

        Assert.Contains("ends at a Wall", problem);
    }

    [Fact]
    public void Streams_FacingEachOther_AreReported()
    {
        var problems = PuzzleProblems(Finish, Stream(1, 1, PuzzleDirection.Right), Stream(2, 1, PuzzleDirection.Left));

        Assert.All(problems, p => Assert.Contains("head-on", p));
        Assert.NotEmpty(problems);
    }

    [Fact]
    public void Stream_Loop_IsReportedOnce()
    {
        var problem = Assert.Single(PuzzleProblems(
            Finish,
            Stream(1, 1, PuzzleDirection.Right),
            Stream(2, 1, PuzzleDirection.Down),
            Stream(2, 2, PuzzleDirection.Left),
            Stream(1, 2, PuzzleDirection.Up)));

        Assert.Contains("loop", problem);
    }

    [Fact]
    public void Stream_LeadingOntoATeleporter_IsFine()
    {
        Assert.Empty(PuzzleProblems(
            Finish,
            Stream(1, 1, PuzzleDirection.Right),
            Stream(2, 1, PuzzleDirection.Right),
            Lettered(PuzzleObjectKind.Teleporter, "A"),
            new PuzzleObject { Kind = PuzzleObjectKind.Teleporter, Letter = "A", Col = 2, Row = 1 }));
    }

    [Fact]
    public void RotatorTiles_WithNoSwitch_AreReported_AndTheReverse()
    {
        var tile = new PuzzleObject { Kind = PuzzleObjectKind.RotatorTile, Direction = PuzzleDirection.Up, Col = 1 };
        var rotatorSwitch = new PuzzleObject { Kind = PuzzleObjectKind.RotatorSwitch, Col = 2 };

        Assert.Contains("no Rotator Switch", Assert.Single(PuzzleProblems(Finish, tile)));
        Assert.Contains("no Rotator tiles", Assert.Single(PuzzleProblems(Finish, rotatorSwitch)));
        Assert.Empty(PuzzleProblems(Finish, tile, rotatorSwitch));
    }

    [Fact]
    public void Invisible_WithNoLantern_IsReported()
    {
        var wall = new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 1, Invisible = true };

        Assert.Contains("no Lantern", Assert.Single(PuzzleProblems(Finish, wall)));
        Assert.Empty(PuzzleProblems(Finish, wall, new PuzzleObject { Kind = PuzzleObjectKind.Lantern, Col = 2 }));
    }

    [Fact]
    public void Stream_EndingAtAWallOnARotatorTile_IsFine_BecauseItCanMove()
    {
        Assert.Empty(PuzzleProblems(
            Finish,
            Stream(1, 1, PuzzleDirection.Right),
            new PuzzleObject { Kind = PuzzleObjectKind.RotatorTile, Direction = PuzzleDirection.Up, Col = 2, Row = 1 },
            new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 2, Row = 1 },
            new PuzzleObject { Kind = PuzzleObjectKind.RotatorSwitch, Col = 5, Row = 5 }));
    }

    private static List<string> ChainProblems(Puzzle first, Puzzle second)
    {
        Node Part(string id, Puzzle puzzle) => new()
        {
            Id = id,
            Card = new Card { HeadingText = id, CoverImagePath = "img/track.png", Audio = new AudioRef { Url = "track.ogg" } },
            Puzzle = puzzle,
        };
        var root = Part("first", first);
        root.Children.Add(Part("second", second));
        foreach (var puzzle in new[] { first, second })
        {
            puzzle.PaletteSource = "img/track.png";
            puzzle.Textures["wall"] = new PuzzleTexture();
        }

        return ProjectValidator.Validate(new WeaveProject { Pages = { MakePage("ouros", root) } })
            .Where(i => i.Message.StartsWith("Puzzle on "))
            .Select(i => i.Message)
            .ToList();
    }

    private static PuzzleObject Placed(PuzzleObjectKind kind, int col, int row) => new() { Kind = kind, Col = col, Row = row };

    [Fact]
    public void ConnectedParts_ThatLineUp_HaveNoProblems()
    {
        Assert.Empty(ChainProblems(
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 0, 4) } },
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Start, 9, 4), Placed(PuzzleObjectKind.Finish, 5, 5) } }));
    }

    [Fact]
    public void PartThatLeadsOn_WithItsFinishOffAnEdge_IsReported()
    {
        var problem = Assert.Single(ChainProblems(
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 0, 0) } },
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 5, 5) } }));

        Assert.Contains("'first': it leads on to 'second', so its Finish has to be on an edge", problem);
    }

    [Fact]
    public void PartThatLeadsOn_WithTwoFinishes_IsReported()
    {
        var problem = Assert.Single(ChainProblems(
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 0, 4), Placed(PuzzleObjectKind.Finish, 9, 4) } },
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 5, 5) } }));

        Assert.Contains("only one Finish", problem);
    }

    [Fact]
    public void FollowingPart_WithSomethingOnItsEntrance_IsReported()
    {
        var problem = Assert.Single(ChainProblems(
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 4, 9) } },
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Start, 5, 5), Placed(PuzzleObjectKind.Wall, 4, 0), Placed(PuzzleObjectKind.Finish, 5, 6) } }));

        Assert.Contains("'second': the ship comes in from 'first' at column 5, row 1, but a Wall is there", problem);
    }

    [Fact]
    public void FollowingPart_WithItsStartOutOfStep_IsReported()
    {
        var problem = Assert.Single(ChainProblems(
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Finish, 4, 9) } },
            new Puzzle { Objects = { Placed(PuzzleObjectKind.Start, 5, 5), Placed(PuzzleObjectKind.Finish, 5, 6) } }));

        Assert.Contains("Start isn't where the ship comes in", problem);
    }

    [Fact]
    public void Puzzle_WithNoTextures_IsReported()
    {
        var node = new Node
        {
            Id = "track",
            Card = new Card { CoverImagePath = "img/track.png", Audio = new AudioRef { Url = "track.ogg" } },
            Puzzle = new Puzzle { PaletteSource = "img/track.png", Objects = { Finish } },
        };
        var project = new WeaveProject { Pages = { MakePage("ouros", node) } };

        Assert.Contains(ProjectValidator.Validate(project), i => i.Message.Contains("before objects had textures"));
    }

    [Fact]
    public void Puzzle_OnALocationWithNoTrackFocus_IsReported()
    {
        var node = new Node { Id = "track", Puzzle = new Puzzle { Objects = { Finish } } };
        var project = new WeaveProject { Pages = { MakePage("ouros", node) } };

        Assert.Contains(ProjectValidator.Validate(project), i => i.Message.Contains("can't be played"));
    }

    [Fact]
    public void Puzzle_WithColoursFromOtherArt_IsReported()
    {
        var node = new Node
        {
            Id = "track",
            Card = new Card { CoverImagePath = "img/new.png", Audio = new AudioRef { Url = "track.ogg" } },
            Puzzle = new Puzzle { PaletteSource = "img/old.png", Objects = { Finish } },
        };
        var project = new WeaveProject { Pages = { MakePage("ouros", node) } };

        Assert.Contains(ProjectValidator.Validate(project), i => i.Message.Contains("different album art"));
    }

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
                    X = 201,
                    Y = 201,
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

    [Fact]
    public void NodeNotCenteredInASquare_IsAWarning()
    {
        var project = new WeaveProject
        {
            Pages = { MakePage("ouros", new Node { Id = "off-center", X = 210, Y = 201 }) },
        };

        var issue = Assert.Single(ProjectValidator.Validate(project));

        Assert.Equal(ValidationSeverity.Warning, issue.Severity);
        Assert.Contains("off-center", issue.Message);
    }

    [Fact]
    public void TwoNodesOnOneSquare_IsAWarning()
    {
        var project = new WeaveProject
        {
            Pages =
            {
                MakePage("ouros",
                    new Node { Id = "first", X = 201, Y = 201 },
                    new Node { Id = "second", X = 201, Y = 201 }),
            },
        };

        var issue = Assert.Single(ProjectValidator.Validate(project));

        Assert.Equal(ValidationSeverity.Warning, issue.Severity);
        Assert.Contains("A0", issue.Message);
        Assert.Contains("second", issue.Message);
    }

    [Fact]
    public void ModalCard_IsNotOnTheGrid()
    {
        var project = new WeaveProject
        {
            Pages =
            {
                MakePage("index", new Node { Id = "tutorial", X = 50, Y = 50, Card = new Card { Size = CardSize.Modal } }),
            },
        };

        Assert.Empty(ProjectValidator.Validate(project));
    }
}
