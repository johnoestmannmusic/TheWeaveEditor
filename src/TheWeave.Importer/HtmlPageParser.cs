using AngleSharp.Dom;
using TheWeave.Core.Model;

namespace TheWeave.Importer;

internal static class HtmlPageParser
{
    public static Page Parse(IDocument doc, string fileName, ImportContext ctx)
    {
        var pageId = System.IO.Path.GetFileNameWithoutExtension(fileName);

        var page = new Page
        {
            Id = pageId,
            Title = doc.Title?.Trim() is { Length: > 0 } title ? title : pageId,
            OutputFileName = fileName,
        };

        var bgmap = doc.QuerySelector("#bgmap");
        if (bgmap is null)
            ctx.Warnings.Add(new ImportWarning("No #bgmap background image found.", pageId));

        page.Background = new ImageRef { ImagePath = bgmap?.GetAttribute("src") ?? "" };

        var bgmap2 = doc.QuerySelector("#bgmap2");
        if (bgmap2 is not null)
            page.SecondaryBackground = new ImageRef { ImagePath = bgmap2.GetAttribute("src") ?? "" };

        var body = doc.Body;
        if (body is not null)
        {
            foreach (var nodeEl in body.Children.Where(c => c.LocalName == "div" && c.ClassList.Contains("node")))
                page.Nodes.Add(NodeParser.Parse(nodeEl, pageId, ctx));
        }

        page.Effects.AddRange(EffectParser.Parse(doc, pageId, ctx));

        return page;
    }
}
