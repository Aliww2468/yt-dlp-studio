import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=path.resolve('test-output','browser');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'studio-test.mp4');
if(!fs.existsSync(file))execFileSync(path.resolve('bin','ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=320x180:rate=24:duration=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file],{windowsHide:true});
http.createServer((req,res)=>{const content=fs.readFileSync(file);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':content.length});if(req.method==='HEAD')res.end();else res.end(content);}).listen(47840,'127.0.0.1',()=>console.log('Local test fixture: http://127.0.0.1:47840/studio-test.mp4'));
