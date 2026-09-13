import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('real yt-dlp + FFmpeg: inspect, download, extract, cancel, retry, persist and protect local API',{timeout:150000},async t=>{
  const work=fs.mkdtempSync(path.join(root,'test-output-'));
  const source=path.join(work,'fixture.mp4'), dest=path.join(work,'downloads');
  execFileSync(path.join(root,'bin','ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=15:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source],{windowsHide:true});
  const media=http.createServer((req,res)=>{if(req.url==='/missing.mp4'){res.writeHead(404);res.end();return;}const bytes=fs.readFileSync(source);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length});if(req.method==='HEAD')res.end();else if(req.url==='/slow.mp4'){let offset=0;const timer=setInterval(()=>{res.write(bytes.subarray(offset,offset+1024));offset+=1024;if(offset>=bytes.length){clearInterval(timer);res.end();}},100);res.on('close',()=>clearInterval(timer));}else res.end(bytes);});
  await new Promise(r=>media.listen(0,'127.0.0.1',r));const mediaUrl=`http://127.0.0.1:${media.address().port}`;
  const port=47839,base=`http://127.0.0.1:${port}`;let proc,token,serverLogs='';
  async function boot(){proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),YTDLP_DATA_DIR:path.join(work,'state'),YTDLP_NO_TRAY:'1'},windowsHide:true});proc.stderr.on('data',b=>serverLogs+=b);for(let i=0;i<80;i++){try{const b=await(await fetch(`${base}/api/bootstrap`)).json();if(b.environment.ready){token=b.token;return b;}}catch{}await sleep(250);}throw new Error(`Server did not start: ${serverLogs}`);}
  const post=async(endpoint,data={})=>{const r=await fetch(`${base}/api/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':token},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw new Error(b.error);return b;};
  const all=async()=> (await(await fetch(`${base}/api/bootstrap`)).json()).jobs;
  async function settle(id,states=['completed','failed','canceled']){for(let i=0;i<160;i++){const j=(await all()).find(x=>x.id===id);if(states.includes(j?.status))return j;await sleep(250);}throw new Error('Task timeout');}
  const options={outputDir:dest};
  try{
    await boot();
    await t.test('cross-origin writes and unauthenticated writes are rejected',async()=>{
      for(const headers of [{'Origin':'https://example.com','X-App-Token':token},{}]){const r=await fetch(`${base}/api/settings`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});assert.equal(r.status,403);}
    });
    await t.test('inspects a real media file',async()=>{const info=await post('inspect',{url:`${mediaUrl}/fixture.mp4`,options});assert.ok(info.title);assert.ok(info.formats.length>0);});
    let videoId;
    await t.test('downloads video and converts audio sequentially',async()=>{
      videoId=(await post('jobs',{urls:`${mediaUrl}/fixture.mp4`,options})).ids[0];
      const audioId=(await post('jobs',{urls:`${mediaUrl}/sound.mp4`,options:{...options,mode:'audio',audioFormat:'mp3'}})).ids[0];
      const video=await settle(videoId),audio=await settle(audioId);assert.equal(video.status,'completed',video.error);assert.equal(audio.status,'completed',audio.error);assert.equal(video.progress,100);assert.ok(fs.existsSync(video.files[0]));assert.ok(audio.files[0].endsWith('.mp3'));
      const probe=JSON.parse(execFileSync(path.join(root,'bin','ffprobe.exe'),['-v','quiet','-show_streams','-of','json',audio.files[0]],{encoding:'utf8',windowsHide:true}));assert.equal(probe.streams[0].codec_name,'mp3');assert.ok(Number(probe.streams[0].duration)>1);
    });
    await t.test('cancels a real throttled download and retries it',async()=>{
      const id=(await post('jobs',{urls:`${mediaUrl}/slow.mp4`,options:{...options,advanced:{enabled:true,rateLimit:'10K'}}})).ids[0];
      let downloading;
      for(let i=0;i<100;i++){downloading=(await all()).find(j=>j.id===id);if(downloading.downloaded>0)break;await sleep(100);}
      assert.ok(downloading.downloaded>0,'must transfer bytes before canceling');assert.equal(downloading.status,'running');
      await assert.rejects(post('shutdown'), /请先结束/);
      await post('job-action',{id,action:'cancel'});assert.equal((await settle(id)).status,'canceled');await post('job-action',{id,action:'retry'});const result=await settle(id);assert.equal(result.status,'completed',result.error);
    });
    await t.test('surfaces actual extractor failures',async()=>{const id=(await post('jobs',{urls:`${mediaUrl}/missing.mp4`,options:{...options,advanced:{enabled:true,retries:0}}})).ids[0];const result=await settle(id);assert.equal(result.status,'failed');assert.match(result.error,/404|not found/i);});
    await t.test('persists preferences and history across restart',async()=>{
      await post('settings',{outputDir:dest,theme:'dark',compact:true,advanced:{enabled:true,subtitles:true}});await post('shutdown');await new Promise(r=>proc.once('exit',r));const b=await boot();assert.equal(b.settings.theme,'dark');assert.equal(b.settings.glass,undefined);assert.equal(b.settings.advanced.subtitles,true);assert.equal(b.jobs.find(j=>j.id===videoId).status,'completed');
    });
    await t.test('removing a history entry retains the downloaded file',async()=>{const job=(await all()).find(j=>j.id===videoId);await post('job-action',{id:videoId,action:'remove'});assert.ok(fs.existsSync(job.files[0]));assert.ok(!(await all()).some(j=>j.id===videoId));});
    await post('shutdown');await new Promise(r=>proc.once('exit',r));
  }finally{if(proc?.exitCode===null)proc.kill();media.close();}
});
