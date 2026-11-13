import { Menu, type MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '@shared/constants/app'

export interface MenuActions {
  onNewPost: () => void
  isDev: boolean
}

/** macOS app menu. Cmd+N is wired here so it works on every page. */
export function buildAppMenu({ onNewPost, isDev }: MenuActions): Menu {
  const template: MenuItemConstructorOptions[] = [
    { label: APP_NAME, role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Post', accelerator: 'CmdOrCtrl+N', click: onNewPost },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? ([
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
              { type: 'separator' }
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
