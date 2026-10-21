import { existsSync } from "node:fs"
import { Plugin } from "@opencode/plugin/tui"
import { captureDirectory, sessionFolder } from "./recorder.ts"

/**
 * Adds `/glass`, which shows where the open session's captures are and copies the path. It only touches the TUI,
 * so nothing reaches the session or the model.
 */
export default Plugin.define({
  id: "opencode-glass",
  setup(context) {
    const directory = captureDirectory(context.options)

    // The built-in slash commands use the global mode too; in the default base mode the command is not reachable
    // from the prompt.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "glass.folder",
          title: "Show capture folder",
          description: "Show and copy the path of this session's captured provider requests and responses",
          group: "Glass",
          palette: true,
          slash: { name: "glass" },
          run: async () => {
            const route = context.ui.router.current()
            const folder = route.type === "session" ? sessionFolder(directory, route.sessionID) : directory
            const notes = [
              context.renderer.copyToClipboardOSC52(folder) ? "Copied to clipboard." : undefined,
              existsSync(folder) ? undefined : "Nothing captured here yet.",
            ].filter(Boolean)
            await context.ui.dialog.alert({ title: "Glass captures", message: [folder, ...notes].join("\n\n") })
          },
        },
      ],
    }))
  },
})
