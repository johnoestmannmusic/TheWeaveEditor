using System.Text.Json.Serialization;

namespace TheWeave.Core.Model;

public enum IconStyle
{
    Default,
    Race,
}

/// <summary>
/// A location on a page's map. Recursive: a Node's Children are further parts of the same location
/// (used for multi-part stories, e.g. Ouros's Salanth Town Gardens chain), reached with X in Track
/// Focus rather than walked to. A top-level node's X/Y are page-relative, and put its icon's center in the middle of a
/// grid square (see GridLayout). A nested node's X/Y aren't used: nothing of it appears on the map,
/// and it's only reached in Track Focus.
/// </summary>
public sealed class Node
{
    public string Id { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public IconStyle IconStyle { get; set; } = IconStyle.Default;

    /// <summary>If true, this node's card is shown by default rather than needing proximity.</summary>
    public bool Persistent { get; set; }

    public Card Card { get; set; } = new();
    public List<Node> Children { get; set; } = new();

    /// <summary>This track's Sokoban puzzle, if it has one. Left out of the project file when it doesn't.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Puzzle? Puzzle { get; set; }

    /// <summary>
    /// The ids of other top-level locations, on any page, whose stages (see PuzzleStages) all have to be solved before
    /// this one opens. Top-level locations only. Left out of the project file when there are none.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Requirements { get; set; }
}
