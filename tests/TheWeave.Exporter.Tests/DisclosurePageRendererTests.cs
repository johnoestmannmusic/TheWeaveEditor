using System.Text.RegularExpressions;
using TheWeave.Exporter.Templates;
using Xunit;

namespace TheWeave.Exporter.Tests;

public class DisclosurePageRendererTests
{
    // Deliberately doesn't assert on aadd.md's exact current wording - that's a live document
    // John edits directly, and pinning the copy here would just make routine edits fail this
    // test for no reason. Asserts the structural guarantees instead: it's a real HTML document,
    // and every bare URL in the source text became a real link.
    [Fact]
    public void Render_ProducesAWellFormedPage_WithEveryUrlHyperlinked()
    {
        var html = DisclosurePageRenderer.Render();

        Assert.StartsWith("<!DOCTYPE html>", html);
        Assert.Contains("<title>", html);
        Assert.Contains("<h1>", html);

        var sourceText = RuntimeAssets.ReadAaddMd();
        var urls = Regex.Matches(sourceText, @"https?://\S+").Select(m => m.Value);

        Assert.NotEmpty(urls);
        foreach (var url in urls)
            Assert.Contains($"<a href=\"{url}\" target=\"_blank\" rel=\"noreferrer noopener\">{url}</a>", html);
    }
}
