import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveDownloadTools} from '../lib/dependencies.mjs';

test('installed edition reuses recorded external paths and local updates take precedence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dependencies-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const external = path.join(root, 'shared tools');
  fs.writeFileSync(path.join(root, 'dependencies.json'), JSON.stringify({engine:path.join(external,'yt-dlp.exe'),ffmpegDir:external}));
  assert.deepEqual(resolveDownloadTools(root), {engine:path.join(external,'yt-dlp.exe'),binDir:external,externalEngine:true});
  fs.mkdirSync(path.join(root,'bin'));
  fs.writeFileSync(path.join(root,'bin','yt-dlp.exe'), 'test');
  fs.writeFileSync(path.join(root,'bin','ffmpeg.exe'), 'test');
  // An incomplete local FFmpeg pair must not hide a usable shared pair.
  assert.equal(resolveDownloadTools(root).binDir, external);
  assert.equal(resolveDownloadTools(root).externalEngine, false);
  fs.writeFileSync(path.join(root,'bin','ffprobe.exe'), 'test');
  assert.equal(resolveDownloadTools(root).binDir, path.join(root,'bin'));
});

test('invalid dependency manifests fail with an actionable repair message', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'studio-dependencies-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'dependencies.json');
  fs.writeFileSync(file,'broken');
  assert.throws(() => resolveDownloadTools(root), /重新运行安装程序/);
  fs.writeFileSync(file, JSON.stringify({engine:'relative.exe'}));
  assert.throws(() => resolveDownloadTools(root), /组件路径无效/);
});
