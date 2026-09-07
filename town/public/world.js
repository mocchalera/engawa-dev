/* Dependency-free WebGL scene. Coordinates are presentation, never authorization. */
const COLORS = { sage: '#7e9b87', coral: '#d28d79', blue: '#739bad', gold: '#d4ad60', plum: '#a18aa6' };
const rgb = c => c.match(/[a-f0-9]{2}/gi).map(x => parseInt(x, 16) / 255);
const mul = (a,b) => { const m=Array(16).fill(0); for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)m[c*4+r]+=a[k*4+r]*b[c*4+k]; return m; };
const norm = a => {const n=Math.hypot(...a);return a.map(x=>x/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const anchors = [[-10,-7],[9,8],[10,-11],[-11,12],[29,8],[29,-11],[-30,-7],[-30,12]];
class Mesh {
  constructor(){this.data=[];}
  tri(a,b,c,color){const n=norm(cross(sub(b,a),sub(c,a))); const light=.72+Math.max(0,dot(n,norm([-1,2,1])))*.28;const col=rgb(color).map(x=>x*light);for(const p of [a,b,c])this.data.push(...p,...col);}
  box(x,y,z,w,h,d,color,angle=0){
    const co=Math.cos(angle),si=Math.sin(angle);
    const v=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([a,b,c])=>[x+a*w/2*co+c*d/2*si,y+b*h/2,z-a*w/2*si+c*d/2*co]);
    for(const [a,b,c,e] of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]){this.tri(v[a],v[b],v[c],color);this.tri(v[a],v[c],v[e],color);}
  }
  orb(x,y,z,rx,ry,rz,color,segments=10,rings=6){
    const point=(i,j)=>{const a=i*Math.PI/rings,b=j*Math.PI*2/segments;return[x+rx*Math.sin(a)*Math.cos(b),y+ry*Math.cos(a),z+rz*Math.sin(a)*Math.sin(b)];};
    for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);if(i>0)this.tri(a,b,d,color);if(i<rings-1)this.tri(d,b,c,color);}
  }
  cylinder(x,y,z,r,h,color,topR=r,n=10){
    for(let j=0;j<n;j++){const a=j*2*Math.PI/n,b=(j+1)*2*Math.PI/n;
      const p=[x+r*Math.cos(a),y-h/2,z+r*Math.sin(a)],q=[x+r*Math.cos(b),y-h/2,z+r*Math.sin(b)],s=[x+topR*Math.cos(a),y+h/2,z+topR*Math.sin(a)],t=[x+topR*Math.cos(b),y+h/2,z+topR*Math.sin(b)];
      this.tri(p,q,s,color);this.tri(s,q,t,color);this.tri([x,y+h/2,z],s,t,color);
    }
  }
  plant(x,z,scale=1){this.cylinder(x,.5*scale,z,.45*scale,scale,'#c79f81',.55*scale);this.cylinder(x,1.25*scale,z,.07*scale,scale,'#9b8a65');this.orb(x,1.7*scale,z,.7*scale,.9*scale,.65*scale,'#88a082');}
  tree(x,z,s=1){this.orb(x,.03,z,1.8*s,.03,1.3*s,'#ccd2b8');this.cylinder(x,1.7*s,z,.18*s,3.4*s,'#a28c70');this.orb(x,3.7*s,z,1.65*s,1.9*s,1.5*s,'#9bb18f');this.orb(x+.55*s,4.45*s,z-.2*s,1.2*s,1.15*s,1.25*s,'#b2c1a0');}
  desk(x,z,angle=0){this.box(x,1.05,z,2.8,.18,1.35,'#c9ae8a',angle);for(const a of [-1,1])for(const b of [-1,1])this.box(x+a*1.13,.5,z+b*.5,.1,1,.1,'#827a69');this.box(x,1.6,z-.2,.9,.6,.08,'#747b70',angle);this.box(x,1.12,z+.28,.7,.05,.3,'#e5ded0',angle);this.cylinder(x+1,1.26,z+.15,.16,.28,'#f6efe2');}
}
export class World {
  constructor(canvas, labels, onMove){
    this.canvas=canvas;this.labels=labels;this.onMove=onMove;this.yaw=.68;this.pitch=.74;this.zoom=27;this.target=[0,0,0];this.snap=null;this.positions=new Map();this.nodes=new Map();this.last=0;this.stopped=false;
    const gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'low-power'}); this.gl=gl;this.ctx2d=gl?null:canvas.getContext('2d');if(!gl&&!this.ctx2d)throw new Error('Canvas unavailable');this.staticData=[];
    if(gl){
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,'attribute vec3 position; attribute vec3 color; uniform mat4 matrix; varying vec3 tint; void main(){ gl_Position=matrix*vec4(position,1.0); tint=color; }'));
    gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec3 tint; void main(){gl_FragColor=vec4(tint,1.0);}'));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);this.pos=gl.getAttribLocation(p,'position');this.col=gl.getAttribLocation(p,'color');this.matrix=gl.getUniformLocation(p,'matrix');this.staticBuffer=gl.createBuffer();this.dynamicBuffer=gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);}
    this.staticCount=0;
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,orbit:e.button===2||e.altKey};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!this.drag)return;if(this.drag.orbit){this.yaw+=(e.clientX-this.drag.x)*.008;this.pitch=Math.max(.35,Math.min(1.3,this.pitch+(e.clientY-this.drag.y)*.005));}this.drag.x=e.clientX;this.drag.y=e.clientY;});
    canvas.addEventListener('pointerup',e=>{if(this.drag&&!this.drag.orbit&&Math.hypot(e.clientX-this.drag.startX,e.clientY-this.drag.startY)<8)this.pick(e.clientX,e.clientY);this.drag=null;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(12,Math.min(55,this.zoom+e.deltaY*.016));},{passive:false});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.stopped=true;canvas.dispatchEvent(new CustomEvent('world-unavailable'));});
    this.resize=new ResizeObserver(()=>this.size());this.resize.observe(canvas);this.size();this.frame=requestAnimationFrame(t=>this.draw(t));
  }
  size(){const r=this.canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.7);this.canvas.width=Math.max(1,r.width*d);this.canvas.height=Math.max(1,r.height*d);this.width=r.width;this.height=r.height;}
  anchor(id){const i=this.snap?.places.findIndex(p=>p.id===id)??-1;return anchors[i]||[Math.floor(i/4)*20,(i%4)*20];}
  update(snap){
    this.snap=snap;const key=JSON.stringify([snap.places.map(p=>[p.id,p.title]),snap.selected,snap.current?.objects]);
    if(key!==this.sceneKey){this.sceneKey=key;this.build();}
    for(const id of this.positions.keys())if(!snap.people.some(p=>p.id===id))this.positions.delete(id);
  }
  focus(id){const a=this.anchor(id);this.target=[a[0],0,a[1]];this.zoom=18;}
  home(){this.target=[0,0,0];this.zoom=27;}
  build(){
    const m=new Mesh();m.box(0,-.8,0,80,1.2,72,'#dbe0cb');m.box(0,-.12,0,63,.15,57,'#d5dcc5');
    for(let i=-20;i<24;i+=3)m.box(0,-.01,i,2,.04,2.3,'#e9e3d3');for(let i=-28;i<31;i+=3)m.box(i,0,1.7,2.3,.04,2,'#e9e3d3');
    for(const [x,z,s] of [[-21,-17,1.2],[21,-20,1.1],[22,18,1.2],[-23,23,1.1],[-2,-24,.8],[31,-3,1],[-29,3,.9],[6,24,.8]])m.tree(x,z,s);
    this.snap?.places.forEach((p,i)=>{
      const [x,z]=this.anchor(p.id);const garden=i%4===1;
      m.box(x,-.05,z,16,.3,15,garden?'#bacda9':'#c2b29a');m.box(x,.13,z,15.7,.08,14.7,garden?'#cad7b8':'#efe7d8');
      if(!garden){
        m.box(x,2.15,z-7.1,16,4.3,.3,i%3===0?'#e7dbca':'#ddc8b9');m.box(x-7.8,1.4,z-3.4,.25,2.8,7.7,'#e4d8c6');
        for(const wx of [-4.6,0,4.6]){m.box(x+wx,2.4,z-6.88,3.15,2,.12,'#b9c9ba');m.box(x+wx,2.4,z-6.75,.08,2,.08,'#ede5d5');m.box(x+wx,2.4,z-6.72,3.15,.08,.08,'#ede5d5');}
        m.box(x,4.45,z-5.9,16.5,.22,3,'#9b8c74');for(let j=-7;j<=7;j++)m.box(x+j,4.63,z-5.9,.1,.18,3,'#bba78a');
        if(i%4===2){
          m.box(x,1.1,z-3.9,9,2,1.1,'#b28d73');m.box(x,2.2,z-3.9,9.3,.17,1.45,'#dfc9a7');
          for(const dx of [-3,2.5]){m.cylinder(x+dx,1.1,z+1,1.55,.16,'#c7af8c');m.cylinder(x+dx,.5,z+1,.16,1,'#908776');for(const a of [-1,1])m.cylinder(x+dx+a*1.9,.65,z+1,.55,.2,'#92a796');}
          m.box(x+3,2.55,z-4,.8,.6,.5,'#798a7e');
        }else{m.desk(x-3,z-2);m.desk(x+2,z-2);m.box(x+3,1,z+3.7,3.6,.8,1.4,'#9eafa0');m.box(x+3,1.65,z+4.3,3.6,.8,.35,'#a5b7a5');m.cylinder(x+2.6,.65,z+1.4,.8,.12,'#d0b38c');}
        m.plant(x-6,z+5,.95);m.plant(x+6,z-4,1.1);
        m.box(x-5.9,2,z-6.55,1.55,1.8,.1,'#b79b75');m.box(x-5.9,2,z-6.42,1.3,1.55,.05,'#f2e9d5');
      }else{
        m.orb(x+2,.24,z-1,2.5,.04,1.7,'#9dbeb7');m.orb(x+2,.29,z-1,1.9,.04,1.2,'#b2d1c6');
        m.box(x-3,.7,z-3,4,.22,.9,'#bea481');m.box(x-3,1.3,z-3.5,4,.65,.12,'#c4ae8d');
        m.cylinder(x+5,2.8,z-4,.12,5.3,'#afa185');m.cylinder(x+5,5.3,z-4,3.1,.35,'#e6d2ac',.18,12);m.cylinder(x+5,1,z-4,1.3,.2,'#d0b38c');
        m.tree(x-5.5,z+3.7,.7);m.plant(x+6,z-4,.9);
      }
      if(p.id===this.snap.selected){
        const objects=this.snap.current?.objects??[];
        objects.slice(0,18).forEach((o,j)=>{const ox=x-5+(j%6)*1.8,oz=z+5+Math.floor(j/6)*.7;
          if(o.kind==='plant')m.plant(ox,oz,.4+o.growth*.08);
          else {m.box(ox,.45,oz,1.2,.9,.1,o.kind==='photo'?'#faf5e8':'#dec993');m.box(ox,.47,oz+.07,.95,.62,.04,o.kind==='photo'?'#9cae9d':'#ead8b4');}
        });
      }
    });
    this.staticData=m.data;this.cpuKey='';const gl=this.gl;if(gl){gl.bindBuffer(gl.ARRAY_BUFFER,this.staticBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.data),gl.STATIC_DRAW);}this.staticCount=m.data.length/6;
  }
  camera(){
    const aspect=this.width/Math.max(1,this.height),h=this.zoom,w=h*aspect;
    const forward=norm([-Math.sin(this.yaw)*Math.cos(this.pitch),-Math.sin(this.pitch),-Math.cos(this.yaw)*Math.cos(this.pitch)]);
    const right=norm(cross(forward,[0,1,0])),up=cross(right,forward);this.basis={forward,right,up,w,h};
    const eye=this.target.map((t,i)=>t-forward[i]*80),back=forward.map(v=>-v);
    const view=[right[0],up[0],back[0],0,right[1],up[1],back[1],0,right[2],up[2],back[2],0,-dot(right,eye),-dot(up,eye),-dot(back,eye),1];
    const proj=[1/w,0,0,0,0,1/h,0,0,0,0,-2/200,0,0,0,-1,1];
    this.mvp=mul(proj,view);return this.mvp;
  }
  pick(cx,cy){
    if(!this.snap||!this.basis)return;const rect=this.canvas.getBoundingClientRect();const nx=(cx-rect.left)/rect.width*2-1,ny=1-(cy-rect.top)/rect.height*2;
    const {right,up,forward,w,h}=this.basis;const p=this.target.map((v,i)=>v+right[i]*nx*w+up[i]*ny*h);const t=-p[1]/forward[1];const ground=p.map((v,i)=>v+forward[i]*t);
    const place=this.snap.places.find(pl=>{const a=this.anchor(pl.id);return Math.abs(ground[0]-a[0])<=8&&Math.abs(ground[2]-a[1])<=7.5;});
    if(place){const a=this.anchor(place.id);this.onMove(place.id,Math.max(-8,Math.min(8,ground[0]-a[0])),Math.max(-7,Math.min(7,ground[2]-a[1])));}
  }
  project(x,y,z){const a=this.mvp,v=[x,y,z,1],p=[0,0,0,0];for(let r=0;r<4;r++)for(let k=0;k<4;k++)p[r]+=a[k*4+r]*v[k];return[(p[0]/p[3]+1)*this.width/2,(1-p[1]/p[3])*this.height/2];}
  label(id,content,x,y,z,type){
    let el=this.nodes.get(id);if(!el){el=document.createElement('div');el.className=type;this.labels.append(el);this.nodes.set(id,el);}if(el.textContent!==content)el.textContent=content;const [px,py]=this.project(x,y,z);el.style.transform=`translate(${px}px,${py}px) translate(-50%,-100%)`;el.hidden=px<0||py<0||px>this.width||py>this.height;return id;
  }
  draw(t){
    if(this.stopped)return;this.frame=requestAnimationFrame(time=>this.draw(time));if(t-this.last<(this.gl?33:90)||document.hidden)return;this.last=t;
    this.camera();const gl=this.gl;if(gl){gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(.94,.94,.89,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniformMatrix4fv(this.matrix,false,new Float32Array(this.mvp));}
    const draw=(buffer,count)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(this.pos);gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(this.col);gl.vertexAttribPointer(this.col,3,gl.FLOAT,false,24,12);gl.drawArrays(gl.TRIANGLES,0,count);};
    if(gl)draw(this.staticBuffer,this.staticCount);const m=new Mesh(),used=new Set();
    this.snap?.places.forEach(p=>{const [x,z]=this.anchor(p.id);used.add(this.label(`room:${p.id}`,p.title,x,.4,z+8,'place-label'));});
    for(const p of this.snap?.people??[]){
      const a=this.anchor(p.roomId);let at=this.positions.get(p.id);if(!at){at={x:p.x,z:p.z,roomId:p.roomId};this.positions.set(p.id,at);}if(at.roomId!==p.roomId){at.x=p.x;at.z=p.z;at.roomId=p.roomId;}at.x+=(p.x-at.x)*.23;at.z+=(p.z-at.z)*.23;
      const x=a[0]+at.x,z=a[1]+at.z,focus=p.mode==='focus',away=p.mode==='away',y=focus?.25:0;const color=COLORS[p.color]||COLORS.sage;
      m.orb(x,.25,z,.66,.02,.43,'#c1c5ad');m.cylinder(x,.95-y,z,.32,.78,color,.39);m.orb(x,1.75-y,z,.44,.45,.42,'#f2dfbf');
      for(const dir of [-1,1]){m.cylinder(x+dir*.2,.42,z,.12,.7,'#737b70');m.orb(x+dir*.2,.15,z+.08,.16,.12,.23,'#737b70');m.cylinder(x+dir*.44,1.03-y+(p.gesture==='wave'&&dir===1?.5:0),z,.1,.58,color);}
      m.orb(x-.15,1.77-y,z+.38,.045,.055,.035,'#5e625b');m.orb(x+.15,1.77-y,z+.38,.045,.055,.035,'#5e625b');
      if(p.avatar==='rabbit'){m.orb(x-.2,2.23-y,z,.13,.5,.14,'#f2dfbf');m.orb(x+.2,2.23-y,z,.13,.5,.14,'#f2dfbf');}
      if(p.avatar==='cat'){m.cylinder(x-.26,2.16-y,z,.19,.5,'#f2dfbf',.01,3);m.cylinder(x+.26,2.16-y,z,.19,.5,'#f2dfbf',.01,3);}
      if(p.avatar==='bird')m.orb(x,1.65-y,z+.46,.15,.1,.2,'#c99761');
      if(focus){m.box(x,.87,z+.65,1.4,.12,.8,'#c9ae8a');m.box(x,1.24,z+.48,.62,.45,.05,'#737b70');}
      if(away)m.orb(x,2.32,z,.18,.13,.18,'#c4c8b8');
      const mode={available:'',knock:' · ひと声どうぞ',focus:' · 集中中',away:' · 離席中'}[p.mode]||'';
      used.add(this.label(`p:${p.id}`,`${p.name}${p.guest?' · GUEST':''}${mode}`,x,2.7,z,'person-label'+(p.id===this.snap.actor.id?' self-label':'')));
      const message=[...(this.snap.buffer??[])].reverse().find(b=>b.author===p.id&&this.snap.now-b.at<12_000);
      if(message)used.add(this.label(`b:${p.id}`,message.text.slice(0,48),x,3.7,z,'bubble'));
      if(p.gesture){const gestures={wave:'おはよう',clap:'ぱちぱち',heart:'ありがとう',coffee:'ひと息'};used.add(this.label(`g:${p.id}`,gestures[p.gesture],x,4.7,z,'gesture-label'));}
    }
    for(const [id,el] of this.nodes)if(!used.has(id)){el.remove();this.nodes.delete(id);}
    if(gl){gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamicBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.data),gl.DYNAMIC_DRAW);draw(this.dynamicBuffer,m.data.length/6);}else this.renderCanvas(m.data);
  }
  renderCanvas(dynamic){
    const key=JSON.stringify([this.mvp,this.width,this.height,this.sceneKey]);
    const projectData=data=>{const triangles=[];for(let i=0;i<data.length;i+=18){const pts=[],depth=[];for(let j=0;j<3;j++){const k=i+j*6,x=data[k],y=data[k+1],z=data[k+2];pts.push(this.project(x,y,z));depth.push(dot([x,y,z],this.basis.forward));}const area=(pts[1][0]-pts[0][0])*(pts[2][1]-pts[0][1])-(pts[1][1]-pts[0][1])*(pts[2][0]-pts[0][0]);if(Math.abs(area)<.1)continue;const color=`rgb(${Math.round(data[i+3]*255)},${Math.round(data[i+4]*255)},${Math.round(data[i+5]*255)})`;triangles.push({pts,depth:depth.reduce((a,b)=>a+b,0)/3,color,floor:Math.max(data[i+1],data[i+7],data[i+13])<=.35});}return triangles;};
    if(this.cpuKey!==key){this.cpuKey=key;this.cpuStatic=projectData(this.staticData);}
    const triangles=[...(this.cpuStatic||[]),...projectData(dynamic)].sort((a,b)=>Number(b.floor)-Number(a.floor)||b.depth-a.depth),c=this.ctx2d,d=this.canvas.width/Math.max(1,this.width);c.setTransform(d,0,0,d,0,0);c.fillStyle='#eeeee3';c.fillRect(0,0,this.width,this.height);
    for(const t of triangles){c.beginPath();c.moveTo(...t.pts[0]);c.lineTo(...t.pts[1]);c.lineTo(...t.pts[2]);c.closePath();c.fillStyle=t.color;c.fill();c.strokeStyle=t.color;c.lineWidth=.4;c.stroke();}
  }
  destroy(){this.stopped=true;cancelAnimationFrame(this.frame);this.resize.disconnect();this.labels.replaceChildren();this.gl?.deleteBuffer(this.staticBuffer);this.gl?.deleteBuffer(this.dynamicBuffer);}
}
