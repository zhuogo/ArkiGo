'use strict';
(() => {
  const $=(id)=>document.getElementById(id);
  const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const moduleMark=()=>{const el=make('span','module-mark');el.setAttribute('aria-hidden','true');return el;};
  const button=(text,action,className='btn')=>{const b=make('button',className,text);b.type='button';b.addEventListener('click',action);return b;};
  const svg=(tag)=>document.createElementNS('http://www.w3.org/2000/svg',tag);
  const viewport=$('viewport'),world=$('world'),announce=(text)=>{$('announcement').textContent=text;};
  // Keyboard actions stay immediate; pointer feedback is limited to occasional surfaces.
  const inputMode=(mode)=>{if(document.documentElement.dataset.input!==mode)document.documentElement.dataset.input=mode;};
  document.addEventListener('pointerdown',()=>inputMode('pointer'),true);
  document.addEventListener('keydown',()=>inputMode('keyboard'),true);
  let feedbackTimer;
  function feedback(message,tone='success',immediate=false){
    clearTimeout(feedbackTimer);$('feedback').dataset.tone=tone;$('feedback').dataset.immediate=String(immediate);
    $('feedback-symbol').textContent=tone==='success'?'✓':'!';$('feedback-message').textContent=message;$('feedback').hidden=false;
    announce(message);feedbackTimer=setTimeout(()=>{$('feedback').hidden=true;},3000);
  }
  const systemTheme=matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme=()=>document.documentElement.dataset.theme??(systemTheme.matches?'dark':'light');
  function syncTheme(){const label=effectiveTheme()==='dark'?'切换到浅色':'切换到深色';$('theme-toggle').setAttribute('aria-label',label);$('theme-toggle').title=label;}
  $('theme-toggle').onclick=()=>{const next=effectiveTheme()==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('arkigo-theme',next);}catch{}syncTheme();announce(next==='dark'?'已切换为深色':'已切换为浅色');};
  systemTheme.addEventListener('change',syncTheme);syncTheme();
  try {
    const payload=JSON.parse($('arkigo-data').textContent),data=payload.document;
    const views=structuredClone(data.views),viewById=new Map(views.map(v=>[v.id,v]));
    const hierarchy=buildHierarchy(data),trail=[];
    const cameraLimits={min:.005,max:32};
    let transitioning=false,transitionCancel=null,autoLockUntil=0,entryScale=1,navigationCause='initial';
    let lastViewport={width:viewport.clientWidth,height:viewport.clientHeight};
    const wheelGesture={last:0,used:false,camera:null};
    const activeTouches=new Map();let touchGestureCamera=null,touchSemanticUsed=false,suppressNodeClickUntil=0;
    const originals=new Map(views.map(v=>[v.id,new Map(v.nodes.map(n=>[n.id,{x:n.x,y:n.y}]))]));
    const statusNames={proposed:'待审阅',accepted:'设计已接受',retired:'已退役'};
    const originNames={user:'用户表达',ai:'AI 建议',code:'代码观察',import:'导入资料',example:'演示数据'};
    const fieldNames={action:'执行动作',inputs:'输入',outputs:'输出',failureHandling:'异常处理',when:'触发 / 适用条件',constraint:'约束',exceptions:'例外',rationale:'依据',given:'给定条件',then:'预期结果',question:'待决定的问题',options:'可选方案',blocks:'影响范围',responsibilities:'职责',boundaries:'边界',trigger:'触发条件',preconditions:'前置条件',startStepId:'起点',terminalStepIds:'终点'};
    const edgeStyle=(kind)=>['feedback','verifies','questions'].includes(kind)?'feedback':['support','structure','governed_by','depends_on'].includes(kind)?'support':'normal';
    let current=null,byId=new Map(),elements=new Map(),edgeElements=new Map(),bounds,camera={x:0,y:0,k:1},selected=null,drag=null,pan=null,pinch=null,frame=0;
    const pointers=new Map();let storageAvailable=true,lastSaveNotice;
    const storageKey=`arkigo-canvas-v1:${data.id}`;
    const layoutRevision=JSON.stringify([data.revision,views.map(v=>[v.id,v.nodes.map(n=>[n.id,n.x,n.y,n.width,n.height])])]);
    function safePosition(node,x,y,view) {
      const zone=view.zones.find(z=>z.id===node.zoneId);
      return zone?{x:clamp(x,zone.x+12,zone.x+zone.width-widthOf(node)-12),y:clamp(y,zone.y+38,zone.y+zone.height-heightOf(node)-12)}
        :{x:clamp(x,20,20000),y:clamp(y,112,20000)};
    }
    try {
      const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
      if(saved?.revision===layoutRevision)for(const view of views)for(const item of saved.views?.find(v=>v.id===view.id)?.nodes??[]) {
        const n=view.nodes.find(n=>n.id===item.id);if(n&&Number.isFinite(item.x)&&Number.isFinite(item.y))Object.assign(n,safePosition(n,item.x,item.y,view));
      }
    } catch {storageAvailable=false;}
    const layoutData=()=>({schemaVersion:'arkigo-layout/1',documentId:data.id,revision:data.revision,views:views.map(v=>({id:v.id,nodes:v.nodes.map(({id,x,y})=>({id,x,y}))}))});
    function save() {
      try{localStorage.setItem(storageKey,JSON.stringify({revision:layoutRevision,views:layoutData().views}));storageAvailable=true;}catch{storageAvailable=false;}
      $('storage-state').textContent=storageAvailable?'布局已保存在此浏览器；设计内容未改动。':'当前浏览器无法保存布局，可使用“导出布局”。';
    }
    function applyCamera() {
      world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.k})`;
      $('zoom-value').textContent=Math.round(camera.k*100)+'%';$('zoom-out').disabled=camera.k<=cameraLimits.min&&!trail.length;$('zoom-in').disabled=camera.k>=cameraLimits.max;
      // Keep the subtle screen grid steady; camera movement only transforms the graph.
    }
    const usableViewport=()=>({x:0,y:0,width:viewport.clientWidth,height:Math.max(100,viewport.clientHeight-86)});
    const sceneCamera=(view)=>fitViewCamera(boundsOf(view),usableViewport());
    function fit(){finishTransition();bounds=boundsOf(current);camera=sceneCamera(current);applyCamera();}
    function zoom(factor,point,source='button'){
      if(transitioning){if(source==='wheel'||source==='pinch')return false;finishTransition();}
      const before={...camera},node=byId.get(selected),area=usableViewport();
      point??=node?.targetViewId&&factor>1?{x:(node.x+widthOf(node)/2)*camera.k+camera.x,y:(node.y+heightOf(node)/2)*camera.k+camera.y}:{x:area.width/2,y:area.height/2};
      if(node?.targetViewId&&!$('detail').hidden)closeDetail(false);
      camera=zoomCamera(camera,factor,point,cameraLimits);applyCamera();
      return source!=='programmatic'&&navigateFromZoom(factor>1?'in':'out',point,source,before);
    }
    function focusNode(id) {
      const n=byId.get(id);if(!n)return;const w=viewport.clientWidth,h=viewport.clientHeight;
      const available=w<760?w:Math.max(300,w-430);
      const k=clamp(Math.min(1.12,(available-55)/widthOf(n)),.45,1.12);
      const cx=w<760?w/2:(w-390)/2,cy=w<760?Math.max(110,(h-270)/2):(h-65)/2;
      camera={k,x:cx-(n.x+widthOf(n)/2)*k,y:cy-(n.y+heightOf(n)/2)*k};applyCamera();
    }
    function paintSelection() {
      const related=new Set();for(const edge of current.edges)if(edge.from===selected||edge.to===selected){related.add(edge.from);related.add(edge.to);}
      for(const n of current.nodes){const el=elements.get(n.id);el.classList.toggle('selected',n.id===selected);el.classList.toggle('related-node',related.has(n.id));el.setAttribute('aria-pressed',String(n.id===selected));}
      for(const edge of current.edges){const related=edge.from===selected||edge.to===selected,pair=edgeElements.get(edge.id);pair.path.classList.toggle('related',related);pair.label.classList.toggle('related',related);}
      syncModuleActions();
    }
    function closeDetail(restore=true){$('detail').hidden=true;syncModuleActions();if(restore)(elements.get(selected)??viewport).focus({preventScroll:true});}
    function closeDirectory(restore=true){$('directory').hidden=true;$('directory-open').setAttribute('aria-expanded','false');syncModuleActions();if(restore)$('directory-open').focus();}
    function showDetails(n) {
      closeDirectory(false);$('detail').hidden=false;$('detail-body').scrollTop=0;
      $('detail-tag').textContent=[n.kind,originNames[n.sourceOrigin],statusNames[n.designStatus]].filter(Boolean).join(' · ');
      $('detail-title').textContent=n.title;$('detail-summary').textContent=n.summary;$('detail-actions').replaceChildren();
      if(n.targetViewId)$('detail-actions').append(button('进入 '+viewById.get(n.targetViewId).title+' →',()=>enterModule(n.id),'btn primary'));
      else if(['模块','module','系统','system'].includes(n.kind))$('detail-actions').append(make('p','panel-note','尚未设计内部结构。'));
      $('detail-fields').replaceChildren();
      for(const [name,value]of Object.entries(n.details)) {
        const block=make('div','detail-block');block.append(make('h3','',fieldNames[name]??name));
        if(Array.isArray(value)){const list=make('ul');for(const text of value)list.append(make('li','',byId.get(text)?.title??text));if(!value.length)block.append(make('p','','未列出'));else block.append(list);}
        else block.append(make('p','',byId.get(value)?.title??value));$('detail-fields').append(block);
      }
      const relations=$('detail-relations');relations.replaceChildren();
      for(const edge of current.edges.filter(e=>e.from===n.id||e.to===n.id)) {
        const forward=edge.from===n.id,other=byId.get(forward?edge.to:edge.from);
        const b=button((forward?'→ ':'← ')+other.title,()=>{select(other.id,true);focusNode(other.id);},'relation-button');b.append(make('small','',edge.label||edge.kind));relations.append(b);
      }
      if(!relations.children.length)relations.append(make('p','notice','没有已声明的关系。'));
      $('detail-sources').replaceChildren(...(n.sources.length?n.sources:['未附来源']).map(text=>make('code','source',text)));
      $('detail-id').textContent=`对象 ID：${n.id} · ${data.revision}`;syncModuleActions();$('detail-close').focus({preventScroll:true});
    }
    function select(id,open=false){const n=byId.get(id);if(!n)return;selected=id;paintSelection();if(open)showDetails(n);announce('已选择：'+n.title+(n.targetViewId?'，可放大或进入模块。':''));}

    function syncModuleActions(){
      const node=byId.get(selected),visible=Boolean(node?.targetViewId)&&$('detail').hidden&&$('directory').hidden&&!transitioning;
      $('module-actions').hidden=!visible;document.body.classList.toggle('module-selected',visible);if(visible)$('module-name').textContent=node.title;
    }
    function drawBreadcrumbs(){
      const path=hierarchy.pathTo(current.id),nav=$('breadcrumbs');nav.replaceChildren();
      path.forEach((item,index)=>{
        if(index)nav.append(make('span','crumb-separator','/'));
        const title=index===0?data.title:viewById.get(item.viewId).title;
        const el=index===path.length-1?make('span','crumb current',title):button(title,()=>goBack(item.viewId),'crumb');
        el.dataset.viewId=item.viewId;el.title=title;if(index===path.length-1)el.setAttribute('aria-current','location');nav.append(el);
      });
      nav.scrollLeft=nav.scrollWidth;
    }
    const transformOf=(c)=>`translate(${c.x}px,${c.y}px) scale(${c.k})`;
    const rebaseCamera=(c,oldSize)=>({...c,x:c.x+(viewport.clientWidth-oldSize.width)/2,y:c.y+(viewport.clientHeight-oldSize.height)/2});
    function finishTransition(){if(transitionCancel)transitionCancel();}
    function snapshotScene(){
      const ghost=world.cloneNode(true);ghost.removeAttribute('id');for(const el of ghost.querySelectorAll('[id]'))el.removeAttribute('id');
      ghost.classList.add('scene-ghost');ghost.inert=true;ghost.setAttribute('aria-hidden','true');viewport.append(ghost);return ghost;
    }
    // A child's content starts (or ends) inside its owner's card in parent coordinates.
    function cameraInsideNode(child,node,parentCamera){
      const box=boundsOf(child),scale=Math.min((widthOf(node)-16)/box.width,(heightOf(node)-16)/box.height),k=parentCamera.k*scale;
      return{k,x:parentCamera.x+(node.x+widthOf(node)/2)*parentCamera.k-(box.x+box.width/2)*k,
        y:parentCamera.y+(node.y+heightOf(node)/2)*parentCamera.k-(box.y+box.height/2)*k};
    }
    function animateLevel(ghost,from,to,entering){
      if(document.documentElement.dataset.input==='keyboard'||matchMedia('(prefers-reduced-motion: reduce)').matches){ghost.remove();return;}
      transitioning=true;viewport.classList.add('level-transition');syncModuleActions();
      // Hold both layers until the whole transition ends. An earlier fade must
      // never restore the outgoing scene's default opacity for its last frames.
      const timing={duration:230,easing:'cubic-bezier(.23,1,.32,1)',fill:'both'},animations=[];
      if(entering){
        animations.push(world.animate([{transform:transformOf(from),opacity:.12},{transform:transformOf(to),opacity:1}],timing));
        animations.push(ghost.animate([{opacity:1},{opacity:0}],{...timing,duration:200}));
      }else{
        animations.push(ghost.animate([{transform:transformOf(from),opacity:1},{transform:transformOf(to),opacity:0}],timing));
        animations.push(world.animate([{opacity:.12},{opacity:1}],timing));
      }
      let finished=false;
      const done=()=>{if(finished)return;finished=true;ghost.remove();for(const animation of animations)animation.cancel();viewport.classList.remove('level-transition');transitioning=false;transitionCancel=null;syncModuleActions();};
      transitionCancel=done;Promise.all(animations.map(a=>a.finished.catch(()=>{}))).then(done);
    }
    function writeLocation(id,replace=false){try{history[replace?'replaceState':'pushState'](null,'','#'+encodeURIComponent(id));}catch{}}
    function markNavigation(source){
      navigationCause=source;autoLockUntil=performance.now()+280;
      wheelGesture.used=true;wheelGesture.last=performance.now();
      if(activeTouches.size)touchSemanticUsed=true;
    }
    function enterModule(id,{source='click',restoreCamera=null}={}){
      const node=byId.get(id);if(!node?.targetViewId)return false;finishTransition();
      const child=viewById.get(node.targetViewId),ghost=snapshotScene(),start=cameraInsideNode(child,node,camera);
      trail.push({viewId:current.id,nodeId:node.id,childId:child.id,camera:{...(restoreCamera??camera)},viewport:{width:viewport.clientWidth,height:viewport.clientHeight}});
      renderView(child.id,sceneCamera(child));markNavigation(source);writeLocation(child.id);animateLevel(ghost,start,camera,true);viewport.focus({preventScroll:true});return true;
    }
    function goBack(targetId=null,{source='back',write=true}={}){
      if(!trail.length)return false;finishTransition();
      const index=targetId?trail.findIndex(item=>item.viewId===targetId):trail.length-1;if(index<0)return false;
      const frame=trail[index],parent=viewById.get(frame.viewId),node=parent.nodes.find(n=>n.id===frame.nodeId),child=current;
      const ghost=snapshotScene(),start={...camera},destination=rebaseCamera(frame.camera,frame.viewport),end=cameraInsideNode(child,node,destination);
      trail.splice(index);renderView(parent.id,destination,node.id);markNavigation(source);if(write)writeLocation(parent.id);
      animateLevel(ghost,start,end,false);(elements.get(node.id)??viewport).focus({preventScroll:true});return true;
    }
    function navigateFromZoom(direction,anchor,source,before){
      if(drag||transitioning||performance.now()<autoLockUntil)return false;
      if(source==='wheel'&&wheelGesture.used||source==='pinch'&&touchSemanticUsed)return false;
      if(direction==='out'&&trail.length&&camera.k<=entryScale*.62)return goBack(null,{source});
      const node=byId.get(selected);if(direction!=='in'||!node?.targetViewId)return false;
      const projected=moduleProjection(node,camera,usableViewport());
      const near=anchor.x>=projected.x-32&&anchor.x<=projected.x+projected.width+32&&anchor.y>=projected.y-32&&anchor.y<=projected.y+projected.height+32;
      if(!near||!shouldEnterModule(node,camera,usableViewport(),{direction,deliberate:true}))return false;
      return enterModule(node.id,{source,restoreCamera:source==='wheel'?wheelGesture.camera:source==='pinch'?touchGestureCamera:before});
    }
    function drawEdges() {
      frame=0;const occupied=[];let fallbackCount=0;
      // Labels are static per view. Batch their measurements before writing SVG paths.
      for(const pair of edgeElements.values())pair.labelWidth??=pair.label.getBBox().width||1;
      for(const edge of current.edges) {
        const {points,fallback}=routeEdge(edge,current.nodes),pair=edgeElements.get(edge.id);
        pair.path.setAttribute('d',roundedPath(points));pair.path.classList.toggle('fallback',fallback);fallbackCount+=Number(fallback);
        const label=placeLabel(points,pair.labelWidth,15,current.nodes,occupied);
        pair.label.setAttribute('x',label.x);pair.label.setAttribute('y',label.y+12);if(edge.label)occupied.push(label);
      }
      $('hint').textContent=fallbackCount?`${fallbackCount} 条连线端口受阻，已用虚线标记；可移开重叠节点。`:'选中模块后放大进入 · '+(trail.length?'缩小返回上层 · ':'')+'拖动空白平移';
    }
    const requestEdges=()=>{if(!frame)frame=requestAnimationFrame(drawEdges);};
    function drawDirectory() {
      const query=$('search').value.trim().toLocaleLowerCase(),list=$('directory-list');list.replaceChildren();
      for(const n of current.nodes)if([n.title,n.summary,n.kind,...n.sources].join(' ').toLocaleLowerCase().includes(query)) {
        const b=button('',()=>{select(n.id,true);focusNode(n.id);},'');b.append(make('span','directory-name',n.title));
        b.title=n.title;b.classList.toggle('current',n.id===selected);if(n.targetViewId)b.append(moduleMark());list.append(b);
      }
      $('search-empty').hidden=list.children.length>0;
      $('directory-count').textContent=query?`${list.children.length} / ${current.nodes.length}`:String(current.nodes.length);
      $('directory-context').textContent='当前模块 · '+current.title;
    }
    function nodeElement(n,index) {
      const el=button('',(event)=>{
        if(!el.dataset.moved&&performance.now()>=suppressNodeClickUntil){
          wheelGesture.last=0;wheelGesture.used=false;
          const already=selected===n.id;select(n.id,!n.targetViewId);
          if(n.targetViewId&&already&&event.detail===0)enterModule(n.id,{source:'keyboard'});
        }delete el.dataset.moved;
      },'node');
      el.dataset.id=n.id;el.dataset.kind=n.kind;el.dataset.origin=n.sourceOrigin??'';el.dataset.status=n.designStatus??'';
      Object.assign(el.style,{left:n.x+'px',top:n.y+'px',width:widthOf(n)+'px',height:heightOf(n)+'px'});
      el.setAttribute('aria-label',n.title+' · '+n.kind+(n.targetViewId?'，选中后可进入内部':''));el.setAttribute('aria-pressed','false');el.title=n.title;
      const kicker=make('div','node-kicker'),kind=make('span');kind.append(make('i'),document.createTextNode(n.kind));kicker.append(kind,make('small','',String(index+1).padStart(2,'0')));
      el.append(kicker,make('h3','',n.title),make('p','',n.summary));
      if(n.targetViewId)el.append(moduleMark());else el.append(make('span','node-footer',n.sources[0]??n.id));
      el.dataset.module=String(Boolean(n.targetViewId));
      el.addEventListener('dblclick',()=>{if(n.targetViewId&&performance.now()>=suppressNodeClickUntil)enterModule(n.id);});
      el.addEventListener('pointerdown',(event)=>{
        if(event.button!==0||drag||pointers.size)return;event.preventDefault();event.stopPropagation();el.focus({preventScroll:true});
        finishTransition();
        delete el.dataset.moved;drag={pointerId:event.pointerId,node:n,element:el,sx:event.clientX,sy:event.clientY,x:n.x,y:n.y,moved:false};el.setPointerCapture(event.pointerId);
      });
      el.addEventListener('pointermove',(event)=>{
        if(!drag||event.pointerId!==drag.pointerId)return;const dx=event.clientX-drag.sx,dy=event.clientY-drag.sy;if(Math.hypot(dx,dy)>5)drag.moved=true;if(!drag.moved)return;el.classList.add('dragging');
        Object.assign(n,safePosition(n,drag.x+dx/camera.k,drag.y+dy/camera.k,current));el.style.transform=`translate(${n.x-drag.x}px,${n.y-drag.y}px)`;requestEdges();
      });
      const end=(event)=>{
        if(!drag||drag.pointerId!==event.pointerId)return;
        const cancelled=event.type!=='pointerup';
        if(drag.moved||cancelled)el.dataset.moved='true';
        const moved=drag.moved,overlap=moved&&current.nodes.some(other=>other!==n&&n.x<other.x+widthOf(other)&&n.x+widthOf(n)>other.x&&n.y<other.y+heightOf(other)&&n.y+heightOf(n)>other.y);
        if(overlap||cancelled){n.x=drag.x;n.y=drag.y;}
        el.style.left=n.x+'px';el.style.top=n.y+'px';el.style.transform='';el.classList.remove('dragging');drag=null;
        if(moved)drawEdges();
        if(moved&&!cancelled){save();if(overlap){const message='位置与其他节点重叠，已恢复拖动前的位置。';$('storage-state').textContent=message;feedback(message,'notice',true);}
          else if(lastSaveNotice!==storageAvailable){feedback(storageAvailable?'布局已自动保存':'无法在此浏览器保存，请导出布局。',storageAvailable?'success':'notice',true);lastSaveNotice=storageAvailable;}}
      };
      for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,end);return el;
    }
    function renderView(id,destination=null,selection=null) {
      const next=viewById.get(id);if(!next)return;
      if(drag){Object.assign(drag.node,{x:drag.x,y:drag.y});drag.element.style.transform='';drag.element.classList.remove('dragging');drag=null;}pointers.clear();pan=null;pinch=null;viewport.classList.remove('panning');
      if(frame){cancelAnimationFrame(frame);frame=0;}closeDetail(false);closeDirectory(false);selected=null;current=next;
      byId=new Map(current.nodes.map(n=>[n.id,n]));elements=new Map();edgeElements=new Map();
      $('view-title').textContent=current.title;$('view-subtitle').textContent=current.subtitle;$('zones').replaceChildren();$('nodes').replaceChildren();$('edge-paths').replaceChildren();$('edge-labels').replaceChildren();
      for(const zone of current.zones){const el=make('div','zone');Object.assign(el.style,{left:zone.x+'px',top:zone.y+'px',width:zone.width+'px',height:zone.height+'px'});el.append(make('span','zone-label',zone.title));$('zones').append(el);}
      current.nodes.forEach((n,index)=>{const el=nodeElement(n,index);elements.set(n.id,el);$('nodes').append(el);});
      for(const edge of current.edges){const path=svg('path'),label=svg('text');path.setAttribute('class','edge');path.dataset.style=edgeStyle(edge.kind);path.dataset.edgeId=edge.id;label.setAttribute('class','edge-label');label.textContent=edge.label;$('edge-paths').append(path);$('edge-labels').append(label);edgeElements.set(edge.id,{path,label});}
      bounds=boundsOf(current);Object.assign(world.style,{width:bounds.width+'px',height:bounds.height+'px'});$('edges').setAttribute('width',bounds.width);$('edges').setAttribute('height',bounds.height);
      drawBreadcrumbs();
      $('legend').replaceChildren();for(const [style,title]of [['normal','调用 / 流转'],['support','依赖 / 归属 / 约束'],['feedback','反馈 / 验收 / 待决策']])if(current.edges.some(e=>edgeStyle(e.kind)===style)){const item=make('span');item.append(make('i',style),document.createTextNode(title));$('legend').append(item);}
      $('search').value='';drawDirectory();drawEdges();
      camera=destination??sceneCamera(current);entryScale=sceneCamera(current).k;selected=byId.has(selection)?selection:null;applyCamera();paintSelection();
      announce('当前模块：'+current.title);
    }
    const point=(event)=>{const rect=viewport.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top};};
    let touchWasPinch=false;
    function cancelNodeDrag(){
      if(!drag)return;const previous=drag;drag=null;
      Object.assign(previous.node,{x:previous.x,y:previous.y});previous.element.style.transform='';previous.element.classList.remove('dragging');
      previous.element.dataset.moved='true';if(previous.element.hasPointerCapture(previous.pointerId))previous.element.releasePointerCapture(previous.pointerId);
      requestEdges();
    }
    // Capture touch pointers at document level so a pinch may begin on a draggable card.
    document.addEventListener('pointerdown',(event)=>{
      if(event.pointerType!=='touch'||!viewport.contains(event.target))return;
      activeTouches.set(event.pointerId,point(event));
      if(activeTouches.size===1){touchGestureCamera={...camera};touchSemanticUsed=false;touchWasPinch=false;}
      if(activeTouches.size<2)return;
      finishTransition();cancelNodeDrag();touchWasPinch=true;suppressNodeClickUntil=performance.now()+500;
      const[a,b]=[...activeTouches.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2};pan=null;
      viewport.classList.add('panning');event.preventDefault();event.stopPropagation();
    },{capture:true,passive:false});
    document.addEventListener('pointermove',(event)=>{
      if(!activeTouches.has(event.pointerId))return;activeTouches.set(event.pointerId,point(event));
      if(!touchWasPinch)return;event.preventDefault();event.stopPropagation();
      if(activeTouches.size!==2||touchSemanticUsed)return;
      const[a,b]=[...activeTouches.values()],next={distance:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if(pinch?.distance){const previous=pinch,changed=zoom(next.distance/previous.distance,previous,'pinch');
        if(!changed){camera.x+=next.x-previous.x;camera.y+=next.y-previous.y;applyCamera();}}
      if(!touchSemanticUsed)pinch=next;
    },{capture:true,passive:false});
    const endTouch=(event)=>{
      if(!activeTouches.has(event.pointerId))return;activeTouches.delete(event.pointerId);
      if(touchWasPinch){event.preventDefault();event.stopPropagation();pointers.clear();pan=null;pinch=null;viewport.classList.remove('panning');suppressNodeClickUntil=performance.now()+320;}
      if(!activeTouches.size){touchWasPinch=false;touchSemanticUsed=false;touchGestureCamera=null;}
    };
    document.addEventListener('pointerup',endTouch,{capture:true,passive:false});
    document.addEventListener('pointercancel',endTouch,{capture:true,passive:false});
    viewport.addEventListener('pointerdown',(event)=>{
      if(event.target.closest('.node')||event.button!==0||drag||touchWasPinch)return;
      finishTransition();event.preventDefault();viewport.focus({preventScroll:true});pointers.set(event.pointerId,point(event));viewport.setPointerCapture(event.pointerId);viewport.classList.add('panning');pan=point(event);
    });
    viewport.addEventListener('pointermove',(event)=>{
      if(!pointers.has(event.pointerId)||touchWasPinch)return;const p=point(event);pointers.set(event.pointerId,p);
      if(pan){camera.x+=p.x-pan.x;camera.y+=p.y-pan.y;pan=p;applyCamera();}
    });
    const endPan=(event)=>{if(touchWasPinch)return;pointers.delete(event.pointerId);pan=null;if(!pointers.size)viewport.classList.remove('panning');};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(type,endPan);
    viewport.addEventListener('wheel',(event)=>{
      event.preventDefault();const now=performance.now();
      if(now-wheelGesture.last>200){wheelGesture.used=false;wheelGesture.camera={...camera};}wheelGesture.last=now;
      if(wheelGesture.used||transitioning)return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1);
      if(delta)zoom(Math.exp(-clamp(delta,-120,120)*.0025),point(event),'wheel');
    },{passive:false});
    viewport.addEventListener('keydown',(event)=>{
      if(event.target!==viewport)return;let handled=true;
      if(['+','='].includes(event.key))zoom(1.2,undefined,'keyboard');else if(event.key==='-')zoom(1/1.2,undefined,'keyboard');else if(event.key==='Enter'&&byId.get(selected)?.targetViewId)enterModule(selected,{source:'keyboard'});else if(event.key==='0')fit();else if(event.key==='ArrowLeft'&&!event.altKey)camera.x+=45;else if(event.key==='ArrowRight')camera.x-=45;else if(event.key==='ArrowUp')camera.y+=45;else if(event.key==='ArrowDown')camera.y-=45;else handled=false;
      if(handled){event.preventDefault();applyCamera();}
    });
    $('zoom-in').onclick=()=>zoom(1.2);$('zoom-out').onclick=()=>zoom(1/1.2);$('actual').onclick=()=>zoom(1/camera.k,undefined,'programmatic');$('fit').onclick=fit;
    $('enter-module').onclick=()=>enterModule(selected);$('inspect-module').onclick=()=>{const n=byId.get(selected);if(n)showDetails(n);};
    $('reset').onclick=()=>{for(const n of current.nodes){Object.assign(n,originals.get(current.id).get(n.id));const el=elements.get(n.id);el.style.left=n.x+'px';el.style.top=n.y+'px';}save();drawEdges();fit();feedback(storageAvailable?'已重置当前视图布局':'已重置布局；此浏览器无法保存。',storageAvailable?'success':'notice');};
    $('directory-open').onclick=()=>{const open=$('directory').hidden;if(open){closeDetail(false);drawDirectory();$('directory').hidden=false;$('directory-open').setAttribute('aria-expanded','true');syncModuleActions();$('search').focus();}else closeDirectory();};
    $('directory-close').onclick=()=>closeDirectory();$('detail-close').onclick=()=>closeDetail();$('search').addEventListener('input',drawDirectory);$('search-clear').onclick=()=>{$('search').value='';drawDirectory();$('search').focus();};
    document.addEventListener('keydown',(event)=>{
      const editing=event.target.closest('input,textarea,select,[contenteditable=true]');
      if(event.altKey&&event.key==='ArrowLeft'&&!editing){event.preventDefault();goBack(null,{source:'keyboard'});return;}
      if(event.key!=='Escape')return;event.preventDefault();
      const hadPanel=!$('detail').hidden||!$('directory').hidden;
      closeDetail(false);closeDirectory(false);
      if(!hadPanel&&!editing)goBack(null,{source:'keyboard'});else viewport.focus({preventScroll:true});
    });
    const exportLayout=()=>{const blob=new Blob([JSON.stringify(layoutData(),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=make('a');link.href=url;link.download=data.id+'.layout.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('布局已准备下载');};
    $('directory-export').onclick=exportLayout;
    $('document-title').textContent=data.title;$('document-title').title=data.title;document.title=data.title+' · ArkiGo';$('scope-note').textContent=data.description;
    let resizeFrame;new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
      const nextSize={width:viewport.clientWidth,height:viewport.clientHeight};if(nextSize.width===lastViewport.width&&nextSize.height===lastViewport.height)return;
      finishTransition();camera=rebaseCamera(camera,lastViewport);lastViewport=nextSize;entryScale=sceneCamera(current).k;
      applyCamera();
    });}).observe(viewport);
    function openPath(id){
      if(!viewById.has(id))id=hierarchy.rootId;finishTransition();trail.length=0;
      const path=hierarchy.pathTo(id);
      for(let i=0;i<path.length-1;i++){const parent=viewById.get(path[i].viewId);trail.push({viewId:parent.id,nodeId:path[i+1].viaNodeId,childId:path[i+1].viewId,camera:sceneCamera(parent),viewport:{width:viewport.clientWidth,height:viewport.clientHeight}});}
      renderView(id);autoLockUntil=performance.now()+280;navigationCause='link';
    }
    function readHash(){let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{id=hierarchy.rootId;}id=viewById.has(id)?id:hierarchy.rootId;
      if(current?.id===id)return;if(trail.some(item=>item.viewId===id))goBack(id,{source:'history',write:false});else openPath(id);
    }
    readHash();writeLocation(current.id,true);window.addEventListener('hashchange',readHash);$('load-state').hidden=true;
    if(!storageAvailable)$('storage-state').textContent='当前浏览器无法保存布局，可使用“导出布局”。';
    window.arkigoCanvas={getState:()=>structuredClone({viewId:current.id,selected,camera,layout:layoutData(),path:hierarchy.pathTo(current.id),depth:trail.length,transitioning,entryScale,navigationCause,trail}),engineVersion:2};
  } catch(error){viewport.classList.add('fatal');$('load-state').hidden=false;$('load-title').textContent='架构图暂时无法显示';$('load-message').textContent=error.message;}
})();
