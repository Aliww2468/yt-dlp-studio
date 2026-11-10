import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { validateUrl, normalizeOptions, buildArgs, advancedDefaults } from './lib/options.mjs';
import { startWindowsTray } from './lib/tray.mjs';
import { explainError } from './lib/errors.mjs';
import { convertSidecars, embedSubtitles } from './lib/subtitles.mjs';
import { normalizeTheme } from './lib/appearance.mjs';
import { resolveDownloadTools } from './lib/dependencies.mjs';
const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.YTDLP_DATA_DIR || path.join(root, 'data');
let {binDir, engine, externalEngine} = resolveDownloadTools(root);
const port = Number(process.env.PORT || 47831), origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
fs.mkdirSync(dataDir, {recursive:true});
const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); } catch { return fallback; } };
const save = (name, value) => { const dest = path.join(dataDir,name); fs.writeFileSync(dest + '.tmp', JSON.stringify(value,null,2)); fs.renameSync(dest+'.tmp', dest); };
let settings = { theme: 'light', compact: false, outputDir: path.join(root,'downloads'), advanced: {...advancedDefaults}, ...read('settings.json',{}) };
settings.theme = normalizeTheme(settings.theme);
delete settings.glass;
// Older records only kept the warning text, so recover the track names from it.
const failedTracks = j => j.failedSubs || (j.subtitleWarnings || []).map(w => /^([\w-]+) 字幕未下载/.exec(w)?.[1]).filter(Boolean);
let jobs = read('jobs.json', []).map(j => {
  j = {...j, failedSubs: failedTracks(j)};
  // A subtitle-only run never touches the saved media, so an interrupted one leaves a completed job.
  if (j.subsOnly) { delete j.subsOnly; return ['running','queued','canceling'].includes(j.status) ? {...j,status:'completed',speed:null,eta:null} : j; }
  return ['running','queued','processing','canceling'].includes(j.status) ? {...j,status:'interrupted',speed:null,eta:null} : j;
});
const clients = new Set(); let active = null, inspecting = false, updating = false, envCache = null;
const publicJobs = () => jobs.map(({ options, ...j }) => j);
const emit = () => { const value = `data: ${JSON.stringify(publicJobs())}\n\n`; for (const c of clients) c.write(value); };
const persist = () => save('jobs.json',jobs);
const log = (job,line) => { job.logs.push(line.slice(0,4000)); job.logs = job.logs.slice(-100); };
function addSubtitleWarning(job, message) {
  if (!job.subtitleWarnings.includes(message)) job.subtitleWarnings.push(message);
}
const wantsSubtitles = job => { const a = job.options.advanced; return a.enabled && (a.subtitles || a.autoSubs); };
// Windows players read SRT, not the VTT that sites serve, and show only subtitles embedded in MKV.
// So finished jobs get cleaned SRT files and, when embedding is on, an MKV with those tracks.
async function processSubtitles(job, { embed }) {
  const a = job.options.advanced, keepVtt = a.subtitleFormat === 'vtt';
  for (const [i, file] of job.files.entries()) {
    if (!fs.statSync(file,{throwIfNoEntry:false})?.isFile()) continue;
    let ranked = [];
    try { ({ranked} = convertSidecars(file, {order:a.subtitleLangs, keepVtt})); }
    catch (e) { addSubtitleWarning(job, `字幕转换为 SRT 失败：${e.message}`); continue; }
    if (embed && ranked.length) {
      try { job.files[i] = await embedSubtitles(file, ranked, path.join(binDir,'ffmpeg.exe')); }
      catch (e) { addSubtitleWarning(job, `字幕嵌入失败：${e.message}`); }
    }
    // "Keep VTT" means the SRT copies only served the embedding step.
    if (keepVtt) for (const t of [...ranked, {file:path.join(path.dirname(file),`${path.parse(file).name}.srt`)}]) fs.rmSync(t.file,{force:true});
  }
}
function stopChild(child) {
  if (process.platform === 'win32') { const killer = spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true}); killer.on('error',()=>child.kill()); }
  else child.kill('SIGTERM');
}
function schedule() {
  if (active || updating) return;
  const job = jobs.find(j=>j.status==='queued'); if (!job) return;
  try { fs.mkdirSync(job.options.outputDir,{recursive:true}); } catch (e) { job.status='failed';job.error=`无法创建保存目录：${e.message}`;persist();emit();schedule();return; }
  const subsOnly = job.subsOnly, previous = {warnings:job.subtitleWarnings||[], failed:job.failedSubs||[]};
  const adv = job.options.advanced;
  if (adv.enabled && adv.cookiesFile && !fs.statSync(adv.cookiesFile,{throwIfNoEntry:false})?.isFile()) {
    const message = `找不到 Cookie 文件：${adv.cookiesFile}。请在「高级选项 → 网络与访问」中重新选择。`;
    if (subsOnly) { delete job.subsOnly; job.status='completed'; if(!job.subtitleWarnings.includes(message)) job.subtitleWarnings.push(message); }
    else { job.status='failed'; job.error=message; }
    persist();emit();schedule();return;
  }
  let args;
  try { args = buildArgs(job.url,job.options,{binDir,subtitleLangs:subsOnly,mediaFile:!job.playlist && job.files.length===1 ? job.files[0] : null}); } catch (e) { job.status=subsOnly?'completed':'failed'; if(subsOnly)delete job.subsOnly; else job.error=e.message; persist();emit();schedule();return; }
  job.status='running'; job.error=''; job.speed=null; job.eta=null; job.subtitleWarnings=[]; job.failedSubs=[];
  if (subsOnly) { job.progress=null; log(job,`—— 补下字幕：${subsOnly.join(', ')} ——`); }
  const child = spawn(engine,args,{windowsHide:true,cwd:root});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  active={child,id:job.id};emit();persist();
  let out='',err='',done=false,mediaSaved=false;
  const line = value => {
    if (!value) return;
    try {
      if (value.startsWith('__PROGRESS__')) { const p=JSON.parse(value.slice(12)); const total=p.total_bytes || p.total_bytes_estimate; job.progress=total ? Math.min(100,p.downloaded_bytes/total*100) : null; job.speed=p.speed;job.eta=p.eta;job.downloaded=p.downloaded_bytes;job.total=total; if(job.status!=='canceling') job.status=p.status==='finished'?'processing':'running'; }
      else if(value.startsWith('__TITLE__')) {job.title=JSON.parse(value.slice(9));job.progress=0;}
      else if(value.startsWith('__FILE__')) {
        const file=JSON.parse(value.slice(8));
        const stat=fs.statSync(file,{throwIfNoEntry:false});
        if (stat?.isFile() && stat.size > 0) {
          mediaSaved=true;
          if(!job.files.includes(file))job.files.push(file);
        } else job.error='下载器报告的媒体文件不存在或为空';
      }
      else if(value.startsWith('__SUB_FORMATS__')) {
        if(value==='__SUB_FORMATS__') addSubtitleWarning(job,'未找到匹配所选语言的字幕。');
      }
      else if(value.startsWith('__POST__')) {if(job.status!=='canceling')job.status='processing';}
      else {
        log(job,value);
        const track=/^WARNING: Unable to download video subtitles for '([^']+)': (.+)/.exec(value);
        if (track) {
          const reason=/\bHTTP Error 429\b/i.test(track[2]) ? '站点限流，HTTP 429' : '详见任务日志';
          addSubtitleWarning(job,`${track[1]} 字幕未下载（${reason}）。`);
          if (!job.failedSubs.includes(track[1])) job.failedSubs.push(track[1]);
        }
        if(value.startsWith('ERROR:')) job.error=explainError(value)||value;
      }
    } catch {log(job,value);}
    emit();
  };
  child.stdout.on('data',b=>{out+=b.toString('utf8');const lines=out.split(/\r?\n/);out=lines.pop();lines.forEach(line);});
  child.stderr.on('data',b=>{err+=b.toString('utf8');const lines=err.split(/\r?\n/);err=lines.pop();lines.forEach(line);});
  const finish = (code,error) => {
    if(done)return;
    done=true;
    if(out)line(out);
    if(err)line(err);
    if(error)job.error=error.message;
    if (subsOnly) {
      // The media is already saved: the job stays completed and only its subtitle notes change.
      if (job.status==='canceling' || job.error || code!==0) {
        const reason = job.status==='canceling' ? '' : `补下字幕失败：${job.error || '下载进程异常结束，请查看日志'}`;
        job.subtitleWarnings = reason ? [...previous.warnings, reason] : previous.warnings;
        job.failedSubs = previous.failed;
      }
      job.error=''; job.status='completed'; job.progress=100; delete job.subsOnly;
    }
    else if(job.status==='canceling') job.status='canceled';
    else {
      if(!job.error && code!==0) job.error='下载进程异常结束，请查看日志';
      if(!job.error && !mediaSaved) job.error='下载结束，但没有生成媒体文件';
      job.status=job.error?'failed':'completed';
      if(job.status==='completed')job.progress=100;
    }
    const settle = () => { job.speed=null;job.eta=null;job.finishedAt=new Date().toISOString(); active=null;persist();emit();schedule(); };
    if (job.status!=='completed' || !wantsSubtitles(job)) return settle();
    const a = job.options.advanced, embed = !subsOnly && a.embedSubs && job.options.mode==='video';
    if (a.subtitleFormat==='vtt' && !embed) return settle();
    job.status='processing'; job.speed=null; job.eta=null; emit();
    processSubtitles(job,{embed}).catch(e=>addSubtitleWarning(job,`字幕处理失败：${e.message}`)).finally(()=>{ job.status='completed'; settle(); });
  };
  child.on('error',e=>finish(-1,e)); child.on('close',code=>finish(code));
}
async function environment(refresh=false) {
  if(envCache&&!refresh)return envCache;
  const version = async (exe,args) => {try {const {stdout}=await exec(exe,args,{windowsHide:true,timeout:12000,maxBuffer:1024*1024});return stdout.split(/\r?\n/)[0];}catch{return null;}};
  const [yt,ffmpeg,ffprobe]=await Promise.all([version(engine,['--version']),version(path.join(binDir,'ffmpeg.exe'),['-version']),version(path.join(binDir,'ffprobe.exe'),['-version'])]);
  return envCache={yt,ffmpeg,ffprobe,node:process.version,ready:!!(yt&&ffmpeg&&ffprobe),root};
}
async function body(req) {let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw new Error('请求内容过大');}try{return JSON.parse(text||'{}');}catch{throw new Error('请求格式不正确');}}
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin&&req.headers.origin!==origin))return json(res,{error:'仅允许本机应用访问'},403);
  const u=new URL(req.url,origin);
  try {
    if(u.pathname==='/api/bootstrap'&&req.method==='GET')return json(res,{app:'yt-dlp-studio',pid:process.pid,token,settings,jobs:publicJobs(),environment:await environment()});
    if(u.pathname.startsWith('/api/')) {
      if((req.headers['x-app-token']||u.searchParams.get('token'))!==token)return json(res,{error:'会话已过期，请刷新页面'},403);
      if(u.pathname==='/api/events'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});clients.add(res);res.write(`data: ${JSON.stringify(publicJobs())}\n\n`);req.on('close',()=>clients.delete(res));return;}
      if(req.method!=='POST')return json(res,{error:'不支持此操作'},405);
      const b=await body(req);
      if(u.pathname==='/api/settings'){const o=normalizeOptions({outputDir:b.outputDir,advanced:b.advanced},settings.outputDir);settings={outputDir:o.outputDir,advanced:o.advanced,theme:normalizeTheme(b.theme??settings.theme),compact:b.compact===true};save('settings.json',settings);return json(res,{settings});}
      if(u.pathname==='/api/environment')return json(res,await environment(true));
      if(u.pathname==='/api/inspect') {
        if(updating)throw new Error('下载引擎正在更新，请稍后重试');if(inspecting)throw new Error('已有链接正在解析，请稍候');
        const url=validateUrl(b.url), options=normalizeOptions(b.options,settings.outputDir);inspecting=true;
        try {const {stdout}=await exec(engine,buildArgs(url,options,{binDir,inspect:true}),{windowsHide:true,timeout:90000,maxBuffer:16*1024*1024});const info=JSON.parse(stdout);return json(res,{title:info.title,thumbnail:info.thumbnail,duration:info.duration,uploader:info.uploader||info.channel,extractor:info.extractor_key,formats:(info.formats||[]).map(f=>({height:f.height,ext:f.ext})),webpage_url:info.webpage_url});}catch(e){throw new Error((e.stderr||e.message).slice(-3000));}finally{inspecting=false;}
      }
      if(u.pathname==='/api/jobs') {
        if(updating)throw new Error('下载引擎正在更新，请稍后重试');
        if(!(await environment()).ready)throw new Error('下载组件尚未就绪，请先运行「安装下载组件.cmd」');
        const urls=String(b.urls||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!urls.length||urls.length>50)throw new Error('每次请输入 1–50 个链接，每行一个');
        const validated=urls.map(validateUrl),options=normalizeOptions(b.options,settings.outputDir);
        const added=validated.map(url=>({id:randomUUID(),url,title:new URL(url).hostname,status:'queued',progress:0,files:[],logs:[],createdAt:new Date().toISOString(),options,mode:options.mode,outputDir:options.outputDir,playlist:options.advanced.enabled&&options.advanced.playlist}));
        jobs.push(...added);persist();emit();schedule();return json(res,{ids:added.map(j=>j.id)});
      }
      if(u.pathname==='/api/job-action') {
        const job=jobs.find(j=>j.id===b.id);if(!job)throw new Error('任务不存在');
        if(b.action==='cancel'){if(active?.id===job.id){job.status='canceling';stopChild(active.child);}else if(job.status==='queued'){if(job.subsOnly){delete job.subsOnly;job.status='completed';}else job.status='canceled';}}
        else if(b.action==='retry'){if(!['failed','canceled','interrupted'].includes(job.status))throw new Error('此任务无需重试');job.status='queued';job.progress=0;job.error='';job.logs=[];job.subtitleWarnings=[];job.failedSubs=[];delete job.finishedAt;}
        else if(b.action==='subs'){if(job.status!=='completed'||!job.failedSubs?.length)throw new Error('此任务没有需要补下的字幕');job.subsOnly=[...job.failedSubs];job.status='queued';}
        else if(b.action==='remove'){if(['queued','running','processing','canceling'].includes(job.status))throw new Error('请先取消任务');jobs=jobs.filter(j=>j!==job);}
        else throw new Error('未知操作');persist();emit();schedule();return json(res,{ok:true});
      }
      if(u.pathname==='/api/open-folder') {
        const job=b.id?jobs.find(j=>j.id===b.id):null;
        if(b.id&&!job)throw new Error('任务不存在');
        // A single video sits in its own folder, so open that folder rather than the download root.
        const own=job?.files?.length===1?path.dirname(job.files[0]):null;
        const dir=own&&fs.statSync(own,{throwIfNoEntry:false})?.isDirectory()?own:normalizeOptions({outputDir:job?job.outputDir:b.outputDir||settings.outputDir},settings.outputDir).outputDir;
        fs.mkdirSync(dir,{recursive:true});
        // Explorer is user-facing even when the download server runs without a console.
        // Do not inherit the hidden-window options used for yt-dlp and FFmpeg.
        const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','explorer.exe'),[dir],{windowsHide:false,detached:true,stdio:'ignore'});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',e=>reject(new Error(`无法打开文件夹：${e.message}`)));});
        child.unref();
        return json(res,{ok:true});
      }
      if(u.pathname==='/api/pick-cookies') {const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','pick-file.ps1')],{windowsHide:true,timeout:120000});return json(res,{path:stdout.trim()});}
      if(u.pathname==='/api/pick-folder') {const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','pick-folder.ps1')],{windowsHide:true,timeout:120000});return json(res,{path:stdout.trim()});}
      if(u.pathname==='/api/update') {
        if(active||inspecting||updating)throw new Error('请等待下载或解析结束再更新');
        updating=true;
        try {
          // Never modify a system-owned engine; install an app-owned update instead.
          const command = externalEngine ? path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe') : engine;
          const args = externalEngine ? ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','ensure-dependencies.ps1'),'-Root',root,'-UpdateEngine'] : ['--ignore-config','--no-plugin-dirs','-U'];
          const {stdout}=await exec(command,args,{windowsHide:true,timeout:600000});
          ({binDir,engine,externalEngine}=resolveDownloadTools(root));
          return json(res,{message:stdout,environment:await environment(true)});
        } finally {updating=false;schedule();}
      }
      if(u.pathname==='/api/shutdown') {if(active||jobs.some(j=>j.status==='queued')||inspecting||updating)throw new Error('请先结束正在进行的下载、解析或更新');json(res,{ok:true});setTimeout(()=>{persist();process.exit(0);},200);return;}
      return json(res,{error:'接口不存在'},404);
    }
    const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
    if(!files[u.pathname]||req.method!=='GET'){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',u.pathname.endsWith('.js')?'text/javascript; charset=utf-8':u.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root,'public',files[u.pathname])));
  }catch(e){json(res,{error:e.message},400);}
});
server.listen(port,'127.0.0.1',()=>{
  console.log(`yt-dlp Studio ready: ${origin}`);
  startWindowsTray(root,origin).catch(error=>console.error('Windows tray:',error.message));
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用。请打开 ${origin} 或设置 PORT。`:e);process.exitCode=1;});
setInterval(()=>{for(const c of clients)c.write(': heartbeat\n\n');},20000).unref();
process.on('SIGINT',()=>{if(active)stopChild(active.child);persist();process.exit(0);});
