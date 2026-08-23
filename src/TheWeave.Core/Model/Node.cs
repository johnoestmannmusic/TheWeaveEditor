namespace TheWeave.Core.Model;

public enum IconStyle
{
    Default,
    Race,
}

/// <summary>
/// A clickable location on a page's map. Recursive: a Node's Children are nested nodes placed
/// inside its own Card (used for multi-part stories, e.g. Ouros's Salanth Town Gardens chain).
/// A top-level node's X/Y are page-relative; a nested node's X/Y are relative to its parent's card.
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
