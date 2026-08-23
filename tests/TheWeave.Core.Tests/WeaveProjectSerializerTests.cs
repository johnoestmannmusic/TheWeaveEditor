using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;
using TheWeave.Core.Serialization;
using Xunit;

namespace TheWeave.Core.Tests;

public class WeaveProjectSerializerTests
{
    private static WeaveProject BuildSampleProject()
    {
        var project = new WeaveProject
        {
            Title = "The Weave",
            Groups = { new PageGroup { Id = "planets", Name = "Planets" } },
        };

        var ouros = new Page
        {
            Id = "ouros",
            Title = "Ouros - The Weave Explorer",
            OutputFileName = "ouros.html",
            GroupId = "planets",
            Background = new ImageRef { ImagePath = "img/ouros/ouros.png" },
            Effects =
            {
                new CrossfadeLayerEffect
                {
                    Id = "fx-crossfade",
                    ImagePath = "img/shrine-layers/0001/0001-map-2.png",
                    OpacityFrom = 0,
                    OpacityTo = 0.82,
                    DurationMs = 9500,
                },
                new DriftingSpriteEffect
                {
                    Id = "fx-flame-1",
                    ImagePath = "img/shrine-layers/0001/flame.gif",
                    X = 785,
                    Y = 1154,
                    BlendMode = "exclusion",
                    DriftX = new DriftAxis { FromPx = 0, ToPx = 1000, DurationMs = 5000, Direction = "alternate-reverse" },
                    DriftY = new DriftAxis { FromPx = -50, ToPx = 50, DurationMs = 1000 },
                },
            },
        };

        var parentNode = new Node
        {
            Id = "salanth-town-gardens",
            X = 173,
            Y = 158,
            Card = new Card
            {
                HeadingText = "Salanth Town Gardens",
                CoverImagePath = "img/ouros/salanth-gardens-1.png",
                Audio = new AudioRef { Url = "https://johnoestmannmusic.com/wp-content/uploads/2026/07/salanth-town-gardens.ogg" },
                PoetryLines = { "Sprawling Gardens", "Of Salanth Town" },
                Action = new CardAction { Kind = ActionKind.Download, Url = "https://johnoestmannmusic.com/0x2a72b-salanth-town-gardens/" },
            },
            Children =
            {
                new Node
                {
                    Id = "jherop-phantom",
                    X = -81,
                    Y = 184,
                    Card = new Card
                    {
                        HeadingText = "Jherop Phantom",
                        CoverImagePath = "img/racers/jherop-phantom.png",
                        PoetryLines = { "**PILOT:** REJJA" },
                        Action = new CardAction { Kind = ActionKind.Download, Url = "https://johnoestmannmusic.com/0x2a72b-ii-salanth-town-gardens-page-2/" },
                    },
                },
            },
        };

        ouros.Nodes.Add(parentNode);
        project.Pages.Add(ouros);

        return project;
    }

    [Fact]
    public void RoundTrip_PreservesNestedNodesAndPolymorphicEffects()
    {
        var original = BuildSampleProject();

        var json = WeaveProjectSerializer.Serialize(original);
        var restored = WeaveProjectSerializer.Deserialize(json);

        var page = Assert.Single(restored.Pages);
        Assert.Equal("ouros", page.Id);

        Assert.Equal(2, page.Effects.Count);
        var crossfade = Assert.IsType<CrossfadeLayerEffect>(page.Effects[0]);
        Assert.Equal(0.82, crossfade.OpacityTo);

        var drift = Assert.IsType<DriftingSpriteEffect>(page.Effects[1]);
        Assert.Equal("exclusion", drift.BlendMode);
        Assert.NotNull(drift.DriftX);
        Assert.Equal(1000, drift.DriftX!.ToPx);

        var parent = Assert.Single(page.Nodes);
        Assert.Equal("salanth-town-gardens", parent.Id);
        Assert.Equal(ActionKind.Download, parent.Card.Action.Kind);

        var child = Assert.Single(parent.Children);
        Assert.Equal("jherop-phantom", child.Id);
        Assert.Equal("**PILOT:** REJJA", child.Card.PoetryLines[0]);
    }

    [Fact]
    public void Page_WrapsDefaultsToTrue()
    {
        var page = new Page();

        Assert.True(page.Wraps);
    }

    [Fact]
    public void RoundTrip_PreservesExplicitWrapsFalse()
    {
        var original = BuildSampleProject();
        original.Pages[0].Wraps = false;

        var json = WeaveProjectSerializer.Serialize(original);
        var restored = WeaveProjectSerializer.Deserialize(json);

        Assert.False(Assert.Single(restored.Pages).Wraps);
    }

    [Fact]
    public void Page_GlobeEffectDefaultsToTrue()
    {
        var page = new Page();

        Assert.True(page.GlobeEffect);
    }

    [Fact]
    public void RoundTrip_PreservesExplicitGlobeEffectFalse()
    {
        var original = BuildSampleProject();
        original.Pages[0].GlobeEffect = false;

        var json = WeaveProjectSerializer.Serialize(original);
        var restored = WeaveProjectSerializer.Deserialize(json);

        Assert.False(Assert.Single(restored.Pages).GlobeEffect);
    }

    [Fact]
    public void SaveAndLoadFromFile_RoundTrips()
    {
        var original = BuildSampleProject();
        var path = Path.Combine(Path.GetTempPath(), $"weave-test-{Guid.NewGuid():N}.json");

        try
        {
            WeaveProjectSerializer.SaveToFile(original, path);
            var restored = WeaveProjectSerializer.LoadFromFile(path);

            Assert.Equal(original.Title, restored.Title);
            Assert.Single(restored.Pages);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
