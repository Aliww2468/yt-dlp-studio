import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const clean = line => line.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => entities[e]).trim();
// VTT allows "mm:ss.ttt"; SRT needs "hh:mm:ss,ttt".
const stamp = t => { const parts = t.replace(',', '.').split(':'); if (parts.length === 2) parts.unshift('00'); return parts.map((p, i) => i < 2 ? p.padStart(2, '0') : p).join(':').replace('.', ','); };
const ms = t => { const [h, m, s] = stamp(t).replace(',', '.').split(':'); return (+h * 3600 + +m * 60 + +s) * 1000; };

export function vttToSrt(text) {
  const cues = [];
  for (const block of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [start, rest] = lines[at].split('-->');
    const end = rest.trim().split(/\s+/)[0];
    const body = lines.slice(at + 1).map(clean).filter(Boolean);
    if (body.length) cues.push({ start: start.trim(), end, lines: body });
  }
  // YouTube auto captions roll: each cue repeats the previous line and types the next one word by word.
  // Keep each spoken line once, so players that show every cue do not stack duplicates.
  const rolling = /<\d{1,2}:\d{2}[:.]\d/.test(text);
  const out = [];
  for (const cue of cues) {
    if (!rolling) { out.push(cue); continue; }
    const recent = out.slice(-2).flatMap(c => c.lines);
    const fresh = cue.lines.filter(l => !recent.includes(l));
    if (!fresh.length) { if (out.length) out.at(-1).end = ms(cue.end) > ms(out.at(-1).end) ? cue.end : out.at(-1).end; continue; }
    out.push({ ...cue, lines: fresh });
  }
  return out.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.lines.join('\n')}\n`).join('\n');
}

// Turns "<media>.<lang>.vtt" files beside each saved media file into SRT, which Windows players read.
// The track that comes first in the user's language list is also saved as "<media>.srt" so it loads by default.
export function convertSidecars(mediaFile, { order = '', keepVtt = false } = {}) {
  const dir = path.dirname(mediaFile), base = path.parse(mediaFile).name;
  const tracks = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(base + '.') || !name.toLowerCase().endsWith('.vtt')) continue;
    const lang = name.slice(base.length + 1, -4);
    if (!/^[\w-]{1,40}$/.test(lang)) continue;
    const source = path.join(dir, name), target = path.join(dir, `${base}.${lang}.srt`);
    fs.writeFileSync(target, '﻿' + vttToSrt(fs.readFileSync(source, 'utf8')).replace(/\n/g, '\r\n'));
    if (!keepVtt) fs.rmSync(source);
    tracks.push({ lang, file: target });
  }
  const patterns = order.split(',').map(p => p.trim()).filter(Boolean);
  const rank = lang => { const i = patterns.findIndex(p => { try { return new RegExp(`^(?:${p})$`).test(lang); } catch { return p === lang; } }); return i < 0 ? patterns.length : i; };
  // Rank every SRT beside the media, so a later retry of a less wanted language cannot replace the default.
  const all = fs.readdirSync(dir).filter(n => n.startsWith(base + '.') && n.toLowerCase().endsWith('.srt'))
    .map(n => ({ lang: n.slice(base.length + 1, -4), file: path.join(dir, n) })).filter(t => /^[\w-]{1,40}$/.test(t.lang));
  const ranked = all.sort((a, b) => rank(a.lang) - rank(b.lang)), preferred = ranked[0];
  if (preferred) fs.copyFileSync(preferred.file, path.join(dir, `${base}.srt`));
  return { tracks: tracks.map(t => t.lang), preferred: preferred?.lang || null, ranked };
}

const languages = [
  [/^zh-(Hans|CN|SG)$/i, 'chi', '简体中文'], [/^zh-(Hant|TW|HK|MO)$/i, 'chi', '繁體中文'], [/^zh/i, 'chi', '中文'],
  [/^en/i, 'eng', 'English'], [/^ja/i, 'jpn', '日本語'], [/^ko/i, 'kor', '한국어'], [/^fr/i, 'fre', 'Français'],
  [/^de/i, 'ger', 'Deutsch'], [/^es/i, 'spa', 'Español'], [/^ru/i, 'rus', 'Русский'], [/^pt/i, 'por', 'Português'], [/^it/i, 'ita', 'Italiano'],
];
export const trackInfo = lang => { const hit = languages.find(([re]) => re.test(lang)); return hit ? { language: hit[1], title: hit[2] } : { language: 'und', title: lang }; };

// Puts the SRT tracks into an MKV beside the media (first track is the default) and replaces the media with it.
// Returns the path of the MKV; the original file is removed only after FFmpeg succeeds.
export async function embedSubtitles(mediaFile, tracks, ffmpeg) {
  if (!tracks.length) return mediaFile;
  const dir = path.dirname(mediaFile), base = path.parse(mediaFile).name;
  const target = path.join(dir, `${base}.mkv`), temp = path.join(dir, `${base}.embedding.mkv`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', mediaFile];
  for (const t of tracks) args.push('-sub_charenc', 'UTF-8', '-i', t.file);
  args.push('-map', '0:v?', '-map', '0:a?');
  tracks.forEach((_, i) => args.push('-map', `${i + 1}:0`));
  args.push('-map_metadata', '0', '-c', 'copy', '-c:s', 'srt');
  tracks.forEach((t, i) => { const info = trackInfo(t.lang); args.push(`-metadata:s:s:${i}`, `language=${info.language}`, `-metadata:s:s:${i}`, `title=${info.title}`, `-disposition:s:${i}`, i ? '0' : 'default'); });
  args.push(temp);
  try { await exec(ffmpeg, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }); }
  catch (e) { fs.rmSync(temp, { force: true }); throw new Error((e.stderr || e.message).trim().split(/\r?\n/).pop()); }
  fs.renameSync(temp, target);
  if (path.resolve(mediaFile) !== path.resolve(target)) fs.rmSync(mediaFile, { force: true });
  return target;
}
