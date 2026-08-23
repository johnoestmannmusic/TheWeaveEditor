using AngleSharp.Dom;
using TheWeave.Core.Model;
using Node = TheWeave.Core.Model.Node;

namespace TheWeave.Importer;

internal static class CardParser
{
    public static Card Parse(IElement floatInfoEl, Node ownerNode, string pageId, ImportContext ctx)
    {
        var style = InlineStyle.Parse(floatInfoEl.GetAttribute("style"));
        var card = new Card();

        ApplySize(card, style);

        card.Offset = new Offset
        {
            Top = InlineStyle.ParsePx(style.GetValueOrDefault("top")) ?? -130,
            Left = InlineStyle.ParsePx(style.GetValueOrDefault("left")) ?? 80,
        };

        var coverEl = floatInfoEl.Children.FirstOrDefault(c => c.LocalName == "img" && c.ClassList.Contains("songCover"));
        if (coverEl is not null)
            card.CoverImagePath = coverEl.GetAttribute("src");

        var audioEl = floatInfoEl.Children.FirstOrDefault(c => c.LocalName == "audio" && c.ClassList.Contains("songPlayer"));
        if (audioEl is not null)
            card.Audio = new AudioRef { Url = audioEl.GetAttribute("src") ?? "" };

        ParseHeading(floatInfoEl, card);
        ParsePoetry(floatInfoEl, card, ownerNode, pageId, ctx);
        ParseNestedChildren(floatInfoEl, card, ownerNode, pageId, ctx);

        return card;
    }

    private static void ApplySize(Card card, Dictionary<string, string> style)
    {
        var width = InlineStyle.ParsePx(style.GetValueOrDefault("width"));
        var height = InlineStyle.ParsePx(style.GetValueOrDefault("height"));

        if (width == 512 && height == 460)
        {
            card.Size = CardSize.Hub;
        }
        else if (width is not null || height is not null)
        {
            card.Size = CardSize.Custom;
            card.CustomWidthPx = width is double w ? (int)w : null;
            card.CustomHeightPx = height is double h ? (int)h : null;
        }
        else
        {
            card.Size = CardSize.Standard;
        }
    }

    private static void ParseHeading(IElement floatInfoEl, Card card)
    {
        var h3 = floatInfoEl.Children.FirstOrDefault(c => c.LocalName == "h3");
        if (h3 is null)
            return;

        card.HeadingText = h3.TextContent.Trim();

        var h3Style = InlineStyle.Parse(h3.GetAttribute("style"));
        var left = InlineStyle.ParsePx(h3Style.GetValueOrDefault("left"));
        var top = InlineStyle.ParsePx(h3Style.GetValueOrDefault("top"));

        var isDefaultHubHeading = card.Size == CardSize.Hub && left == 150 && top == 10;
        if (!isDefaultHubHeading && (left is not null || top is not null))
            card.HeadingOffset = new Offset { Left = left ?? 0, Top = top ?? 0 };
    }

    private static void ParsePoetry(IElement floatInfoEl, Card card, Node ownerNode, string pageId, ImportContext ctx)
    {
        var poetryTextEl = floatInfoEl.Children.FirstOrDefault(c => c.LocalName == "div" && c.ClassList.Contains("poetry-text"));
        if (poetryTextEl is null)
            return;

        var ptStyle = InlineStyle.Parse(poetryTextEl.GetAttribute("style"));
        var left = InlineStyle.ParsePx(ptStyle.GetValueOrDefault("left"));
        var top = InlineStyle.ParsePx(ptStyle.GetValueOrDefault("top"));

        var isDefaultHubPoetry = card.Size == CardSize.Hub && left == 175 && top == 20;
        if (!isDefaultHubPoetry && (left is not null || top is not null))
            card.PoetryOffset = new Offset { Left = left ?? 0, Top = top ?? 0 };

        // Descendant (not direct-child) search: some hand-authored lines end up wrapped in a
        // stray <p> rather than being direct children of .poetry-text.
        foreach (var lineEl in poetryTextEl.QuerySelectorAll(".poetry-line"))
            card.PoetryLines.Add(PoetryLineConverter.FromHtml(lineEl.InnerHtml));

        var downloadLink = poetryTextEl.QuerySelector(".poetry-download a");
        var travelLink = poetryTextEl.QuerySelector(".poetry-travel a");

        if (downloadLink is not null)
        {
            card.Action = new CardAction { Kind = ActionKind.Download, Url = downloadLink.GetAttribute("href") };
        }
        else if (travelLink is not null)
        {
            card.Action = new CardAction { Kind = ActionKind.Travel };
            ctx.PendingTravelLinks.Add(new PendingTravelLink(ownerNode, travelLink.GetAttribute("href") ?? "", pageId));
        }
    }

    private static void ParseNestedChildren(IElement floatInfoEl, Card card, Node ownerNode, string pageId, ImportContext ctx)
    {
        // Direct children only: a further .node wraps a nested story-chain location; a bare
        // .floatInfo (not wrapped in .node) is a static side panel like the "Updates:" list.
        foreach (var child in floatInfoEl.Children)
        {
            if (child.LocalName != "div")
                continue;

            if (child.ClassList.Contains("node"))
                ownerNode.Children.Add(NodeParser.Parse(child, pageId, ctx));
            else if (child.ClassList.Contains("floatInfo"))
                card.ExtraPanels.Add(StaticPanelParser.Parse(child));
        }
    }
}
