namespace TheWeave.Core.Model.Effects;

/// <summary>One animated axis of a DriftingSpriteEffect - mirrors an Element.animate() keyframe pair.</summary>
public sealed class DriftAxis
{
    public double FromPx { get; set; }
    public double ToPx { get; set; }
    public int DurationMs { get; set; } = 1000;
    public string Direction { get; set; } = "alternate";
    public string Easing { get; set; } = "ease-in-out";
}
