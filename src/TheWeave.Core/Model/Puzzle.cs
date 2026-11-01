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
}

[JsonConverter(typeof(JsonStringEnumConverter<PuzzleDirection>))]
public enum PuzzleDirection
{
    Up,
    Down,
    Left,
    Right,
}

/// <summary>One thing on a puzzle's board. A square holds one object, plus optionally a Stream under it.</summary>
public sealed class PuzzleObject
{
    public PuzzleObjectKind Kind { get; set; }
    public int Col { get; set; }
    public int Row { get; set; }

    /// <summary>Gate, Switch and Teleporter only. Gates and Switches pair up by letter, and Teleporters do separately.</summary>
    public string? Letter { get; set; }

    /// <summary>Stream only.</summary>
    public PuzzleDirection? Direction { get; set; }

    /// <summary>Gate only: whether it starts the puzzle open. Left out of the project file when it doesn't.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Open { get; set; }
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
