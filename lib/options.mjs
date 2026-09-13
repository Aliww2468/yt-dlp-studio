import path from 'node:path';

export const advancedDefaults = { enabled: false, playlist: false, playlistItems: '', subtitles: false, autoSubs: false, subtitleLangs: 'zh.*,en', embedSubs: false, thumbnail: false, metadata: true, rateLimit: '', proxy: '', cookiesBrowser: '', retries: 5, fragments: 1 };
export function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('请输入有效的视频链接');
  let url; try { url = new URL(value.trim()); } catch { throw new Error('请输入完整链接，以 https:// 或 http:// 开头'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含用户名和密码的 HTTP / HTTPS 链接');
  return url.href;
}
export function normalizeOptions(input = {}, defaultDir) {
  const pick = (v, values, fallback) => values.includes(v) ? v : fallback;
  const dir = typeof input.outputDir === 'string' && input.outputDir.trim() ? input.outputDir.trim() : defaultDir;
  if (!path.isAbsolute(dir) || /[\x00-\x1f]/.test(dir)) throw new Error('保存位置必须是有效的绝对路径');
  const a = { ...advancedDefaults };
  const source = input.advanced || {};
  for (const key of ['enabled','playlist','subtitles','autoSubs','embedSubs','thumbnail','metadata']) a[key] = source[key] === undefined ? a[key] : source[key] === true;
  for (const key of ['playlistItems','subtitleLangs','rateLimit','proxy']) a[key] = String(source[key] ?? a[key]).trim();
  a.cookiesBrowser = pick(source.cookiesBrowser, ['', 'chrome', 'edge', 'firefox'], '');
  a.retries = Number(source.retries ?? 5); a.fragments = Number(source.fragments ?? 1);
  if (!Number.isInteger(a.retries) || a.retries < 0 || a.retries > 20 || !Number.isInteger(a.fragments) || a.fragments < 1 || a.fragments > 8) throw new Error('重试次数应为 0–20，分片并发应为 1–8');
  if (a.enabled) {
    if (a.playlistItems && !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(a.playlistItems)) throw new Error('播放列表范围示例：1-10 或 1,3,5');
    if (a.subtitleLangs.length > 200 || !/^[\w.*,\-]+$/.test(a.subtitleLangs)) throw new Error('字幕语言示例：zh.*,en');
    if (a.rateLimit && !/^\d+(?:\.\d+)?[KMG]?$/i.test(a.rateLimit)) throw new Error('限速格式示例：2M 或 500K');
    if (a.proxy) { let p; try { p = new URL(a.proxy); } catch { throw new Error('代理地址格式不正确'); } if (!['http:','https:','socks5:','socks5h:'].includes(p.protocol)) throw new Error('代理支持 HTTP、HTTPS 和 SOCKS5'); }
  }
  return { mode: pick(input.mode, ['video','audio'], 'video'), quality: pick(input.quality, ['best','2160','1440','1080','720','480'], '1080'), videoFormat: pick(input.videoFormat, ['mp4','mkv','auto'], 'mp4'), audioFormat: pick(input.audioFormat, ['mp3','m4a','flac','wav'], 'mp3'), outputDir: path.resolve(dir), advanced: a };
}
export function buildArgs(url, options, { binDir, inspect = false, nodePath = process.execPath } = {}) {
  const o = options, a = o.advanced.enabled ? o.advanced : advancedDefaults;
  const args = ['--ignore-config', '--no-plugin-dirs', '--no-colors', '--encoding', 'utf-8', '--js-runtimes', `node:${nodePath}`, '--ffmpeg-location', binDir, '--socket-timeout', '20', '--retries', String(a.retries), '--fragment-retries', String(a.retries)];
  args.push(inspect || !a.playlist ? '--no-playlist' : '--yes-playlist');
  if (a.proxy) args.push('--proxy', a.proxy);
  if (a.cookiesBrowser) args.push('--cookies-from-browser', a.cookiesBrowser);
  if (inspect) return [...args, '--dump-single-json', '--skip-download', '--', validateUrl(url)];
  args.push('--newline', '--progress', '--progress-delta', '0.5', '--no-simulate', '--windows-filenames', '--no-overwrites', '--continue', '-P', o.outputDir, '-o', '%(title).160B [%(id)s].%(ext)s', '--print', 'before_dl:__TITLE__%(title)j', '--print', 'after_move:__FILE__%(filepath)j', '--progress-template', 'download:__PROGRESS__%(progress)j', '--progress-template', 'postprocess:__POST__%(progress.status)s');
  if (o.mode === 'audio') args.push('-f', 'bestaudio/best', '-x', '--audio-format', o.audioFormat, '--audio-quality', '0');
  else {
    const h = o.quality === 'best' ? '' : `[height<=?${o.quality}]`;
    args.push('-f', `bv*${h}+ba/b${h}`);
    if (o.videoFormat !== 'auto') args.push('--merge-output-format', o.videoFormat, '--remux-video', o.videoFormat);
    if (o.videoFormat === 'mp4') args.push('-S', 'vcodec:h264,acodec:aac');
  }
  if (a.playlist && a.playlistItems) args.push('--playlist-items', a.playlistItems);
  if (a.subtitles || a.autoSubs) { args.push('--sub-langs', a.subtitleLangs); if (a.subtitles) args.push('--write-subs'); if (a.autoSubs) args.push('--write-auto-subs'); if (a.embedSubs && o.mode === 'video') args.push('--embed-subs'); }
  if (a.thumbnail) args.push('--write-thumbnail');
  if (a.metadata) args.push('--embed-metadata');
  if (a.rateLimit) args.push('--limit-rate', a.rateLimit);
  args.push('--concurrent-fragments', String(a.fragments), '--', validateUrl(url));
  return args;
}
