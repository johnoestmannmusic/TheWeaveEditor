using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;
using TheWeave.Core.Serialization;
using Xunit;

namespace TheWeave.Core.Tests;

public class WeaveProjectSerializerTests
{
    private static Puzzle MakeFilePuzzle() => new()
    {
        PaletteSource = "img/track.png",
        Palette = { ["wall"] = "#112233" },
        Textures = { ["wall"] = new PuzzleTexture { Ramp = { "#112233" }, Pixels = "0" } },
        Objects =
        {
            new PuzzleObject { Kind = PuzzleObjectKind.Gate, Col = 2, Row = 3, Letter = "A", Open = true },
            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 4, Row = 5, Direction = PuzzleDirection.Left },
            new PuzzleObject { Kind = PuzzleObjectKind.Wall, Col = 6, Row = 7 },
        },
    };

    [Fact]
    public void PuzzleFile_RoundTripsTheLayout()
    {
        var (objects, drawings, _) = PuzzleFile.Parse(PuzzleFile.Serialize(MakeFilePuzzle()));

        Assert.Empty(drawings);
        Assert.Equal(3, objects.Count);
        Assert.Equal(PuzzleObjectKind.Gate, objects[0].Kind);
        Assert.Equal((2, 3), (objects[0].Col, objects[0].Row));
        Assert.Equal("A", objects[0].Letter);
        Assert.True(objects[0].Open);
        Assert.Equal(PuzzleDirection.Left, objects[1].Direction);
        Assert.Null(objects[2].Letter);
        Assert.False(objects[2].Open);
    }

    [Fact]
    public void PuzzleFile_LeavesOutWhatComesFromTheArt_AndIsEasyToRead()
    {
        var json = PuzzleFile.Serialize(MakeFilePuzzle());

        Assert.DoesNotContain("Palette", json);
        Assert.DoesNotContain("Textures", json);
        Assert.DoesNotContain("#112233", json);
        Assert.Contains("\"Kind\": \"Wall\"", json);
        Assert.DoesNotContain("null", json);
    }

    [Theory]
    [InlineData("not json at all", "can't be read")]
    [InlineData("{}", "isn't a Sokoban puzzle file")]
    [InlineData("{ \"Pages\": [] }", "isn't a Sokoban puzzle file")]
    [InlineData("null", "isn't a Sokoban puzzle file")]
    [InlineData("[1, 2]", "can't be read")]
    [InlineData("{ \"Format\": \"weave-sokoban-puzzle\", \"Version\": 99, \"Objects\": [] }", "newer version")]
    [InlineData("{ \"Format\": \"weave-sokoban-puzzle\", \"Version\": 1, \"Objects\": [{ \"Kind\": \"Dragon\" }] }", "can't be read")]
    public void PuzzleFile_RejectsWhatItCantUse(string json, string expected)
    {
        var e = Assert.Throws<InvalidDataException>(() => PuzzleFile.Parse(json));

        Assert.Contains(expected, e.Message);
    }

    [Fact]
    public void PuzzleFile_WithNoObjects_IsAnEmptyBoard()
    {
        Assert.Empty(PuzzleFile.Parse("{ \"format\": \"weave-sokoban-puzzle\", \"version\": 1 }").Objects);
    }

    private static PuzzleDrawing MakeDrawing(string id, PuzzleObjectKind kind = PuzzleObjectKind.Wall, char paint = 'G') => new()
    {
        Id = id,
        Kind = kind,
        Name = id,
        Pixels = new string(paint, PuzzleDrawings.TilePixels),
        Mix = { new PuzzleMixColour { Role = "wall", Shade = 2, Percent = 100 } },
    };

    [Fact]
    public void PuzzleFile_CarriesOnlyTheDrawingsItsObjectsUse()
    {
        var puzzle = MakeFilePuzzle();
        puzzle.Objects[2].Variant = "mossy";
        var library = new List<PuzzleDrawing> { MakeDrawing("mossy"), MakeDrawing("unused"), MakeDrawing("Wall"), MakeDrawing("mossy-key", PuzzleObjectKind.Key) };

        var (objects, drawings, _) = PuzzleFile.Parse(PuzzleFile.Serialize(puzzle, library));

        Assert.Equal("mossy", objects[2].Variant);
        Assert.Equal(["mossy"], drawings.Select(d => d.Id));
        Assert.Equal(PuzzleObjectKind.Wall, drawings[0].Kind);
        Assert.Equal(PuzzleDrawings.TilePixels, drawings[0].Pixels.Length);
    }

    [Fact]
    public void PuzzleDrawings_Merge_AddsWhatsMissing_SkipsWhatsThere_AndCopiesAClash()
    {
        var library = new List<PuzzleDrawing> { MakeDrawing("same"), MakeDrawing("clash", paint: 'O') };
        var objects = new List<PuzzleObject>
        {
            new() { Kind = PuzzleObjectKind.Wall, Variant = "same" },
            new() { Kind = PuzzleObjectKind.Wall, Variant = "clash" },
            new() { Kind = PuzzleObjectKind.Wall, Variant = "new" },
        };

        var added = PuzzleDrawings.Merge(library, [MakeDrawing("same"), MakeDrawing("clash"), MakeDrawing("new"), MakeDrawing("Wall")], objects);

        Assert.Equal(["clash-2", "new"], added.Select(d => d.Id));
        Assert.Equal(["same", "clash-2", "new"], objects.Select(o => o.Variant));
        Assert.Equal('G', added[0].Pixels[0]);
    }

    [Fact]
    public void PuzzleDrawings_UsedBy_IncludesARedrawnStandard_OnlyForKindsOnTheBoard()
    {
        var puzzle = MakeFilePuzzle();
        var library = new List<PuzzleDrawing> { MakeDrawing("Wall"), MakeDrawing("Key", PuzzleObjectKind.Key) };

        Assert.Equal(["Wall"], PuzzleDrawings.UsedBy(puzzle, library).Select(d => d.Id));
        Assert.Empty(PuzzleDrawings.UsedBy(puzzle, library, includeStandard: false));
    }

    [Fact]
    public void Drawings_RoundTrip_AndAreLeftOutOfAProjectWithoutAny()
    {
        var project = new WeaveProject();
        Assert.DoesNotContain("PuzzleDrawings", WeaveProjectSerializer.Serialize(project));

        project.PuzzleDrawings = [MakeDrawing("gate-a", PuzzleObjectKind.Gate)];
        project.PuzzleDrawings[0].OpenPixels = new string('.', PuzzleDrawings.TilePixels);
        var back = WeaveProjectSerializer.Deserialize(WeaveProjectSerializer.Serialize(project));

        var drawing = Assert.Single(back.PuzzleDrawings!);
        Assert.Equal(PuzzleObjectKind.Gate, drawing.Kind);
        Assert.Equal(PuzzleDrawings.TilePixels, drawing.OpenPixels!.Length);
        Assert.Equal("wall", drawing.Mix[0].Role);
        Assert.Contains("\"Kind\": \"Gate\"", WeaveProjectSerializer.Serialize(project));
    }

    [Fact]
    public void Puzzle_RoundTrips_WithItsKindsAndDirectionsWrittenByName()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page
        {
            Id = "ouros",
            Nodes =
            {
                new Node
                {
                    Id = "track",
                    Puzzle = new Puzzle
                    {
                        PaletteSource = "img/track.png",
                        Palette = { ["wall"] = "#112233" },
                        Objects =
                        {
                            new PuzzleObject { Kind = PuzzleObjectKind.Gate, Col = 2, Row = 3, Letter = "A", Open = true },
                            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 4, Row = 5, Direction = PuzzleDirection.Left },
                            new PuzzleObject { Kind = PuzzleObjectKind.RotatorTile, Col = 6, Row = 7, Direction = PuzzleDirection.Up, Invisible = true },
                            new PuzzleObject { Kind = PuzzleObjectKind.Lantern, Col = 8, Row = 9 },
                        },
                        Textures = { ["wall"] = new PuzzleTexture { Ramp = { "#112233" }, Pixels = "0" } },
                    },
                },
            },
        });

        var json = WeaveProjectSerializer.Serialize(project);
        Assert.Contains("\"Kind\": \"Gate\"", json);
        Assert.Contains("\"Direction\": \"Left\"", json);

        var puzzle = WeaveProjectSerializer.Deserialize(json).Pages[0].Nodes[0].Puzzle!;
        Assert.Equal("img/track.png", puzzle.PaletteSource);
        Assert.Equal("#112233", puzzle.Palette["wall"]);
        Assert.Equal(PuzzleObjectKind.Gate, puzzle.Objects[0].Kind);
        Assert.Equal("A", puzzle.Objects[0].Letter);
        Assert.Equal(PuzzleDirection.Left, puzzle.Objects[1].Direction);
        Assert.True(puzzle.Objects[0].Open);
        Assert.False(puzzle.Objects[1].Open);
        Assert.Equal(PuzzleObjectKind.RotatorTile, puzzle.Objects[2].Kind);
        Assert.Equal(PuzzleDirection.Up, puzzle.Objects[2].Direction);
        Assert.True(puzzle.Objects[2].Invisible);
        Assert.Equal(PuzzleObjectKind.Lantern, puzzle.Objects[3].Kind);
        Assert.False(puzzle.Objects[3].Invisible);
        Assert.Equal(1, System.Text.RegularExpressions.Regex.Count(json, "\"Invisible\""));
        Assert.Equal(1, System.Text.RegularExpressions.Regex.Count(json, "\"Open\""));
        Assert.Equal("#112233", puzzle.Textures["wall"].Ramp[0]);
        Assert.Equal("0", puzzle.Textures["wall"].Pixels);
    }

    [Fact]
    public void Node_WithNoPuzzle_LeavesItOutOfTheFile()
    {
        var project = new WeaveProject();
        project.Pages.Add(new Page { Id = "ouros", Nodes = { new Node { Id = "track" } } });

        var json = WeaveProjectSerializer.Serialize(project);

        Assert.DoesNotContain("\"Puzzle\"", json);
        Assert.Null(WeaveProjectSerializer.Deserialize(json).Pages[0].Nodes[0].Puzzle);
    }

    private static WeaveProject BuildSampleProject()
    {
        var project = new WeaveProject
        {
            Title = "The Weave",
            Groups = { new PageGroup { Id = "planets", Name = "Planets" } },
        };

        var ouros = new Page
        {
            Id = "ouros",
            Title = "Ouros - The Weave Explorer",
            OutputFileName = "ouros.html",
            GroupId = "planets",
            Background = new ImageRef { ImagePath = "img/ouros/ouros.png" },
            Effects =
            {
                new CrossfadeLayerEffect
                {
                    Id = "fx-crossfade",
                    ImagePath = "img/shrine-layers/0001/0001-map-2.png",
                    OpacityFrom = 0,
                    OpacityTo = 0.82,
                    DurationMs = 9500,
                },
                new DriftingSpriteEffect
                {
                    Id = "fx-flame-1",
                    ImagePath = "img/shrine-layers/0001/flame.gif",
                    X = 785,
                    Y = 1154,
                    BlendMode = "exclusion",
                    DriftX = new DriftAxis { FromPx = 0, ToPx = 1000, DurationMs = 5000, Direction = "alternate-reverse" },
                    DriftY = new DriftAxis { FromPx = -50, ToPx = 50, DurationMs = 1000 },
                },
            },
        };

        var parentNode = new Node
        {
            Id = "salanth-town-gardens",
            X = 173,
            Y = 158,
            Card = new Card
            {
                HeadingText = "Salanth Town Gardens",
                CoverImagePath = "img/ouros/salanth-gardens-1.png",
                Audio = new AudioRef { Url = "https://johnoestmannmusic.com/wp-content/uploads/2026/07/salanth-town-gardens.ogg" },
                PoetryLines = { "Sprawling Gardens", "Of Salanth Town" },
                Action = new CardAction { Kind = ActionKind.Download, Url = "https://johnoestmannmusic.com/0x2a72b-salanth-town-gardens/" },
            },
            Children =
            {
                new Node
                {
                    Id = "jherop-phantom",
                    X = -81,
                    Y = 184,
                    Card = new Card
                    {
                        HeadingText = "Jherop Phantom",
                        CoverImagePath = "img/racers/jherop-phantom.png",
                        PoetryLines = { "**PILOT:** REJJA" },
                        Action = new CardAction { Kind = ActionKind.Download, Url = "https://johnoestmannmusic.com/0x2a72b-ii-salanth-town-gardens-page-2/" },
                    },
                },
            },
        };

        ouros.Nodes.Add(parentNode);
        project.Pages.Add(ouros);

        return project;
    }

    [Fact]
    public void RoundTrip_PreservesNestedNodesAndPolymorphicEffects()
    {
        var original = BuildSampleProject();

        var json = WeaveProjectSerializer.Serialize(original);
        var restored = WeaveProjectSerializer.Deserialize(json);

        var page = Assert.Single(restored.Pages);
        Assert.Equal("ouros", page.Id);

        Assert.Equal(2, page.Effects.Count);
        var crossfade = Assert.IsType<CrossfadeLayerEffect>(page.Effects[0]);
        Assert.Equal(0.82, crossfade.OpacityTo);

        var drift = Assert.IsType<DriftingSpriteEffect>(page.Effects[1]);
        Assert.Equal("exclusion", drift.BlendMode);
        Assert.NotNull(drift.DriftX);
        Assert.Equal(1000, drift.DriftX!.ToPx);

        var parent = Assert.Single(page.Nodes);
        Assert.Equal("salanth-town-gardens", parent.Id);
        Assert.Equal(ActionKind.Download, parent.Card.Action.Kind);

        var child = Assert.Single(parent.Children);
        Assert.Equal("jherop-phantom", child.Id);
        Assert.Equal("**PILOT:** REJJA", child.Card.PoetryLines[0]);
    }

    [Fact]
    public void Deserialize_OlderProject_IsUpgradedOnTheWayIn()
    {
        var json = """
            {
              "SchemaVersion": 1,
              "DefaultWorldWidthPx": 3010,
              "DefaultWorldHeightPx": 1696,
              "Pages": [ { "Id": "ouros", "Wraps": true, "Nodes": [ { "Id": "a", "X": 173, "Y": 158 } ] } ]
            }
            """;

        var project = WeaveProjectSerializer.Deserialize(json);

        Assert.Equal(ProjectMigrations.CurrentSchemaVersion, project.SchemaVersion);
        Assert.Equal(3000, project.DefaultWorldWidthPx);
        var node = Assert.Single(Assert.Single(project.Pages).Nodes);
        Assert.Equal(201, node.X);
        Assert.Equal(201, node.Y);
    }

    [Fact]
    public void Deserialize_CurrentProject_IsLeftAlone()
    {
        var original = BuildSampleProject();
        original.Pages[0].Nodes[0].X = 12;

        var restored = WeaveProjectSerializer.Deserialize(WeaveProjectSerializer.Serialize(original), out var notes);

        Assert.Null(notes);
        Assert.Equal(12, restored.Pages[0].Nodes[0].X);
    }

    [Fact]
    public void Page_GlobeEffectDefaultsToTrue()
    {
        var page = new Page();

        Assert.True(page.GlobeEffect);
    }

    [Fact]
    public void RoundTrip_PreservesExplicitGlobeEffectFalse()
    {
        var original = BuildSampleProject();
        original.Pages[0].GlobeEffect = false;

        var json = WeaveProjectSerializer.Serialize(original);
        var restored = WeaveProjectSerializer.Deserialize(json);

        Assert.False(Assert.Single(restored.Pages).GlobeEffect);
    }

    [Fact]
    public void SaveAndLoadFromFile_RoundTrips()
    {
        var original = BuildSampleProject();
        var path = Path.Combine(Path.GetTempPath(), $"weave-test-{Guid.NewGuid():N}.json");

        try
        {
            WeaveProjectSerializer.SaveToFile(original, path);
            var restored = WeaveProjectSerializer.LoadFromFile(path);

            Assert.Equal(original.Title, restored.Title);
            Assert.Single(restored.Pages);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
