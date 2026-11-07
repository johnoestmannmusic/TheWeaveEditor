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
}

/// <summary>One kind of Archeton: its name, what it's drawn with, and the parts that make it work.</summary>
public sealed class ArchetonDefinition
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>The id of an Archeton drawing in WeaveProject.PuzzleDrawings, or null for the Standard one.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Drawing { get; set; }

    public List<ArchetonPart> Parts { get; set; } = new();
}

public static class ArchetonDefinitions
{
    public const int MaxRange = 9;

    /// <summary>The first Archeton: an eye that fires a laser at the ship within 2 squares, any way, pushing it back out of reach.</summary>
    public static ArchetonDefinition Sentribeam() => new()
    {
        Id = "sentribeam",
        Name = "Sentribeam",
        Parts =
        [
            new ArchetonPart { Kind = ArchetonPartKind.Beam, Range = 2, Look = ArchetonLook.AllWays, BlockedByBlocks = true },
            new ArchetonPart { Kind = ArchetonPartKind.Push },
        ],
    };

    /// <summary>The definitions a puzzle's Archetons are, from a library.</summary>
    public static List<ArchetonDefinition> UsedBy(Puzzle puzzle, IEnumerable<ArchetonDefinition>? library)
    {
        var ids = puzzle.Objects.Where(o => o.Kind == PuzzleObjectKind.Archeton && o.Archeton is not null).Select(o => o.Archeton!).ToHashSet();
        return (library ?? []).Where(d => ids.Contains(d.Id)).ToList();
    }

    /// <summary>The drawings a set of definitions are drawn with, from a library.</summary>
    public static List<PuzzleDrawing> DrawingsOf(IEnumerable<ArchetonDefinition> definitions, IEnumerable<PuzzleDrawing>? library)
    {
        var ids = definitions.Where(d => d.Drawing is not null).Select(d => d.Drawing!).ToHashSet();
        return (library ?? []).Where(d => d.Kind == PuzzleObjectKind.Archeton && ids.Contains(d.Id)).ToList();
    }
}
