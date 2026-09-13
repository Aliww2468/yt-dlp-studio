import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { validateUrl, normalizeOptions, buildArgs, advancedDefaults } from './lib/options.mjs';
import { startWindowsTray } from './lib/tray.mjs';
import { normalizeTheme } from './lib/appearance.mjs';
const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.YTDLP_DATA_DIR || path.join(root, 'data');
const binDir = path.join(root, 'bin'), engine = path.join(binDir, 'yt-dlp.exe');
const port = Number(process.env.PORT || 47831), origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
fs.mkdirSync(dataDir, {recursive:true});
const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); } catch { return fallback; } };
const save = (name, value) => { const dest = path.join(dataDir,name); fs.writeFileSync(dest + '.tmp', JSON.stringify(value,null,2)); fs.renameSync(dest+'.tmp', dest); };
let settings = { theme: 'light', compact: false, outputDir: path.join(root,'downloads'), advanced: {...advancedDefaults}, ...read('settings.json',{}) };
settings.theme = normalizeTheme(settings.theme);
delete settings.glass;
let jobs = read('jobs.json', []).map(j => ['running','queued','processing','canceling'].includes(j.status) ? {...j,status:'interrupted',speed:null,eta:null} : j);
const clients = new Set(); let active = null, inspecting = false, updating = false, envCache = null;
const publicJobs = () => jobs.map(({ options, ...j }) => j);
const emit = () => { const value = `data: ${JSON.stringify(publicJobs())}\n\n`; for (const c of clients) c.write(value); };
const persist = () => save('jobs.json',jobs);
const log = (job,line) => { job.logs.push(line.slice(0,4000)); job.logs = job.logs.slice(-100); };
function stopChild(child) {
  if (process.platform === 'win32') { const killer = spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true}); killer.on('error',()=>child.kill()); }
  else child.kill('SIGTERM');
}
function schedule() {
  if (active || updating) return;
  const job = jobs.find(j=>j.status==='queued'); if (!job) return;
  try { fs.mkdirSync(job.options.outputDir,{recursive:true}); } catch (e) { job.status='failed';job.error=`无法创建保存目录：${e.message}`;persist();emit();schedule();return; }
  job.status='running'; job.error=''; job.speed=null; job.eta=null;
  const child = spawn(engine,buildArgs(job.url,job.options,{binDir}),{windowsHide:true,cwd:root});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  active={child,id:job.id};emit();persist();
  let out='',err='',done=false;
  const line = value => {
    if (!value) return;
    try {
      if (value.startsWith('__PROGRESS__')) { const p=JSON.parse(value.slice(12)); const total=p.total_bytes || p.total_bytes_estimate; job.progress=total ? Math.min(100,p.downloaded_bytes/total*100) : null; job.speed=p.speed;job.eta=p.eta;job.downloaded=p.downloaded_bytes;job.total=total; if(job.status!=='canceling') job.status=p.status==='finished'?'processing':'running'; }
      else if(value.startsWith('__TITLE__')) {job.title=JSON.parse(value.slice(9));job.progress=0;}
      else if(value.startsWith('__FILE__')) {const file=JSON.parse(value.slice(8));if(!job.files.includes(file))job.files.push(file);}
      else if(value.startsWith('__POST__')) {if(job.status!=='canceling')job.status='processing';}
      else {log(job,value); if(value.startsWith('ERROR:')) job.error=value;}
    } catch {log(job,value);}
    emit();
  };
  child.stdout.on('data',b=>{out+=b.toString('utf8');const lines=out.split(/\r?\n/);out=lines.pop();lines.forEach(line);});
  child.stderr.on('data',b=>{err+=b.toString('utf8');const lines=err.split(/\r?\n/);err=lines.pop();lines.forEach(line);});
  const finish = (code,error) => { if(done)return;done=true;if(out)line(out);if(err)line(err);job.status=job.status==='canceling'?'canceled':code===0?'completed':'failed'; if(error)job.error=error.message;if(job.status==='failed'&&!job.error)job.error='下载进程异常结束，请查看日志';if(job.status==='completed')job.progress=100;job.speed=null;job.eta=null;job.finishedAt=new Date().toISOString();active=null;persist();emit();schedule(); };
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
        if(b.action==='cancel'){if(active?.id===job.id){job.status='canceling';stopChild(active.child);}else if(job.status==='queued'){job.status='canceled';}}
        else if(b.action==='retry'){if(!['failed','canceled','interrupted'].includes(job.status))throw new Error('此任务无需重试');job.status='queued';job.progress=0;job.error='';job.logs=[];delete job.finishedAt;}
        else if(b.action==='remove'){if(['queued','running','processing','canceling'].includes(job.status))throw new Error('请先取消任务');jobs=jobs.filter(j=>j!==job);}
        else throw new Error('未知操作');persist();emit();schedule();return json(res,{ok:true});
      }
      if(u.pathname==='/api/open-folder') {
        const job=b.id?jobs.find(j=>j.id===b.id):null;
        if(b.id&&!job)throw new Error('任务不存在');
        const dir=normalizeOptions({outputDir:job?job.outputDir:b.outputDir||settings.outputDir},settings.outputDir).outputDir;
        fs.mkdirSync(dir,{recursive:true});
        // Explorer is user-facing even when the download server runs without a console.
        // Do not inherit the hidden-window options used for yt-dlp and FFmpeg.
        const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','explorer.exe'),[dir],{windowsHide:false,detached:true,stdio:'ignore'});
        await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',e=>reject(new Error(`无法打开文件夹：${e.message}`)));});
        child.unref();
        return json(res,{ok:true});
      }
      if(u.pathname==='/api/pick-folder') {const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','pick-folder.ps1')],{windowsHide:true,timeout:120000});return json(res,{path:stdout.trim()});}
      if(u.pathname==='/api/update') {if(active||inspecting||updating)throw new Error('请等待下载或解析结束再更新');updating=true;try{const {stdout}=await exec(engine,['--ignore-config','--no-plugin-dirs','-U'],{windowsHide:true,timeout:180000});return json(res,{message:stdout,environment:await environment(true)});}finally{updating=false;schedule();}}
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
