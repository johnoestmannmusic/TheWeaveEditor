namespace TheWeave.Core.Model;

/// <summary>
/// An always-visible secondary text panel inside a card, with no icon or proximity
/// behavior of its own - e.g. index.html's "Updates:" changelog panel next to the tutorial card.
/// </summary>
public sealed class StaticTextBlock
{
    public string HeadingText { get; set; } = "";
    public List<string> Lines { get; set; } = new();
    public Offset Offset { get; set; } = new();
}
