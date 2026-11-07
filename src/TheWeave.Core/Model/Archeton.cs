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
