'use strict';
const {parentPort}=require('node:worker_threads');
const fs=require('node:fs/promises'),zlib=require('node:zlib');
const worker=require('tesseract.js/src/worker-script');
const core=require('tesseract.js-core/tesseract-core-lstm');
worker.setAdapter({getCore:async()=>core,gunzip:data=>zlib.gunzipSync(data),readCache:file=>fs.readFile(file),
  writeCache:async()=>{throw Error('OCR cache is disabled');},fetch:async()=>{throw Error('OCR uses bundled data only');}});
parentPort.on('message',packet=>worker.dispatchHandlers(packet,obj=>parentPort.postMessage(obj)));
