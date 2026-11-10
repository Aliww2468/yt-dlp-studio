import path from 'node:path';

export const advancedDefaults = { enabled: false, playlist: false, playlistItems: '', subtitles: false, autoSubs: false, subtitleLangs: 'zh.*,en', embedSubs: false, subtitleFormat: 'srt', thumbnail: false, thumbnailFormat: 'jpg', metadata: true, rateLimit: '', proxy: '', cookiesBrowser: '', cookiesFile: '', retries: 5, fragments: 1 };
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
  for (const key of ['playlistItems','subtitleLangs','rateLimit','proxy','cookiesFile']) a[key] = String(source[key] ?? a[key]).trim();
  a.subtitleFormat = pick(source.subtitleFormat, ['srt', 'vtt'], 'srt');
  a.thumbnailFormat = pick(source.thumbnailFormat, ['', 'jpg', 'png', 'webp'], 'jpg');
  a.cookiesBrowser = pick(source.cookiesBrowser, ['', 'chrome', 'edge', 'firefox'], '');
  a.retries = Number(source.retries ?? 5); a.fragments = Number(source.fragments ?? 1);
  if (!Number.isInteger(a.retries) || a.retries < 0 || a.retries > 20 || !Number.isInteger(a.fragments) || a.fragments < 1 || a.fragments > 8) throw new Error('重试次数应为 0–20，分片并发应为 1–8');
  if (a.enabled) {
    if (a.playlistItems && !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(a.playlistItems)) throw new Error('播放列表范围示例：1-10 或 1,3,5');
    if (a.subtitleLangs.length > 200 || !/^[\w.*,\-]+$/.test(a.subtitleLangs)) throw new Error('字幕语言示例：zh.*,en');
    if (a.rateLimit && !/^\d+(?:\.\d+)?[KMG]?$/i.test(a.rateLimit)) throw new Error('限速格式示例：2M 或 500K');
    if (a.cookiesFile && (a.cookiesFile.length > 1024 || !path.isAbsolute(a.cookiesFile) || /[\x00-\x1f]/.test(a.cookiesFile))) throw new Error('Cookie 文件必须是有效的绝对路径');
    if (a.proxy) { let p; try { p = new URL(a.proxy); } catch { throw new Error('代理地址格式不正确'); } if (!['http:','https:','socks5:','socks5h:'].includes(p.protocol)) throw new Error('代理支持 HTTP、HTTPS 和 SOCKS5'); }
  }
  return { mode: pick(input.mode, ['video','audio'], 'video'), quality: pick(input.quality, ['best','2160','1440','1080','720','480'], '1080'), videoFormat: pick(input.videoFormat, ['mp4','mkv','auto'], 'mp4'), audioFormat: pick(input.audioFormat, ['mp3','m4a','flac','wav'], 'mp3'), outputDir: path.resolve(dir), advanced: a };
}
// Every video gets its own folder; the lengths keep the full path under the Windows 260-character limit.
// Video files carry their height (" 2160p"), so asking for a higher quality later saves a new file
// instead of --no-overwrites keeping the earlier, lower-quality one.
export const outputTemplate = '%(title).60B [%(id)s]/%(title).120B [%(id)s]%(height& {}p|)s.%(ext)s';
export function buildArgs(url, options, { binDir, inspect = false, subtitleLangs = null, mediaFile = null, nodePath = process.execPath } = {}) {
  const o = options, a = o.advanced.enabled ? o.advanced : advancedDefaults;
  const args = ['--ignore-config', '--no-plugin-dirs', '--no-colors', '--encoding', 'utf-8', '--js-runtimes', `node:${nodePath}`, '--ffmpeg-location', binDir, '--socket-timeout', '20', '--retries', String(a.retries), '--fragment-retries', String(a.retries)];
  args.push(inspect || !a.playlist ? '--no-playlist' : '--yes-playlist');
  if (a.proxy) args.push('--proxy', a.proxy);
  // A cookies.txt file is the dependable source on Windows, so it wins over reading a browser.
  if (a.cookiesFile) args.push('--cookies', a.cookiesFile);
  else if (a.cookiesBrowser) args.push('--cookies-from-browser', a.cookiesBrowser);
  if (inspect) return [...args, '--dump-single-json', '--skip-download', '--', validateUrl(url)];
  const output = ['--windows-filenames', '--no-overwrites', '-P', options.outputDir, '-o', outputTemplate];
  if (subtitleLangs) {
    // Fetch only the given tracks next to the already saved media; nothing else is downloaded.
    const langs = subtitleLangs.filter(l => typeof l === 'string' && /^[\w-]{1,40}$/.test(l));
    if (!langs.length) throw new Error('没有需要补下的字幕');
    // Naming after the saved file keeps tracks beside media from any earlier folder layout.
    const target = mediaFile && path.isAbsolute(mediaFile)
      ? ['--windows-filenames', '--no-overwrites', '-P', path.dirname(mediaFile), '-o', `${path.parse(mediaFile).name.replaceAll('%', '%%')}.%(ext)s`]
      : output;
    args.push('--newline', '--no-simulate', '--skip-download', ...target, '--ignore-errors', '--sleep-subtitles', '5', '--sub-langs', langs.join(','));
    if (a.subtitles) args.push('--write-subs');
    if (a.autoSubs) args.push('--write-auto-subs');
    return [...args, '--', validateUrl(url)];
  }
  args.push('--newline', '--progress', '--progress-delta', '0.5', '--no-simulate', ...output, '--continue', '--print', 'before_dl:__TITLE__%(title)j', '--print', 'after_move:__FILE__%(filepath)j', '--progress-template', 'download:__PROGRESS__%(progress)j', '--progress-template', 'postprocess:__POST__%(progress.status)s');
  if (o.mode === 'audio') args.push('-f', 'bestaudio/best', '-x', '--audio-format', o.audioFormat, '--audio-quality', '0');
  else {
    const h = o.quality === 'best' ? '' : `[height<=?${o.quality}]`;
    args.push('-f', `bv*${h}+ba/b${h}`);
    // Windows players only show subtitles embedded in MKV, so embedding saves MKV while keeping the MP4 codec choice.
    const embed = a.embedSubs && (a.subtitles || a.autoSubs);
    const container = embed && o.videoFormat !== 'auto' ? 'mkv' : o.videoFormat;
    if (container !== 'auto') args.push('--merge-output-format', container, '--remux-video', container);
    // Resolution must come first: with the codec first, YouTube's 360p single-file H.264 format wins over HD.
    // H.264 / AAC are still preferred among formats of the same resolution.
    if (o.videoFormat === 'mp4') args.push('-S', 'res,vcodec:h264,acodec:aac');
  }
  if (a.playlist && a.playlistItems) args.push('--playlist-items', a.playlistItems);
  if (a.subtitles || a.autoSubs) {
    // yt-dlp can then skip a failed track and still save the other tracks and media.
    args.push('--ignore-errors', '--sleep-subtitles', '5', '--sub-langs', a.subtitleLangs,
      '--print', 'before_dl:__SUB_FORMATS__%(requested_subtitles.:.ext|)l');
    if (a.subtitles) args.push('--write-subs');
    if (a.autoSubs) args.push('--write-auto-subs');
  }
  if (a.thumbnail) { args.push('--write-thumbnail'); if (a.thumbnailFormat) args.push('--convert-thumbnails', a.thumbnailFormat); }
  if (a.metadata) args.push('--embed-metadata');
  if (a.rateLimit) args.push('--limit-rate', a.rateLimit);
  args.push('--concurrent-fragments', String(a.fragments), '--', validateUrl(url));
  return args;
}
