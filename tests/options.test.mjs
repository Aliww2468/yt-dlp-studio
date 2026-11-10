import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {normalizeOptions,validateUrl,buildArgs} from '../lib/options.mjs';
import {explainError} from '../lib/errors.mjs';
import {vttToSrt,convertSidecars} from '../lib/subtitles.mjs';
import fs from 'node:fs';
import os from 'node:os';
import {trackInfo} from '../lib/subtitles.mjs';
const dir=path.resolve('test-output');
test('only HTTP(S) links are accepted; arguments cannot become executable options',()=>{
  for(const url of ['--exec=calc','file:///C:/secret','javascript:alert(1)','https://user:pass@example.com'])assert.throws(()=>validateUrl(url));
  const url='https://example.com/video?q=--exec%20calc';
  const args=buildArgs(url,normalizeOptions({},dir),{binDir:dir});
  assert.deepEqual(args.slice(-2),['--',url]);assert.ok(!args.includes('--exec'));
});
test('advanced options are dormant until the user enables them',()=>{
  const opts=normalizeOptions({advanced:{enabled:false,playlist:true,proxy:'http://localhost:7890',cookiesBrowser:'chrome',subtitles:true}},dir);
  const args=buildArgs('https://example.com',opts,{binDir:dir});
  for(const arg of ['--yes-playlist','--proxy','--cookies-from-browser','--write-subs','--ignore-errors','--sleep-subtitles'])assert.ok(!args.includes(arg));
  assert.ok(args.includes('--no-playlist'));
});
test('invalid limits, ranges and output directories are rejected',()=>{
  for(const advanced of [{rateLimit:'bad'},{playlistItems:'--exec'},{fragments:99},{retries:-1},{proxy:'file:///tmp'}])assert.throws(()=>normalizeOptions({advanced:{enabled:true,...advanced}},dir));
  assert.throws(()=>normalizeOptions({outputDir:'relative/path'},dir));
});
test('inspection never expands a playlist and never downloads',()=>{
  const args=buildArgs('https://example.com',normalizeOptions({advanced:{enabled:true,playlist:true,autoSubs:true}},dir),{binDir:dir,inspect:true});
  assert.ok(args.includes('--skip-download'));assert.ok(args.includes('--no-playlist'));assert.ok(!args.includes('--yes-playlist'));
  assert.ok(!args.includes('--ignore-errors'));assert.ok(!args.includes('--sleep-subtitles'));
});
test('subtitle-only runs fetch just the named tracks and never the media',()=>{
  const opts=normalizeOptions({advanced:{enabled:true,autoSubs:true,embedSubs:true,thumbnail:true}},dir);
  const args=buildArgs('https://example.com',opts,{binDir:dir,subtitleLangs:['zh-Hans','zh-Hant']});
  assert.ok(args.includes('--skip-download'));assert.ok(args.includes('--write-auto-subs'));assert.ok(!args.includes('--write-subs'));
  assert.equal(args[args.indexOf('--sub-langs')+1],'zh-Hans,zh-Hant');
  for(const arg of ['--embed-subs','--write-thumbnail','-f','--print'])assert.ok(!args.includes(arg));
  assert.throws(()=>buildArgs('https://example.com',opts,{binDir:dir,subtitleLangs:['.*']}));
});
test('a cookies.txt file is passed to yt-dlp and wins over reading a browser',()=>{
  const cookies=path.join(dir,'cookies.txt');
  const args=buildArgs('https://example.com',normalizeOptions({advanced:{enabled:true,cookiesBrowser:'chrome',cookiesFile:cookies}},dir),{binDir:dir});
  assert.equal(args[args.indexOf('--cookies')+1],cookies);assert.ok(!args.includes('--cookies-from-browser'));
  assert.throws(()=>normalizeOptions({advanced:{enabled:true,cookiesFile:'cookies.txt'}},dir),/Cookie/);
  const off=buildArgs('https://example.com',normalizeOptions({advanced:{enabled:false,cookiesFile:cookies}},dir),{binDir:dir});
  assert.ok(!off.includes('--cookies'));
});
test('cookie and sign-in failures are explained in Chinese',()=>{
  assert.match(explainError('ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info'),/Chrome.*Cookie 文件/);
  assert.match(explainError('ERROR: Failed to decrypt with DPAPI. See  https://github.com/yt-dlp/yt-dlp/issues/10927  for more info'),/Cookie 文件/);
  assert.match(explainError("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies"),/需要登录/);
  assert.equal(explainError('ERROR: Unsupported URL: https://example.com'),'');
});
test('each video is saved in its own folder; subtitle retries go beside the saved file',()=>{
  const opts=normalizeOptions({advanced:{enabled:true,autoSubs:true}},dir);
  const args=buildArgs('https://example.com',opts,{binDir:dir});
  assert.equal(args[args.indexOf('-o')+1],'%(title).60B [%(id)s]/%(height&{}p|未知分辨率)s/%(title).120B [%(id)s].%(ext)s');
  const audio=buildArgs('https://example.com',normalizeOptions({mode:'audio'},dir),{binDir:dir});
  assert.equal(audio[audio.indexOf('-o')+1],'%(title).60B [%(id)s]/%(title).120B [%(id)s].%(ext)s');
  const media=path.join(dir,'old','Clip 100% [x].mp4');
  const subs=buildArgs('https://example.com',opts,{binDir:dir,subtitleLangs:['zh-Hans'],mediaFile:media});
  assert.equal(subs[subs.indexOf('-P')+1],path.join(dir,'old'));
  assert.equal(subs[subs.indexOf('-o')+1],'Clip 100%% [x].%(ext)s');
});
test('saved thumbnails are converted to the chosen format',()=>{
  const build=advanced=>buildArgs('https://example.com',normalizeOptions({advanced:{enabled:true,thumbnail:true,...advanced}},dir),{binDir:dir});
  const def=build({});assert.equal(def[def.indexOf('--convert-thumbnails')+1],'jpg');
  const png=build({thumbnailFormat:'png'});assert.equal(png[png.indexOf('--convert-thumbnails')+1],'png');
  assert.ok(!build({thumbnailFormat:''}).includes('--convert-thumbnails'));
  const bad=build({thumbnailFormat:'gif;rm'});assert.equal(bad[bad.indexOf('--convert-thumbnails')+1],'jpg');
  assert.ok(!build({thumbnail:false}).includes('--convert-thumbnails'));
});
test('YouTube rolling VTT becomes clean SRT, one line per cue',()=>{
  const vtt=['WEBVTT','Kind: captions','',
    '00:00:04.960 --> 00:00:06.750 align:start position:0%',' ','Hi<00:00:05.040><c> everyone.</c>','',
    '00:00:06.750 --> 00:00:06.760 align:start position:0%','Hi everyone.',' ','',
    '00:00:06.760 --> 00:00:08.430 align:start position:0%','Hi everyone.','This<00:00:07.000><c> is</c> &amp; more','',
    '00:00:08.430 --> 00:00:08.440','Hi everyone.','This is & more',''].join('\n');
  assert.equal(vttToSrt(vtt),'1\n00:00:04,960 --> 00:00:06,760\nHi everyone.\n\n2\n00:00:06,760 --> 00:00:08,440\nThis is & more\n');
  assert.equal(vttToSrt('WEBVTT\n\n01:02.500 --> 01:03.000\nNo.\n\n01:03.000 --> 01:04.000\nNo.\n'),'1\n00:01:02,500 --> 00:01:03,000\nNo.\n\n2\n00:01:03,000 --> 00:01:04,000\nNo.\n');
});
test('sidecar VTT files become SRT and the preferred language is saved under the media name',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'subs-'));
  const media=path.join(folder,'Clip [x].mp4');fs.writeFileSync(media,'');
  for(const lang of ['en','zh-Hant','zh-Hans'])fs.writeFileSync(path.join(folder,`Clip [x].${lang}.vtt`),`WEBVTT\n\n00:00.000 --> 00:01.000\n${lang}\n`);
  const r=convertSidecars(media,{order:'zh-Hans,zh.*,en'});
  assert.equal(r.preferred,'zh-Hans');
  assert.deepEqual(fs.readdirSync(folder).sort(),['Clip [x].en.srt','Clip [x].mp4','Clip [x].srt','Clip [x].zh-Hans.srt','Clip [x].zh-Hant.srt']);
  assert.match(fs.readFileSync(path.join(folder,'Clip [x].srt'),'utf8'),/zh-Hans/);
  fs.rmSync(folder,{recursive:true});
});
test('a later retry of a less wanted language keeps the existing default track',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'subs-'));
  const media=path.join(folder,'Clip.mp4');fs.writeFileSync(media,'');
  fs.writeFileSync(path.join(folder,'Clip.zh-Hans.srt'),'zh');fs.writeFileSync(path.join(folder,'Clip.en.vtt'),'WEBVTT\n\n00:00.000 --> 00:01.000\nen\n');
  assert.equal(convertSidecars(media,{order:'zh.*,en'}).preferred,'zh-Hans');
  assert.equal(fs.readFileSync(path.join(folder,'Clip.srt'),'utf8'),'zh');
  fs.rmSync(folder,{recursive:true});
});
test('embedding saves MKV but keeps the MP4 codec choice, and tracks get readable names',()=>{
  const args=buildArgs('https://example.com',normalizeOptions({advanced:{enabled:true,autoSubs:true,embedSubs:true}},dir),{binDir:dir});
  assert.equal(args[args.indexOf('--merge-output-format')+1],'mkv');assert.equal(args[args.indexOf('--remux-video')+1],'mkv');
  assert.equal(args[args.indexOf('-S')+1],'res,vcodec:h264,acodec:aac');assert.ok(!args.includes('--embed-subs'));
  const plain=buildArgs('https://example.com',normalizeOptions({advanced:{enabled:true,autoSubs:true}},dir),{binDir:dir});
  assert.equal(plain[plain.indexOf('--merge-output-format')+1],'mp4');
  assert.deepEqual(trackInfo('zh-Hans'),{language:'chi',title:'简体中文'});assert.deepEqual(trackInfo('zh-Hant'),{language:'chi',title:'繁體中文'});
  assert.deepEqual(trackInfo('en-US'),{language:'eng',title:'English'});assert.deepEqual(trackInfo('tlh'),{language:'und',title:'tlh'});
});
test('MP4 downloads rank resolution before codec, so HD is not lost to the 360p H.264 format',()=>{
  for(const quality of ['best','2160','1080']){
    const args=buildArgs('https://example.com',normalizeOptions({quality,videoFormat:'mp4'},dir),{binDir:dir});
    assert.match(args[args.indexOf('-S')+1],/^res,/);
  }
});
