import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';

export async function startWindowsTray(root, origin) {
  if (process.platform !== 'win32' || process.env.YTDLP_NO_TRAY === '1') return null;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'build-tray.ps1')], {windowsHide:true,timeout:30000});
  const child = spawn(path.join(root,'bin','yt-dlp-tray.exe'), [root,origin,String(process.pid)], {windowsHide:true,stdio:'ignore'});
  child.on('error', error => console.error('Windows tray:',error.message));
  child.unref();
  return child;
}
