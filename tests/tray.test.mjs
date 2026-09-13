import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function trayProcesses() {
  const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name = 'yt-dlp-tray.exe'" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`],{windowsHide:true,timeout:10000});
  if(!stdout.trim())return[];
  const value=JSON.parse(stdout);return Array.isArray(value)?value:[value];
}

test('Windows tray starts once, survives duplicate launch, and exits with its server',{skip:process.platform!=='win32',timeout:60000},async()=>{
  const data=fs.mkdtempSync(path.join(root,'test-output-tray-'));
  const origin='http://127.0.0.1:47841';
  const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'47841',YTDLP_DATA_DIR:data,YTDLP_NO_TRAY:'0'},windowsHide:true,stdio:'ignore'});
  const serverExit=once(server,'exit');
  let boot,started;
  try{
    for(let i=0;i<60;i++){try{const r=await fetch(`${origin}/api/bootstrap`);boot=await r.json();if(boot.pid===server.pid)break;}catch{}await sleep(200);}
    assert.equal(boot?.pid,server.pid);
    for(let i=0;i<15;i++){started=(await trayProcesses()).filter(p=>p.ParentProcessId===server.pid);if(started.length)break;await sleep(200);}
    assert.equal(started.length,1,'server must start a native tray process');
    const helperId=started[0].ProcessId;
    const duplicate=spawn(path.join(root,'bin','yt-dlp-tray.exe'),[root,origin,String(server.pid)],{windowsHide:true,stdio:'ignore'});
    const [duplicateCode]=await once(duplicate,'exit');
    assert.equal(duplicateCode,0,'duplicate instance should exit successfully');
    assert.ok((await trayProcesses()).some(p=>p.ProcessId===helperId),'original tray remains alive');
    const r=await fetch(`${origin}/api/shutdown`,{method:'POST',headers:{'X-App-Token':boot.token,'Content-Type':'application/json'},body:'{}'});
    assert.equal(r.status,200);
    await serverExit;
    let remains=true;
    for(let i=0;i<12;i++){remains=(await trayProcesses()).some(p=>p.ProcessId===helperId);if(!remains)break;await sleep(250);}
    assert.equal(remains,false,'tray must exit when the server exits');
  }finally{if(server.exitCode===null)server.kill();}
});
