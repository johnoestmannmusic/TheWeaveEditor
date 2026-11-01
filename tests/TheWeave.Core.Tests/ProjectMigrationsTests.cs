using TheWeave.Core.Model;
using TheWeave.Core.Serialization;

namespace TheWeave.Core.Tests;

public class ProjectMigrationsTests
{
    private static Node TravelNode(string id, string target, double x, double y) => new()
    {
        Id = id,
        X = x,
        Y = y,
        Card = new Card { HeadingText = id, Action = new CardAction { Kind = ActionKind.Travel, TargetPageId = target } },
    };

    private static WeaveProject Project(params Page[] pages)
    {
        var project = new WeaveProject { SchemaVersion = 2, HomePageId = "home" };
        project.Pages.AddRange(pages);
        return project;
    }

    [Fact]
    public void Upgrade_MovesAPlanetsReturnNodeToTheEntrySquare()
    {
        var returnNode = TravelNode("back", "home", 201, 201);
        var other = new Node { Id = "track", X = 501, Y = 501 };
        var project = Project(new Page { Id = "home" }, new Page { Id = "planet", Nodes = { other, returnNode } });

        var notes = ProjectMigrations.Upgrade(project);

        Assert.Equal(ProjectMigrations.CurrentSchemaVersion, project.SchemaVersion);
        Assert.Equal(51, returnNode.X);
        Assert.Equal(201, returnNode.Y);
        Assert.Equal(501, other.X); // nothing else moves
        Assert.Contains(notes!, n => n.Contains("#0") && n.Contains("1 page"));
    }

    [Fact]
    public void Upgrade_MovesAnythingAlreadyOnTheEntrySquareOutOfTheWay()
    {
        var returnNode = TravelNode("back", "home", 201, 351);
        var occupant = new Node { Id = "track", X = 51, Y = 201, Card = new Card { HeadingText = "Track" } };
        var project = Project(new Page { Id = "home" }, new Page { Id = "planet", Title = "Planet", Nodes = { occupant, returnNode } });

        var notes = ProjectMigrations.Upgrade(project);

        Assert.Equal(51, returnNode.X);
        Assert.Equal(201, returnNode.Y);
        Assert.False(occupant.X == 51 && occupant.Y == 201);
        Assert.Contains(notes!, n => n.StartsWith("Planet: 'Track' moved to"));
    }

    [Fact]
    public void Upgrade_LeavesTheHomePageAlone()
    {
        var planetLink = TravelNode("planet-link", "planet", 1101, 351);
        var project = Project(new Page { Id = "home", Nodes = { planetLink } }, new Page { Id = "planet" });

        ProjectMigrations.Upgrade(project);

        Assert.Equal(1101, planetLink.X);
        Assert.Equal(351, planetLink.Y);
    }

    [Fact]
    public void Upgrade_OnlyMovesOneReturnNodePerPage()
    {
        var first = TravelNode("first", "home", 201, 201);
        var second = TravelNode("second", "home", 351, 201);
        var project = Project(new Page { Id = "home" }, new Page { Id = "planet", Nodes = { first, second } });

        ProjectMigrations.Upgrade(project);

        Assert.Equal(51, first.X);
        Assert.Equal(351, second.X);
    }

    [Fact]
    public void Upgrade_ProjectWithNoHomePage_MovesNothing()
    {
        var link = TravelNode("link", "other", 201, 201);
        var project = new WeaveProject { SchemaVersion = 2, Pages = { new Page { Id = "planet", Nodes = { link } }, new Page { Id = "other" } } };

        var notes = ProjectMigrations.Upgrade(project);

        Assert.Equal(201, link.X);
        Assert.Empty(notes!);
    }

    [Fact]
    public void Upgrade_ANodeAlreadyOnTheEntrySquare_IsNotReportedAsMoved()
    {
        var project = Project(new Page { Id = "home" }, new Page { Id = "planet", Nodes = { TravelNode("back", "home", 51, 201) } });

        Assert.Empty(ProjectMigrations.Upgrade(project)!);
    }

    [Fact]
    public void Upgrade_CurrentProject_DoesNothing()
    {
        var returnNode = TravelNode("back", "home", 201, 201);
        var project = Project(new Page { Id = "home" }, new Page { Id = "planet", Nodes = { returnNode } });
        project.SchemaVersion = ProjectMigrations.CurrentSchemaVersion;

        Assert.Null(ProjectMigrations.Upgrade(project));
        Assert.Equal(201, returnNode.X);
    }
}
