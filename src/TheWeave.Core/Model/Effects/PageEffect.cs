using System.Text.Json.Serialization;

namespace TheWeave.Core.Model.Effects;

/// <summary>
/// A generic, reusable per-page visual effect (replaces hand-written inline &lt;script&gt; blocks
/// like the one on shrines-layer-0001.html). Applied at runtime by the shared main.js.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(DriftingSpriteEffect), "drift")]
[JsonDerivedType(typeof(CrossfadeLayerEffect), "crossfade")]
public abstract class PageEffect
{
    public string Id { get; set; } = "";
}
