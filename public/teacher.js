const socket = io();
const TEAM_IMAGES = ['assets/team-1.jpeg','assets/team-2.jpeg','assets/team-3.jpeg','assets/team-4.jpeg'];
let questions = [];
let editIndex = -1;
let roomCode = null;
let teamNames = ['翡翠陣營','金羽陣營','蒼藍陣營','赤金陣營'];
let latestBoard = {teams:[],players:[]};

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function loadLocal(){
  try{ questions = JSON.parse(localStorage.getItem('fourCampsQuestions')||'[]'); }catch{questions=[]}
  try{ const t=JSON.parse(localStorage.getItem('fourCampsTeamNames')||'null'); if(Array.isArray(t)&&t.length===4) teamNames=t; }catch{}
}
function saveLocal(){ localStorage.setItem('fourCampsQuestions',JSON.stringify(questions)); localStorage.setItem('fourCampsTeamNames',JSON.stringify(teamNames)); }

function renderTeams(){
  $('#teamEditor').innerHTML = teamNames.map((name,i)=>`<div class="team-card"><img src="${TEAM_IMAGES[i]}"><div class="field" style="margin:8px 0 0"><input data-teamname="${i}" value="${esc(name)}" maxlength="20" aria-label="陣營名稱"></div></div>`).join('');
  document.querySelectorAll('[data-teamname]').forEach(inp=>inp.addEventListener('input',e=>{teamNames[+e.target.dataset.teamname]=e.target.value;saveLocal();if(roomCode) socket.emit('host-update-teams',{roomCode,teamNames});}));
}
function renderQuestions(){
  $('#qCount').textContent=`(${questions.length})`;
  if(!questions.length){$('#qList').innerHTML='<p class="muted">尚未有題目。按「載入示例」可立即試玩。</p>';return;}
  $('#qList').innerHTML=questions.map((q,i)=>`<div class="q-item"><strong>${i+1}. ${esc(q.prompt)}</strong><div class="answers">${q.options.map((o,idx)=>`<span class="${idx===q.correctIndex?'correct':''}">${String.fromCharCode(65+idx)}. ${esc(o)}</span>`).join('　')}</div><div class="row end" style="margin-top:9px"><span class="muted grow">${q.duration||12} 秒</span><button class="btn small ghost" data-edit="${i}">編輯</button><button class="btn small danger" data-del="${i}">刪除</button></div></div>`).join('');
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>beginEdit(+b.dataset.edit));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{questions.splice(+b.dataset.del,1);saveLocal();renderQuestions();});
}
function clearForm(){
  $('#prompt').value='';[0,1,2,3].forEach(i=>$('#o'+i).value='');$('#correct').value='0';$('#duration').value='12';editIndex=-1;$('#saveQuestion').textContent='新增題目';$('#cancelEdit').classList.add('hidden');$('#editHint').textContent='';
}
function beginEdit(i){
  const q=questions[i];editIndex=i;$('#prompt').value=q.prompt;q.options.forEach((o,j)=>$('#o'+j).value=o);$('#correct').value=String(q.correctIndex);$('#duration').value=String(q.duration||12);$('#saveQuestion').textContent='儲存修改';$('#cancelEdit').classList.remove('hidden');$('#editHint').textContent=`正在編輯第 ${i+1} 題`;window.scrollTo({top:0,behavior:'smooth'});
}
function validateForm(){
  const prompt=$('#prompt').value.trim();const options=[0,1,2,3].map(i=>$('#o'+i).value.trim());
  if(!prompt||options.some(x=>!x)){alert('請輸入題目及四個選項。');return null}
  return {prompt,options,correctIndex:+$('#correct').value,duration:+$('#duration').value};
}
$('#saveQuestion').onclick=()=>{const q=validateForm();if(!q)return;if(editIndex>=0)questions[editIndex]=q;else questions.push(q);saveLocal();renderQuestions();clearForm();};
$('#cancelEdit').onclick=clearForm;
$('#loadSample').onclick=()=>{if(questions.length&&!confirm('這會以示例題目取代目前題庫，繼續嗎？'))return;questions=[
 {prompt:'哪一個詞語表示「重新恢復知覺」？',options:['蘇醒','飛翔','盛滿','伸展'],correctIndex:0,duration:12},
 {prompt:'哪一個詞語最適合形容「身體因冷或緊張而輕微抖動」？',options:['歪倒','顫動','無限','動彈'],correctIndex:1,duration:12},
 {prompt:'「盤古用斧頭＿＿天地」應填上哪個詞語？',options:['滋潤','沉睡','創造','劈開'],correctIndex:3,duration:12},
 {prompt:'哪一個詞語表示「植物生長得繁密旺盛」？',options:['黑暗','茂盛','宇宙','抵禦'],correctIndex:1,duration:12},
 {prompt:'「饒恕」最接近以下哪個意思？',options:['原諒','敬佩','後悔','反抗'],correctIndex:0,duration:12}
];saveLocal();renderQuestions();clearForm();};
$('#clearAll').onclick=()=>{if(confirm('確定清空全部題目？')){questions=[];saveLocal();renderQuestions();clearForm();}};
$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,questions},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='四陣營題庫.json';a.click();URL.revokeObjectURL(a.href);};
$('#importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());const arr=Array.isArray(data)?data:data.questions;if(!Array.isArray(arr))throw 0;questions=arr.filter(q=>q.prompt&&Array.isArray(q.options)&&q.options.length===4).map(q=>({...q,correctIndex:+q.correctIndex,duration:+q.duration||12}));saveLocal();renderQuestions();alert(`已匯入 ${questions.length} 題。`);}catch{alert('檔案格式不正確。')}e.target.value='';};

async function createRoom(){
  if(!questions.length){$('#roomMsg').textContent='請先新增最少一條題目。';return}
  $('#createRoom').disabled=true;$('#roomMsg').textContent='';
  socket.emit('host-create-room',{questions,teamNames},async res=>{
    $('#createRoom').disabled=false;if(!res?.ok){$('#roomMsg').textContent=res?.error||'建立失敗';return}
    roomCode=res.room.code;$('#createRoom').classList.add('hidden');$('#roomArea').classList.remove('hidden');$('#livePanel').classList.remove('hidden');
    const info=await fetch('/api/server-info').then(r=>r.json());
    const protocol=location.protocol==='https:'?'https:':'http:';
    const host=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?info.lanIp:location.host.split(':')[0];
    const port=location.port?`:${location.port}`:(protocol==='http:'&&info.port?`:${info.port}`:'');
    const joinUrl=`${protocol}//${host}${port}/play.html?room=${roomCode}`;
    const qr=await fetch('/api/qr?text='+encodeURIComponent(joinUrl)).then(r=>r.json());
    $('#roomArea').innerHTML=`<div style="height:14px"></div><div class="row" style="align-items:flex-start"><div class="grow"><div class="muted">房間碼</div><div class="room-code">${roomCode}</div><p class="join-url">${esc(joinUrl)}</p><p class="muted">學生掃碼後，輸入姓名並選擇陣營即可。</p></div><img class="qr" src="${qr.dataUrl}" alt="加入遊戲 QR Code"></div>`;
  });
}
$('#createRoom').onclick=createRoom;
$('#syncQuestions').onclick=()=>{if(!roomCode)return;socket.emit('host-update-questions',{roomCode,questions},res=>alert(res?.ok?'已同步最新題目。':res?.error||'同步失敗'));};
$('#resetLobby').onclick=()=>roomCode&&socket.emit('host-reset-lobby',{roomCode});
$('#startGame').onclick=()=>{if(!roomCode)return;socket.emit('host-start-game',{roomCode},res=>{if(!res?.ok)alert(res?.error||'無法開始');});};

function renderBoard(board){
  latestBoard=board||latestBoard;
  const teams=latestBoard.teams||[];const players=latestBoard.players||[];
  $('#scoreTeams').innerHTML=teams.map(t=>`<div class="score-team"><img src="${TEAM_IMAGES[t.team]}"><div>${esc(t.name)}</div><div class="big">${t.score}</div><div class="muted">${t.players} 人</div></div>`).join('');
  $('#playerCount').textContent=`(${players.length}/30)`;
  $('#playerList').innerHTML=players.length?players.map(p=>`<div class="player-chip"><b>${esc(p.name)}</b><span>${esc(teamNames[p.team]||'')} · ${p.score}分</span></div>`).join(''):'<p class="muted">等待學生加入……</p>';
}
socket.on('lobby-update',data=>{if(data.room.code!==roomCode)return;renderBoard({teams:data.teams,players:data.players});$('#statusPill').textContent=data.room.status==='lobby'?'等待加入':data.room.status;});
socket.on('game-countdown',()=>{$('#statusPill').textContent='即將開始';$('#nowQuestion').innerHTML='<h3>3 秒後開始</h3><p class="muted">學生裝置已進入倒數。</p>';$('#startGame').disabled=true;});
socket.on('question-start',q=>{$('#statusPill').textContent=`第 ${q.index+1}/${q.total} 題`;$('#nowQuestion').innerHTML=`<h3>${esc(q.prompt)}</h3><p class="muted">作答時間 ${q.duration} 秒</p>`;$('#progress').textContent='已作答 0 人';});
socket.on('answer-progress',p=>{$('#progress').textContent=`已作答 ${p.answered}/${p.total} 人`;});
socket.on('score-update',renderBoard);
socket.on('question-finished',q=>{$('#nowQuestion').innerHTML+=`<p class="success">正確答案：${esc(q.correctText)}</p>`;});
socket.on('game-ended',board=>{renderBoard(board);$('#statusPill').textContent='遊戲完結';$('#startGame').disabled=false;const top=board.players?.[0];$('#nowQuestion').innerHTML=`<h3>🏆 遊戲完結</h3><p>${top?`個人第一名：<b>${esc(top.name)}</b>（${top.score} 分）`:'完成'}</p><p class="muted">按「回到大堂」可再玩一局；你亦可先修改題目再同步。</p>`;});
socket.on('return-lobby',()=>{$('#statusPill').textContent='等待加入';$('#startGame').disabled=false;$('#nowQuestion').innerHTML='<h3>等待開始</h3><p class="muted">你可以修改題目，然後按「同步最新題目」。</p>';$('#progress').textContent='';});
socket.on('room-closed',()=>location.reload());

loadLocal();renderTeams();renderQuestions();renderBoard({teams:teamNames.map((name,team)=>({team,name,score:0,players:0})),players:[]});
