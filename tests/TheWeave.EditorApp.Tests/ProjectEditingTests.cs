using TheWeave.Core.Model;
using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

public class ProjectEditingTests
{
    private static Puzzle MakePuzzle(params PuzzleObject[] objects) => new() { Objects = objects.ToList() };

    private static Node MakeNodeWithPuzzle()
    {
        return new Node { Id = "track", Puzzle = MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.Finish, Col = 1, Row = 1 }) };
    }

    [Fact]
    public void IndexPage_IsFoundWhereverTheAppIsStartedFrom_AndHasEveryLocalFileItLoads()
    {
        var original = Environment.CurrentDirectory;
        Environment.CurrentDirectory = Path.GetTempPath();
        try
        {
            Assert.True(File.Exists(Program.IndexPagePath), Program.IndexPagePath);
        }
        finally
        {
            Environment.CurrentDirectory = original;
        }

        var page = File.ReadAllText(Program.IndexPagePath);
        var references = System.Text.RegularExpressions.Regex.Matches(page, "(?:src|href)=\"([^\":]+)\"")
            .Select(m => m.Groups[1].Value)
            .ToList();

        Assert.Contains("puzzle.js", references);
        Assert.Contains("puzzleEditor.js", references);
        foreach (var reference in references)
            Assert.True(File.Exists(Path.Combine(Path.GetDirectoryName(Program.IndexPagePath)!, reference)), reference);
    }

    // Exactly what puzzleEditor.js's savePuzzle sends.
    [Fact]
    public void UpdatePuzzleMessage_ReadsWhatTheEditorSends()
    {
        var raw = $$"""
            {
              "type": "update-puzzle", "pageId": "ouros", "nodeId": "track",
              "puzzle": {
                "objects": [
                  { "kind": "Gate", "col": 2, "row": 3, "letter": "A", "open": true },
                  { "kind": "Stream", "col": 4, "row": 5, "direction": "Left" },
                  { "kind": "Start", "col": 5, "row": 9 }
                ],
                "palette": { "wall": "#112233" },
                "textures": { "wall": { "ramp": ["#112233"], "pixels": "{{new string('0', 576)}}" } },
                "paletteSource": "img/track.png"
              }
            }
            """;

        var message = System.Text.Json.JsonSerializer.Deserialize<EditorMessage>(raw, Program.InboundOptions)!;

        ProjectEditing.ValidatePuzzle(message.Puzzle!);
        Assert.Equal(PuzzleObjectKind.Gate, message.Puzzle!.Objects[0].Kind);
        Assert.Equal("A", message.Puzzle.Objects[0].Letter);
        Assert.True(message.Puzzle.Objects[0].Open);
        Assert.Equal("#112233", message.Puzzle.Textures["wall"].Ramp[0]);
        Assert.Equal(PuzzleDirection.Left, message.Puzzle.Objects[1].Direction);
        Assert.Equal("#112233", message.Puzzle.Palette["wall"]);
        Assert.Equal("img/track.png", message.Puzzle.PaletteSource);

        var cleared = System.Text.Json.JsonSerializer.Deserialize<EditorMessage>("""{ "type": "update-puzzle", "puzzle": null }""", Program.InboundOptions)!;
        Assert.Null(cleared.Puzzle);
    }

    // Exactly what puzzleDrawings.js's sendDrawings and puzzleEditor.js's savePuzzle send.
    [Fact]
    public void DrawingMessages_ReadWhatTheEditorSends()
    {
        var raw = $$"""
            {
              "type": "update-puzzle-drawings",
              "drawings": [
                { "id": "gate-2", "kind": "Gate", "name": "Iron", "pixels": "{{new string('G', 576)}}", "openPixels": "{{new string('.', 576)}}",
                  "mix": [{ "role": "gate", "shade": 1, "percent": 60 }, { "role": "outline", "shade": 0, "percent": 40 }] }
              ]
            }
            """;

        var message = System.Text.Json.JsonSerializer.Deserialize<EditorMessage>(raw, Program.InboundOptions)!;
        var project = new WeaveProject();
        ProjectEditing.ApplyPuzzleDrawingsEdit(project, message.Drawings!);

        var drawing = Assert.Single(project.PuzzleDrawings!);
        Assert.Equal(PuzzleObjectKind.Gate, drawing.Kind);
        Assert.Equal("Iron", drawing.Name);
        Assert.Equal('.', drawing.OpenPixels![0]);
        Assert.Equal(60, drawing.Mix[0].Percent);

        var withVariant = System.Text.Json.JsonSerializer.Deserialize<EditorMessage>(
            """{ "type": "update-puzzle", "puzzle": { "objects": [{ "kind": "Wall", "col": 1, "row": 1, "variant": "mossy" }] } }""", Program.InboundOptions)!;
        Assert.Equal("mossy", withVariant.Puzzle!.Objects[0].Variant);
    }

    [Fact]
    public void ApplyPuzzleEdit_ReplacesAndRemoves()
    {
        var node = MakeNodeWithPuzzle();
        var replacement = MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 9, Row = 9 });

        ProjectEditing.ApplyPuzzleEdit(node, replacement);
        Assert.Same(replacement, node.Puzzle);

        ProjectEditing.ApplyPuzzleEdit(node, null);
        Assert.Null(node.Puzzle);
    }

    [Fact]
    public void ApplyPuzzleEdit_AllowsAnObjectOnAStream()
    {
        var node = new Node();

        ProjectEditing.ApplyPuzzleEdit(node, MakePuzzle(
            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 1, Row = 1, Direction = PuzzleDirection.Up },
            new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 1, Row = 1 }));

        Assert.Equal(2, node.Puzzle!.Objects.Count);
    }

    [Fact]
    public void ApplyPuzzleEdit_DropsFieldsAKindDoesNotUse()
    {
        var node = new Node();

        ProjectEditing.ApplyPuzzleEdit(node, MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.Wall, Letter = "A", Direction = PuzzleDirection.Up, Open = true }));

        Assert.Null(node.Puzzle!.Objects[0].Letter);
        Assert.Null(node.Puzzle.Objects[0].Direction);
        Assert.False(node.Puzzle.Objects[0].Open);
    }

    private static PuzzleDrawing Drawing(string id, PuzzleObjectKind kind = PuzzleObjectKind.Wall) => new()
    {
        Id = id,
        Kind = kind,
        Name = id,
        Pixels = new string('G', PuzzleDrawings.TilePixels),
        Mix = { new PuzzleMixColour { Role = "wall", Shade = 2, Percent = 100 } },
    };

    private static WeaveProject MakeProjectWithVariants()
    {
        var parent = new Node
        {
            Id = "first",
            Puzzle = MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.Wall, Variant = "mossy" }),
            Children = { new Node { Id = "second", Puzzle = MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.Wall, Variant = "cracked" }) } },
        };
        return new WeaveProject
        {
            Pages = { new Page { Id = "ouros", Nodes = { parent } } },
            PuzzleDrawings = [Drawing("mossy"), Drawing("cracked")],
        };
    }

    [Fact]
    public void ApplyPuzzleDrawingsEdit_ReplacesTheLibrary_AndSendsObjectsOfADeletedDrawingBackToStandard()
    {
        var project = MakeProjectWithVariants();

        ProjectEditing.ApplyPuzzleDrawingsEdit(project, [Drawing("mossy")]);

        var nodes = project.Pages[0].Nodes;
        Assert.Equal(["mossy"], project.PuzzleDrawings!.Select(d => d.Id));
        Assert.Equal("mossy", nodes[0].Puzzle!.Objects[0].Variant);
        Assert.Null(nodes[0].Children[0].Puzzle!.Objects[0].Variant);

        ProjectEditing.ApplyPuzzleDrawingsEdit(project, []);
        Assert.Null(project.PuzzleDrawings);
        Assert.Null(nodes[0].Puzzle!.Objects[0].Variant);
    }

    [Fact]
    public void ApplyPuzzleDrawingsEdit_TidiesWhatADrawingDoesNotUse()
    {
        var project = new WeaveProject();
        var key = Drawing("shiny", PuzzleObjectKind.Key);
        key.Name = "  Shiny  ";
        key.OpenPixels = new string('O', PuzzleDrawings.TilePixels);
        key.Mix = [new PuzzleMixColour { Role = "outline", Shade = 3, Percent = 40 }, new PuzzleMixColour { Role = "key", Shade = 1, Percent = 0 }];

        ProjectEditing.ApplyPuzzleDrawingsEdit(project, [key]);

        Assert.Equal("Shiny", key.Name);
        Assert.Null(key.OpenPixels);
        Assert.Equal(0, key.Mix[0].Shade);
    }

    public static TheoryData<Action<PuzzleDrawing>> InvalidDrawings => new()
    {
        d => d.Pixels = d.Pixels[1..],
        d => d.Pixels = "X" + d.Pixels[1..],
        d => d.Kind = PuzzleObjectKind.Stream,
        d => d.Kind = PuzzleObjectKind.Start,
        d => d.Id = "Key",
        d => d.Id = " ",
        d => d.Name = " ",
        d => d.Mix = [],
        d => d.Mix = [.. Enumerable.Range(0, 5).Select(_ => new PuzzleMixColour { Role = "wall", Percent = 20 })],
        d => d.Mix[0].Role = "sky",
        d => d.Mix[0].Shade = 4,
        d => d.Mix[0].Percent = 101,
        d => d.Mix[0].Percent = 0,
        d => { d.Kind = PuzzleObjectKind.Gate; d.OpenPixels = "."; },
    };

    [Theory]
    [MemberData(nameof(InvalidDrawings))]
    public void ApplyPuzzleDrawingsEdit_RejectsAnInvalidDrawing_LeavingTheLibrary(Action<PuzzleDrawing> spoil)
    {
        var project = MakeProjectWithVariants();
        var before = project.PuzzleDrawings;
        var drawing = Drawing("new");
        spoil(drawing);

        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleDrawingsEdit(project, [Drawing("mossy"), drawing]));

        Assert.Same(before, project.PuzzleDrawings);
        Assert.Equal("cracked", project.Pages[0].Nodes[0].Children[0].Puzzle!.Objects[0].Variant);
    }

    [Fact]
    public void ApplyPuzzleDrawingsEdit_RejectsTwoDrawingsWithOneId()
    {
        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleDrawingsEdit(new WeaveProject(), [Drawing("a"), Drawing("a")]));
    }

    [Fact]
    public void ARedrawnStandardDrawing_HasItsKindsNameAsItsId()
    {
        var project = new WeaveProject();

        ProjectEditing.ApplyPuzzleDrawingsEdit(project, [Drawing("Wall")]);

        Assert.Equal("Wall", Assert.Single(project.PuzzleDrawings!).Id);
    }

    [Fact]
    public void AddPuzzleDrawings_KeepsTheLibrarysOwn_AndAddsTheRest()
    {
        var project = MakeProjectWithVariants();
        var replacement = Drawing("mossy");
        replacement.Name = "Different";

        ProjectEditing.AddPuzzleDrawings(project, [replacement, Drawing("new")]);

        Assert.Equal(["mossy", "cracked", "new"], project.PuzzleDrawings!.Select(d => d.Id));
        Assert.Equal("mossy", project.PuzzleDrawings[0].Name);
    }

    [Fact]
    public void ApplyPuzzleEdit_KeepsAVariantOnlyWhereThereAreDrawings()
    {
        var node = new Node();

        ProjectEditing.ApplyPuzzleEdit(node, MakePuzzle(
            new PuzzleObject { Kind = PuzzleObjectKind.Wall, Variant = "mossy" },
            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 1, Direction = PuzzleDirection.Up, Variant = "mossy" },
            new PuzzleObject { Kind = PuzzleObjectKind.Key, Col = 2, Variant = "" }));

        Assert.Equal(["mossy", null, null], node.Puzzle!.Objects.Select(o => o.Variant));
    }

    [Fact]
    public void ApplyPuzzleEdit_TakesTexturesWithAGrain_OrOldOnesWithPixels_ButNotNeither()
    {
        var grain = MakePuzzle();
        grain.Textures["wall"] = new PuzzleTexture { Ramp = { "#000000", "#111111", "#222222", "#333333" }, Grain = new string('z', PuzzleDrawings.TilePixels) };
        ProjectEditing.ApplyPuzzleEdit(new Node(), grain);

        var old = MakePuzzle();
        old.Textures["wall"] = new PuzzleTexture { Ramp = { "#000000" }, Pixels = new string('0', PuzzleDrawings.TilePixels) };
        ProjectEditing.ApplyPuzzleEdit(new Node(), old);

        var neither = MakePuzzle();
        neither.Textures["wall"] = new PuzzleTexture { Ramp = { "#000000" } };
        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(new Node(), neither));
    }

    public static TheoryData<PuzzleObject[]> InvalidPuzzles => new()
    {
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 10 } } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Wall, Row = -1 } } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Gate } } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Switch, Letter = "a" } } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Teleporter, Letter = "AB" } } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Stream } } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Wall }, new PuzzleObject { Kind = PuzzleObjectKind.Key } } },
        { new[]
        {
            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Direction = PuzzleDirection.Up },
            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Direction = PuzzleDirection.Down },
        } },
        { new[] { new PuzzleObject { Kind = PuzzleObjectKind.Start }, new PuzzleObject { Kind = PuzzleObjectKind.Start, Col = 1 } } },
    };

    [Theory]
    [MemberData(nameof(InvalidPuzzles))]
    public void ApplyPuzzleEdit_RejectsAnInvalidPuzzle_LeavingTheOldOne(PuzzleObject[] objects)
    {
        var node = MakeNodeWithPuzzle();
        var before = node.Puzzle;

        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(node, MakePuzzle(objects)));

        Assert.Same(before, node.Puzzle);
    }

    [Fact]
    public void ApplyPuzzleEdit_KeepsAGatePlacedOpen()
    {
        var node = new Node();

        ProjectEditing.ApplyPuzzleEdit(node, MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.Gate, Letter = "A", Open = true }));

        Assert.True(node.Puzzle!.Objects[0].Open);
    }

    [Fact]
    public void ApplyPuzzleEdit_DropsInvisibleFromFinishAndStart_AndKeepsItElsewhere()
    {
        var node = new Node();

        ProjectEditing.ApplyPuzzleEdit(node, MakePuzzle(
            new PuzzleObject { Kind = PuzzleObjectKind.Finish, Invisible = true },
            new PuzzleObject { Kind = PuzzleObjectKind.Start, Col = 1, Invisible = true },
            new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 2, Invisible = true },
            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 3, Direction = PuzzleDirection.Up, Invisible = true }));

        Assert.Equal(new[] { false, false, true, true }, node.Puzzle!.Objects.Select(o => o.Invisible));
    }

    [Fact]
    public void ApplyPuzzleEdit_AllowsARotatorTileWithAnObject_ButNotAStreamToo()
    {
        var tile = new PuzzleObject { Kind = PuzzleObjectKind.RotatorTile, Direction = PuzzleDirection.Up };

        ProjectEditing.ApplyPuzzleEdit(new Node(), MakePuzzle(tile, new PuzzleObject { Kind = PuzzleObjectKind.Wall }));

        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(
            new Node(),
            MakePuzzle(tile, new PuzzleObject { Kind = PuzzleObjectKind.Stream, Direction = PuzzleDirection.Up })));
    }

    [Fact]
    public void ApplyPuzzleEdit_RejectsARotatorTileWithNoDirection()
    {
        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(new Node(), MakePuzzle(new PuzzleObject { Kind = PuzzleObjectKind.RotatorTile })));
    }

    [Theory]
    [InlineData(0, 576)]
    [InlineData(1, 575)]
    public void ApplyPuzzleEdit_RejectsAnIncompleteTexture(int shades, int pixels)
    {
        var puzzle = MakePuzzle();
        puzzle.Textures["wall"] = new PuzzleTexture { Ramp = Enumerable.Repeat("#112233", shades).ToList(), Pixels = new string('0', pixels) };

        Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(new Node(), puzzle));
    }

    private static PuzzleObject At(PuzzleObjectKind kind, int col, int row) => new() { Kind = kind, Col = col, Row = row };

    // A location of three parts, each with a puzzle, and the page it's on.
    private static (Page Page, Node First, Node Second, Node Third) MakeConnectedParts()
    {
        var third = new Node { Id = "third", Card = new Card { HeadingText = "Third" }, Puzzle = MakePuzzle(At(PuzzleObjectKind.Start, 5, 5), At(PuzzleObjectKind.Finish, 3, 3)) };
        var second = new Node { Id = "second", Card = new Card { HeadingText = "Second" }, Puzzle = MakePuzzle(At(PuzzleObjectKind.Start, 5, 5), At(PuzzleObjectKind.Finish, 9, 4)), Children = { third } };
        var first = new Node { Id = "first", Card = new Card { HeadingText = "First" }, Puzzle = MakePuzzle(At(PuzzleObjectKind.Start, 5, 9), At(PuzzleObjectKind.Finish, 3, 0)), Children = { second } };
        return (new Page { Id = "ouros", Nodes = { first } }, first, second, third);
    }

    private static (int, int) StartOf(Node node)
    {
        var start = node.Puzzle!.Objects.Single(o => o.Kind == PuzzleObjectKind.Start);
        return (start.Col, start.Row);
    }

    [Theory]
    [InlineData(0, 4, PuzzleDirection.Left)]
    [InlineData(9, 4, PuzzleDirection.Right)]
    [InlineData(4, 0, PuzzleDirection.Up)]
    [InlineData(4, 9, PuzzleDirection.Down)]
    [InlineData(0, 0, null)]
    [InlineData(9, 9, null)]
    [InlineData(0, 9, null)]
    [InlineData(4, 4, null)]
    public void ExitDirectionOf_IsAnEdgeOnly_NotACornerOrTheMiddle(int col, int row, PuzzleDirection? expected)
    {
        Assert.Equal(expected, PuzzleConnection.ExitDirectionOf(col, row));
    }

    [Theory]
    [InlineData(0, 4, 9, 4)]
    [InlineData(9, 4, 0, 4)]
    [InlineData(4, 0, 4, 9)]
    [InlineData(4, 9, 4, 0)]
    public void EntranceFrom_IsDirectlyAcrossOnTheOppositeEdge(int col, int row, int toCol, int toRow)
    {
        Assert.Equal((toCol, toRow), PuzzleConnection.EntranceFrom(col, row, PuzzleConnection.ExitDirectionOf(col, row)!.Value));
    }

    [Fact]
    public void ApplyPuzzleEdit_MovingTheFinish_MovesTheNextPartsStartToMatch()
    {
        var (page, first, second, _) = MakeConnectedParts();

        ProjectEditing.ApplyPuzzleEdit(first, MakePuzzle(At(PuzzleObjectKind.Start, 5, 9), At(PuzzleObjectKind.Finish, 0, 6)), page);

        Assert.Equal((9, 6), StartOf(second));
    }

    [Fact]
    public void ApplyPuzzleEdit_EditingAFollowingPart_KeepsItsStartWhereTheShipComesIn()
    {
        var (page, first, second, _) = MakeConnectedParts();
        ProjectEditing.ApplyPuzzleEdit(first, first.Puzzle, page);
        Assert.Equal((3, 9), StartOf(second));

        ProjectEditing.ApplyPuzzleEdit(second, MakePuzzle(At(PuzzleObjectKind.Start, 1, 1), At(PuzzleObjectKind.Finish, 9, 4), At(PuzzleObjectKind.Wall, 2, 2)), page);

        Assert.Equal((3, 9), StartOf(second));
        Assert.Equal((0, 4), StartOf(second.Children[0]));
    }

    [Fact]
    public void ApplyPuzzleEdit_ABlockedEntrance_LeavesTheStartAndTheBlockAlone()
    {
        var (page, first, second, _) = MakeConnectedParts();
        second.Puzzle!.Objects.Add(At(PuzzleObjectKind.Wall, 3, 9));

        ProjectEditing.ApplyPuzzleEdit(first, first.Puzzle, page);

        Assert.Equal((5, 5), StartOf(second));
        Assert.Contains(second.Puzzle.Objects, o => o.Kind == PuzzleObjectKind.Wall && o.Col == 3 && o.Row == 9);
    }

    [Fact]
    public void ApplyPuzzleEdit_AFloorTileOnTheEntrance_IsNoBlock()
    {
        var (page, first, second, _) = MakeConnectedParts();
        second.Puzzle!.Objects.Add(new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 3, Row = 9, Direction = PuzzleDirection.Up });

        ProjectEditing.ApplyPuzzleEdit(first, first.Puzzle, page);

        Assert.Equal((3, 9), StartOf(second));
    }

    [Theory]
    [InlineData(4, 4)]
    [InlineData(0, 0)]
    public void ApplyPuzzleEdit_PartThatLeadsOn_RejectsANewFinishOffAnEdge(int col, int row)
    {
        var (page, first, _, _) = MakeConnectedParts();
        var before = first.Puzzle;

        var e = Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(first, MakePuzzle(At(PuzzleObjectKind.Start, 5, 9), At(PuzzleObjectKind.Finish, col, row)), page));

        Assert.Contains("on an edge", e.Message);
        Assert.Same(before, first.Puzzle);
    }

    [Fact]
    public void ApplyPuzzleEdit_PartThatLeadsOn_RejectsASecondFinish()
    {
        var (page, first, _, _) = MakeConnectedParts();

        var e = Assert.Throws<InvalidOperationException>(() => ProjectEditing.ApplyPuzzleEdit(first, MakePuzzle(At(PuzzleObjectKind.Finish, 3, 0), At(PuzzleObjectKind.Finish, 9, 3)), page));

        Assert.Contains("only have one Finish", e.Message);
    }

    [Fact]
    public void ApplyPuzzleEdit_TheLastPart_CanPutItsFinishAnywhere()
    {
        var (page, _, _, third) = MakeConnectedParts();

        ProjectEditing.ApplyPuzzleEdit(third, MakePuzzle(At(PuzzleObjectKind.Finish, 4, 4), At(PuzzleObjectKind.Finish, 6, 6)), page);

        Assert.Equal(2, third.Puzzle!.Objects.Count(o => o.Kind == PuzzleObjectKind.Finish));
    }

    [Fact]
    public void ApplyPuzzleEdit_AnOldFinishOffAnEdge_StillLetsTheRestBeEdited()
    {
        var (page, first, _, _) = MakeConnectedParts();
        first.Puzzle = MakePuzzle(At(PuzzleObjectKind.Finish, 4, 4));

        ProjectEditing.ApplyPuzzleEdit(first, MakePuzzle(At(PuzzleObjectKind.Finish, 4, 4), At(PuzzleObjectKind.Wall, 1, 1)), page);

        Assert.Equal(2, first.Puzzle!.Objects.Count);
    }

    [Fact]
    public void PreviousPart_IsTheParent_OnlyForItsFirstChild()
    {
        var (page, first, second, third) = MakeConnectedParts();
        var sibling = new Node { Id = "sibling" };
        first.Children.Add(sibling);

        Assert.Null(ProjectEditing.PreviousPart(page.Nodes, first));
        Assert.Same(first, ProjectEditing.PreviousPart(page.Nodes, second));
        Assert.Same(second, ProjectEditing.PreviousPart(page.Nodes, third));
        Assert.Null(ProjectEditing.PreviousPart(page.Nodes, sibling));
    }

    [Fact]
    public void ApplyNodeEdit_LeavesThePuzzleAlone()
    {
        var project = MakeProjectWithNestedNodes();
        var page = project.Pages[0];
        var node = page.Nodes[0].Children[0];
        node.Puzzle = MakePuzzle();
        var before = node.Puzzle;

        ProjectEditing.ApplyNodeEdit(project, page, node, new NodeEditRequest { HeadingText = "Renamed" });

        Assert.Same(before, node.Puzzle);
    }

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

        Assert.Equal(51, node.X); // #0, next to the A0 that's taken
        Assert.Equal(201, node.Y);
    }

    [Fact]
    public void AddNode_WithNoPositionOnAnEmptyMap_StartsAtA0()
    {
        var page = new Page();
        var node = ProjectEditing.AddNode(new WeaveProject { Pages = { page } }, page, null);

        Assert.Equal(201, node.X);
        Assert.Equal(201, node.Y);
    }

    [Fact]
    public void ApplyNodeEdit_NumberColumn_IsAllowedLikeAnyOtherSquare()
    {
        var node = new Node { X = 201, Y = 201 };
        var page = new Page { Nodes = { node } };

        ProjectEditing.ApplyNodeEdit(new WeaveProject { Pages = { page } }, page, node, new NodeEditRequest { X = 51, Y = 351 });

        Assert.Equal(51, node.X);
        Assert.Equal(351, node.Y);
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
