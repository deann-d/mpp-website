'use strict';
/* Integration test untuk serverless function Vercel (folder api/).
   Menjalankan handler dengan req/res tiruan + mock Upstash Redis in-memory.
   Pakai: node tools/test-vercel-api.js   (tidak perlu koneksi internet) */
const http = require('http');
const path = require('path');
const API = path.resolve(__dirname, '..', 'api');

const store = { kv:{}, lists:{}, sets:{} };
function exec(a){const[c,...x]=a.map(String);switch(c){
 case 'GET':return store.kv[x[0]]!==undefined?store.kv[x[0]]:null;
 case 'SET':if(x.includes('NX')){if(store.kv[x[0]]!==undefined)return null;store.kv[x[0]]=x[1];return 'OK';}store.kv[x[0]]=x[1];return 'OK';
 case 'DEL':{let n=0;for(const k of x){if(store.kv[k]!==undefined){delete store.kv[k];n++;}}return n;}
 case 'EXPIRE':return 1;
 case 'INCR':store.kv[x[0]]=String(parseInt(store.kv[x[0]]||'0',10)+1);return +store.kv[x[0]];
 case 'RPUSH':store.lists[x[0]]=store.lists[x[0]]||[];store.lists[x[0]].push(...x.slice(1));return store.lists[x[0]].length;
 case 'LPUSH':store.lists[x[0]]=store.lists[x[0]]||[];store.lists[x[0]].unshift(...x.slice(1));return store.lists[x[0]].length;
 case 'LPOP':{const l=store.lists[x[0]];return l&&l.length?l.shift():null;}
 case 'LLEN':return (store.lists[x[0]]||[]).length;
 case 'LTRIM':{const l=store.lists[x[0]]||[];store.lists[x[0]]=l.slice(+x[1],+x[2]+1);return 'OK';}
 case 'SADD':store.sets[x[0]]=store.sets[x[0]]||new Set();let n=0;x.slice(1).forEach(v=>{if(!store.sets[x[0]].has(v)){store.sets[x[0]].add(v);n++;}});return n;
 case 'SREM':{const s=store.sets[x[0]];let n=0;if(s)x.slice(1).forEach(v=>{if(s.delete(v))n++;});return n;}
 case 'SMEMBERS':return [...(store.sets[x[0]]||[])];
 case 'HSET':store.kv[x[0]]=store.kv[x[0]]||{};for(let i=1;i<x.length;i+=2)store.kv[x[0]][x[i]]=x[i+1];return (x.length-1)/2;
 case 'HGETALL':return store.kv[x[0]]||{};
 default:throw new Error('unknown '+c);}}

const mock=http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
 r.setHeader('Content-Type','application/json');
 try{ if(q.url.endsWith('/pipeline')){r.end(JSON.stringify(JSON.parse(b).map(c=>({result:exec(c)}))));}
 else{const c=decodeURIComponent(q.url.replace(/^\//,'').split('?')[0]);r.end(JSON.stringify({result:exec([c,...(b?JSON.parse(b):[])])}));}}
 catch(e){r.statusCode=400;r.end(JSON.stringify({error:e.message}));}});});

function mkRes(){return{statusCode:200,_h:{},_b:null,
  setHeader(k,v){this._h[k]=v},status(c){this.statusCode=c;return this},json(o){this._b=o;return this}};}
async function call(h,o={}){const res=mkRes();
  await h({method:o.method||'GET',body:o.body||null,query:o.query||{},headers:o.headers||{}},res);return res;}

mock.listen(0, async ()=>{
  const port = mock.address().port;
  process.env.KV_REST_API_URL='http://localhost:'+port;
  process.env.KV_REST_API_TOKEN='t';
  process.env.ADMIN_TOKEN='rahasia123';

  const health=require(path.join(API,'health')), reg=require(path.join(API,'register')),
        trk=require(path.join(API,'track')), par=require(path.join(API,'partner','[code]')),
        adm=require(path.join(API,'admin','stats'));
  let pass=0,fail=0;
  const ck=(n,c,x='')=>{c?(pass++,console.log('  [OK] '+n)):(fail++,console.log('  [GAGAL] '+n+(x?' — '+x:'')));};
  console.log('\n=== INTEGRATION TEST: Vercel serverless handlers ===\n');

  let r=await call(health);
  ck('GET /api/health → 200 & kv_configured=true', r.statusCode===200 && r._b.kv_configured===true, JSON.stringify(r._b));

  const payload={nama:'Budi Test',email:'budi.test@example.com',whatsapp:'081234567890',
    status:'Mahasiswa Aktif',institusi:'UI',sosmed:'Instagram',
    setuju_etika:true,setuju_data:true,setuju_status:true};
  r=await call(reg,{method:'POST',body:payload});
  ck('POST /api/register → 201 + kode resmi pertama KSA-674961-MPP', r.statusCode===201 && r._b.ref_code==='KSA-674961-MPP', JSON.stringify(r._b));
  const code=r._b.ref_code; const pin=r._b.access_pin;
  ck('register menyertakan next_steps', Array.isArray(r._b.next_steps) && r._b.next_steps.length===4);

  r=await call(reg,{method:'POST',body:payload});
  ck('POST /api/register email duplikat → 409', r.statusCode===409);

  const poolBeforeWarmup=store.lists['mpp:pool'].length;
  const warmup=await call(reg,{method:'POST',body:{...payload,nama:'Pemanas Pool',email:'pemanas.pool@example.com'}});
  ck('pendaftaran pemanas mengisi pool', warmup.statusCode===201 && store.lists['mpp:pool'].length===poolBeforeWarmup-1);
  const parallelEmail='paralel.unik@example.com';
  const poolBeforeParallel=store.lists['mpp:pool'].length;
  const parallelResults=await Promise.all(Array.from({length:20},(_,i)=>call(reg,{
    method:'POST',body:{...payload,nama:'Paralel '+i,email:parallelEmail}
  })));
  const parallel201=parallelResults.filter(result=>result.statusCode===201);
  const parallel409=parallelResults.filter(result=>result.statusCode===409);
  ck('20 pendaftaran paralel email sama: tepat 1 respons 201 dan 19 respons 409',
    parallel201.length===1 && parallel409.length===19 && parallelResults.every(result=>result.statusCode===201 || result.statusCode===409),
    parallelResults.map(result=>result.statusCode).join(','));
  ck('respons 409 tidak memuat ref_code', parallel409.every(result=>!Object.prototype.hasOwnProperty.call(result._b,'ref_code')));
  ck('race email memakai tepat satu kode pool', poolBeforeParallel-store.lists['mpp:pool'].length===1,
    'sebelum='+poolBeforeParallel+', sesudah='+store.lists['mpp:pool'].length);

  const rollbackEmail='rollback.pool@example.com';
  store.lists['mpp:pool']=[];
  const noCode=await call(reg,{method:'POST',body:{...payload,nama:'Rollback',email:rollbackEmail}});
  ck('pool kosong mengembalikan 503 dan melepas klaim email',
    noCode.statusCode===503 && store.kv['mpp:email:'+rollbackEmail]===undefined,
    JSON.stringify(noCode._b));
  store.lists['mpp:pool'].push('KSA-ROLLBACK-MPP');
  const retry=await call(reg,{method:'POST',body:{...payload,nama:'Rollback Berhasil',email:rollbackEmail}});
  ck('email dapat didaftarkan setelah klaim rollback', retry.statusCode===201);
  r=await call(reg,{method:'GET'});
  ck('GET /api/register → 405', r.statusCode===405);
  r=await call(reg,{method:'POST',body:{...payload,email:'baru@example.com',setuju_etika:false}});
  ck('register tanpa persetujuan etika → 400', r.statusCode===400);
  r=await call(reg,{method:'POST',body:{...payload,email:'wa@example.com',whatsapp:'123'}});
  ck('register WhatsApp tidak valid → 400', r.statusCode===400);

  r=await call(trk,{method:'POST',body:{ref_code:code,prospect:'calon@x.com'}});
  ck('POST /api/track → 201 first_click=true', r.statusCode===201 && r._b.first_click===true, JSON.stringify(r._b));
  r=await call(trk,{method:'POST',body:{ref_code:'KSA-562541-MPP',prospect:'calon@x.com'}});
  ck('prospek sama oleh mitra lain → tetap milik mitra pertama', r._b.attributed_to===code && r._b.first_click===false);
  r=await call(trk,{method:'POST',body:{ref_code:'BUKAN-KODE'}});
  ck('POST /api/track kode invalid → 400', r.statusCode===400);

  r=await call(par,{query:{code},headers:{'x-partner-pin':pin}});
  ck('GET /api/partner/:code → 200 & clicks tercatat', r.statusCode===200 && r._b.stats.clicks===1, JSON.stringify(r._b));
  r=await call(par,{query:{code:code.toLowerCase()},headers:{'x-partner-pin':pin}});
  ck('GET /api/partner/:code case-insensitive', r.statusCode===200 && r._b.partner.nama==='Budi Test');
  r=await call(par,{query:{code:'KSA-DEMO-MPP'}});
  ck('GET /api/partner/KSA-DEMO-MPP → mode demo', r.statusCode===200 && r._b.demo===true);
  r=await call(par,{query:{code},headers:{'x-partner-pin':'SALAH123'}});
  ck('GET /api/partner dengan PIN salah -> 401', r.statusCode===401);
  r=await call(reg,{method:'POST',body:{...payload,email:'bot@example.com',website:'http://spam'}});
  ck('register dengan honeypot terisi -> 400', r.statusCode===400);
  r=await call(par,{query:{code:'KSA-999999-MPP'}});
  ck('GET /api/partner tidak dikenal → 401', r.statusCode===401);

  r=await call(adm,{headers:{}});
  ck('GET /api/admin/stats tanpa token → 401', r.statusCode===401);
  r=await call(adm,{headers:{authorization:'Bearer rahasia123'}});
  ck('GET /api/admin/stats + token → 200 dan jumlah mitra konsisten',
     r.statusCode===200 && r._b.total_mitra===parallel201.length+3, JSON.stringify(r._b));

  // CORS preflight
  r=await call(reg,{method:'OPTIONS'});
  ck('OPTIONS /api/register → 204 (CORS preflight)', r.statusCode===204);

  console.log('\n=== HASIL: '+pass+' lulus, '+fail+' gagal ===\n');
  mock.close(); process.exit(fail?1:0);
});
