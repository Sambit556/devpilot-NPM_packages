/**
 * DevsPilot DX Helper
 *
 * Implements native OS Developer Experience integrations (Category K):
 * - Desktop Notifications (K7)
 * - Sound Alerts (K8)
 * - Clipboard Copying (K16)
 *
 * Implemented using lightweight OS command fallbacks to avoid heavy external NPM imports.
 */

import { exec } from 'node:child_process';
import { createLogger } from './logger.js';

const log = createLogger({ name: 'DxHelper' });

/**
 * Sends a desktop system notification using native OS commands.
 */
export function sendNotification(title: string, message: string): void {
  const cleanTitle = title.replace(/["']/g, '');
  const cleanMsg = message.replace(/["']/g, '');

  if (process.platform === 'win32') {
    // PowerShell notification
    const psCmd = `powershell -Command "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $objNotification = New-Object System.Windows.Forms.NotifyIcon; $objNotification.Icon = [System.Drawing.SystemIcons]::Information; $objNotification.BalloonTipIcon = 'Info'; $objNotification.BalloonTipTitle = '${cleanTitle}'; $objNotification.BalloonTipText = '${cleanMsg}'; $objNotification.Visible = $True; $objNotification.ShowBalloonTip(5000)"`;
    exec(psCmd);
  } else if (process.platform === 'darwin') {
    // AppleScript notification
    const osascriptCmd = `osascript -e 'display notification "${cleanMsg}" with title "${cleanTitle}"'`;
    exec(osascriptCmd);
  } else {
    // Linux notify-send fallback
    exec(`notify-send "${cleanTitle}" "${cleanMsg}"`);
  }
}

/**
 * Plays a native warning/alert beep sound depending on platform.
 */
export function playSoundAlert(type: 'success' | 'error'): void {
  if (process.platform === 'win32') {
    // PowerShell console beep
    const freq = type === 'success' ? 800 : 400;
    const dur = type === 'success' ? 150 : 400;
    exec(`powershell -Command "[Console]::Beep(${freq}, ${dur})"`);
  } else if (process.platform === 'darwin') {
    // macOS system sounds
    const sound = type === 'success' ? 'Glass' : 'Basso';
    exec(`afplay /System/Library/Sounds/${sound}.aiff`);
  } else {
    // Linux pcspkr beep
    exec('echo -e "\\a"');
  }
}

/**
 * Copies a text block to the system clipboard using native utilities.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = exec(
      process.platform === 'win32'
        ? 'clip'
        : process.platform === 'darwin'
          ? 'pbcopy'
          : 'xclip -selection clipboard',
      (err) => {
        if (err) {
          log.debug(`Failed to copy to clipboard: ${err.message}`);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );

    if (proc.stdin) {
      proc.stdin.write(text);
      proc.stdin.end();
    } else {
      resolve(false);
    }
  });
}
