using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;
using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

public class ProjectEditingEffectsTests
{
    private static Page MakePage() => new() { Id = "shrine", Title = "Shrine", OutputFileName = "shrine.html" };

    private static EffectEditRequest CrossfadeRequest(string imagePath = "img/shrine/layer2.png") => new()
    {
        Kind = "Crossfade",
        ImagePath = imagePath,
        OpacityFrom = 0.82,
        OpacityTo = 0,
        DurationMs = 9500,
        Direction = "alternate",
        Easing = "ease-in-out",
    };

    private static EffectEditRequest DriftRequest() => new()
    {
        Kind = "Drift",
        ImagePath = "img/shrine/flame.gif",
        X = 785,
        Y = 1154,
        BlendMode = "exclusion",
        HasDriftX = true,
        DriftXFromPx = 0,
        DriftXToPx = 1000,
        DriftXDurationMs = 5000,
        DriftXDirection = "alternate-reverse",
        DriftXEasing = "ease-in-out",
        HasDriftY = false,
    };

    [Fact]
    public void AddEffect_Crossfade_AddsEffectAndSetsSecondaryBackground()
    {
        var page = MakePage();

        var effect = ProjectEditing.AddEffect(page, CrossfadeRequest());

        var crossfade = Assert.IsType<CrossfadeLayerEffect>(Assert.Single(page.Effects));
        Assert.Same(effect, crossfade);
        Assert.Equal(0.82, crossfade.OpacityFrom);
        Assert.NotNull(page.SecondaryBackground);
        Assert.Equal("img/shrine/layer2.png", page.SecondaryBackground!.ImagePath);
    }

    [Fact]
    public void AddEffect_Drift_OnlyIncludesAxesMarkedPresent()
    {
        var page = MakePage();

        var effect = ProjectEditing.AddEffect(page, DriftRequest());

        var drift = Assert.IsType<DriftingSpriteEffect>(effect);
        Assert.NotNull(drift.DriftX);
        Assert.Equal(1000, drift.DriftX!.ToPx);
        Assert.Null(drift.DriftY); // HasDriftY was false
        Assert.Equal("exclusion", drift.BlendMode);
    }

    [Fact]
    public void AddEffect_GeneratesUniqueIdsAcrossMultipleEffectsOfSameKind()
    {
        var page = MakePage();

        var first = ProjectEditing.AddEffect(page, DriftRequest());
        var second = ProjectEditing.AddEffect(page, DriftRequest());

        Assert.Equal("drift", first.Id);
        Assert.Equal("drift-2", second.Id);
    }

    [Fact]
    public void UpdateEffect_ReplacesFieldsInPlace()
    {
        var page = MakePage();
        var effect = ProjectEditing.AddEffect(page, CrossfadeRequest());

        var edited = CrossfadeRequest();
        edited.DurationMs = 3000;
        ProjectEditing.UpdateEffect(page, effect.Id, edited);

        var crossfade = Assert.IsType<CrossfadeLayerEffect>(Assert.Single(page.Effects));
        Assert.Equal(3000, crossfade.DurationMs);
        Assert.Equal(effect.Id, crossfade.Id); // id is preserved across an edit
    }

    [Fact]
    public void UpdateEffect_UnknownId_Throws()
    {
        var page = MakePage();
        Assert.Throws<InvalidOperationException>(() => ProjectEditing.UpdateEffect(page, "does-not-exist", CrossfadeRequest()));
    }

    [Fact]
    public void RemoveEffect_RemovesItAndClearsSecondaryBackground_WhenNoCrossfadeRemains()
    {
        var page = MakePage();
        var effect = ProjectEditing.AddEffect(page, CrossfadeRequest());
        Assert.NotNull(page.SecondaryBackground);

        var removed = ProjectEditing.RemoveEffect(page, effect.Id);

        Assert.True(removed);
        Assert.Empty(page.Effects);
        Assert.Null(page.SecondaryBackground);
    }

    [Fact]
    public void RemoveEffect_KeepsSecondaryBackground_WhenAnotherCrossfadeStillExists()
    {
        var page = MakePage();
        var first = ProjectEditing.AddEffect(page, CrossfadeRequest("img/a.png"));
        ProjectEditing.AddEffect(page, CrossfadeRequest("img/b.png"));

        ProjectEditing.RemoveEffect(page, first.Id);

        Assert.NotNull(page.SecondaryBackground);
        Assert.Equal("img/b.png", page.SecondaryBackground!.ImagePath);
    }

    [Fact]
    public void RemoveEffect_ReturnsFalse_WhenNotFound()
    {
        var page = MakePage();
        Assert.False(ProjectEditing.RemoveEffect(page, "does-not-exist"));
    }
}
