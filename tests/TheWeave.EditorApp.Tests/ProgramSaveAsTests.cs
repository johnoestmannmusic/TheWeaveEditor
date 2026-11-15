using TheWeave.EditorApp;
using Xunit;

namespace TheWeave.EditorApp.Tests;

/// <summary>
/// Saving a project under a different path (Program.SaveProjectAs): the one decision in it worth pinning down is where
/// the project's assets are looked for afterwards, since that's what its image previews and its export resolve against.
/// </summary>
public class ProgramSaveAsTests
{
    private static readonly string Root = Path.Combine(Path.GetTempPath(), "weave-save-as-tests");

    private static string Folder(string name) => Path.Combine(Root, name);
    private static string Project(string folderName) => Path.Combine(Folder(folderName), "project.json");

    [Fact]
    public void SavingElsewhere_TakesTheAssetsWithIt_WhenTheySatBesideTheProjectFile()
    {
        var contentRoot = Program.ContentRootAfterSaveAs(Folder("old"), Project("old"), Project("new"));

        Assert.Equal(Folder("new"), contentRoot);
    }

    [Fact]
    public void SavingElsewhere_LeavesTheAssetsWhereTheyAre_WhenTheyWereImportedSomewhereElse()
    {
        var contentRoot = Program.ContentRootAfterSaveAs(Folder("imported"), Project("elsewhere"), Project("new"));

        Assert.Equal(Folder("imported"), contentRoot);
    }

    [Fact]
    public void Saving_ANewProjectThatHasNoPathYet_PutsItsAssetsBesideIt()
    {
        Assert.Equal(Folder("new"), Program.ContentRootAfterSaveAs(null, null, Project("new")));
    }

    [Fact]
    public void Saving_OverTheSamePath_ChangesNothing()
    {
        Assert.Equal(Folder("old"), Program.ContentRootAfterSaveAs(Folder("old"), Project("old"), Project("old")));
    }
}
