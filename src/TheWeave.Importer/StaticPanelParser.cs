using AngleSharp.Dom;
using TheWeave.Core.Model;

namespace TheWeave.Importer;

/// <summary>
/// Parses an always-visible secondary panel: a bare .floatInfo (not wrapped in a .node) placed
/// directly inside another card - e.g. index.html's "Updates:" changelog next to the tutorial
/// card. Distinguished from a nested story node by NOT being wrapped in a .node div.
/// </summary>
internal static class StaticPanelParser
{
    public static StaticTextBlock Parse(IElement floatInfoEl)
    {
        var style = InlineStyle.Parse(floatInfoEl.GetAttribute("style"));

        var block = new StaticTextBlock
        {
            Offset = new Offset
            {
                Left = InlineStyle.ParsePx(style.GetValueOrDefault("left")) ?? 0,
                Top = InlineStyle.ParsePx(style.GetValueOrDefault("top")) ?? 0,
            },
        };

        var h3 = floatInfoEl.Children.FirstOrDefault(c => c.LocalName == "h3");
        if (h3 is not null)
            block.HeadingText = h3.TextContent.Trim();

        var poetryTextEl = floatInfoEl.Children.FirstOrDefault(c => c.ClassList.Contains("poetry-text"));
        if (poetryTextEl is not null)
        {
            foreach (var lineEl in poetryTextEl.QuerySelectorAll(".poetry-line"))
                block.Lines.Add(PoetryLineConverter.FromHtml(lineEl.InnerHtml));
        }

        return block;
    }
}
