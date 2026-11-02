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
}

[JsonConverter(typeof(JsonStringEnumConverter<PuzzleDirection>))]
public enum PuzzleDirection
{
    Up,
    Down,
    Left,
    Right,
}

/// <summary>One thing on a puzzle's board. A square holds one object, plus optionally a floor tile (a Stream or RotatorTile) under it.</summary>
public sealed class PuzzleObject
{
    public PuzzleObjectKind Kind { get; set; }
    public int Col { get; set; }
    public int Row { get; set; }

    /// <summary>Gate, Switch and Teleporter only. Gates and Switches pair up by letter, and Teleporters do separately.</summary>
    public string? Letter { get; set; }

    /// <summary>Stream and RotatorTile only.</summary>
    public PuzzleDirection? Direction { get; set; }

    /// <summary>Gate only: whether it starts the puzzle open. Left out of the project file when it doesn't.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Open { get; set; }

    /// <summary>
    /// Anything but Finish and Start: whether it starts out unseen until a Lantern reveals it. It still
    /// behaves exactly the same. Left out of the project file when it isn't.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Invisible { get; set; }
}

/// <summary>
/// One object colour's texture, generated from the album art (see runtime/puzzle.js's pickTextures): the
/// shades it's made of, and one digit per pixel of a square saying which shade goes there.
/// </summary>
public sealed class PuzzleTexture
{
    public List<string> Ramp { get; set; } = new();
    public string Pixels { get; set; } = "";
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
            && o.Kind is not (PuzzleObjectKind.Start or PuzzleObjectKind.Stream or PuzzleObjectKind.RotatorTile));
}
