using System.Text.Json;
using System.Text.Json.Serialization;
using Photino.NET;
using TheWeave.Core.Model;
using TheWeave.Core.Serialization;
using TheWeave.Core.Validation;
using TheWeave.Exporter;
using TheWeave.Importer;

namespace TheWeave.EditorApp;

/// <summary>
/// The editor shell: a thin native window (Photino, hosting the OS's own webview) around a
/// plain HTML/CSS/JS UI in wwwroot/. This class is JS<->C# interop only - project
/// state/logic lives entirely in TheWeave.Core/Importer/Exporter (and the small in-memory
/// mutations in ProjectEditing.cs), kept UI-agnostic.
///
/// Protocol: JS sends one JSON envelope (EditorMessage) per action via
/// window.external.sendMessage; after every mutation the *entire* current project is sent
/// back via window.SendWebMessage as a "project-state" message, and the tree/inspector UI is
/// fully re-rendered from that. Project sizes here (tens to low hundreds of nodes) make a
/// full resync on every edit simpler and safer than partial patching, at negligible cost.
/// </summary>
public static class Program
{
    private static WeaveProject? _project;
    private static string? _projectPath;
    private static readonly EditorSettings _settings = EditorSettings.Load();
    private static UndoHistory _undoHistory = new();
    private static List<string>? _startupWarnings; // see LoadProject

    /// <summary>
    /// Where this project's content assets (img/, fnt/) actually live on disk - the imported
    /// folder, or the saved project file's own directory as a "assets live next to the
    /// project" convention. Used both to resolve real file:// image URLs for the map canvas
    /// preview and as the Exporter's contentSourceRoot so Export Site actually copies assets.
    /// </summary>
    private static string? _contentRoot;

    // Extensions need a "*." glob prefix - Photino's Linux backend passes them straight to
    // gtk_file_filter_add_pattern, which treats a bare "json" as a literal filename to match,
    // not an extension.
    private static readonly (string Name, string[] Extensions)[] ProjectFileFilter =
    {
        ("Weave Project", new[] { "*.json" }),
    };

    private static readonly (string Name, string[] Extensions)[] PuzzleFileFilter =
    {
        ("Sokoban Puzzle", new[] { "*.json" }),
    };

    private static readonly (string Name, string[] Extensions)[] PngFileFilter =
    {
        ("PNG Image", new[] { "*.png" }),
    };

    // One extension per filter entry, not a single entry listing several - confirmed (via
    // Photino.Native's Linux AddFilters, which joins multiple extensions with ";" before
    // handing the string to GTK) that its strtok-based parsing only ever splits the *first*
    // "|", so a ";"-joined extension list gets added to GTK as one literal pattern that no
    // real file matches, leaving the picker empty. Filtering to just "Image" isn't possible on
    // Linux without hitting that bug, so this is several single-extension filters instead
    // (GTK's own filter dropdown lets a user switch between them), with "All Files" last so
    // nothing is ever unreachable.
    private static readonly (string Name, string[] Extensions)[] ImageFileFilter =
    {
        ("PNG Image", new[] { "*.png" }),
        ("JPEG Image", new[] { "*.jpg" }),
        ("JPEG Image (.jpeg)", new[] { "*.jpeg" }),
        ("GIF Image", new[] { "*.gif" }),
        ("WebP Image", new[] { "*.webp" }),
        ("All Files", new[] { "*" }),
    };

    // Same one-extension-per-filter reasoning as ImageFileFilter above.
    private static readonly (string Name, string[] Extensions)[] AudioFileFilter =
    {
        ("OGG Audio", new[] { "*.ogg" }),
        ("MP3 Audio", new[] { "*.mp3" }),
        ("All Files", new[] { "*" }),
    };

    internal static readonly JsonSerializerOptions InboundOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    // Enum values are intentionally NOT camelCased (kept as e.g. "Hub", "Travel") even though
    // property names are - they're opaque tokens the UI round-trips verbatim in <select>
    // options, and matching InboundOptions exactly avoids a second casing convention for JS to
    // track when it sends an edit back.
    private static readonly JsonSerializerOptions OutboundOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    // Always the build output's copy, wherever the app was started from. A path relative to the current
    // folder would find the source wwwroot after a plain "dotnet run", and that doesn't have everything
    // the page needs: puzzle.js is linked in from the exporter's runtime at build time - see the csproj.
    internal static string IndexPagePath => Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");

    [STAThread]
    public static void Main(string[] args)
    {
        // An explicit path argument wins; otherwise fall back to whatever project was open last
        // time, since this editor is normally used on one ongoing project rather than many.
        var pathToOpen = args.Length > 0 ? args[0] : _settings.LastProjectPath;

        if (pathToOpen is not null && File.Exists(pathToOpen))
            LoadProject(pathToOpen);

        var window = new PhotinoWindow()
            .SetTitle("The Weave Editor")
            .SetUseOsDefaultSize(false)
            .SetSize(1200, 800)
            .Center()
            .RegisterWebMessageReceivedHandler(OnMessage)
            .Load(IndexPagePath);

        // Belt-and-suspenders: on this dev environment's WebKitGTK setup, WaitForClose() has
        // been observed to not reliably unblock when the window is closed, leaving the host
        // process (and its WebKit child processes) running after the window disappears. Force
        // the whole process to exit as soon as the window starts closing, rather than relying
        // on WaitForClose()'s return + natural fall-through of Main().
        window.RegisterWindowClosingHandler((sender, e) =>
        {
            Environment.Exit(0);
            return false;
        });

        window.WaitForClose();
        Environment.Exit(0);
    }

    private static async void OnMessage(object? sender, string raw)
    {
        var window = (PhotinoWindow)sender!;

        try
        {
            var message = JsonSerializer.Deserialize<EditorMessage>(raw, InboundOptions)
                ?? throw new InvalidOperationException("Empty message.");

            switch (message.Type)
            {
                case "ready":
                    SendProjectState(window, _startupWarnings);
                    _startupWarnings = null;
                    break;

                case "new-project":
                    _project = new WeaveProject { Title = "Untitled Project" };
                    ProjectEditing.SeedArchetons(_project);
                    _projectPath = null;
                    _contentRoot = null;
                    _undoHistory = new UndoHistory();
                    SendProjectState(window);
                    break;

                case "open-project":
                    OpenProject(window);
                    break;

                case "import-legacy-site":
                    await ImportLegacySite(window);
                    break;

                case "export-site":
                    ExportSite(window);
                    break;

                case "change-export-path":
                    ChangeExportPath(window);
                    break;

                case "pick-cover-image":
                    PickCoverImage(window, message.PageId, message.NodeId);
                    break;

                case "pick-background-music":
                    PickBackgroundMusic(window);
                    break;

                case "rename-node-id":
                    RequireProject();
                    RenameNodeId(window, RequirePage(message.PageId), message.NodeId, message.NewId);
                    break;

                case "undo":
                    RequireProject();
                    Undo(window);
                    break;

                case "redo":
                    RequireProject();
                    Redo(window);
                    break;

                case "add-page":
                    RequireProject();
                    ApplyMutation(window, () => ProjectEditing.AddPage(_project!, message.Page?.Title, message.Page?.OutputFileName, message.Page?.BackgroundImagePath));
                    break;

                case "update-page":
                    RequireProject();
                    var pageToEdit = RequirePage(message.PageId);
                    ApplyMutation(window, () => ProjectEditing.ApplyPageEdit(_project!, pageToEdit, message.Page ?? new PageEditRequest()));
                    break;

                case "update-project":
                    RequireProject();
                    ApplyMutation(window, () => ProjectEditing.ApplyProjectEdit(_project!, message.Project ?? new ProjectEditRequest()));
                    break;

                case "update-tutorial-modal":
                    RequireProject();
                    ApplyMutation(window, () => ProjectEditing.ApplyTutorialModalEdit(_project!, message.TutorialModal ?? new TutorialModalEditRequest()));
                    break;

                case "delete-page":
                    RequireProject();
                    var pageToDelete = RequirePage(message.PageId);
                    ApplyMutation(window, () =>
                    {
                        _project!.Pages.Remove(pageToDelete);
                        ProjectEditing.DropMissingRequirements(_project);
                    });
                    break;

                case "add-node":
                    RequireProject();
                    var pageForAdd = RequirePage(message.PageId);
                    ApplyMutation(window, () => ProjectEditing.AddNode(_project!, pageForAdd, message.ParentNodeId, message.X, message.Y));
                    break;

                case "update-node":
                    RequireProject();
                    var pageForEdit = RequirePage(message.PageId);
                    var nodeToEdit = RequireNode(pageForEdit, message.NodeId);
                    var nodeEdit = message.Node ?? new NodeEditRequest();
                    // Rejects a taken square here, before ApplyMutation records an undo step for a
                    // change that isn't going to happen.
                    ProjectEditing.ResolveNodePosition(_project!, pageForEdit, nodeToEdit, nodeEdit.X, nodeEdit.Y);
                    ApplyMutation(window, () => ProjectEditing.ApplyNodeEdit(_project!, pageForEdit, nodeToEdit, nodeEdit));
                    break;

                case "update-puzzle":
                    RequireProject();
                    var pageForPuzzle = RequirePage(message.PageId);
                    var nodeForPuzzle = RequireNode(pageForPuzzle, message.NodeId);
                    // Same order as update-node: a rejected puzzle shouldn't record an undo step. Tried on a copy,
                    // since applying it also lines up the next part's Start.
                    if (message.Puzzle is not null)
                        ProjectEditing.ApplyPuzzleEdit(CopyForCheck(nodeForPuzzle), CopyForCheck(message.Puzzle));
                    var addedDrawings = message.Drawings ?? [];
                    var addedArchetons = message.Archetons ?? [];
                    if (addedDrawings.Count > 0 || addedArchetons.Count > 0)
                    {
                        var check = CopyForCheck(_project!);
                        ProjectEditing.AddPuzzleDrawings(check, CopyForCheck(addedDrawings));
                        ProjectEditing.AddArchetons(check, CopyForCheck(addedArchetons));
                    }
                    ApplyMutation(window, () =>
                    {
                        if (addedDrawings.Count > 0)
                            ProjectEditing.AddPuzzleDrawings(_project!, addedDrawings);
                        if (addedArchetons.Count > 0)
                            ProjectEditing.AddArchetons(_project!, addedArchetons);
                        ProjectEditing.ApplyPuzzleEdit(nodeForPuzzle, message.Puzzle, pageForPuzzle);
                    });
                    break;

                case "update-puzzle-drawings":
                    RequireProject();
                    var drawings = message.Drawings ?? [];
                    ProjectEditing.ApplyPuzzleDrawingsEdit(CopyForCheck(_project!), CopyForCheck(drawings), message.DrawingSets is null ? null : CopyForCheck(message.DrawingSets));
                    ApplyMutation(window, () => ProjectEditing.ApplyPuzzleDrawingsEdit(_project!, drawings, message.DrawingSets));
                    break;

                case "update-archetons":
                    RequireProject();
                    var archetons = message.Archetons ?? [];
                    ProjectEditing.ApplyArchetonsEdit(CopyForCheck(_project!), CopyForCheck(archetons));
                    ApplyMutation(window, () => ProjectEditing.ApplyArchetonsEdit(_project!, archetons));
                    break;

                case "load-puzzle-art":
                    RequireProject();
                    SendPuzzleArt(window, RequireNode(RequirePage(message.PageId), message.NodeId));
                    break;

                case "export-puzzle":
                    RequireProject();
                    ExportPuzzle(window, RequireNode(RequirePage(message.PageId), message.NodeId));
                    break;

                case "import-puzzle":
                    RequireProject();
                    ImportPuzzle(window, RequireNode(RequirePage(message.PageId), message.NodeId));
                    break;

                case "export-drawing-png":
                    ExportDrawingPng(window, message.DataUrl, message.FileName);
                    break;

                case "import-drawing-png":
                    ImportDrawingPng(window);
                    break;

                case "delete-node":
                    RequireProject();
                    var pageForDelete = RequirePage(message.PageId);
                    ApplyMutation(window, () =>
                    {
                        if (!ProjectEditing.RemoveNode(pageForDelete.Nodes, message.NodeId ?? ""))
                            throw new InvalidOperationException($"Node '{message.NodeId}' not found.");
                        ProjectEditing.DropMissingRequirements(_project!);
                    });
                    break;

                case "add-effect":
                    RequireProject();
                    var pageForAddEffect = RequirePage(message.PageId);
                    ApplyMutation(window, () => ProjectEditing.AddEffect(pageForAddEffect, message.Effect ?? new EffectEditRequest()));
                    break;

                case "update-effect":
                    RequireProject();
                    var pageForUpdateEffect = RequirePage(message.PageId);
                    ApplyMutation(window, () => ProjectEditing.UpdateEffect(pageForUpdateEffect, message.EffectId ?? "", message.Effect ?? new EffectEditRequest()));
                    break;

                case "delete-effect":
                    RequireProject();
                    var pageForEffectDelete = RequirePage(message.PageId);
                    ApplyMutation(window, () =>
                    {
                        if (!ProjectEditing.RemoveEffect(pageForEffectDelete, message.EffectId ?? ""))
                            throw new InvalidOperationException($"Effect '{message.EffectId}' not found.");
                    });
                    break;

                default:
                    SendError(window, $"Unknown message type '{message.Type}'.");
                    break;
            }
        }
        catch (Exception ex)
        {
            SendError(window, ex.Message);
        }
    }

    // A deep copy, for trying an edit out on without touching the real thing.
    private static T CopyForCheck<T>(T value) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, InboundOptions), InboundOptions)!;

    private static void RequireProject()
    {
        if (_project is null)
            throw new InvalidOperationException("No project open.");
    }

    private static Page RequirePage(string? pageId) =>
        (pageId is not null ? ProjectEditing.FindPage(_project!, pageId) : null)
        ?? throw new InvalidOperationException($"Page '{pageId}' not found.");

    private static Node RequireNode(Page page, string? nodeId) =>
        (nodeId is not null ? ProjectEditing.FindNode(page.Nodes, nodeId) : null)
        ?? throw new InvalidOperationException($"Node '{nodeId}' not found.");

    private static void OpenProject(PhotinoWindow window)
    {
        var paths = window.ShowOpenFile(title: "Open Weave Project", filters: ProjectFileFilter);
        if (paths.Length == 0)
            return;

        LoadProject(paths[0]);
        RememberLastProjectPath();
        SendProjectState(window, _startupWarnings);
        _startupWarnings = null;
    }

    // A project written by an older version gets upgraded as it loads (see ProjectMigrations), which
    // can move things around - so the original file is kept as a backup, once, before the upgraded
    // version replaces it. Anything the upgrade has to say is shown the next time the UI gets the
    // project state.
    private static void LoadProject(string path)
    {
        var savedVersion = WeaveProjectSerializer.ReadSchemaVersion(path);
        _project = WeaveProjectSerializer.LoadFromFile(path, out var upgradeNotes);
        ProjectEditing.SeedArchetons(_project);
        _projectPath = path;
        _contentRoot = Path.GetDirectoryName(Path.GetFullPath(path));
        _undoHistory = UndoHistory.Load(path);

        if (upgradeNotes is not null)
        {
            var backupPath = $"{path}.v{savedVersion}.bak";
            if (!File.Exists(backupPath))
                File.Copy(path, backupPath);

            WeaveProjectSerializer.SaveToFile(_project, path);

            _startupWarnings = new List<string> { $"Project upgraded. The previous version is saved as {backupPath}." };
            _startupWarnings.AddRange(upgradeNotes);
        }
    }

    // Shared shape for every plain in-memory edit: record the pre-mutation state for undo,
    // apply it, then the usual auto-save + resync. Kept separate from RenameNodeId (needs an
    // extra message sent before the resync) and Undo/Redo (the "mutation" *is* moving through
    // the history rather than adding to it), but everything else funnels through here so
    // there's exactly one place that has to remember all three steps.
    private static void ApplyMutation(PhotinoWindow window, Action mutate)
    {
        _undoHistory.RecordBeforeChange(_project!);
        mutate();
        AutoSave(window);
        if (_projectPath is not null)
            _undoHistory.Save(_projectPath);
        SendProjectState(window);
    }

    private static void Undo(PhotinoWindow window)
    {
        var restored = _undoHistory.Undo(_project!);
        if (restored is null)
        {
            SendStatus(window, "Nothing to undo.");
            return;
        }

        _project = restored;
        AutoSave(window);
        if (_projectPath is not null)
            _undoHistory.Save(_projectPath);
        SendProjectState(window);
    }

    private static void Redo(PhotinoWindow window)
    {
        var restored = _undoHistory.Redo(_project!);
        if (restored is null)
        {
            SendStatus(window, "Nothing to redo.");
            return;
        }

        _project = restored;
        AutoSave(window);
        if (_projectPath is not null)
            _undoHistory.Save(_projectPath);
        SendProjectState(window);
    }

    // Called after every mutation instead of a manual Save button. A brand new, never-saved
    // project has nowhere to write to yet, so the very first edit prompts once (like a "Save
    // As"); every edit after that - for this project, for the rest of the session - writes
    // silently. If the user cancels that first prompt, the edit stays applied in memory and
    // the next edit will ask again.
    private static void AutoSave(PhotinoWindow window)
    {
        if (_project is null)
            return;

        if (_projectPath is null)
        {
            var path = window.ShowSaveFile(title: "Save Weave Project", filters: ProjectFileFilter);
            if (string.IsNullOrEmpty(path))
                return;

            _projectPath = path;
            _contentRoot ??= Path.GetDirectoryName(Path.GetFullPath(path));
            RememberLastProjectPath();
        }

        try
        {
            WeaveProjectSerializer.SaveToFile(_project, _projectPath);
        }
        catch (Exception ex)
        {
            SendError(window, $"Auto-save failed: {ex.Message}");
        }
    }

    private static void RememberLastProjectPath()
    {
        _settings.LastProjectPath = _projectPath;
        _settings.Save();
    }

    private static async Task ImportLegacySite(PhotinoWindow window)
    {
        var folders = window.ShowOpenFolder(title: "Select the site folder to import");
        if (folders.Length == 0)
            return;

        var result = await new SiteImporter().ImportDirectoryAsync(folders[0]);
        var upgradeNotes = ProjectMigrations.Upgrade(result.Project) ?? new List<string>();
        _project = result.Project;
        _projectPath = null;
        _contentRoot = Path.GetFullPath(folders[0]);
        _undoHistory = new UndoHistory();

        SendProjectState(window, result.Warnings.Select(w => w.ToString()).Concat(upgradeNotes).ToList());
    }

    private static void ExportSite(PhotinoWindow window)
    {
        if (_project is null)
        {
            SendError(window, "No project open.");
            return;
        }

        // Once an export folder is set (and still exists), reuse it silently rather than
        // prompting every time - this project is normally exported to the same place over and
        // over. If it's gone missing (moved/deleted), fall back to prompting again.
        var exportPath = _project.ExportPath;
        if (exportPath is null || !Directory.Exists(exportPath))
        {
            var folders = window.ShowOpenFolder(title: "Select the export destination folder");
            if (folders.Length == 0)
                return;

            exportPath = folders[0];
            var chosenPath = exportPath;
            ApplyMutation(window, () => _project!.ExportPath = chosenPath);
        }

        new SiteExporter().Export(_project, exportPath, _contentRoot);
        SendStatus(window, $"Exported to {exportPath}" + (_contentRoot is null ? " (no content root known - img/fnt were not copied)" : ""));
    }

    private static void ChangeExportPath(PhotinoWindow window)
    {
        if (_project is null)
        {
            SendError(window, "No project open.");
            return;
        }

        var folders = window.ShowOpenFolder(title: "Select the export destination folder");
        if (folders.Length == 0)
            return;

        var newExportPath = folders[0];
        ApplyMutation(window, () => _project!.ExportPath = newExportPath);
        SendStatus(window, $"Export folder set to {newExportPath}.");
    }

    private static void PickCoverImage(PhotinoWindow window, string? pageId, string? nodeId)
    {
        if (_contentRoot is null)
        {
            SendError(window, "Open, import, or save the project first so its content folder is known.");
            return;
        }

        var paths = window.ShowOpenFile(title: "Select cover image", filters: ImageFileFilter);
        if (paths.Length == 0)
            return;

        var sourceAbsolute = Path.GetFullPath(paths[0]);
        var page = pageId is not null ? ProjectEditing.FindPage(_project!, pageId) : null;
        var node = page is not null && nodeId is not null ? ProjectEditing.FindNode(page.Nodes, nodeId) : null;

        var destRelative = AssetImport.ResolveDestination(_contentRoot, _project!.Assets.ImgRoot, sourceAbsolute, page?.Id, node?.Id);

        var destAbsolute = Path.GetFullPath(Path.Combine(_contentRoot, destRelative.Replace('/', Path.DirectorySeparatorChar)));
        if (!string.Equals(destAbsolute, sourceAbsolute, StringComparison.OrdinalIgnoreCase))
        {
            var destDir = Path.GetDirectoryName(destAbsolute);
            if (!string.IsNullOrEmpty(destDir))
                Directory.CreateDirectory(destDir);

            File.Copy(sourceAbsolute, destAbsolute, overwrite: true);
        }

        window.SendWebMessage(JsonSerializer.Serialize(new { type = "image-picked", path = destRelative }, OutboundOptions));
    }

    // As a data URL, because a canvas isn't allowed to read the pixels of a file:// image, and that's
    // where the puzzle's colours come from.
    private static void SendPuzzleArt(PhotinoWindow window, Node node)
    {
        var coverPath = node.Card.CoverImagePath;
        if (_contentRoot is null || string.IsNullOrEmpty(coverPath))
            throw new InvalidOperationException("This location has no album art to build a puzzle on.");

        var absolute = Path.GetFullPath(Path.Combine(_contentRoot, coverPath.Replace('/', Path.DirectorySeparatorChar)));
        if (!File.Exists(absolute))
            throw new InvalidOperationException($"Album art '{coverPath}' wasn't found.");

        var mime = Path.GetExtension(absolute).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            _ => "image/png",
        };

        window.SendWebMessage(JsonSerializer.Serialize(new
        {
            type = "puzzle-art",
            nodeId = node.Id,
            dataUrl = $"data:{mime};base64,{Convert.ToBase64String(File.ReadAllBytes(absolute))}",
        }, OutboundOptions));
    }

    private static void ExportPuzzle(PhotinoWindow window, Node node)
    {
        if (node.Puzzle is null)
            throw new InvalidOperationException("This track has no puzzle to export yet.");

        var path = window.ShowSaveFile(title: "Export Sokoban Puzzle", filters: PuzzleFileFilter);
        if (string.IsNullOrEmpty(path))
            return;

        if (!Path.HasExtension(path))
            path += ".json";

        File.WriteAllText(path, PuzzleFile.Serialize(node.Puzzle, _project!.PuzzleDrawings, _project.Archetons));
        SendStatus(window, $"Exported puzzle to {path}.");
    }

    // Checks the file here, but leaves saving it to the page, which sends it back as a normal edit along with
    // this track's own colours and textures, and any drawings the library doesn't have yet - see
    // puzzleEditor.js's receiveImportedPuzzle.
    private static void ImportPuzzle(PhotinoWindow window, Node node)
    {
        var paths = window.ShowOpenFile(title: "Import Sokoban Puzzle", filters: PuzzleFileFilter);
        if (paths.Length == 0)
            return;

        var (objects, fileDrawings, fileArchetons) = PuzzleFile.Parse(File.ReadAllText(paths[0]));
        var drawings = PuzzleDrawings.Merge(_project!.PuzzleDrawings, fileDrawings, objects);
        // Archeton drawings are named by their definitions rather than by objects, so they're added as they are,
        // unless the library already has one by that id.
        drawings.AddRange(fileDrawings.Where(d => d.Kind == PuzzleObjectKind.Archeton
            && drawings.All(added => added.Id != d.Id) && (_project.PuzzleDrawings ?? []).All(existing => existing.Id != d.Id)));
        var archetons = fileArchetons.Where(a => (_project.Archetons ?? []).All(existing => existing.Id != a.Id)).ToList();
        ProjectEditing.ValidatePuzzle(new Puzzle { Objects = objects });
        var check = CopyForCheck(_project);
        ProjectEditing.AddPuzzleDrawings(check, CopyForCheck(drawings));
        ProjectEditing.AddArchetons(check, CopyForCheck(archetons));

        window.SendWebMessage(JsonSerializer.Serialize(new { type = "puzzle-imported", nodeId = node.Id, objects, drawings, archetons }, OutboundOptions));
    }

    // An object drawing as a PNG, for drawing in other art software. The page draws and reads the image itself (see
    // puzzleDrawings.js's exportDrawingPng and drawingPng.js), so all this does is save and open the file.
    private static void ExportDrawingPng(PhotinoWindow window, string? dataUrl, string? fileName)
    {
        var bytes = DrawingPng.FromDataUrl(dataUrl);

        var path = window.ShowSaveFile(title: $"Export Drawing{(string.IsNullOrWhiteSpace(fileName) ? "" : $" '{fileName}'")}", filters: PngFileFilter);
        if (string.IsNullOrEmpty(path))
            return;

        if (!Path.HasExtension(path))
            path += ".png";

        File.WriteAllBytes(path, bytes);
        SendStatus(window, $"Exported drawing to {path}.");
    }

    private static void ImportDrawingPng(PhotinoWindow window)
    {
        var paths = window.ShowOpenFile(title: "Import Drawing", filters: PngFileFilter);
        if (paths.Length == 0)
            return;

        var dataUrl = DrawingPng.ToDataUrl(File.ReadAllBytes(paths[0]));
        window.SendWebMessage(JsonSerializer.Serialize(new { type = "drawing-png-imported", dataUrl }, OutboundOptions));
    }

    private static void PickBackgroundMusic(PhotinoWindow window)
    {
        if (_contentRoot is null)
        {
            SendError(window, "Open, import, or save the project first so its content folder is known.");
            return;
        }

        var paths = window.ShowOpenFile(title: "Select background music", filters: AudioFileFilter);
        if (paths.Length == 0)
            return;

        var sourceAbsolute = Path.GetFullPath(paths[0]);
        var musRoot = _project!.Assets.MusRoot;

        var destRelativeToMusRoot = AssetImport.ResolveRootRelativeDestination(_contentRoot, musRoot, sourceAbsolute);

        var destAbsolute = Path.GetFullPath(Path.Combine(_contentRoot, musRoot, destRelativeToMusRoot.Replace('/', Path.DirectorySeparatorChar)));
        if (!string.Equals(destAbsolute, sourceAbsolute, StringComparison.OrdinalIgnoreCase))
        {
            var destDir = Path.GetDirectoryName(destAbsolute);
            if (!string.IsNullOrEmpty(destDir))
                Directory.CreateDirectory(destDir);

            File.Copy(sourceAbsolute, destAbsolute, overwrite: true);
        }

        window.SendWebMessage(JsonSerializer.Serialize(new { type = "music-picked", path = destRelativeToMusRoot }, OutboundOptions));
    }

    private static void RenameNodeId(PhotinoWindow window, Page page, string? nodeId, string? newIdRaw)
    {
        var node = RequireNode(page, nodeId);
        var newId = ProjectEditing.NormalizeId(newIdRaw ?? "");

        if (newId.Length == 0)
        {
            SendError(window, "Location ID can't be empty.");
            return;
        }

        if (newId == node.Id)
            return;

        if (ProjectEditing.IsNodeIdInUse(_project!, newId))
        {
            SendError(window, $"Location ID '{newId}' is already in use - choose a different one.");
            return;
        }

        _undoHistory.RecordBeforeChange(_project!);

        var oldId = node.Id;
        node.Id = newId;
        ProjectEditing.RenameRequirements(_project!, oldId, newId);

        if (_contentRoot is not null)
        {
            var renamedCover = AssetImport.RenameCoverImageIfOwned(_contentRoot, _project!, node, oldId);
            if (renamedCover is not null)
                node.Card.CoverImagePath = renamedCover;
        }

        // Sent before the usual project-state resync so the JS side can update its own
        // selectedNodeId to match *before* that resync reconciles selection against the tree -
        // otherwise it finds the old id gone and drops the selection entirely.
        window.SendWebMessage(JsonSerializer.Serialize(new { type = "node-renamed", pageId = page.Id, oldId, newId }, OutboundOptions));

        AutoSave(window);
        if (_projectPath is not null)
            _undoHistory.Save(_projectPath);
        SendProjectState(window);
    }

    private static void SendProjectState(PhotinoWindow window, List<string>? warnings = null)
    {
        var issues = _project is not null
            ? ProjectValidator.Validate(_project)
            : new List<ValidationIssue>();

        var payload = new
        {
            type = "project-state",
            path = _projectPath,
            contentRoot = _contentRoot,
            project = _project,
            grids = _project?.Pages.ToDictionary(p => p.Id, p => BuildGridPayload(p, _project)),
            validationIssues = issues.Select(i => i.ToString()).ToList(),
            warnings = warnings ?? new List<string>(),
            canUndo = _undoHistory.CanUndo,
            canRedo = _undoHistory.CanRedo,
        };

        window.SendWebMessage(JsonSerializer.Serialize(payload, OutboundOptions));
    }

    // Everything the canvas and the square pickers need to know about a page's grid, already worked
    // out, so app.js has no second copy of GridLayout's maths to keep in sync.
    private static object BuildGridPayload(Page page, WeaveProject project)
    {
        var grid = GridLayout.For(page, project);
        return new
        {
            cellWidth = grid.CellWidth,
            cellHeight = grid.CellHeight,
            nodeIconSize = GridLayout.NodeIconSizePx,
            columnCenters = Enumerable.Range(0, grid.Columns).Select(grid.ColumnCenter).ToList(),
            rowCenters = Enumerable.Range(0, grid.Rows).Select(grid.RowCenter).ToList(),
            columnLabels = Enumerable.Range(0, grid.Columns).Select(grid.ColumnLabel).ToList(),
            screenLinesX = grid.ScreenLinesX,
            screenLinesY = grid.ScreenLinesY,
        };
    }

    private static void SendStatus(PhotinoWindow window, string message) =>
        window.SendWebMessage(JsonSerializer.Serialize(new { type = "status", message }, OutboundOptions));

    private static void SendError(PhotinoWindow window, string message) =>
        window.SendWebMessage(JsonSerializer.Serialize(new { type = "error", message }, OutboundOptions));
}
