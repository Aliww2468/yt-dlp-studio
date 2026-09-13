import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {normalizeOptions,validateUrl,buildArgs} from '../lib/options.mjs';
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
  for(const arg of ['--yes-playlist','--proxy','--cookies-from-browser','--write-subs'])assert.ok(!args.includes(arg));
  assert.ok(args.includes('--no-playlist'));
});
test('invalid limits, ranges and output directories are rejected',()=>{
  for(const advanced of [{rateLimit:'bad'},{playlistItems:'--exec'},{fragments:99},{retries:-1},{proxy:'file:///tmp'}])assert.throws(()=>normalizeOptions({advanced:{enabled:true,...advanced}},dir));
  assert.throws(()=>normalizeOptions({outputDir:'relative/path'},dir));
});
test('inspection never expands a playlist and never downloads',()=>{
  const args=buildArgs('https://example.com',normalizeOptions({advanced:{enabled:true,playlist:true}},dir),{binDir:dir,inspect:true});
  assert.ok(args.includes('--skip-download'));assert.ok(args.includes('--no-playlist'));assert.ok(!args.includes('--yes-playlist'));
});
