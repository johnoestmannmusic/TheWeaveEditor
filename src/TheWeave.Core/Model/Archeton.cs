using System.Text.Json.Serialization;

namespace TheWeave.Core.Model;

// Archetons: mechanical enemies placed on a puzzle's board, each built in the Editor from a drawing and a list of
// parts, rather than programmed one by one. They aren't beaten so much as got around. Shared by every puzzle in the
// project, like its drawings - see runtime/puzzle.js's createPuzzleGame for what each part does.

/// <summary>What a part of an Archeton is. Written by name, as this list is expected to keep growing.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ArchetonPartKind>))]
public enum ArchetonPartKind
{
    /// <summary>A sensor: sees the ship in a straight line, up to Range squares away, unless something's in the way.</summary>
    Beam,

    /// <summary>An effect: pushes the ship away along whichever beam sees it, a square at a time, until it's out of reach.</summary>
    Push,

    /// <summary>
    /// An effect: the ship can't step into anywhere a Beam reaches, and the laser shows across it while the ship is one
    /// square off it, or in it.
    /// </summary>
    Block,

    /// <summary>
    /// A movement: each time the ship takes a step, slides a square along its line towards the ship's column, or row -
    /// its row when it's placed facing Left or Right, its column facing Up or Down. Anything solid stops it, and it
    /// triggers what it lands on, as the ship would: Switches, Lanterns, Pipe Switches and Reset Switches.
    /// </summary>
    Slide,

    /// <summary>
    /// A movement: each time the ship takes a step, hops to the next square of its Moves, counted from the square it
    /// started on, so it always comes back round. A move that's blocked, it stays put for, and carries on with the next.
    /// </summary>
    Sequence,

    /// <summary>
    /// Touching it hurts: the ship stepping into it, or it landing on the ship, sends the ship back to the square it
    /// came from. It's still solid to everything else, so it stops beams, Slide Bugs and Push Blocks.
    /// </summary>
    Sting,
}

/// <summary>Which ways a Beam looks.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ArchetonLook>))]
public enum ArchetonLook
{
    /// <summary>Up, down, left and right.</summary>
    AllWays,

    /// <summary>Only the way the Archeton is placed facing.</summary>
    Facing,
}

/// <summary>One part of an Archeton, with whichever settings its kind has.</summary>
public sealed class ArchetonPart
{
    public ArchetonPartKind Kind { get; set; }

    /// <summary>Beam only: how many squares it reaches, from 1 to 9.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Range { get; set; }

    /// <summary>Beam only.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ArchetonLook? Look { get; set; }

    /// <summary>Beam only: whether Push Blocks stop it, as Walls, closed Gates and other Archetons always do.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? BlockedByBlocks { get; set; }

    /// <summary>Beam only: whether every square it reaches is outlined on the board, so the player can see where.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? ShowReach { get; set; }

    /// <summary>Sequence only: the moves it makes, one for each step the ship takes, over and over.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<PuzzleDirection>? Moves { get; set; }
}

/// <summary>One kind of Archeton: its name, what it's drawn with, and the parts that make it work.</summary>
public sealed class ArchetonDefinition
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>The id of an Archeton drawing in WeaveProject.PuzzleDrawings, or null for the Standard one.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Drawing { get; set; }

    /// <summary>The id of a Laser drawing in WeaveProject.PuzzleDrawings its lasers are drawn with, or null for the Standard one.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LaserDrawing { get; set; }

    public List<ArchetonPart> Parts { get; set; } = new();
}

public static class ArchetonDefinitions
{
    public const int MaxRange = 9;

    /// <summary>The first Archeton: an eye whose lasers reach 2 squares any way, blocking the ship from crossing them.</summary>
    public static ArchetonDefinition Sentribeam() => new()
    {
        Id = "sentribeam",
        Name = "Sentribeam",
        Parts =
        [
            new ArchetonPart { Kind = ArchetonPartKind.Beam, Range = 2, Look = ArchetonLook.AllWays, BlockedByBlocks = true, ShowReach = true },
            new ArchetonPart { Kind = ArchetonPartKind.Block },
        ],
    };

    /// <summary>The second Archeton: a mechanical woodlouse on 6 wheels, sliding along its line to keep in the ship's way.</summary>
    public static ArchetonDefinition SlideBug() => new()
    {
        Id = "slide-bug",
        Name = "Slide Bug",
        Drawing = SlideBugDrawingId,
        Parts = [new ArchetonPart { Kind = ArchetonPartKind.Slide }],
    };

    public const string SlideBugDrawingId = "slide-bug";

    /// <summary>Slide Bug's drawing, facing right: plated segments, a head with two eyes, and 3 wheels either side.</summary>
    public static PuzzleDrawing SlideBugDrawing() => new()
    {
        Id = SlideBugDrawingId,
        Kind = PuzzleObjectKind.Archeton,
        Name = "Slide Bug",
        Pixels =
        "........................" +
        "......O....OO....O......" +
        ".....O1O..O11O..O1O....." +
        "....O1H1O.OHHO.O1H1O...." +
        "....O111O.O11O.O111O...." +
        ".....OOO..OOOO..OOO....." +
        ".......OOO2333OOO......." +
        ".....OO3332333233OO....." +
        "....O32333233323344O...." +
        "...OGG2GGG2GGG2GG4O4O..." +
        "...OGG2GGG2GGG2GG444O..." +
        "...OGG2GGG2GGG2GG444O..." +
        "...OGG2GGG2GGG2GG444O..." +
        "...OGG2GGG2GGG2GG444O..." +
        "...OGG2GGG2GGG2GG4O4O..." +
        "....OG2GGG2GGG2GG44O...." +
        ".....OOGGG2GGG2GGOO....." +
        ".......OOO2GGGOOO......." +
        ".....OOO..OOOO..OOO....." +
        "....O111O.O11O.O111O...." +
        "....O1H1O.OHHO.O1H1O...." +
        ".....O1O..O11O..O1O....." +
        "......O....OO....O......" +
        "........................",
        Mix =
        [
            new PuzzleMixColour { Role = "archeton", Shade = 0, Percent = 15 },
            new PuzzleMixColour { Role = "archeton", Shade = 1, Percent = 25 },
            new PuzzleMixColour { Role = "archeton", Shade = 2, Percent = 45 },
            new PuzzleMixColour { Role = "archeton", Shade = 3, Percent = 15 },
        ],
    };

    /// <summary>The ready-made Archetons, each offered to a project once - see WeaveProject.ArchetonsOffered.</summary>
    /// <summary>The third Archeton: a spider that hops round its starting square, up, down, left and right, and stings.</summary>
    public static ArchetonDefinition JumpbugA() => new()
    {
        Id = "jumpbug-a",
        Name = "Jumpbug A",
        Drawing = JumpbugDrawingId,
        Parts =
        [
            new ArchetonPart
            {
                Kind = ArchetonPartKind.Sequence,
                Moves = [PuzzleDirection.Up, PuzzleDirection.Down, PuzzleDirection.Down, PuzzleDirection.Up, PuzzleDirection.Left, PuzzleDirection.Right, PuzzleDirection.Right, PuzzleDirection.Left],
            },
            new ArchetonPart { Kind = ArchetonPartKind.Sting },
        ],
    };

    public const string JumpbugDrawingId = "jumpbug";

    /// <summary>Jumpbug's drawing: a round body with a head at the top, and 4 bent legs out to the sides.</summary>
    public static PuzzleDrawing JumpbugDrawing() => new()
    {
        Id = JumpbugDrawingId,
        Kind = PuzzleObjectKind.Archeton,
        Name = "Jumpbug",
        Pixels =
        "........................" +
        "........................" +
        "........................" +
        "........................" +
        "..........OOOO.........." +
        "..........O22O.........." +
        "....O....OH22HO....O...." +
        "...O3OO...O22O...OO3O..." +
        "...O333O.O2222O.O333O..." +
        "..O33O33OGGGGGGO33O33O.." +
        "..O3O.OGG444GGGGGO.O3O.." +
        "..OO...OG444GGGGO...OO.." +
        ".O3O..OGGGGGGGGGGO..O3O." +
        "..O...OGGGGGGGGGGO...O.." +
        "......OGGGGGGGGGGO......" +
        "....OO311111111113OO...." +
        "...O3OOOO111111OOOO3O..." +
        "...OO....OO11OO....OO..." +
        "..O3O......OO......O3O.." +
        "..O3O..............O3O.." +
        "..OO................OO.." +
        ".O3O................O3O." +
        "..O..................O.." +
        "........................",
        Mix =
        [
            new PuzzleMixColour { Role = "archeton", Shade = 0, Percent = 15 },
            new PuzzleMixColour { Role = "archeton", Shade = 1, Percent = 25 },
            new PuzzleMixColour { Role = "archeton", Shade = 2, Percent = 45 },
            new PuzzleMixColour { Role = "archeton", Shade = 3, Percent = 15 },
        ],
    };

    /// <summary>How many moves a Sequence can have.</summary>
    public const int MaxMoves = 32;

    public static IReadOnlyList<Func<ArchetonDefinition>> ReadyMade { get; } = [Sentribeam, SlideBug, JumpbugA];

    /// <summary>The drawing a ready-made Archeton comes with, by its id, or null.</summary>
    public static PuzzleDrawing? ReadyMadeDrawing(string? id) => id switch
    {
        SlideBugDrawingId => SlideBugDrawing(),
        JumpbugDrawingId => JumpbugDrawing(),
        _ => null,
    };

    /// <summary>
    /// Sentribeam first pushed the ship back rather than blocking it. A project still with that first version, untouched,
    /// gets the new one's Block in place of its Push. One that's been changed is left as it is.
    /// </summary>
    public static void UpgradeFirstSentribeam(List<ArchetonDefinition>? archetons)
    {
        var first = archetons?.FirstOrDefault(a => a.Id == "sentribeam" && a.Name == "Sentribeam" && a.Drawing is null);
        if (first is not { Parts.Count: 2 })
            return;
        var beam = first.Parts[0];
        var unchanged = beam is { Kind: ArchetonPartKind.Beam, Range: 2, Look: ArchetonLook.AllWays, BlockedByBlocks: true }
            && first.Parts[1].Kind == ArchetonPartKind.Push;
        if (unchanged)
            first.Parts[1] = new ArchetonPart { Kind = ArchetonPartKind.Block };
    }

    /// <summary>The definitions a puzzle's Archetons are, from a library.</summary>
    public static List<ArchetonDefinition> UsedBy(Puzzle puzzle, IEnumerable<ArchetonDefinition>? library)
    {
        var ids = puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.Archeton && o.Archeton is not null).Select(o => o.Archeton!).ToHashSet();
        return (library ?? []).Where(d => ids.Contains(d.Id)).ToList();
    }

    /// <summary>The drawings a set of definitions are drawn with, their lasers' included, from a library, and any redrawn Standard ones.</summary>
    public static List<PuzzleDrawing> DrawingsOf(IEnumerable<ArchetonDefinition> definitions, IEnumerable<PuzzleDrawing>? library)
    {
        var list = definitions.ToList();
        var bodies = list.Where(d => d.Drawing is not null).Select(d => d.Drawing!).Append(nameof(PuzzleObjectKind.Archeton)).ToHashSet();
        var lasers = list.Where(d => d.LaserDrawing is not null).Select(d => d.LaserDrawing!).Append(nameof(PuzzleObjectKind.Laser)).ToHashSet();
        if (list.Count == 0)
            return [];
        return (library ?? []).Where(d => (d.Kind == PuzzleObjectKind.Archeton && bodies.Contains(d.Id))
            || (d.Kind == PuzzleObjectKind.Laser && lasers.Contains(d.Id))).ToList();
    }
}
