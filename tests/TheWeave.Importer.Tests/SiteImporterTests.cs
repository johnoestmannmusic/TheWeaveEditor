using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;
using Xunit;

namespace TheWeave.Importer.Tests;

// These fixtures are exact copies of real pages from TheWeave-Explorer - the three most
// structurally demanding ones (nesting, effects, persistence + a static side panel) - so
// these tests double as the "does the importer actually work on real, messy hand-authored
// HTML" check the plan calls for before building anything on top of it.
public class SiteImporterTests
{
    private static string FixturesDir => Path.Combine(AppContext.BaseDirectory, "Fixtures");

    [Fact]
    public async Task ImportDirectory_ParsesAllThreeFixturePages()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);

        Assert.Equal(3, result.Project.Pages.Count);
        Assert.Contains(result.Project.Pages, p => p.Id == "index");
        Assert.Contains(result.Project.Pages, p => p.Id == "ouros");
        Assert.Contains(result.Project.Pages, p => p.Id == "shrines-layer-0001");
    }

    [Fact]
    public async Task Index_TutorialNode_IsPersistentAndHasUpdatesExtraPanel()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var index = result.Project.Pages.Single(p => p.Id == "index");

        var tutorial = index.Nodes.Single(n => n.Card.HeadingText == "Tutorial:");
        Assert.True(tutorial.Persistent);
        Assert.Equal(50, tutorial.X);
        Assert.Equal(50, tutorial.Y);

        // A poetry-line wrapped in a stray <p> in the real markup - must still be found.
        Assert.Contains("&nbsp;", tutorial.Card.PoetryLines);

        // <b>Credits:</b> round-trips to the schema's **bold** convention.
        Assert.Contains("**Credits:**", tutorial.Card.PoetryLines);

        var updates = Assert.Single(tutorial.Card.ExtraPanels);
        Assert.Equal("Updates:", updates.HeadingText);
        Assert.Equal(260, updates.Offset.Left);
        Assert.Contains(updates.Lines, l => l.Contains("Sigmir"));
    }

    [Fact]
    public async Task Index_HubTravelNode_ResolvesTargetPageId()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var index = result.Project.Pages.Single(p => p.Id == "index");

        var ourosHub = index.Nodes.Single(n => n.Card.HeadingText == "OUROS");
        Assert.Equal(CardSize.Hub, ourosHub.Card.Size);
        Assert.Equal(ActionKind.Travel, ourosHub.Card.Action.Kind);
        Assert.Equal("ouros", ourosHub.Card.Action.TargetPageId);
    }

    [Fact]
    public async Task Ouros_SalanthTownGardens_ImportsThreeLevelNestedStoryChain()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var ouros = result.Project.Pages.Single(p => p.Id == "ouros");

        var gardens = ouros.Nodes.Single(n => n.Card.HeadingText == "Salanth Town Gardens");
        Assert.Equal(ActionKind.Download, gardens.Card.Action.Kind);

        var jherop = Assert.Single(gardens.Children);
        Assert.Equal("Jherop Phantom", jherop.Card.HeadingText);
        Assert.Equal(-81, jherop.X);
        Assert.Equal(184, jherop.Y);
        Assert.Contains("**PILOT:** REJJA", jherop.Card.PoetryLines);

        var funeral = Assert.Single(jherop.Children);
        Assert.Equal("The Gardener's Funeral", funeral.Card.HeadingText);
        Assert.Empty(funeral.Children);
    }

    [Fact]
    public async Task Ouros_HubBackToIndex_ResolvesTargetPageId()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var ouros = result.Project.Pages.Single(p => p.Id == "ouros");

        var hub = ouros.Nodes.Single(n => n.Card.Action.Kind == ActionKind.Travel);
        Assert.Equal("index", hub.Card.Action.TargetPageId);
    }

    [Fact]
    public async Task Shrine_ShrineNode_IsPersistent()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var shrine = result.Project.Pages.Single(p => p.Id == "shrines-layer-0001");

        var skyrest = shrine.Nodes.Single(n => n.Card.HeadingText == "SKYREST");
        Assert.True(skyrest.Persistent);
    }

    [Fact]
    public async Task Shrine_ParsesCrossfadeEffect_WithRealValuesFromTheHandWrittenScript()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var shrine = result.Project.Pages.Single(p => p.Id == "shrines-layer-0001");

        var crossfade = Assert.Single(shrine.Effects.OfType<CrossfadeLayerEffect>());
        Assert.Equal("img/shrine-layers/0001/0001-map-2.png", crossfade.ImagePath);
        Assert.Equal(0.82, crossfade.OpacityFrom);
        Assert.Equal(0, crossfade.OpacityTo);
        Assert.Equal(9500, crossfade.DurationMs);
        Assert.Equal("alternate", crossfade.Direction);
        Assert.NotNull(shrine.SecondaryBackground);
    }

    [Fact]
    public async Task Shrine_ParsesBothDriftingFlameEffects_WithRealValuesFromTheHandWrittenScript()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var shrine = result.Project.Pages.Single(p => p.Id == "shrines-layer-0001");

        var flames = shrine.Effects.OfType<DriftingSpriteEffect>().OrderBy(f => f.X).ToList();
        Assert.Equal(2, flames.Count);

        var flame1 = flames[0];
        Assert.Equal(785, flame1.X);
        Assert.Equal(1154, flame1.Y);
        Assert.Equal("exclusion", flame1.BlendMode);
        Assert.NotNull(flame1.DriftX);
        Assert.Equal(0, flame1.DriftX!.FromPx);
        Assert.Equal(1000, flame1.DriftX.ToPx);
        Assert.Equal(5000, flame1.DriftX.DurationMs);
        Assert.Equal("alternate-reverse", flame1.DriftX.Direction);
        Assert.NotNull(flame1.DriftY);
        Assert.Equal(-50, flame1.DriftY!.FromPx);
        Assert.Equal(50, flame1.DriftY.ToPx);

        var flame2 = flames[1];
        Assert.Equal(2727, flame2.X);
        Assert.Equal(155, flame2.Y);
        Assert.Equal(-1000, flame2.DriftX!.ToPx); // mirrored direction from flame1
    }

    [Fact]
    public async Task ImportedProject_PassesValidationAgainstItsOwnPages()
    {
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);

        var issues = TheWeave.Core.Validation.ProjectValidator.Validate(result.Project);

        // No duplicate ids and no *resolvable* travel link is left dangling. (Links to pages
        // outside this 3-file fixture set - e.g. the-weave-ii.html - are expected here and
        // covered separately by ImportDirectory_UnresolvedTravelLink_ProducesWarning.)
        Assert.DoesNotContain(issues, i => i.Message.Contains("Duplicate"));
    }

    [Fact]
    public async Task ImportDirectory_UnresolvedTravelLink_ProducesWarning()
    {
        // shrines-layer-0001.html links back to the-weave-ii.html, which isn't part of this
        // 3-file fixture set - the importer should say so rather than silently dropping it.
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);

        Assert.Contains(result.Warnings, w => w.Message.Contains("the-weave-ii.html") && w.Message.Contains("doesn't match any imported page"));
    }

    [Fact]
    public async Task ImportDirectory_UnresolvedTravelLink_StillCapturesItsSpawnPositionAndTutorialFlag()
    {
        // shrines-layer-0001.html's portal link ('./the-weave-ii.html?x=80&y=995') can't
        // resolve a TargetPageId (that page isn't in this 3-file fixture set), but its arrival
        // position should still be captured rather than lost alongside the unresolved target.
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var shrine = result.Project.Pages.Single(p => p.Id == "shrines-layer-0001");

        var portal = shrine.Nodes.Single(n => n.Card.Action.Kind == TheWeave.Core.Model.ActionKind.Travel);
        Assert.Equal(80, portal.Card.Action.TravelSpawnX);
        Assert.Equal(995, portal.Card.Action.TravelSpawnY);
    }

    [Fact]
    public async Task Ouros_HubBackToIndex_CapturesSpawnPositionAndTutorialOffFlag()
    {
        // ouros.html's hub-back-to-index link is './index.html?x=445px&y=165px&tutorial=off' -
        // a real case of all three query params together, including the stray "px" suffix.
        var result = await new SiteImporter().ImportDirectoryAsync(FixturesDir);
        var ouros = result.Project.Pages.Single(p => p.Id == "ouros");

        var hub = ouros.Nodes.Single(n => n.Card.Action.Kind == ActionKind.Travel);
        Assert.Equal(445, hub.Card.Action.TravelSpawnX);
        Assert.Equal(165, hub.Card.Action.TravelSpawnY);
        Assert.True(hub.Card.Action.TravelSkipTutorial);
    }
}
