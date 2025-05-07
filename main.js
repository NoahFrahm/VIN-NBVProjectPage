/* =========================================================
 *  Synchronized 2‑row × 6‑panel point‑cloud viewer + top row
 *  -------------------------------------------------
 *  • Top row = 0-s point cloud + 2 photos
 *  • Row B  = BASE   paths (6 time points)
 *  • Row O  = OURS   paths (6 time points)
 *  • Shared camera; mouse controls work only when the
 *    cursor is inside a canvas of that row.
 * =========================================================*/

/* ---------- global camera state ---------- */
let initialCameraZ = -5.0;    
let minCameraZ     = -0.5;

let cameraYaw   = 0;
let cameraPitch = 0;
let cameraZ     = -initialCameraZ;

/* second independent camera for coverage baselines */
let cam2Yaw=0, cam2Pitch=0, cam2Z=-initialCameraZ;

/* ---------- constants ---------- */
const TIMES   = [15,30,45,60];      // four time points for grid
const GRID_LEN = TIMES.length;      // 4

const TOP_PC_ID = 'canvasPC0';
const BASE_ID = ['canvasB1','canvasB2','canvasB3','canvasB4'];
const OURS_ID = ['canvasO1','canvasO2','canvasO3','canvasO4'];

const COVER_ID = ['canvasC0','canvasC1'];
const COVER_LEN = COVER_ID.length;   // 2

/* viewer registries (parallel arrays) */
const glCtx   = {top:[], B:new Array(GRID_LEN).fill(null), O:new Array(GRID_LEN).fill(null)};
const program = {top:[], B:new Array(GRID_LEN).fill(null), O:new Array(GRID_LEN).fill(null)};
const uniLoc  = {top:[], B:new Array(GRID_LEN).fill(null), O:new Array(GRID_LEN).fill(null)};
const nPoints = {top:[], B:TIMES.map(()=>0),        O:TIMES.map(()=>0)};

glCtx.C = new Array(COVER_LEN).fill(null);
program.C = new Array(COVER_LEN).fill(null);
uniLoc.C  = new Array(COVER_LEN).fill(null);
nPoints.C = new Array(COVER_LEN).fill(0);

let isDragging = false, lastX = 0, lastY = 0, activeRow = null;

/* -------------------------------------------------------- */
/*                    helper functions                      */
/* -------------------------------------------------------- */
function buildPaths(house, method) {
  return TIMES.map(t => {
    return `./point_clouds/${house}/${method}_${house}_time_${t}.ply`;
  });
}

/* ---- WebGL boilerplate ---- */
function initGL(canvas){
  const gl = canvas.getContext('webgl',{antialias:true});
  if(!gl){ alert('WebGL unavailable'); }
  return gl;
}
function createShader(gl,src,type){
  const sh = gl.createShader(type);
  gl.shaderSource(sh,src); gl.compileShader(sh);
  if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))
    {console.error(gl.getShaderInfoLog(sh));}
  return sh;
}
function createProgram(gl,vs,fs){
  const p = gl.createProgram();
  gl.attachShader(p,createShader(gl,vs,gl.VERTEX_SHADER));
  gl.attachShader(p,createShader(gl,fs,gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))
    {console.error(gl.getProgramInfoLog(p));}
  return p;
}
function perspective(fovy,aspect,n,f){
  const t = 1/Math.tan(fovy/2), r=n-f;
  return new Float32Array([t/aspect,0,0,0, 0,t,0,0, 0,0,(n+f)/r,-1, 0,0,2*n*f/r,0]);
}
function multiply(a,b){
  const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)
    o[c*4+r]=a[r]*b[c*4]+a[r+4]*b[c*4+1]+a[r+8]*b[c*4+2]+a[r+12]*b[c*4+3];
  return o;
}
function translate(m,tx,ty,tz){
  const t=new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1]);
  return multiply(m,t);
}
function cameraMatrix(){
  const cosP = Math.cos(cameraPitch), sinP = Math.sin(cameraPitch);
  const cosY = Math.cos(cameraYaw),   sinY = Math.sin(cameraYaw);
  const rot  = new Float32Array([
    cosY,0,-sinY,0,
    sinY*sinP, cosP, cosY*sinP,0,
    sinY*cosP,-sinP, cosP*cosY,0,
    0,0,0,1]);
  const trans = translate(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,cameraZ,1]),0,0,0);
  return multiply(trans, rot);
}
function camera2Matrix(){
  const cosP=Math.cos(cam2Pitch), sinP=Math.sin(cam2Pitch);
  const cosY=Math.cos(cam2Yaw),   sinY=Math.sin(cam2Yaw);
  const rot=new Float32Array([
    cosY,0,-sinY,0,
    sinY*sinP, cosP, cosY*sinP,0,
    sinY*cosP,-sinP, cosP*cosY,0,
    0,0,0,1]);
  const trans=translate(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,cam2Z,1]),0,0,0);
  return multiply(trans,rot);
}

/* ---- viewer setup ---- */
function setupViewer(gl, pos, col, pointSize = 3){
  const VS=`attribute vec3 aPosition;attribute vec3 aColor;
           uniform mat4 uMVMatrix,uPMatrix;varying vec3 vColor;
           void main(){gl_PointSize=${pointSize.toFixed(1)};
             gl_Position=uPMatrix*uMVMatrix*vec4(aPosition,1.0);vColor=aColor;}`;
  const FS=`precision mediump float;varying vec3 vColor;
           void main(){gl_FragColor=vec4(vColor,1.0);}`;
  const prog=createProgram(gl,VS,FS);
  gl.useProgram(prog);
  /* position */
  const pb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,pb);
  gl.bufferData(gl.ARRAY_BUFFER,pos,gl.STATIC_DRAW);
  const locPos=gl.getAttribLocation(prog,'aPosition');
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos,3,gl.FLOAT,false,0,0);
  /* color */
  const cb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,cb);
  gl.bufferData(gl.ARRAY_BUFFER,col,gl.STATIC_DRAW);
  const locCol=gl.getAttribLocation(prog,'aColor');
  gl.enableVertexAttribArray(locCol);
  gl.vertexAttribPointer(locCol,3,gl.FLOAT,false,0,0);
  gl.clearColor(0.95,0.95,0.95,1); gl.enable(gl.DEPTH_TEST);
  return {program:prog,uMV:gl.getUniformLocation(prog,'uMVMatrix'),
          uP:gl.getUniformLocation(prog,'uPMatrix')};
}

/* ---- loader for top row: 0-s point cloud + two photos ---- */
async function loadTopRow(house){
  // 0‑s point cloud
  const ply = await loadPLY(`./point_clouds/${house}/BASEVIEW_${house}.ply`);
  const cv  = document.getElementById(TOP_PC_ID);
  const gl  = initGL(cv);
  const v   = setupViewer(gl, ply.positions, ply.colors);

  // hook it into the render arrays for shared camera
  glCtx.top = [gl]; program.top=[v.program]; uniLoc.top=[{mv:v.uMV,p:v.uP}]; nPoints.top=[ply.positions.length/3];

  /* same controls as other canvases */
  if(!cv.dataset.bound){
    cv.dataset.bound='1';
    cv.addEventListener('pointerenter',()=>activeRow='top');
    cv.addEventListener('pointerleave',()=>{activeRow=null;});
    cv.addEventListener('pointerdown',e=>{
      isDragging=true; lastX=e.clientX; lastY=e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove',e=>{
      if(isDragging && activeRow==='top'){
        cameraYaw   += (e.clientX-lastX)*0.01;
        cameraPitch += (e.clientY-lastY)*0.01;
        lastX=e.clientX; lastY=e.clientY;
      }
    });
    cv.addEventListener('pointerup',()=>isDragging=false);
  }

  // reference images
  document.getElementById('pic1').src = `./point_clouds/${house}/BASEVIEW_1.jpg`;
  document.getElementById('pic2').src = `./point_clouds/${house}/BASEVIEW_0.jpg`;
}

/* ---- simple ASCII‑PLY loader ---- */
async function loadPLY(url){
  const text=await (await fetch(url)).text();
  const lines=text.trim().split(/\n+/);
  let nv=0, start=0;
  for(let i=0;i<lines.length;i++){
    if(lines[i].startsWith('element vertex')) nv=+lines[i].split(/\s+/)[2];
    if(lines[i].trim()==='end_header'){start=i+1;break;}
  }
  const pos=new Float32Array(nv*3), col=new Float32Array(nv*3);
  for(let i=0;i<nv;i++){
    const p=lines[start+i].split(/\s+/).map(Number);
    pos.set(p.slice(0,3),i*3);
    const c=p.length>=6?p.slice(3,6).map(v=>v/255):[0,0,0];
    col.set(c,i*3);
  }
  return {positions:pos,colors:col};
}

/* -------------------------------------------------------- */
/*                loading rows & houses                     */
/* -------------------------------------------------------- */
async function loadRow(rowKey, ids, paths){
  for(let i=0;i<GRID_LEN;i++){
    const ply = await loadPLY(paths[i]);
    const canvas = document.getElementById(ids[i]);
    const gl     = initGL(canvas);
    const v      = setupViewer(gl,ply.positions,ply.colors);
    glCtx[rowKey][i]=gl; program[rowKey][i]=v.program;
    uniLoc[rowKey][i]={mv:v.uMV,p:v.uP};
    nPoints[rowKey][i]=ply.positions.length/3;

    /* bind pointer events once */
    if(!canvas.dataset.bound){
      canvas.dataset.bound='1';
      canvas.addEventListener('pointerenter',()=>activeRow=rowKey);
      canvas.addEventListener('pointerleave',()=>{activeRow=null;});
      canvas.addEventListener('pointerdown',e=>{
        isDragging=true; lastX=e.clientX; lastY=e.clientY;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove',e=>{
        if(isDragging && activeRow===rowKey){
          cameraYaw   += (e.clientX-lastX)*0.01;
          cameraPitch += (e.clientY-lastY)*0.01;
          lastX=e.clientX; lastY=e.clientY;
        }
      });
      canvas.addEventListener('pointerup',()=>isDragging=false);
    }
  }
}

async function setInitialZoom(paths){
  const ply = await loadPLY(paths[Math.floor(paths.length/2)]);
  let maxR = 0;
  for (let i = 0; i < ply.positions.length; i += 3) {
    const x = ply.positions[i], y = ply.positions[i+1], z = ply.positions[i+2];
    maxR = Math.max(maxR, Math.hypot(x, y, z));
  }
  initialCameraZ = cameraZ = -maxR * 2.0;   // back up 2× radius
}

async function loadHouse(house){
  await loadTopRow(house);
  const basePaths = TIMES.map(t=>`./point_clouds/${house}/BASE_${house}_time_${t}.ply`);
  const oursPaths = TIMES.map(t=>`./point_clouds/${house}/OURS_${house}_time_${t}.ply`);
  await setInitialZoom(basePaths);
  await loadRow('B', BASE_ID, basePaths);
  await loadRow('O', OURS_ID, oursPaths);
}

async function loadCoverage(setName){
  const paths = ['BASE','OURS'].map(i=>`./point_clouds/cov10/${setName}/${i}_${setName}.ply`);
  for(let i=0;i<COVER_LEN;i++){
    const ply = await loadPLY(paths[i]);
    const canvas=document.getElementById(COVER_ID[i]);
    const gl=initGL(canvas);
    const v = setupViewer(gl, ply.positions, ply.colors, 6);  // bigger points
    glCtx.C[i]=gl; program.C[i]=v.program; uniLoc.C[i]={mv:v.uMV,p:v.uP}; nPoints.C[i]=ply.positions.length/3;

    if(!canvas.dataset.bound){
      canvas.dataset.bound='1';
      canvas.addEventListener('pointerenter',()=>activeRow='C');
      canvas.addEventListener('pointerleave',()=>{activeRow=null;});
      canvas.addEventListener('pointerdown',e=>{
        isDragging=true;lastX=e.clientX;lastY=e.clientY;
        canvas.setPointerCapture(e.pointerId);});
      canvas.addEventListener('pointermove',e=>{
        if(isDragging && activeRow==='C'){
          cam2Yaw+=(e.clientX-lastX)*0.01;
          cam2Pitch+=(e.clientY-lastY)*0.01;
          lastX=e.clientX;lastY=e.clientY;
        }});
      canvas.addEventListener('pointerup',()=>isDragging=false);
    }
  }
  // set cam2Z based on first coverage cloud
  const ply0 = await loadPLY(paths[0]);
  let maxR = 0;
  for(let i=0;i<ply0.positions.length;i+=3){
    const x=ply0.positions[i], y=ply0.positions[i+1], z=ply0.positions[i+2];
    maxR = Math.max(maxR, Math.hypot(x,y,z));
  }
  cam2Z = -maxR * 2.0;
}

window.addEventListener('wheel', e => {
  if (activeRow==='C') {
    e.preventDefault();
    cam2Z += e.deltaY * 0.01;
    cam2Z = Math.min(cam2Z, -minCameraZ);   // never go past the object
  } else if (activeRow) {
    e.preventDefault();
    cameraZ += e.deltaY * 0.01;
    cameraZ = Math.min(cameraZ, -minCameraZ);   // never go past the object
  }
}, { passive:false });

/* -------------------------------------------------------- */
/*                        RENDER                            */
/* -------------------------------------------------------- */
function render(){
  ['top','B','O','C'].forEach(rowKey=>{
    const ids = rowKey==='C'?COVER_ID:(rowKey==='B'?BASE_ID:(rowKey==='O'?OURS_ID:[TOP_PC_ID]));
    const len = rowKey==='C'?COVER_LEN:(rowKey==='top'?1:GRID_LEN);
    for(let i=0;i<len;i++){
      const gl=glCtx[rowKey][i]; if(!gl) continue;
      const canvas=document.getElementById(ids[i]);
      const dpr=window.devicePixelRatio||1;
      const w=Math.floor(canvas.clientWidth*dpr);
      const h=Math.floor(canvas.clientHeight*dpr);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      const pMat = perspective(45*Math.PI / 180, w / h, 0.05, 1000);
      const mvMat = rowKey==='C'?camera2Matrix():cameraMatrix();
      gl.viewport(0,0,w,h);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program[rowKey][i]);
      gl.uniformMatrix4fv(uniLoc[rowKey][i].p,false,pMat);
      gl.uniformMatrix4fv(uniLoc[rowKey][i].mv,false,mvMat);
      gl.drawArrays(gl.POINTS,0,nPoints[rowKey][i]);
    }
  });
  requestAnimationFrame(render);
}


document.getElementById('reset-view-1')
        .addEventListener('click', () => {
          // Reset the first camera
          cameraYaw = 0;
          cameraPitch = 0;
          cameraZ = initialCameraZ;

          console.log('First camera reset');
        });

document.getElementById('reset-view-2')
        .addEventListener('click', () => {
          // Reset the coverage‑pair camera
          cam2Yaw   = 0;
          cam2Pitch = 0;
          cam2Z     = initialCoverZ;   // use its own baseline

          console.log('Coverage camera reset');
        });

/* mouse‑wheel zoom (only when cursor is in either row) */
window.addEventListener('wheel',e=>{
  if(activeRow==='C'){ e.preventDefault(); cam2Z += e.deltaY*0.01; cam2Z=Math.min(cam2Z,-minCameraZ);}
  else if(activeRow){ e.preventDefault(); cameraZ += e.deltaY*0.01; }
},{passive:false});

/* -------------------------------------------------------- */
/*                        BOOT                              */
/* -------------------------------------------------------- */
document.addEventListener('DOMContentLoaded',()=>{
  /* house‑selection buttons */
  const houseButtons = document.querySelectorAll('.group1-btn');
  houseButtons.forEach(btn=>{
    btn.addEventListener('click', () => {
      /* visual feedback */
      houseButtons.forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');

      /* load the chosen house */
      loadHouse(btn.dataset.house);
    });
  });

  document.querySelectorAll('.coverage-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.coverage-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      loadCoverage(btn.dataset.set);
    });
  });

  loadHouse('h004');   // default house
  loadCoverage('m013'); // default coverage set
  render();
});