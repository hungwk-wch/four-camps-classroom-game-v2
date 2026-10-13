const socket=io();
const TEAM_IMAGES=['assets/team-1.jpeg','assets/team-2.jpeg','assets/team-3.jpeg','assets/team-4.jpeg'];
let roomCode='';let selectedTeam=0;let player=null;let teamNames=['陣營一','陣營二','陣營三','陣營四'];let currentRound=null;let answered=false;let raf=null;let targets=[];let timerInt=null;let latestBoard=null;
const $=s=>document.querySelector(s);const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const params=new URLSearchParams(location.search);if(params.get('room'))$('#roomCode').value=params.get('room').toUpperCase();

function renderTeamChoices(containerId,selectable=true,counts=[]){
  const el=$(containerId);el.innerHTML=teamNames.map((name,i)=>`<div class="team-card ${i===selectedTeam?'selected':''}" data-team="${i}"><img src="${TEAM_IMAGES[i]}"><h4>${esc(name)}</h4><div class="count">${counts[i]??''}${counts[i]!=null?' 人':''}</div></div>`).join('');
  if(selectable) el.querySelectorAll('[data-team]').forEach(card=>card.onclick=()=>{selectedTeam=+card.dataset.team;renderTeamChoices(containerId,true,counts);if(roomCode&&player)socket.emit('student-change-team',{roomCode,team:selectedTeam});});
}
renderTeamChoices('#teamChoices');

$('#joinBtn').onclick=()=>{
  roomCode=$('#roomCode').value.trim().toUpperCase();const name=$('#name').value.trim();$('#joinMsg').textContent='';
  socket.emit('student-join',{roomCode,name,team:selectedTeam},res=>{
    if(!res?.ok){$('#joinMsg').textContent=res?.error||'加入失敗';return}
    player=res.player;teamNames=res.room.teamNames;$('#joinView').classList.add('hidden');$('#lobbyView').classList.remove('hidden');$('#lobbyCode').textContent=roomCode;$('#myLobby').innerHTML=`${esc(player.name)} · ${esc(teamNames[player.team])}`;renderTeamChoices('#lobbyTeams',true,[0,0,0,0]);
  });
};

socket.on('lobby-update',data=>{
  if(data.room.code!==roomCode)return;teamNames=data.room.teamNames;if(player){const me=data.players.find(p=>p.id===socket.id);if(me){player={...player,...me};selectedTeam=me.team;}}
  const counts=[0,0,0,0];data.players.forEach(p=>counts[p.team]++);if(!$('#lobbyView').classList.contains('hidden')){renderTeamChoices('#lobbyTeams',true,counts);$('#myLobby').innerHTML=`${esc(player?.name||'')} · ${esc(teamNames[selectedTeam])}`;}
});

socket.on('game-countdown',({seconds})=>{
  $('#lobbyView').classList.add('hidden');$('#gameView').classList.remove('hidden');showOverlay(`<div class="countdown" id="countNum">${seconds}</div><p>準備！</p>`);let n=seconds;const t=setInterval(()=>{n--;const e=$('#countNum');if(e)e.textContent=n>0?n:'GO!';if(n<=0){clearInterval(t);setTimeout(hideOverlay,450)}},1000);setupMe();
});
function setupMe(){if(!player)return;$('#myName').textContent=player.name;$('#myTeamImg').src=TEAM_IMAGES[selectedTeam];$('#myScore').textContent=player.score||0;}
function showOverlay(html){$('#overlayMain').innerHTML=html;$('#overlay').classList.remove('hidden')}
function hideOverlay(){$('#overlay').classList.add('hidden')}
function clearArena(){if(raf)cancelAnimationFrame(raf);raf=null;targets=[];$('#arena').querySelectorAll('.target').forEach(x=>x.remove());if(timerInt)clearInterval(timerInt);timerInt=null;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function placeTargets(options){
  clearArena();const arena=$('#arena');const rect=arena.getBoundingClientRect();const shuffled=shuffle([...options]);
  targets=shuffled.map((opt,i)=>{const el=document.createElement('button');el.className='target';el.textContent=opt.text;el.dataset.idx=opt.originalIndex;arena.appendChild(el);const w=Math.min(190,Math.max(118,90+opt.text.length*13));el.style.width=w+'px';const h=58;let x=Math.random()*Math.max(20,rect.width-w-20)+10;let y=Math.random()*Math.max(20,rect.height-h-20)+10;let speed=0.55+Math.random()*.75;let angle=Math.random()*Math.PI*2;let vx=Math.cos(angle)*speed,vy=Math.sin(angle)*speed;el.onclick=e=>shoot(el,+el.dataset.idx,e);return {el,x,y,w,h,vx,vy,last:performance.now()};});
  function frame(now){for(const t of targets){const dt=Math.min(32,now-t.last);t.last=now;t.x+=t.vx*dt;t.y+=t.vy*dt;if(t.x<5){t.x=5;t.vx=Math.abs(t.vx)}if(t.x+t.w>arena.clientWidth-5){t.x=arena.clientWidth-t.w-5;t.vx=-Math.abs(t.vx)}if(t.y<5){t.y=5;t.vy=Math.abs(t.vy)}if(t.y+t.h>arena.clientHeight-5){t.y=arena.clientHeight-t.h-5;t.vy=-Math.abs(t.vy)}t.el.style.transform=`translate(${t.x}px,${t.y}px)`;}raf=requestAnimationFrame(frame)}raf=requestAnimationFrame(frame);
}
function shoot(el,idx,e){
  if(answered||!currentRound)return;answered=true;document.querySelectorAll('.target').forEach(x=>x.disabled=true);projectileTo(el);
  socket.emit('student-answer',{roomCode,roundId:currentRound.roundId,originalIndex:idx},res=>{if(!res?.ok){answered=false;return}handleAnswer(res)});
}
function projectileTo(el){const r=el.getBoundingClientRect();const p=document.createElement('div');p.className='projectile';const sx=innerWidth/2,sy=innerHeight-50,tx=r.left+r.width/2,ty=r.top+r.height/2;p.style.left=sx+'px';p.style.top=sy+'px';document.body.appendChild(p);requestAnimationFrame(()=>{p.style.transform=`translate(${tx-sx}px,${ty-sy}px) scale(.5)`;p.style.opacity='.2'});setTimeout(()=>p.remove(),260)}
function handleAnswer(res){const f=$('#flash');f.className='flash '+(res.correct?'good':'bad');setTimeout(()=>f.className='flash',380);$('#myScore').textContent=res.score;$('#myCombo').textContent=res.combo>1?`Combo ×${res.combo}`:'';showOverlay(`<h2>${res.correct?'✅ 答對！':'❌ 答錯'}</h2><p>${res.correct?`+${res.delta} 分`:`正確答案：<b>${esc(res.correctText)}</b>`}</p><p class="muted">等待下一題……</p>`);}

socket.on('question-start',q=>{currentRound=q;answered=false;hideOverlay();$('#roundLabel').textContent=`${q.index+1}/${q.total}`;$('#gameQuestion').textContent=q.prompt;let remaining=q.duration;$('#timer').textContent=remaining;placeTargets(q.options);timerInt=setInterval(()=>{remaining--;$('#timer').textContent=Math.max(0,remaining);if(remaining<=0)clearInterval(timerInt)},1000);});
socket.on('question-finished',q=>{clearArena();if(!answered)showOverlay(`<h2>⏰ 時間到</h2><p>正確答案：<b>${esc(q.correctText)}</b></p><p class="muted">下一題即將開始……</p>`);else {const p=$('#overlayMain p.muted');if(p)p.textContent='下一題即將開始……';}});
socket.on('score-update',board=>{latestBoard=board;const me=board.players.find(p=>p.id===socket.id);if(me){player={...player,...me};selectedTeam=me.team;$('#myScore').textContent=me.score;$('#myCombo').textContent=me.combo>1?`Combo ×${me.combo}`:'';}const team=board.teams.find(t=>t.team===selectedTeam);if(team)$('#teamScore').textContent=`${team.name} ${team.score}`;});
socket.on('game-ended',board=>{clearArena();const teams=[...board.teams].sort((a,b)=>b.score-a.score);const players=board.players.slice(0,8);showOverlay(`<h2>🏆 遊戲完結</h2><p>冠軍陣營：<b>${esc(teams[0]?.name||'')}</b> · ${teams[0]?.score||0} 分</p><table class="rank-table"><thead><tr><th>名次</th><th>學生</th><th>分數</th></tr></thead><tbody>${players.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${p.score}</td></tr>`).join('')}</tbody></table><p class="muted">等待老師開下一局。</p>`);});
socket.on('return-lobby',()=>{clearArena();$('#gameView').classList.add('hidden');$('#lobbyView').classList.remove('hidden');hideOverlay();if(player){player.score=0;player.combo=0;}renderTeamChoices('#lobbyTeams',true,[0,0,0,0]);});
socket.on('room-closed',()=>{clearArena();showOverlay('<h2>房間已關閉</h2><p>老師已離開房間，請重新加入。</p><button class="btn primary" onclick="location.href=\'play.html\'">返回</button>');});
