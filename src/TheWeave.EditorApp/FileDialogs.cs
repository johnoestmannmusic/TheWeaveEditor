using System.Runtime.InteropServices;
using Photino.NET;

namespace TheWeave.EditorApp;

/// <summary>
/// The Editor's file dialogs. Photino's own open at whatever size and place GTK last remembered, which can
/// run behind the desktop's task bar, with nothing offered to change that. So on Linux, where they're GTK
/// dialogs anyway, this makes them directly: the same dialog, with its size and position set. On Wayland an
/// app can't place its own windows, so what centers it there is being a modal child of the Editor's window.
/// Anywhere else, it's Photino's.
/// </summary>
internal static class FileDialogs
{
    private const int DefaultWidth = 760;
    private const int DefaultHeight = 520;

    public static string[] ShowOpenFile(PhotinoWindow window, string title, (string Name, string[] Extensions)[] filters)
    {
        if (!OperatingSystem.IsLinux())
            return window.ShowOpenFile(title: title, filters: filters);

        var path = RunOnMainThread(window, () => Gtk.Run(title, Gtk.ActionOpen, "_Open", filters));
        return path is null ? Array.Empty<string>() : new[] { path };
    }

    public static string? ShowSaveFile(PhotinoWindow window, string title, (string Name, string[] Extensions)[] filters)
    {
        if (!OperatingSystem.IsLinux())
            return window.ShowSaveFile(title: title, filters: filters);

        return RunOnMainThread(window, () => Gtk.Run(title, Gtk.ActionSave, "_Save", filters));
    }

    public static string[] ShowOpenFolder(PhotinoWindow window, string title)
    {
        if (!OperatingSystem.IsLinux())
            return window.ShowOpenFolder(title: title);

        var path = RunOnMainThread(window, () => Gtk.Run(title, Gtk.ActionSelectFolder, "_Select", Array.Empty<(string, string[])>()));
        return path is null ? Array.Empty<string>() : new[] { path };
    }

    private static string? RunOnMainThread(PhotinoWindow window, Func<string?> run)
    {
        string? result = null;
        window.Invoke(() => result = run());
        return result;
    }

    private static class Gtk
    {
        public const int ActionOpen = 0;
        public const int ActionSave = 1;
        public const int ActionSelectFolder = 2;

        private const string LibGtk = "libgtk-3.so.0";
        private const string LibGlib = "libglib-2.0.so.0";
        private const int ResponseCancel = -6;
        private const int ResponseAccept = -3;
        private const int PositionCenter = 1;
        private const int PositionCenterOnParent = 4;

        public static string? Run(string title, int action, string acceptLabel, (string Name, string[] Extensions)[] filters)
        {
            var parent = FindEditorWindow();
            var dialog = gtk_file_chooser_dialog_new(title, parent, action, IntPtr.Zero);

            try
            {
                gtk_dialog_add_button(dialog, "_Cancel", ResponseCancel);
                gtk_dialog_add_button(dialog, acceptLabel, ResponseAccept);
                gtk_dialog_set_default_response(dialog, ResponseAccept);
                gtk_window_set_modal(dialog, true);
                // Over the Editor's window, where it's looked for, or failing that the middle of the screen.
                gtk_window_set_position(dialog, parent != IntPtr.Zero ? PositionCenterOnParent : PositionCenter);

                if (action == ActionSave)
                    gtk_file_chooser_set_do_overwrite_confirmation(dialog, true);

                foreach (var (name, extensions) in filters)
                {
                    var filter = gtk_file_filter_new();
                    gtk_file_filter_set_name(filter, name);
                    foreach (var extension in extensions)
                        gtk_file_filter_add_pattern(filter, extension);
                    gtk_file_chooser_add_filter(dialog, filter);
                }

                // A default size wouldn't do here: GTK puts back the size this kind of dialog was last left
                // at as it appears, however large that was, so this has to come after.
                gtk_widget_show(dialog);
                gtk_window_resize(dialog, DefaultWidth, DefaultHeight);

                // GTK placed it for the size it remembered, so it's put back in the middle of the Editor's window
                // now it's the size it should be. Wayland doesn't let an app place its windows, but there being a
                // modal child of the Editor's window is what centers it.
                if (parent != IntPtr.Zero)
                {
                    gtk_window_get_position(parent, out var left, out var top);
                    gtk_window_get_size(parent, out var width, out var height);
                    gtk_window_move(dialog, left + (width - DefaultWidth) / 2, top + (height - DefaultHeight) / 2);
                }

                if (gtk_dialog_run(dialog) != ResponseAccept)
                    return null;

                var chosen = gtk_file_chooser_get_filename(dialog);
                if (chosen == IntPtr.Zero)
                    return null;

                var path = Marshal.PtrToStringUTF8(chosen);
                g_free(chosen);
                return path;
            }
            finally
            {
                gtk_widget_destroy(dialog);
            }
        }

        // Photino doesn't give out its window on Linux, but it's the only one the Editor has open.
        private static IntPtr FindEditorWindow()
        {
            var windows = gtk_window_list_toplevels();
            var found = IntPtr.Zero;

            for (var item = windows; item != IntPtr.Zero; item = Marshal.ReadIntPtr(item, IntPtr.Size))
            {
                var candidate = Marshal.ReadIntPtr(item);
                if (gtk_widget_get_visible(candidate))
                {
                    found = candidate;
                    break;
                }
            }

            g_list_free(windows);
            return found;
        }

        [DllImport(LibGtk)] private static extern IntPtr gtk_file_chooser_dialog_new([MarshalAs(UnmanagedType.LPUTF8Str)] string title, IntPtr parent, int action, IntPtr firstButtonText);
        [DllImport(LibGtk)] private static extern IntPtr gtk_dialog_add_button(IntPtr dialog, [MarshalAs(UnmanagedType.LPUTF8Str)] string label, int response);
        [DllImport(LibGtk)] private static extern void gtk_dialog_set_default_response(IntPtr dialog, int response);
        [DllImport(LibGtk)] private static extern int gtk_dialog_run(IntPtr dialog);
        [DllImport(LibGtk)] private static extern void gtk_window_set_modal(IntPtr window, [MarshalAs(UnmanagedType.Bool)] bool modal);
        [DllImport(LibGtk)] private static extern void gtk_window_set_position(IntPtr window, int position);
        [DllImport(LibGtk)] private static extern void gtk_window_get_position(IntPtr window, out int x, out int y);
        [DllImport(LibGtk)] private static extern void gtk_window_get_size(IntPtr window, out int width, out int height);
        [DllImport(LibGtk)] private static extern void gtk_window_move(IntPtr window, int x, int y);
        [DllImport(LibGtk)] private static extern void gtk_window_resize(IntPtr window, int width, int height);
        [DllImport(LibGtk)] private static extern IntPtr gtk_window_list_toplevels();
        [DllImport(LibGtk)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool gtk_widget_get_visible(IntPtr widget);
        [DllImport(LibGtk)] private static extern void gtk_widget_show(IntPtr widget);
        [DllImport(LibGtk)] private static extern void gtk_widget_destroy(IntPtr widget);
        [DllImport(LibGtk)] private static extern void gtk_file_chooser_set_do_overwrite_confirmation(IntPtr chooser, [MarshalAs(UnmanagedType.Bool)] bool confirm);
        [DllImport(LibGtk)] private static extern void gtk_file_chooser_add_filter(IntPtr chooser, IntPtr filter);
        [DllImport(LibGtk)] private static extern IntPtr gtk_file_chooser_get_filename(IntPtr chooser);
        [DllImport(LibGtk)] private static extern IntPtr gtk_file_filter_new();
        [DllImport(LibGtk)] private static extern void gtk_file_filter_set_name(IntPtr filter, [MarshalAs(UnmanagedType.LPUTF8Str)] string name);
        [DllImport(LibGtk)] private static extern void gtk_file_filter_add_pattern(IntPtr filter, [MarshalAs(UnmanagedType.LPUTF8Str)] string pattern);
        [DllImport(LibGlib)] private static extern void g_list_free(IntPtr list);
        [DllImport(LibGlib)] private static extern void g_free(IntPtr memory);
    }
}
