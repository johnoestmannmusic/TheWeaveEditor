using AngleSharp.Dom;
using TheWeave.Core.Model;
using Node = TheWeave.Core.Model.Node;

namespace TheWeave.Importer;

internal static class NodeParser
{
    public static Node Parse(IElement nodeEl, string pageId, ImportContext ctx)
    {
        var style = InlineStyle.Parse(nodeEl.GetAttribute("style"));
        var id = nodeEl.GetAttribute("id");

        var iconEl = nodeEl.Children.FirstOrDefault(c => c.LocalName == "img" && c.ClassList.Contains("nodeImage"));
        var iconSrc = iconEl?.GetAttribute("src");

        var floatInfoEl = nodeEl.Children.FirstOrDefault(c => c.LocalName == "div" && c.ClassList.Contains("floatInfo"));

        var node = new Node
        {
            Id = Slug.Generate(id ?? floatInfoEl?.Children.FirstOrDefault(c => c.LocalName == "h3")?.TextContent, ctx.UsedNodeIds),
            X = InlineStyle.ParsePx(style.GetValueOrDefault("left")) ?? 0,
            Y = InlineStyle.ParsePx(style.GetValueOrDefault("top")) ?? 0,
            IconStyle = iconSrc == "img/node-race.png" ? IconStyle.Race : IconStyle.Default,
            Persistent = id is "tutorialNode" or "shrineNode",
        };

        if (floatInfoEl is not null)
            node.Card = CardParser.Parse(floatInfoEl, node, pageId, ctx);
        else
            ctx.Warnings.Add(new ImportWarning("Node has no .floatInfo card - imported with an empty one.", pageId, node.Id));

        return node;
    }
}
