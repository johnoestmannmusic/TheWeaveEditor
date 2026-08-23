namespace TheWeave.Core.Model.Effects;

/// <summary>
/// A sprite that drifts back and forth (e.g. shrines-layer-0001.html's flame GIFs). At least one
/// of DriftX/DriftY should be set.
/// </summary>
public sealed class DriftingSpriteEffect : PageEffect
{
    public string ImagePath { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }

    /// <summary>CSS mix-blend-mode, e.g. "exclusion". Null = normal blending.</summary>
    public string? BlendMode { get; set; }

    public DriftAxis? DriftX { get; set; }
    public DriftAxis? DriftY { get; set; }
}
