using TheWeave.Core.Model;
using TheWeave.Core.Model.Effects;
using TheWeave.Exporter;
using TheWeave.Exporter.Templates;
using Xunit;

namespace TheWeave.Exporter.Tests;

public class PageRendererTests
{
    private static string RenderTrackWithPuzzle(Card card, List<PuzzleDrawing>? drawings = null, string? gateVariant = null)
    {
        var project = new WeaveProject { PuzzleDrawings = drawings };
        var page = new Page
        {
            Id = "ouros",
            Background = new ImageRef { ImagePath = "img/ouros.png" },
            Nodes =
            {
                new Node
                {
                    Id = "track",
                    Card = card,
                    Puzzle = new Puzzle
                    {
                        PaletteSource = "img/track.png",
                        Palette = { ["wall"] = "#112233" },
                        Textures = { ["wall"] = new PuzzleTexture { Ramp = { "#112233" }, Pixels = "0" } },
                        Objects =
                        {
                            new PuzzleObject { Kind = PuzzleObjectKind.Gate, Col = 2, Row = 3, Letter = "A", Open = true, Variant = gateVariant },
                            new PuzzleObject { Kind = PuzzleObjectKind.Stream, Col = 4, Row = 5, Direction = PuzzleDirection.Left },
                        },
                    },
                },
            },
        };
        project.Pages.Add(page);
        return new PageRenderer(project).RenderPage(page);
    }

    private static Card PlayableCard() => new() { CoverImagePath = "img/track.png", Audio = new AudioRef { Url = "track.ogg" } };

    [Fact]
    public void RenderPage_WritesAPlayablePuzzle_AsEscapedJson()
    {
        var html = RenderTrackWithPuzzle(PlayableCard());

        var attr = System.Text.RegularExpressions.Regex.Match(html, "data-puzzle=\"([^\"]*)\"").Groups[1].Value;
        var json = System.Net.WebUtility.HtmlDecode(attr);
        Assert.Equal(
            "{\"id\":\"track\",\"objects\":[{\"kind\":\"Gate\",\"col\":2,\"row\":3,\"letter\":\"A\",\"open\":true},{\"kind\":\"Stream\",\"col\":4,\"row\":5,\"direction\":\"Left\"}],\"palette\":{\"wall\":\"#112233\"},\"textures\":{\"wall\":{\"ramp\":[\"#112233\"],\"pixels\":\"0\"}}}",
            json);
    }

    private static string PuzzleJsonOf(string html) =>
        System.Net.WebUtility.HtmlDecode(System.Text.RegularExpressions.Regex.Match(html, "data-puzzle=\"([^\"]*)\"").Groups[1].Value);

    [Fact]
    public void RenderPage_APuzzleCarriesOnlyTheDrawingsItUses()
    {
        PuzzleDrawing Drawing(string id, PuzzleObjectKind kind) => new()
        {
            Id = id,
            Kind = kind,
            Name = id,
            Pixels = new string('G', PuzzleDrawings.TilePixels),
            Mix = { new PuzzleMixColour { Role = "gate", Shade = 1, Percent = 100 } },
        };
        var library = new List<PuzzleDrawing>
        {
            Drawing("iron", PuzzleObjectKind.Gate), Drawing("Gate", PuzzleObjectKind.Gate), Drawing("Wall", PuzzleObjectKind.Wall), Drawing("wood", PuzzleObjectKind.Gate),
        };

        var json = PuzzleJsonOf(RenderTrackWithPuzzle(PlayableCard(), library, gateVariant: "iron"));

        using var parsed = System.Text.Json.JsonDocument.Parse(json);
        var drawings = parsed.RootElement.GetProperty("drawings").EnumerateArray().ToList();
        Assert.Equal(["iron", "Gate"], drawings.Select(d => d.GetProperty("id").GetString()));
        Assert.Equal("Gate", drawings[0].GetProperty("kind").GetString());
        Assert.Equal("gate", drawings[0].GetProperty("mix")[0].GetProperty("role").GetString());
        Assert.Equal("iron", parsed.RootElement.GetProperty("objects")[0].GetProperty("variant").GetString());

        Assert.DoesNotContain("drawings", PuzzleJsonOf(RenderTrackWithPuzzle(PlayableCard(), [Drawing("Wall", PuzzleObjectKind.Wall)])));
    }

    [Fact]
    public void RenderPage_LeavesOutAPuzzleThatCantBePlayed()
    {
        Assert.DoesNotContain("data-puzzle", RenderTrackWithPuzzle(new Card { CoverImagePath = "img/track.png" }));
        Assert.DoesNotContain("data-puzzle", RenderTrackWithPuzzle(new Card { Audio = new AudioRef { Url = "track.ogg" } }));

        var travel = PlayableCard();
        travel.Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "ouros" };
        Assert.DoesNotContain("data-puzzle", RenderTrackWithPuzzle(travel));
    }

    [Fact]
    public void RenderPage_ANodeWithNoPuzzle_HasNoPuzzleAttribute()
    {
        var project = new WeaveProject();
        var page = new Page { Id = "ouros", Background = new ImageRef { ImagePath = "img/ouros.png" }, Nodes = { new Node { Id = "track", Card = PlayableCard() } } };

        Assert.DoesNotContain("data-puzzle", new PageRenderer(project).RenderPage(page));
    }

    private const string ExactGridJson =
        "{\"columns\":20,\"rows\":10,\"cellWidth\":150,\"cellHeight\":150,\"originX\":0,\"originY\":150}";

    private const string ExactScreenJson = "{\"width\":1500,\"height\":798,\"tops\":[126,876]}";

    // A minimal single-node page, checked byte-for-byte against a pinned expected output -
    // the one true "golden file" case, kept deliberately small so it's easy to eyeball.
    [Fact]
    public void RenderPage_MinimalPage_MatchesGoldenOutput()
    {
        var project = new WeaveProject { Title = "The Weave" };
        var page = new Page
        {
            Id = "tutorial-only",
            Title = "The Weave Explorer",
            OutputFileName = "index.html",
            Background = new ImageRef { ImagePath = "img/the_weave/the_weave.png" },
            Nodes =
            {
                new Node
                {
                    Id = "tutorial",
                    X = 50,
                    Y = 50,
                    Card = new Card
                    {
                        HeadingText = "Tutorial:",
                        PoetryLines = { "Click Z near a location" },
                    },
                },
            },
        };
        project.Pages.Add(page);

        var actual = new PageRenderer(project).RenderPage(page);

        var expected = $$"""
            <!DOCTYPE html>
            <html><head>
            <meta http-equiv="content-type" content="text/html; charset=UTF-8">
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
              <title>The Weave Explorer</title>
              <link href="css/main.css?v={{RuntimeAssets.Version}}" rel="stylesheet">
              <script src="jsx/sokoban.js?v={{RuntimeAssets.Version}}"></script>
              <script src="jsx/puzzle.js?v={{RuntimeAssets.Version}}"></script>
              <script src="jsx/main.js?v={{RuntimeAssets.Version}}"></script>

              <script>
                window.__weavePage = {"id":"tutorial-only","globeEffect":true,"worldWidth":3000,"worldHeight":1686,"defaultSpawnX":null,"defaultSpawnY":null,"isHomePage":false,"grid":{{ExactGridJson}},"screen":{{ExactScreenJson}}};
              </script>
              </head>

              <body>

                <div id="loadingScreen"><div id="loadingPanel"><div id="loadingLabel">Entering..</div><div id="loadingBar"><div id="loadingFill"></div></div></div></div>

                <!-- Background -->
                 <img id="bgmap" class="pannable" src="img/the_weave/the_weave.png">

                <!-- Interactables -->

                <!-- Tutorial: -->
                <div class="node" style="left: 50px; top: 50px;">
                  <img class="nodeImage" src="img/node.png">

                  <!-- Info -->
                  <div class="floatInfo" style="position: relative; top: -130px; left: 80px; display:none">
                    <!-- Text -->
                    <h3>Tutorial:</h3>

                    <div class="poetry-text">
                        <div class="poetry-line">Click Z near a location</div>
                  </div>
                </div>
                </div>
                <!-------------------->

              </body>

              </html>

            """;

        Assert.Equal(Normalize(expected), Normalize(actual));
    }

    [Fact]
    public void RenderPage_NestedStoryChain_ProducesNestedNodeMarkup()
    {
        var project = new WeaveProject();
        var page = new Page
        {
            Id = "ouros",
            Title = "Ouros",
            OutputFileName = "ouros.html",
            Background = new ImageRef { ImagePath = "img/ouros/ouros.png" },
            Nodes =
            {
                new Node
                {
                    Id = "salanth-town-gardens",
                    X = 173,
                    Y = 158,
                    Card = new Card { HeadingText = "Salanth Town Gardens", PoetryLines = { "Sprawling Gardens" } },
                    Children =
                    {
                        new Node
                        {
                            Id = "jherop-phantom",
                            X = -81,
                            Y = 184,
                            Card = new Card { HeadingText = "Jherop Phantom", PoetryLines = { "**PILOT:** REJJA" } },
                            Children =
                            {
                                new Node
                                {
                                    Id = "gardeners-funeral",
                                    X = -81,
                                    Y = 184,
                                    Card = new Card { HeadingText = "The Gardener's Funeral" },
                                },
                            },
                        },
                    },
                },
            },
        };
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Equal(3, CountOccurrences(html, "class=\"node\""));
        Assert.Contains("<h3>Salanth Town Gardens</h3>", html);
        Assert.Contains("<h3>Jherop Phantom</h3>", html);
        Assert.Contains("<h3>The Gardener&#39;s Funeral</h3>", html);
        Assert.Contains("<b>PILOT:</b> REJJA", html);

        // Nested node markup must appear *inside* its parent's floatInfo, not after it closes.
        var parentCardOpen = html.IndexOf("<h3>Salanth Town Gardens</h3>", StringComparison.Ordinal);
        var childNode = html.IndexOf("<h3>Jherop Phantom</h3>", StringComparison.Ordinal);
        var grandchildNode = html.IndexOf("<h3>The Gardener&#39;s Funeral</h3>", StringComparison.Ordinal);
        Assert.True(parentCardOpen < childNode);
        Assert.True(childNode < grandchildNode);

        // Their cards are only read by Track Focus now, so nothing on the map hints at them.
        Assert.DoesNotContain("chainHint", html);
    }

    [Fact]
    public void RenderPage_HubCard_GetsFixedSizeAndTextOffsets()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var pentura = MakePage("pentura", "pentura.html");

        index.Nodes.Add(new Node
        {
            Id = "hub-pentura",
            Card = new Card
            {
                Size = CardSize.Hub,
                HeadingText = "PENTURA",
                Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "pentura" },
            },
        });
        project.Pages.Add(index);
        project.Pages.Add(pentura);

        var html = new PageRenderer(project).RenderPage(index);

        Assert.Contains("width: 512px; height: 460px; position: absolute", html);
        Assert.Contains("<h3 style=\"left: 150px; top: 10px;\">PENTURA</h3>", html);
        Assert.Contains("<div class=\"poetry-text\" style=\"left: 175px; top: 20px;\">", html);
        Assert.Contains("<!-- Travel -->", html);
        Assert.Contains("<a href=\"./pentura.html\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_PersistentNode_EmitsDataAttribute()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node
        {
            Id = "tutorial",
            Persistent = true,
            Card = new Card { HeadingText = "Tutorial:" },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("<div class=\"node\" data-persistent=\"true\"", html);
    }

    [Fact]
    public void RenderPage_NonPersistentNode_OmitsDataAttribute()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node { Id = "n", Card = new Card { HeadingText = "N" } });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.DoesNotContain("data-persistent", html);
    }

    [Fact]
    public void RenderPage_ModalCard_GetsFixedCenteredStyleAndDataAttributes()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node
        {
            Id = "tutorial",
            Persistent = true,
            Card = new Card { Size = CardSize.Modal, HeadingText = "Tutorial:" },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("<div class=\"node\" data-persistent=\"true\" data-modal=\"true\" data-modal-id=\"tutorial\"", html);
        Assert.Contains("<div class=\"floatInfo\" data-modal=\"true\" style=\"width: 520px; height: 560px; overflow-y: auto; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); display:none\">", html);
        // A Modal card's top/left are never Card.Offset-derived - the switch's usual shared
        // tail (which would silently override the centering transform above, since later
        // declarations win within one inline style attribute) must not run for it.
        Assert.DoesNotContain("top: 0px; left: 0px", html);
    }

    [Fact]
    public void RenderPage_ModalCard_CustomSizeOverridesDefault()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node
        {
            Id = "tutorial",
            Card = new Card { Size = CardSize.Modal, CustomWidthPx = 640, CustomHeightPx = 480, HeadingText = "Tutorial:" },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("width: 640px; height: 480px; overflow-y: auto; position: fixed", html);
    }

    [Fact]
    public void RenderPage_CrossfadeEffect_EmitsSecondaryBackgroundAndScriptPayload()
    {
        var project = new WeaveProject();
        var page = MakePage("shrine", "shrine.html");
        page.SecondaryBackground = new ImageRef { ImagePath = "img/shrine-layers/0001/0001-map-2.png" };
        page.Effects.Add(new CrossfadeLayerEffect
        {
            Id = "fx-crossfade",
            ImagePath = "img/shrine-layers/0001/0001-map-2.png",
            OpacityFrom = 0,
            OpacityTo = 0.82,
            DurationMs = 9500,
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("id=\"bgmap2\"", html);
        Assert.Contains("window.__weaveEffects", html);
        Assert.Contains("\"type\":\"crossfade\"", html);
        Assert.Contains("\"opacityTo\":0.82", html);
        Assert.Contains("\"durationMs\":9500", html);
    }

    [Fact]
    public void RenderPage_DriftingSpriteEffect_EmitsScriptPayloadWithBothAxes()
    {
        var project = new WeaveProject();
        var page = MakePage("shrine", "shrine.html");
        page.Effects.Add(new DriftingSpriteEffect
        {
            Id = "fx-flame-1",
            ImagePath = "img/shrine-layers/0001/flame.gif",
            X = 785,
            Y = 1154,
            BlendMode = "exclusion",
            DriftX = new DriftAxis { FromPx = 0, ToPx = 1000, DurationMs = 5000, Direction = "alternate-reverse" },
            DriftY = new DriftAxis { FromPx = -50, ToPx = 50, DurationMs = 1000 },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("\"type\":\"drift\"", html);
        Assert.Contains("\"blendMode\":\"exclusion\"", html);
        Assert.Contains("\"driftX\":{\"fromPx\":0,\"toPx\":1000", html);
        Assert.Contains("\"driftY\":{\"fromPx\":-50,\"toPx\":50", html);
    }

    [Fact]
    public void RenderPage_NoEffects_EmitsNoEffectsScript()
    {
        var project = new WeaveProject();
        var page = MakePage("plain", "plain.html");
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        // Every page still gets the unconditional __weavePage config script (world size/wrap) -
        // only the effects script is conditional on the page actually having effects.
        Assert.DoesNotContain("__weaveEffects", html);
        Assert.Contains("window.__weavePage", html);
    }

    [Fact]
    public void RenderPage_NestedNode_IgnoresItsStoredPosition()
    {
        var project = new WeaveProject();
        var page = MakePage("ouros", "ouros.html");
        page.Nodes.Add(new Node
        {
            Id = "root",
            X = 201,
            Y = 351,
            Card = new Card { Offset = new Offset { Top = -130, Left = 80 } },
            Children =
            {
                new Node
                {
                    Id = "child",
                    X = -81,
                    Y = 193,
                    Card = new Card { Offset = new Offset { Top = -130, Left = 80 } },
                },
            },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("<div class=\"node\" style=\"left: 201px; top: 351px;\">", html);
        Assert.Contains("<div class=\"node\" style=\"left: 0px; top: 0px;\">", html);
    }

    [Fact]
    public void RenderPage_WeavePageConfig_UsesPageWorldSizeAndGrid()
    {
        var project = new WeaveProject { DefaultWorldWidthPx = 3000, DefaultWorldHeightPx = 1686 };
        var planet = MakePage("planet", "planet.html");
        project.Pages.Add(planet);

        var planetHtml = new PageRenderer(project).RenderPage(planet);
        Assert.Contains("window.__weavePage = {\"id\":\"planet\",\"globeEffect\":true,\"worldWidth\":3000,\"worldHeight\":1686,\"defaultSpawnX\":null,\"defaultSpawnY\":null,\"isHomePage\":false,\"grid\":" + ExactGridJson + ",\"screen\":" + ExactScreenJson + "};", planetHtml);

        var merged = MakePage("index", "index.html");
        merged.GlobeEffect = false;
        merged.WorldWidthPx = 6000;
        merged.WorldHeightPx = 1686;
        project.Pages.Add(merged);

        var mergedHtml = new PageRenderer(project).RenderPage(merged);
        Assert.Contains("window.__weavePage = {\"id\":\"index\",\"globeEffect\":false,\"worldWidth\":6000,\"worldHeight\":1686,\"defaultSpawnX\":null,\"defaultSpawnY\":null,\"isHomePage\":false,\"grid\":{\"columns\":40,\"rows\":10,\"cellWidth\":150,\"cellHeight\":150,\"originX\":0,\"originY\":150},\"screen\":" + ExactScreenJson + "};", mergedHtml);
    }

    [Fact]
    public void RenderPage_TravelWithSpawnPositionAndSkipTutorial_EmitsQueryString()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var ouros = MakePage("ouros", "ouros.html");

        ouros.Nodes.Add(new Node
        {
            Id = "hub-index",
            Card = new Card
            {
                Size = CardSize.Hub,
                HeadingText = "THE WEAVE",
                Action = new CardAction
                {
                    Kind = ActionKind.Travel,
                    TargetPageId = "index",
                    TravelSpawnX = 445,
                    TravelSpawnY = 165,
                    TravelSkipTutorial = true,
                },
            },
        });
        project.Pages.Add(index);
        project.Pages.Add(ouros);

        var html = new PageRenderer(project).RenderPage(ouros);

        Assert.Contains("<a href=\"./index.html?x=445&amp;y=165&amp;tutorial=off\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelWithNoExplicitSpawn_DefaultsToReciprocalNodePosition()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html");

        // index -> azurus: the hub icon representing Azurus on the sector map.
        index.Nodes.Add(new Node
        {
            Id = "azurus-icon",
            X = 1101,
            Y = 350,
            Card = new Card { HeadingText = "AZURUS", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } },
        });
        // azurus -> index: the "return to the weave" link, with no TravelSpawnX/Y typed in by
        // hand - should default to landing right back on the hub icon above (1101, 350), not
        // the ship's own generic default spawn.
        azurus.Nodes.Add(new Node
        {
            Id = "return-to-weave",
            Card = new Card { HeadingText = "RETURN", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "index" } },
        });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var html = new PageRenderer(project).RenderPage(azurus);

        Assert.Contains("<a href=\"./index.html?x=1101&amp;y=350\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelWithExplicitSpawn_OverridesReciprocalNodePosition()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html");

        index.Nodes.Add(new Node
        {
            Id = "azurus-icon",
            X = 1101,
            Y = 350,
            Card = new Card { HeadingText = "AZURUS", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } },
        });
        azurus.Nodes.Add(new Node
        {
            Id = "return-to-weave",
            Card = new Card
            {
                HeadingText = "RETURN",
                Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "index", TravelSpawnX = 999, TravelSpawnY = 888 },
            },
        });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var html = new PageRenderer(project).RenderPage(azurus);

        Assert.Contains("<a href=\"./index.html?x=999&amp;y=888\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelFromHomePageWithNoExplicitSpawn_LandsOnTheEntrySquare()
    {
        var project = new WeaveProject { HomePageId = "index" };
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html");

        // index is the hub (HomePageId) - traveling *from* it always lands on the entry square, even
        // if azurus's own "return to hub" node has been moved somewhere else.
        index.Nodes.Add(new Node
        {
            Id = "azurus-icon",
            X = 1101,
            Y = 350,
            Card = new Card { HeadingText = "AZURUS", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } },
        });
        azurus.Nodes.Add(new Node
        {
            Id = "return-to-weave",
            X = 50,
            Y = 50,
            Card = new Card { HeadingText = "RETURN", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "index" } },
        });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var html = new PageRenderer(project).RenderPage(index);

        Assert.Contains("<a href=\"./azurus.html?x=75&amp;y=225\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelFromHomePage_EntrySquareFollowsTheTargetPagesOwnGrid()
    {
        var project = new WeaveProject { HomePageId = "index", DefaultWorldWidthPx = 3010, DefaultWorldHeightPx = 1696 };
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html"); // no WorldWidthPx/HeightPx override

        index.Nodes.Add(new Node
        {
            Id = "azurus-icon",
            Card = new Card { HeadingText = "AZURUS", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } },
        });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var html = new PageRenderer(project).RenderPage(index);

        Assert.Contains("<a href=\"./azurus.html?x=75.25&amp;y=226.335\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelBackToHomePageWithNoExplicitSpawn_LandsExactlyOnThePlanetsNode()
    {
        var project = new WeaveProject { HomePageId = "index" };
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html");

        index.Nodes.Add(new Node
        {
            Id = "azurus-icon",
            X = 1101,
            Y = 350,
            Card = new Card { HeadingText = "AZURUS", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } },
        });
        // azurus isn't the hub, so the *other* direction's rule (the entry square) doesn't apply here -
        // this lands right on the hub icon above, making it obvious where the ship came from.
        azurus.Nodes.Add(new Node
        {
            Id = "return-to-weave",
            Card = new Card { HeadingText = "RETURN", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "index" } },
        });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var html = new PageRenderer(project).RenderPage(azurus);

        // index is HomePageId, so its actual output file is theweave.html (see
        // PageRenderer.HomePageFileName), not index.html.
        Assert.Contains("<a href=\"./theweave.html?x=1101&amp;y=350\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelBackToNonHomeReciprocal_LandsExactlyOnNodeNoOffset()
    {
        var project = new WeaveProject { HomePageId = "the-real-hub" };
        var hub = MakePage("the-real-hub", "the-real-hub.html");
        var ouros = MakePage("ouros", "ouros.html");
        var shrine = MakePage("shrine", "shrine.html");

        // ouros -> shrine: a reciprocal landing whose target ("shrine") is *not* the project's
        // home page - only a return trip that lands back on HomePageId itself gets nudged up.
        ouros.Nodes.Add(new Node
        {
            Id = "shrine-icon",
            Card = new Card { HeadingText = "SHRINE", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "shrine" } },
        });
        shrine.Nodes.Add(new Node
        {
            Id = "return-to-ouros",
            X = 222,
            Y = 444,
            Card = new Card { HeadingText = "RETURN", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "ouros" } },
        });
        project.Pages.Add(hub);
        project.Pages.Add(ouros);
        project.Pages.Add(shrine);

        var html = new PageRenderer(project).RenderPage(ouros);

        Assert.Contains("<a href=\"./shrine.html?x=222&amp;y=444\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_PageDefaultSpawn_EmitsInWeavePageConfig()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.DefaultSpawnX = 4262;
        page.DefaultSpawnY = 601;
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("\"defaultSpawnX\":4262,\"defaultSpawnY\":601", html);
    }

    [Fact]
    public void RenderPage_TravelWithAmbiguousReciprocalLinks_EmitsNoSpawnQuery()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html");

        // Two different nodes on the target page both travel back to azurus - genuinely
        // ambiguous which one represents "the way back", so no spawn position is guessed.
        index.Nodes.Add(new Node { Id = "a", X = 100, Y = 100, Card = new Card { HeadingText = "A", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } } });
        index.Nodes.Add(new Node { Id = "b", X = 200, Y = 200, Card = new Card { HeadingText = "B", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } } });
        azurus.Nodes.Add(new Node { Id = "return", Card = new Card { HeadingText = "RETURN", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "index" } } });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var html = new PageRenderer(project).RenderPage(azurus);

        Assert.Contains("<a href=\"./index.html\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_StandardCard_HeightDependsOnWhetherItHasAudio()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node
        {
            Id = "no-audio",
            Card = new Card { HeadingText = "Informational" }, // e.g. a travel-only or plain card
        });
        page.Nodes.Add(new Node
        {
            Id = "with-audio",
            Card = new Card { HeadingText = "Has Music", Audio = new AudioRef { Url = "https://example.com/track.ogg" } },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        // No audio - no explicit height override, so it falls back to .floatInfo's own CSS
        // default (505px, the no-audio size - see main.css).
        var noAudioBlock = html.Substring(html.IndexOf("<!-- Informational -->"), html.IndexOf("<!-- Has Music -->") - html.IndexOf("<!-- Informational -->"));
        Assert.DoesNotContain("height:", noAudioBlock);

        // Has audio - a track's card just fits what's left once its poetry is hidden.
        var withAudioBlock = html.Substring(html.IndexOf("<!-- Has Music -->"));
        Assert.Contains("height: auto", withAudioBlock);
    }

    [Fact]
    public void RenderPage_TravelActionTargetingHomePage_GetsTravelHomeMarker()
    {
        var project = new WeaveProject { HomePageId = "index" };
        var index = MakePage("index", "index.html");
        var azurus = MakePage("azurus", "azurus.html");
        azurus.Nodes.Add(new Node
        {
            Id = "return-to-weave",
            Card = new Card { HeadingText = "RETURN", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "index" } },
        });
        azurus.Nodes.Add(new Node
        {
            Id = "return-elsewhere",
            Card = new Card { HeadingText = "ELSEWHERE", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "azurus" } },
        });
        project.Pages.Add(index);
        project.Pages.Add(azurus);

        var homeHtml = new PageRenderer(project).RenderPage(index);
        var azurusHtml = new PageRenderer(project).RenderPage(azurus);

        // main.js's updateHubMusicSignal reads isHomePage to know when to play the hub theme at
        // full ambient volume, and data-travel-home to know which nodes elsewhere preview it.
        Assert.Contains("\"isHomePage\":true", homeHtml);
        Assert.Contains("\"isHomePage\":false", azurusHtml);
        Assert.DoesNotContain("data-travel-home=\"true\"", homeHtml);

        // Only the node whose Travel action targets the home page gets the marker - the other
        // node's own <!-- HeadingText --> comment (see RenderNode) delimits its block so this
        // can tell the two apart despite Node.Id never appearing in the exported HTML.
        var returnBlock = azurusHtml.Substring(azurusHtml.IndexOf("<!-- RETURN -->"), azurusHtml.IndexOf("<!-- ELSEWHERE -->") - azurusHtml.IndexOf("<!-- RETURN -->"));
        var elsewhereBlock = azurusHtml.Substring(azurusHtml.IndexOf("<!-- ELSEWHERE -->"));
        Assert.Contains("data-travel-home=\"true\"", returnBlock);
        Assert.DoesNotContain("data-travel-home", elsewhereBlock);
    }

    [Fact]
    public void RenderPage_TravelActionWithoutAudio_GetsKeyHint()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var pentura = MakePage("pentura", "pentura.html");
        index.Nodes.Add(new Node
        {
            Id = "hub-pentura",
            Card = new Card { Size = CardSize.Hub, HeadingText = "PENTURA", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "pentura" } },
        });
        project.Pages.Add(index);
        project.Pages.Add(pentura);

        var html = new PageRenderer(project).RenderPage(index);

        Assert.Contains("<img class=\"keyHint\" src=\"img/ui/key_z.gif\"><a href=\"./pentura.html\">[ TRAVEL ]</a>", html);
    }

    [Fact]
    public void RenderPage_TravelActionWithAudio_HintGoesToTravel_AudioIsUnwrapped()
    {
        var project = new WeaveProject();
        var index = MakePage("index", "index.html");
        var pentura = MakePage("pentura", "pentura.html");
        index.Nodes.Add(new Node
        {
            Id = "hub-pentura",
            Card = new Card
            {
                Size = CardSize.Hub,
                HeadingText = "PENTURA",
                Audio = new AudioRef { Url = "https://example.com/track.ogg" },
                Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "pentura" },
            },
        });
        project.Pages.Add(index);
        project.Pages.Add(pentura);

        var html = new PageRenderer(project).RenderPage(index);

        // A Hub card that actually has audio gets the shorter, audio-reclaimed height (see
        // BuildCardStyle) - unlike the plain travel-only Hub card in
        // RenderPage_TravelActionWithoutAudio_GetsKeyHint, which never had that space to reclaim.
        Assert.Contains("width: 512px; height: 406px; position: absolute", html);

        // Location audio follows the ship's square now (see main.js's updateLocationAudio), not
        // Z-toggled, so it never competes with the travel link for the key hint - Z always
        // reaches Travel when one is present, audio or not.
        Assert.Contains("<audio class=\"songPlayer\" preload=\"none\" src=\"https://example.com/track.ogg\"></audio>", html);
        Assert.Contains("<img class=\"keyHint\" src=\"img/ui/key_z.gif\"><a href=\"./pentura.html\">[ TRAVEL ]</a>", html);
    }

    [Theory]
    [InlineData(ActionKind.Download, CardSize.Standard, true)]
    [InlineData(ActionKind.None, CardSize.Standard, true)]
    [InlineData(ActionKind.Travel, CardSize.Standard, false)]
    [InlineData(ActionKind.None, CardSize.Modal, false)]
    public void RenderPage_FocusAction_OnlyOnCardsWhereZOpensTrackFocus(ActionKind kind, CardSize size, bool expected)
    {
        var project = new WeaveProject();
        var page = MakePage("ouros", "ouros.html");
        page.Nodes.Add(new Node
        {
            Id = "track",
            Card = new Card
            {
                Size = size,
                Audio = new AudioRef { Url = "https://example.com/track.ogg" },
                Action = new CardAction { Kind = kind, TargetPageId = kind == ActionKind.Travel ? "ouros" : null },
            },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Equal(expected, html.Contains("<span class=\"focus-action\">[ Enter ]</span>"));
    }

    [Theory]
    [InlineData(ActionKind.Download, true, true)]
    [InlineData(ActionKind.None, true, true)]
    [InlineData(ActionKind.Travel, true, false)]
    [InlineData(ActionKind.None, false, false)]
    public void RenderPage_TrackCard_MarkedSoItsPoetryOnlyShowsInTrackFocus(ActionKind kind, bool hasAudio, bool expected)
    {
        var project = new WeaveProject();
        var page = MakePage("ouros", "ouros.html");
        page.Nodes.Add(new Node
        {
            Id = "location",
            Card = new Card
            {
                Audio = hasAudio ? new AudioRef { Url = "https://example.com/track.ogg" } : null,
                PoetryLines = { "A line of verse" },
                Action = new CardAction { Kind = kind, TargetPageId = kind == ActionKind.Travel ? "ouros" : null },
            },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Equal(expected, html.Contains("class=\"floatInfo trackCard\""));
        // Always in the page, whichever way it's shown - Track Focus reads it from here.
        Assert.Contains("A line of verse", html);
    }

    [Fact]
    public void RenderPage_NoAudio_GetsNoFocusAction()
    {
        var project = new WeaveProject();
        var page = MakePage("ouros", "ouros.html");
        page.Nodes.Add(new Node { Id = "info", Card = new Card { HeadingText = "Just Text" } });
        project.Pages.Add(page);

        Assert.DoesNotContain("focus-action", new PageRenderer(project).RenderPage(page));
    }

    [Fact]
    public void RenderPage_ModalCard_GetsCloseActionWithKeyHint_ButNotOnItsOwnAudio()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node
        {
            Id = "tutorial",
            Persistent = true,
            Card = new Card
            {
                Size = CardSize.Modal,
                HeadingText = "Tutorial:",
                Audio = new AudioRef { Url = "https://example.com/track.ogg" },
            },
        });
        project.Pages.Add(page);

        var html = new PageRenderer(project).RenderPage(page);

        Assert.Contains("<div class=\"poetry-close\">", html);
        Assert.Contains("<span class=\"modal-close-action\">[ Close ]</span><img class=\"keyHint\" src=\"img/ui/key_z.gif\">", html);
        // Z closes a modal instead of ever reaching its songPlayer (see main.js's modalQueue),
        // so the hint next to the audio itself would be actively misleading here.
        Assert.Contains("<audio class=\"songPlayer\" controls src=\"https://example.com/track.ogg\"></audio>\n", html);
        Assert.DoesNotContain("songPlayer\" controls src=\"https://example.com/track.ogg\"></audio>\n      <img class=\"keyHint\"", html);
    }

    [Fact]
    public void RenderPage_TravelToUnknownPage_Throws()
    {
        var project = new WeaveProject();
        var page = MakePage("index", "index.html");
        page.Nodes.Add(new Node
        {
            Id = "hub",
            Card = new Card { HeadingText = "Nowhere", Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = "ghost" } },
        });
        project.Pages.Add(page);

        Assert.Throws<InvalidOperationException>(() => new PageRenderer(project).RenderPage(page));
    }

    private static Page MakePage(string id, string outputFileName) => new()
    {
        Id = id,
        Title = id,
        OutputFileName = outputFileName,
        Background = new ImageRef { ImagePath = $"img/{id}/{id}.png" },
    };

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = 0;
        while ((index = haystack.IndexOf(needle, index, StringComparison.Ordinal)) != -1)
        {
            count++;
            index += needle.Length;
        }
        return count;
    }

    // Compares structure/content, not incidental indentation - the C# raw-string literal's
    // own dedent rules don't line up exactly with the renderer's indentation math, and that's
    // not what this test is meant to pin down.
    private static string Normalize(string s) =>
        string.Join('\n', s.Replace("\r\n", "\n").Split('\n').Select(line => line.Trim())).Trim();
}
