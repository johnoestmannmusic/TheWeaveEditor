namespace TheWeave.Core.Model;

public enum IconStyle
{
    Default,
    Race,
}

/// <summary>
/// A location on a page's map. Recursive: a Node's Children are further parts of the same location
/// (used for multi-part stories, e.g. Ouros's Salanth Town Gardens chain), reached with X rather than
/// walked to. A top-level node's X/Y are page-relative, and put its icon's center in the middle of a
/// grid square (see GridLayout). A nested node's X/Y aren't used: it has no icon of its own, and
/// always sits exactly on its parent (see PageRenderer.RenderNode).
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
}
