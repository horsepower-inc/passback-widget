// gives the widget a { send, on, off } hot object over same-origin POST and EventSource.

const SHIM = `(function(){
var P=__BASE__+'/api/passback/';
var L={};
var es=null;
function emit(e,d){
  (L[e]||[]).slice().forEach(function(cb){try{cb(d)}catch(_){}});
}
function post(name,data){
  return fetch(P+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
}
function open(){
  es=new EventSource(P+'events');
  es.onmessage=function(m){
    var d;
    try{d=JSON.parse(m.data)}catch(_){return}
    emit('passback:status',d);
  };
  es.addEventListener('passback:items',function(m){
    var d;
    try{d=JSON.parse(m.data)}catch(_){return}
    emit('passback:items',d);
  });
}
function watched(){
  return (L['passback:status']||[]).length+(L['passback:items']||[]).length>0;
}
var hot={
  send:function(event,data){
    if(event==='passback:mark'){
      post('mark',data).then(function(r){return r.json()}).then(function(ack){
        emit('passback:ack',ack);
      },function(err){
        emit('passback:ack',{v:1,batchId:data.batch.id,accepted:[],trimmed:[],error:{code:'network',message:String(err&&err.message||err)}});
      });
    }else if(event==='passback:orphaned'){
      try{post('orphaned',data).then(function(){},function(){})}catch(_){}
    }else if(event==='passback:reopen'){
      try{post('reopen',data).then(function(){},function(){})}catch(_){}
    }else if(event==='passback:verdict'){
      try{post('verdict',data).then(function(){},function(){})}catch(_){}
    }else if(event==='passback:clear'){
      try{post('clear',data).then(function(r){return r.ok?r.json():null}).then(function(d){
        if(d)emit('passback:cleared',d);
      }).catch(function(){})}catch(_){}
    }else if(event==='passback:list'){
      try{post('list',data).then(function(r){return r.ok?r.json():null}).then(function(d){
        if(d)emit('passback:items',d);
      }).catch(function(){})}catch(_){}
    }
  },
  on:function(event,cb){
    (L[event]=L[event]||[]).push(cb);
    if((event==='passback:status'||event==='passback:items')&&!es)open();
  },
  off:function(event,cb){
    var a=L[event];
    if(!a)return;
    var i=a.indexOf(cb);
    if(i>=0)a.splice(i,1);
    if(es&&!watched()){es.close();es=null}
  }
};
window.__passback=Object.assign(window.__passback||{},{hot:hot,caps:['reopen','verdict','list','clear']}__BUILD__);
})();`;

export function hotShimSource(base: string, buildId?: string): string {
  const build = buildId === undefined ? '' : `,{buildId:${JSON.stringify(buildId)}}`;
  return SHIM.replace('__BASE__', () => JSON.stringify(base))
    .replace('__BUILD__', () => build)
    .replace(/</g, '\\u003c');
}
