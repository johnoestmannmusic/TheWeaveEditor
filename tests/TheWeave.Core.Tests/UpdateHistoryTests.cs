using TheWeave.Core.Model;
using Xunit;

namespace TheWeave.Core.Tests;

public class UpdateHistoryTests
{
    [Fact]
    public void Parse_DatedEntry_SplitsTheTagFromTheHeadline()
    {
        var entries = UpdateHistory.Parse(["[26AUG26] Locations now Auto-Play and various other fixes!"]);

        var entry = Assert.Single(entries);
        Assert.Equal("26AUG26", entry.DateTag);
        Assert.Equal("Locations now Auto-Play and various other fixes!", entry.Headline);
        Assert.Empty(entry.SubItems);
    }

    [Fact]
    public void Parse_EntryWithoutADateTag_KeepsItsWholeLineAsTheHeadline()
    {
        var entry = Assert.Single(UpdateHistory.Parse(["Something changed"]));

        Assert.Null(entry.DateTag);
        Assert.Equal("Something changed", entry.Headline);
    }

    [Fact]
    public void Parse_IndentedLines_AreSubItemsOfTheEntryAboveThem()
    {
        var entries = UpdateHistory.Parse(
        [
            "[10JUN26] Entry point is now The Weave:",
            "    Azurus released, with 6 locations",
            "    Pyron released, with 2 locations",
        ]);

        var entry = Assert.Single(entries);
        Assert.Equal("Entry point is now The Weave:", entry.Headline);
        Assert.Equal(["Azurus released, with 6 locations", "Pyron released, with 2 locations"], entry.SubItems);
    }

    [Fact]
    public void Parse_EachLineAtTheMargin_IsItsOwnEntry_NewestFirst()
    {
        var entries = UpdateHistory.Parse(
        [
            "[17NOV26] First batch of puzzles now released!",
            "[01NOV26] Overhaul starting to transform TWE into a Sokoban-like explorer!",
        ]);

        Assert.Equal(["17NOV26", "01NOV26"], entries.Select(e => e.DateTag));
    }

    [Fact]
    public void Parse_BlankLinesAndTheModalsNbspSpacers_AreSeparatorsOnly()
    {
        var entries = UpdateHistory.Parse(
        [
            "[17NOV26] One",
            "&nbsp;&nbsp;&nbsp;&nbsp;",
            "",
            "   ",
            "[01NOV26] Two",
        ]);

        Assert.Equal(["One", "Two"], entries.Select(e => e.Headline));
        Assert.All(entries, entry => Assert.Empty(entry.SubItems));
    }

    [Fact]
    public void Parse_Nothing_IsNoEntries()
    {
        Assert.Empty(UpdateHistory.Parse(null));
        Assert.Empty(UpdateHistory.Parse([]));
        Assert.Empty(UpdateHistory.Parse(["", "&nbsp;"]));
        Assert.False(UpdateHistory.HasEntries(null));
        Assert.True(UpdateHistory.HasEntries(["[26AUG26] One"]));
    }

    [Fact]
    public void PanelLines_TakesTheNewestEntries_WithTheirSubItemsAndTheLinkLast()
    {
        var lines = UpdateHistory.PanelLines(
            [
                "[17NOV26] First",
                "    a sub-item",
                "[01NOV26] Second",
                "[26AUG26] Third",
            ],
            count: 2);

        Assert.Equal(
        [
            "[17NOV26] First",
            "    a sub-item",
            "&nbsp;&nbsp;&nbsp;&nbsp;",
            "[01NOV26] Second",
            "&nbsp;&nbsp;&nbsp;&nbsp;",
            UpdateHistory.FullLogLinkLine,
        ], lines);
    }

    [Fact]
    public void PanelLines_WithNoEntries_OrNoneWanted_IsEmpty()
    {
        Assert.Empty(UpdateHistory.PanelLines(null, 6));
        Assert.Empty(UpdateHistory.PanelLines(["[26AUG26] One"], 0));
    }

    [Fact]
    public void PanelLines_KeepsADatedEntryAndASubItemLineReadableAsItWasTyped()
    {
        // What the panel shows is the same text the history was written in, so a line copied out of the panel goes back
        // into the history unchanged.
        var lines = UpdateHistory.PanelLines(["[07JUL26] Ouros is now open:", "    A mysterious radio signal"], 6);

        Assert.Equal("[07JUL26] Ouros is now open:", lines[0]);
        Assert.Equal("    A mysterious radio signal", lines[1]);
    }
}
