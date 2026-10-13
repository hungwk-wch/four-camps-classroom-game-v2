const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.status(200).send('ok'));

const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeRoomCode() : code;
}

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    teamNames: room.teamNames,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    currentIndex: room.currentIndex,
    questionCount: room.questions.length
  };
}

function scoreboard(room) {
  const teams = [0,1,2,3].map(i => ({
    team: i,
    name: room.teamNames[i],
    score: 0,
    players: 0
  }));
  const players = [];
  room.players.forEach(p => {
    teams[p.team].score += p.score;
    teams[p.team].players += 1;
    players.push({ id: p.id, name: p.name, team: p.team, score: p.score, combo: p.combo });
  });
  players.sort((a,b) => b.score - a.score);
  return { teams, players };
}

function emitLobby(room) {
  const data = {
    room: publicRoom(room),
    teams: scoreboard(room).teams,
    players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, team:p.team, score:p.score }))
  };
  io.to(room.code).emit('lobby-update', data);
}

function stopRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function finishGame(room) {
  stopRoomTimer(room);
  room.status = 'ended';
  const board = scoreboard(room);
  io.to(room.code).emit('game-ended', board);
  io.to(room.code).emit('score-update', board);
}

function startNextQuestion(room) {
  stopRoomTimer(room);
  room.currentIndex += 1;
  if (room.currentIndex >= room.questions.length) return finishGame(room);

  const q = room.questions[room.currentIndex];
  room.roundId += 1;
  room.answers = new Set();
  room.questionStartedAt = Date.now();
  room.status = 'playing';

  io.to(room.code).emit('question-start', {
    roundId: room.roundId,
    index: room.currentIndex,
    total: room.questions.length,
    prompt: q.prompt,
    options: q.options.map((text, originalIndex) => ({ text, originalIndex })),
    duration: q.duration || 12,
    startedAt: room.questionStartedAt
  });

  room.timer = setTimeout(() => {
    io.to(room.code).emit('question-finished', {
      index: room.currentIndex,
      correctIndex: q.correctIndex,
      correctText: q.options[q.correctIndex]
    });
    room.timer = setTimeout(() => startNextQuestion(room), 1800);
  }, (q.duration || 12) * 1000);
}

app.get('/api/server-info', (req, res) => {
  res.json({ lanIp: getLanIp(), port: PORT, publicOrigin: process.env.PUBLIC_ORIGIN || '' });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  try {
    const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 420 });
    res.json({ dataUrl });
  } catch (e) {
    res.status(400).json({ error: 'QR generation failed' });
  }
});

io.on('connection', socket => {
  socket.on('host-create-room', (payload, cb) => {
    try {
      const questions = Array.isArray(payload?.questions) ? payload.questions : [];
      if (!questions.length) return cb?.({ ok:false, error:'請先建立最少一條題目。' });
      const code = makeRoomCode();
      const room = {
        code,
        hostId: socket.id,
        questions,
        teamNames: Array.isArray(payload.teamNames) && payload.teamNames.length === 4 ? payload.teamNames : ['翡翠陣營','金羽陣營','蒼藍陣營','赤金陣營'],
        maxPlayers: 30,
        players: new Map(),
        status: 'lobby',
        currentIndex: -1,
        roundId: 0,
        questionStartedAt: 0,
        answers: new Set(),
        timer: null
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.role = 'host';
      socket.data.roomCode = code;
      cb?.({ ok:true, room: publicRoom(room) });
      emitLobby(room);
    } catch (e) {
      cb?.({ ok:false, error:'建立房間失敗。' });
    }
  });

  socket.on('host-update-questions', ({ roomCode, questions }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return cb?.({ok:false,error:'房間不存在或你不是主持人。'});
    if (room.status === 'playing') return cb?.({ok:false,error:'遊戲進行中不能更換題目。'});
    room.questions = Array.isArray(questions) ? questions : room.questions;
    room.currentIndex = -1;
    cb?.({ok:true});
    emitLobby(room);
  });

  socket.on('host-update-teams', ({ roomCode, teamNames }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return cb?.({ok:false,error:'房間不存在或你不是主持人。'});
    if (Array.isArray(teamNames) && teamNames.length === 4) room.teamNames = teamNames.map(x => String(x).slice(0,20));
    cb?.({ok:true});
    emitLobby(room);
  });

  socket.on('student-join', ({ roomCode, name, team }, cb) => {
    roomCode = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return cb?.({ok:false,error:'找不到房間，請檢查房間碼。'});
    if (room.status === 'playing') return cb?.({ok:false,error:'遊戲已開始，請等下一局。'});
    if (room.players.size >= room.maxPlayers) return cb?.({ok:false,error:'房間已滿（最多30人）。'});
    if (![0,1,2,3].includes(Number(team))) return cb?.({ok:false,error:'請選擇陣營。'});
    const safeName = String(name || '').trim().slice(0,18);
    if (!safeName) return cb?.({ok:false,error:'請輸入姓名。'});

    const player = { id: socket.id, name: safeName, team:Number(team), score:0, combo:0 };
    room.players.set(socket.id, player);
    socket.join(roomCode);
    socket.data.role = 'student';
    socket.data.roomCode = roomCode;
    cb?.({ok:true, room: publicRoom(room), player});
    emitLobby(room);
  });

  socket.on('student-change-team', ({ roomCode, team }, cb) => {
    const room = rooms.get(roomCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || room.status !== 'lobby') return cb?.({ok:false});
    if (![0,1,2,3].includes(Number(team))) return cb?.({ok:false});
    p.team = Number(team);
    cb?.({ok:true});
    emitLobby(room);
  });

  socket.on('host-start-game', ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return cb?.({ok:false,error:'房間不存在。'});
    if (!room.questions.length) return cb?.({ok:false,error:'沒有題目。'});
    if (!room.players.size) return cb?.({ok:false,error:'暫時沒有學生加入。'});
    stopRoomTimer(room);
    room.currentIndex = -1;
    room.roundId = 0;
    room.players.forEach(p => { p.score = 0; p.combo = 0; });
    room.status = 'countdown';
    io.to(room.code).emit('game-countdown', { seconds: 3 });
    cb?.({ok:true});
    room.timer = setTimeout(() => startNextQuestion(room), 3000);
  });

  socket.on('host-reset-lobby', ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return cb?.({ok:false});
    stopRoomTimer(room);
    room.status = 'lobby';
    room.currentIndex = -1;
    room.roundId = 0;
    room.players.forEach(p => { p.score = 0; p.combo = 0; });
    io.to(room.code).emit('return-lobby');
    emitLobby(room);
    cb?.({ok:true});
  });

  socket.on('student-answer', ({ roomCode, roundId, originalIndex }, cb) => {
    const room = rooms.get(roomCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || room.status !== 'playing') return cb?.({ok:false,error:'目前不能作答。'});
    if (roundId !== room.roundId) return cb?.({ok:false,error:'題目已更新。'});
    if (room.answers.has(socket.id)) return cb?.({ok:false,error:'你已經作答。'});
    room.answers.add(socket.id);

    const q = room.questions[room.currentIndex];
    const elapsed = Math.max(0, Date.now() - room.questionStartedAt);
    const durationMs = (q.duration || 12) * 1000;
    const remainingRatio = Math.max(0, 1 - elapsed / durationMs);
    const correct = Number(originalIndex) === Number(q.correctIndex);
    let delta = 0;
    if (correct) {
      p.combo += 1;
      const speedBonus = Math.round(100 * remainingRatio);
      const comboBonus = Math.min(60, Math.max(0, (p.combo - 1) * 10));
      delta = 100 + speedBonus + comboBonus;
    } else {
      p.combo = 0;
      delta = -25;
    }
    p.score = Math.max(0, p.score + delta);
    const result = {
      ok:true, correct, delta, score:p.score, combo:p.combo,
      correctIndex:q.correctIndex,
      correctText:q.options[q.correctIndex]
    };
    cb?.(result);
    socket.emit('answer-result', result);
    const board = scoreboard(room);
    io.to(room.code).emit('score-update', board);
    io.to(room.hostId).emit('answer-progress', { answered: room.answers.size, total: room.players.size });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.id === room.hostId) {
      stopRoomTimer(room);
      io.to(room.code).emit('room-closed');
      rooms.delete(room.code);
      return;
    }
    if (room.players.delete(socket.id)) emitLobby(room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLanIp();
  console.log('');
  console.log('==============================================');
  console.log(' 四陣營課堂競技平台 v2 雲端版已啟動');
  console.log(` 教師端：http://localhost:${PORT}/teacher.html`);
  const publicOrigin = process.env.PUBLIC_ORIGIN || '';
  if (publicOrigin) console.log(` 雲端網址：${publicOrigin}`);
  else console.log(` 本機測試學生端：http://${ip}:${PORT}/play.html`);
  console.log(' 雲端部署後，學生毋須與教師使用同一個 Wi‑Fi。');
  console.log('==============================================');
  console.log('');
});
