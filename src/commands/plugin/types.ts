import type { LocalJSXCommandOnDone } from 'src/types/command.js'

/**
 * Navigation state of the `/plugin` root view between sub-panels.
 * Each branch corresponds to a different sub-screen or an initial route parsed from CLI arguments.
 */
export type ViewState =
  | { type: 'menu' } // return to the main plugin menu
  | { type: 'help' } // show help
  | { type: 'validate'; path?: string } // validate the plugin package at the given path
  | {
      type: 'browse-marketplace' // browse/install plugins in the given marketplace
      targetMarketplace: string // target marketplace identifier
      targetPlugin?: string // optional: preselected plugin name
    }
  | { type: 'discover-plugins'; targetPlugin?: string } // discover page; may preselect a plugin name to search
  | {
      type: 'manage-plugins' // manage installed plugins (enable/disable/uninstall)
      targetPlugin?: string // optional: focus a plugin
      targetMarketplace?: string // optional: marketplace used together with targetPlugin
      action?: 'uninstall' | 'enable' | 'disable' // optional: action to run directly on open
    }
  | { type: 'marketplace-list' } // list configured marketplaces
  | { type: 'marketplace-menu' } // marketplace-related submenu
  | { type: 'add-marketplace'; initialValue?: string } // add a marketplace; may prefill URL/name
  | {
      type: 'manage-marketplaces' // manage saved marketplace sources
      targetMarketplace?: string // optional: focus a marketplace
      action?: 'remove' | 'update' // optional: remove or refresh the marketplace
    }

/** Props of the `/plugin` Ink command entry. */
export type PluginSettingsProps = {
  onComplete: LocalJSXCommandOnDone // callback when the sub-flow ends (may carry result text and display mode)
  args?: string // CLI subcommand argument string passed through from the CLI
  showMcpRedirectMessage?: boolean // show MCP-related hints when redirected from `/mcp`
}
