import { Menu, type BrowserWindow } from 'electron'
import { buildContextMenuTemplate, type ContextMenuLabels } from './context-menu-template'
import { translateUi } from './ui-locale'

/**
 * Give a product window the context menu Electron does not ship. One handler
 * covers every surface the window renders — conversation text, the composer,
 * search fields, settings inputs — because Chromium reports what was clicked
 * and which edit actions are currently legal.
 *
 * Labels follow the PRODUCT language rather than Chromium's packaged locale, so
 * a Chinese app says 复制 on an English OS. The menu bar's own edit items use
 * bare roles and therefore do not; this is the better behaviour, and the two
 * can converge later.
 */
export function installContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, resolveLabels())
    if (template.length === 0 || window.isDestroyed()) {
      return
    }
    Menu.buildFromTemplate(template).popup({ window })
  })
}

function resolveLabels(): ContextMenuLabels {
  return {
    undo: translateUi('common.undo', 'Undo'),
    redo: translateUi('common.redo', 'Redo'),
    cut: translateUi('common.cut', 'Cut'),
    copy: translateUi('common.copy', 'Copy'),
    paste: translateUi('common.paste', 'Paste'),
    selectAll: translateUi('common.selectAll', 'Select All')
  }
}
