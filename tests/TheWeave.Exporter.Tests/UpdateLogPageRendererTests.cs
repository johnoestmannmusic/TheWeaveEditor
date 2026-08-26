using TheWeave.Exporter.Templates;
using Xunit;

namespace TheWeave.Exporter.Tests;

public class UpdateLogPageRendererTests
{
    [Fact]
    public void RenderFromText_DatedEntry_GetsADateLabelAndTheRestAsItsHeadline()
    {
        var html = UpdateLogPageRenderer.RenderFromText("[26AUG26] Locations now Auto-Play and various other fixes!");

        Assert.Contains("<span class=\"date\">26AUG26</span>Locations now Auto-Play and various other fixes!", html);
    }

    [Fact]
    public void RenderFromText_IndentedFollowUpLines_BecomeANestedSubList()
    {
        var html = UpdateLogPageRenderer.RenderFromText(
            "[10JUN26] Entry point is now The Weave:\n" +
            "    Azurus released, with 6 locations\n" +
            "    Pyron released, with 2 locations");

        Assert.Contains("<span class=\"date\">10JUN26</span>Entry point is now The Weave:<ul>" +
            "<li>Azurus released, with 6 locations</li>" +
            "<li>Pyron released, with 2 locations</li>" +
            "</ul></li>", html);
    }

    [Fact]
    public void RenderFromText_NonIndentedFollowUpLine_ReflowsIntoTheHeadlineInstead()
    {
        var html = UpdateLogPageRenderer.RenderFromText(
            "[07JUL26] Ouros is now open:\n" +
            "the rest of the sentence continues here");

        Assert.Contains("<span class=\"date\">07JUL26</span>Ouros is now open: the rest of the sentence continues here</li>", html);
        Assert.DoesNotContain("<ul><li>the rest", html);
    }

    [Fact]
    public void RenderFromText_EntryWithoutADateTag_RendersWithNoDateLabel()
    {
        var html = UpdateLogPageRenderer.RenderFromText(
            "TWE Guided Tours are now available for those who would like a more structured look into The Weave.");

        Assert.DoesNotContain("class=\"date\"", html);
        Assert.Contains("<li>TWE Guided Tours are now available", html);
    }

    [Fact]
    public void RenderFromText_MultipleBlankLineSeparatedBlocks_EachBecomeTheirOwnTopLevelListItem()
    {
        var html = UpdateLogPageRenderer.RenderFromText(
            "[26AUG26] First entry\n\n[23AUG26] Second entry");

        Assert.Contains("<li><span class=\"date\">26AUG26</span>First entry</li>", html);
        Assert.Contains("<li><span class=\"date\">23AUG26</span>Second entry</li>", html);
    }

    [Fact]
    public void RenderFromText_BareUrlInAnEntry_GetsHyperlinked()
    {
        var html = UpdateLogPageRenderer.RenderFromText("[01JAN27] Read more at https://example.com/notes");

        Assert.Contains("<a href=\"https://example.com/notes\" target=\"_blank\" rel=\"noreferrer noopener\">https://example.com/notes</a>", html);
    }

    [Fact]
    public void RenderFromText_LeadingHeadingBlock_SetsTitleAndSubtitle_InsteadOfBecomingAnEntry()
    {
        var html = UpdateLogPageRenderer.RenderFromText(
            "# Update Log\n## The Weave Explorer\n\n[26AUG26] First entry");

        Assert.Contains("<title>Update Log</title>", html);
        Assert.Contains("<h1>Update Log</h1>", html);
        Assert.Contains("<p class=\"subtitle\">The Weave Explorer</p>", html);

        // The heading block itself never becomes a changelog entry.
        Assert.DoesNotContain("# Update Log", html.Substring(html.IndexOf("<ul class=\"updates\">")));
        Assert.Contains("<li><span class=\"date\">26AUG26</span>First entry</li>", html);
    }

    [Fact]
    public void RenderFromText_NoLeadingHeadingBlock_FallsBackToPlainDefaultTitle()
    {
        var html = UpdateLogPageRenderer.RenderFromText("[26AUG26] First entry");

        Assert.Contains("<title>Update Log</title>", html);
        Assert.Contains("<h1>Update Log</h1>", html);
        Assert.DoesNotContain("class=\"subtitle\"", html);
    }

    [Fact]
    public void RenderFromText_HeadingBlockWithNoLevelOneLine_StillUsesDefaultTitle_ButKeepsTheSubtitle()
    {
        var html = UpdateLogPageRenderer.RenderFromText(
            "## The Weave Explorer\n\n[26AUG26] First entry");

        Assert.Contains("<title>Update Log</title>", html);
        Assert.Contains("<p class=\"subtitle\">The Weave Explorer</p>", html);
    }

    [Fact]
    public void Render_ProducesAWellFormedPage_MatchingTheLiveUpdateLog()
    {
        var html = UpdateLogPageRenderer.Render();

        Assert.StartsWith("<!DOCTYPE html>", html);
        Assert.Contains("<title>Update Log</title>", html);
        Assert.Contains("<ul class=\"updates\">", html);
    }
}
