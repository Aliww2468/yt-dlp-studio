import fs from 'node:fs';
import path from 'node:path';

export function resolveDownloadTools(root) {
  let config = {};
  const manifest = path.join(root, 'dependencies.json');
  if (fs.existsSync(manifest)) {
    try { config = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('组件配置损坏，请重新运行安装程序修复。'); }
  }
  const bin = path.join(root, 'bin');
  const localEngine = path.join(bin, 'yt-dlp.exe');
  const engine = fs.existsSync(localEngine) ? localEngine : config.engine || localEngine;
  const localPair = ['ffmpeg.exe', 'ffprobe.exe'].every(name => fs.existsSync(path.join(bin, name)));
  const binDir = localPair ? bin : config.ffmpegDir || bin;
  if (!path.isAbsolute(engine) || !path.isAbsolute(binDir)) throw new Error('组件路径无效，请重新运行安装程序修复。');
  return {engine, binDir, externalEngine: path.resolve(engine) !== path.resolve(localEngine)};
}
