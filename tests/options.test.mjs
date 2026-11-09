import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {normalizeOptions,validateUrl,buildArgs} from '../lib/options.mjs';
import {explainError} from '../lib/errors.mjs';
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
  assert.equal(args[args.indexOf('-o')+1],'%(title).60B [%(id)s]/%(title).120B [%(id)s].%(ext)s');
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
