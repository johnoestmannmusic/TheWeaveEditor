using System.Text.Json.Serialization;

namespace TheWeave.Core.Model;

// Written by name rather than number, unlike the project's other enums: this list is expected to keep
// growing, and a name stays readable in the project file and can't change meaning if the order does.
[JsonConverter(typeof(JsonStringEnumConverter<PuzzleObjectKind>))]
public enum PuzzleObjectKind
{
    /// <summary>Can't be moved through.</summary>
    Wall,

    /// <summary>Reaching this solves the puzzle.</summary>
    Finish,

    /// <summary>Blocks the way until a Switch with the same letter opens it.</summary>
    Gate,

    /// <summary>Stepping on this opens or closes every Gate with the same letter.</summary>
    Switch,

    /// <summary>Stepping on this moves the ship to the other Teleporter with the same letter.</summary>
    Teleporter,

    /// <summary>A conveyor belt, carrying the ship and whatever's placed on it in its Direction.</summary>
    Stream,

    /// <summary>If a puzzle has any, all of them have to be collected before Switches do anything.</summary>
    Key,

    /// <summary>Where the ship begins. A puzzle has at most one.</summary>
    Start,

    /// <summary>Like a Stream, moving what's on it in its Direction, but only while the ship is on a RotatorSwitch.</summary>
    RotatorTile,

    /// <summary>While the ship is on this, RotatorTiles move what's on them once per second.</summary>
    RotatorSwitch,

    /// <summary>Stepping on this lights it for good, revealing Invisible things within reach of it.</summary>
    Lantern,

    /// <summary>Pushed a square by the ship walking into it. Two or more with the same Symbol side by side sink into the ground.</summary>
    PushBlock,

    /// <summary>Stepping on this launches the ship 2 squares in its Direction, over anything in between, or 1 if it can't land that far.</summary>
    JumpTile,

    /// <summary>Stepping on this puts every object but Walls back as the puzzle started, leaving the ship where it is.</summary>
    ResetSwitch,

    /// <summary>
    /// A floor tile the ship and objects can only move into, through and out of along it: across while it lies Left or
    /// Right, and up and down while it stands Up or Down.
    /// </summary>
    Pipe,

    /// <summary>Stepping on this turns every Pipe a quarter turn anticlockwise, and again each second the ship stays on it.</summary>
    PipeSwitch,
}

/// <summary>A Push Block's symbol, drawn on it as a hollow outline - see runtime/puzzle.js's SYMBOLS.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PuzzleSymbol>))]
public enum PuzzleSymbol
{
    Circle,
    Cross,
    Triangle,
    Square,
    Star,
}

[JsonConverter(typeof(JsonStringEnumConverter<PuzzleDirection>))]
public enum PuzzleDirection
{
    Up,
    Down,
    Left,
    Right,
}

/// <summary>One thing on a puzzle's board. A square holds one object, plus optionally a floor tile (a Stream, RotatorTile or Pipe) under it.</summary>
public sealed class PuzzleObject
{
    public PuzzleObjectKind Kind { get; set; }
    public int Col { get; set; }
    public int Row { get; set; }

    /// <summary>Gate, Switch and Teleporter only. Gates and Switches pair up by letter, and Teleporters do separately.</summary>
    public string? Letter { get; set; }

    /// <summary>Stream, RotatorTile, JumpTile and Pipe only.</summary>
    public PuzzleDirection? Direction { get; set; }

    /// <summary>PushBlock only.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PuzzleSymbol? Symbol { get; set; }

    /// <summary>Gate only: whether it starts the puzzle open. Left out of the project file when it doesn't.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Open { get; set; }

    /// <summary>
    /// Anything but Finish and Start: whether it starts out unseen until a Lantern reveals it. It still
    /// behaves exactly the same. Left out of the project file when it isn't.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Invisible { get; set; }

    /// <summary>
    /// The id of the PuzzleDrawing in WeaveProject.PuzzleDrawings it's drawn with. Left out of the project file
    /// when it's its kind's Standard drawing.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Variant { get; set; }
}

/// <summary>
/// One object colour's texture, generated from the album art (see runtime/puzzle.js's pickTextures): its 4
/// shades, darkest first, the art's grain for mixes, and its Standard look.
/// </summary>
public sealed class PuzzleTexture
{
    public List<string> Ramp { get; set; } = new();

    /// <summary>One base-36 lightness digit per pixel of a square. Missing from a texture made before mixes.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Grain { get; set; }

    /// <summary>
    /// One digit per pixel saying which of Ramp's shades goes there in the Standard look. In a texture made
    /// before mixes, Ramp held only the shades the art had, and this stands in for the grain too.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Pixels { get; set; }
}

/// <summary>One of a drawing's mix of colours: a shade of a palette colour, and how much of the drawing's grain it covers.</summary>
public sealed class PuzzleMixColour
{
    /// <summary>A palette role, like "wall" or "key", or "outline" or "light", which have only the one shade.</summary>
    public string Role { get; set; } = "";

    /// <summary>0 to 3: Darkest, Dark, Main or Light.</summary>
    public int Shade { get; set; }

    /// <summary>Taken in proportion to the others, so they needn't add up to exactly 100.</summary>
    public int Percent { get; set; }
}

/// <summary>
/// Pixel art for one kind of object, shared by every puzzle in the project and recoloured from each one's
/// album art (see runtime/puzzle.js's buildSprite). One whose Id is its Kind's name redraws that kind's Standard drawing.
/// </summary>
public sealed class PuzzleDrawing
{
    public string Id { get; set; } = "";
    public PuzzleObjectKind Kind { get; set; }
    public string Name { get; set; } = "";

    /// <summary>One paint per pixel of a square, row by row - see PuzzleDrawings.Paints.</summary>
    public string Pixels { get; set; } = "";

    /// <summary>Gate only: how it looks open.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? OpenPixels { get; set; }

    /// <summary>
    /// Stream only: its channel bending in from its left, for where another Stream pours into it from the side.
    /// Drawn flowing right, like Pixels, which for a Stream or Rotator tile is its Still layer.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? BendPixels { get; set; }

    /// <summary>Stream and Rotator tile only: the layer that moves along with the flow, over the Still one.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FlowPixels { get; set; }

    public List<PuzzleMixColour> Mix { get; set; } = new();
}

/// <summary>
/// A named group of one kind's drawings, for the Puzzle Editor to place from: each square placed from a set gets
/// one of its drawings at random. Only a way of placing, so the game never sees it - each object still has its
/// own drawing.
/// </summary>
public sealed class PuzzleDrawingSet
{
    public string Id { get; set; } = "";
    public PuzzleObjectKind Kind { get; set; }
    public string Name { get; set; } = "";

    /// <summary>Its drawings' ids. A kind's own name is its Standard drawing, which can be in a set too.</summary>
    public List<string> Drawings { get; set; } = new();
}

/// <summary>The rules for PuzzleDrawings, shared with runtime/puzzle.js.</summary>
public static class PuzzleDrawings
{
    public const int TilePixels = 24 * 24;

    /// <summary>
    /// Nothing, the outline colour, the light colour, the mix laid out in the album's grain, or one of the
    /// mix's colours (darkest first) on its own.
    /// </summary>
    public const string Paints = ".OHG1234";

    public static readonly IReadOnlyList<string> Roles = ["wall", "finish", "gate", "teleporter", "stream", "key", "rotator", "lantern", "block", "jump", "reset", "pipe", "outline", "light"];

    /// <summary>Every kind drawn from a drawing.</summary>
    public static readonly IReadOnlySet<PuzzleObjectKind> DrawnKinds = new HashSet<PuzzleObjectKind>
    {
        PuzzleObjectKind.Wall, PuzzleObjectKind.Finish, PuzzleObjectKind.Gate, PuzzleObjectKind.Switch,
        PuzzleObjectKind.Teleporter, PuzzleObjectKind.Key, PuzzleObjectKind.RotatorSwitch, PuzzleObjectKind.Lantern,
        PuzzleObjectKind.Stream, PuzzleObjectKind.RotatorTile, PuzzleObjectKind.PushBlock, PuzzleObjectKind.JumpTile,
        PuzzleObjectKind.ResetSwitch, PuzzleObjectKind.Pipe, PuzzleObjectKind.PipeSwitch,
    };

    /// <summary>The kinds animated as they flow: a Still layer, and a Flow layer that moves along it.</summary>
    public static bool IsAnimated(PuzzleObjectKind kind) => kind is PuzzleObjectKind.Stream or PuzzleObjectKind.RotatorTile;

    public static bool IsStandard(PuzzleDrawing drawing) => drawing.Id == drawing.Kind.ToString();

    /// <summary>
    /// The drawings from a library that a puzzle is drawn with: its objects' variants, and, unless only
    /// variants are wanted, any redrawn Standard drawing of a kind it has.
    /// </summary>
    public static List<PuzzleDrawing> UsedBy(Puzzle puzzle, IEnumerable<PuzzleDrawing>? library, bool includeStandard = true) =>
        (library ?? []).Where(drawing => puzzle.Objects.Any(o => o.Kind == drawing.Kind
            && (o.Variant == drawing.Id || (includeStandard && IsStandard(drawing))))).ToList();

    /// <summary>
    /// Which of a puzzle file's drawings a library needs adding, pointing its objects at the ones added. One
    /// with the same id as a different drawing already there comes in as a copy under a new id.
    /// </summary>
    public static List<PuzzleDrawing> Merge(IEnumerable<PuzzleDrawing>? library, IEnumerable<PuzzleDrawing> incoming, List<PuzzleObject> objects)
    {
        var existing = (library ?? []).ToList();
        var added = new List<PuzzleDrawing>();

        foreach (var drawing in incoming.Where(d => !IsStandard(d)))
        {
            var same = existing.Concat(added).FirstOrDefault(d => d.Id == drawing.Id);
            if (same is not null && SameDrawing(same, drawing))
                continue;

            var id = drawing.Id;
            if (same is not null)
            {
                var taken = existing.Concat(added).Select(d => d.Id).ToHashSet();
                for (var n = 2; taken.Contains(id); n++)
                    id = $"{drawing.Id}-{n}";
                foreach (var obj in objects.Where(o => o.Kind == drawing.Kind && o.Variant == drawing.Id))
                    obj.Variant = id;
            }

            added.Add(new PuzzleDrawing
            {
                Id = id,
                Kind = drawing.Kind,
                Name = drawing.Name,
                Pixels = drawing.Pixels,
                OpenPixels = drawing.OpenPixels,
                BendPixels = drawing.BendPixels,
                FlowPixels = drawing.FlowPixels,
                Mix = drawing.Mix.Select(m => new PuzzleMixColour { Role = m.Role, Shade = m.Shade, Percent = m.Percent }).ToList(),
            });
        }
        return added;
    }

    private static bool SameDrawing(PuzzleDrawing a, PuzzleDrawing b) =>
        a.Kind == b.Kind && a.Name == b.Name && a.Pixels == b.Pixels && a.OpenPixels == b.OpenPixels
        && a.BendPixels == b.BendPixels && a.FlowPixels == b.FlowPixels
        && a.Mix.Count == b.Mix.Count
        && a.Mix.Zip(b.Mix).All(pair => pair.First.Role == pair.Second.Role && pair.First.Shade == pair.Second.Shade && pair.First.Percent == pair.Second.Percent);
}

/// <summary>
/// A Sokoban puzzle played over a track's album art, on a board of BoardSize x BoardSize squares. Stored
/// on the track's own Node, so each part of a multi-part location has its own.
/// </summary>
public sealed class Puzzle
{
    public const int BoardSize = 10;

    public List<PuzzleObject> Objects { get; set; } = new();

    /// <summary>
    /// The colours to draw this puzzle with, by role (see runtime/puzzle.js's pickPalette). Stored rather
    /// than worked out when needed, because the Editor can read the art's pixels and an exported site
    /// opened from disk can't.
    /// </summary>
    public Dictionary<string, string> Palette { get; set; } = new();

    /// <summary>The objects' textures, by the same roles as Palette and stored for the same reason.</summary>
    public Dictionary<string, PuzzleTexture> Textures { get; set; } = new();

    /// <summary>The Card.CoverImagePath that Palette and Textures were made from, to tell when they've gone out of date.</summary>
    public string? PaletteSource { get; set; }
}

/// <summary>
/// How one part's board leads on to the next part's, edge to edge like screens of a map: a Finish on an edge
/// leads off it, and the ship comes in on the opposite edge of the next board, directly across. Shared with
/// runtime/puzzle.js's exitDirectionOf and entranceFrom.
/// </summary>
public static class PuzzleConnection
{
    /// <summary>Which way a square leads off the board, or null in the middle or in a corner, which would point two ways.</summary>
    public static PuzzleDirection? ExitDirectionOf(int col, int row)
    {
        var last = Puzzle.BoardSize - 1;
        var onSide = col == 0 || col == last;
        var onTopOrBottom = row == 0 || row == last;
        if (onSide == onTopOrBottom)
            return null;

        if (onSide)
            return col == 0 ? PuzzleDirection.Left : PuzzleDirection.Right;
        return row == 0 ? PuzzleDirection.Up : PuzzleDirection.Down;
    }

    /// <summary>Where the ship comes in on the next board after leaving through an edge square.</summary>
    public static (int Col, int Row) EntranceFrom(int col, int row, PuzzleDirection exit)
    {
        var last = Puzzle.BoardSize - 1;
        return exit switch
        {
            PuzzleDirection.Left => (last, row),
            PuzzleDirection.Right => (0, row),
            PuzzleDirection.Up => (col, last),
            _ => (col, 0),
        };
    }

    /// <summary>
    /// Where the ship comes in on the board after this one, or null if this one doesn't lead on: it needs
    /// exactly one Finish, on an edge.
    /// </summary>
    public static (int Col, int Row)? EntranceAfter(Puzzle? puzzle)
    {
        var finishes = puzzle?.Objects.Where(o => o.Kind == PuzzleObjectKind.Finish).ToList();
        if (finishes is not { Count: 1 })
            return null;

        var finish = finishes[0];
        var exit = ExitDirectionOf(finish.Col, finish.Row);
        return exit is null ? null : EntranceFrom(finish.Col, finish.Row, exit.Value);
    }

    /// <summary>Whatever on the board is in the way of the ship coming in at a square - anything but a floor tile or Start.</summary>
    public static PuzzleObject? BlockingEntrance(Puzzle puzzle, (int Col, int Row) entrance) =>
        puzzle.Objects.FirstOrDefault(o => o.Col == entrance.Col && o.Row == entrance.Row
            && o.Kind is not (PuzzleObjectKind.Start or PuzzleObjectKind.Stream or PuzzleObjectKind.RotatorTile or PuzzleObjectKind.Pipe));
}
