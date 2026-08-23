namespace TheWeave.Core.Model.Effects;

/// <summary>
/// A second full-size background image that cross-fades in and out over the page's primary
/// background (e.g. shrines-layer-0001.html's #bgmap2). The exporter emits this image path
/// onto the owning Page's SecondaryBackground.
/// </summary>
public sealed class CrossfadeLayerEffect : PageEffect
{
    public string ImagePath { get; set; } = "";
    public double OpacityFrom { get; set; }
    public double OpacityTo { get; set; }
    public int DurationMs { get; set; } = 1000;
    public string Direction { get; set; } = "alternate";
    public string Easing { get; set; } = "ease-in-out";
}
