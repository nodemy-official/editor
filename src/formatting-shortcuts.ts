import { Extension } from "@tiptap/core";

export const FormattingShortcuts = Extension.create<{
  strikethrough: boolean;
}>({
  addOptions: () => ({ strikethrough: true }),
  addKeyboardShortcuts() {
    // `editor.commands` binds a fresh transaction per access, so the command
    // must be invoked lazily inside the shortcut rather than captured here.
    const suppressWhileComposing = (command: () => boolean) => () =>
      this.editor.view.composing || command();
    // `Mod-` is Cmd on macOS, so a physical Ctrl press would not reach any
    // binding. Mirroring each shortcut with `Control-` keeps literal Ctrl
    // chords working there; on other platforms they normalize to the same
    // `Ctrl-` key and simply overwrite each other. Shift+letter chords need
    // the uppercase spelling because `event.key` arrives already shifted.
    const bind = (command: () => boolean, ...keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, suppressWhileComposing(command)])
      );
    return {
      ...bind(
        () => this.editor.commands.toggleBold(),
        "Mod-b",
        "Mod-B",
        "Control-b",
        "Control-B"
      ),
      ...bind(
        () => this.editor.commands.toggleCode(),
        "Mod-e",
        "Mod-E",
        "Control-e",
        "Control-E"
      ),
      ...bind(
        () => this.editor.commands.toggleItalic(),
        "Mod-i",
        "Mod-I",
        "Control-i",
        "Control-I"
      ),
      ...bind(
        () => this.editor.commands.toggleBlockquote(),
        "Mod-Shift-b",
        "Mod-Shift-B",
        "Control-Shift-b",
        "Control-Shift-B"
      ),
      ...(this.options.strikethrough
        ? bind(
            () => this.editor.commands.toggleStrike(),
            "Mod-Shift-s",
            "Mod-Shift-S",
            "Control-Shift-s",
            "Control-Shift-S"
          )
        : {}),
    };
  },
  name: "markdownEditorFormattingShortcuts",
  // Runs before StarterKit's `Mod-` bindings so toggles are actually
  // suppressed during IME composition instead of racing the defaults.
  priority: 1050,
});
