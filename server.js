// ==================== server.js ====================
// 音频直播服务器 - 完整代码（直接复制粘贴即可）

// 1. 引入需要的模块
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

// 2. 创建Express应用和HTTP服务器
const app = express();
const server = http.createServer(app);

// 3. 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 4. 存储所有连接的客户端
const clients = new Map(); // key: clientId, value: { ws, type, roomId, userName }
const rooms = new Map();   // key: roomId, value: [studentClientIds]

// 5. 设置静态文件目录（用于测试页面）
app.use(express.static(path.join(__dirname, 'public')));

// 6. 基础路由（测试用）
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>音频直播服务器</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .status { background: #e8f5e8; padding: 15px; border-radius: 5px; }
        .room { background: #f0f0f0; padding: 15px; margin: 10px 0; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>🎤 音频直播服务器运行中</h1>
      <div class="status">
        <p>✅ 服务器状态：正常运行</p>
        <p>📡 WebSocket地址：ws://localhost:3000</p>
        <p>📊 在线客户端：${clients.size} 个</p>
        <p>🏠 活跃房间：${rooms.size} 个</p>
      </div>
      <div class="room">
        <h3>测试连接：</h3>
        <p>1. 打开微信开发者工具</p>
        <p>2. 在小程序代码中连接：ws://localhost:3000</p>
        <p>3. 或者使用在线WebSocket测试工具</p>
      </div>
    </body>
    </html>
  `);
});

// 7. 获取服务器状态（API接口）
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: Date.now(),
    clients: clients.size,
    rooms: rooms.size,
    roomsInfo: Array.from(rooms.entries()).map(([roomId, students]) => ({
      roomId,
      studentCount: students.length,
      teacher: Array.from(clients.values()).find(c => c.type === 'teacher' && c.roomId === roomId)?.userName || '无'
    }))
  });
});

// 8. WebSocket连接处理
wss.on('connection', (ws, req) => {
  console.log('🟢 新的WebSocket连接建立');
  
  // 生成唯一客户端ID
  const clientId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  // 发送连接成功消息
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId,
    message: '连接服务器成功',
    timestamp: Date.now()
  }));
  
  // 监听客户端消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`📨 收到消息 [${data.type}] from ${clientId}`);
      
      switch (data.type) {
        case 'join':
          handleJoin(ws, clientId, data);
          break;
          
        case 'audio':
          handleAudioData(clientId, data);
          break;
          
        case 'chat':
          handleChatMessage(clientId, data);
          break;
          
        case 'ping':
          // 心跳检测
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }));
          break;
          
        case 'leave':
          handleLeave(clientId);
          break;
          
        default:
          console.log('未知消息类型:', data.type);
      }
    } catch (error) {
      console.error('❌ 消息解析错误:', error);
    }
  });
  
  // 连接关闭
  ws.on('close', () => {
    console.log(`🔴 连接关闭: ${clientId}`);
    handleLeave(clientId);
  });
  
  // 连接错误
  ws.on('error', (error) => {
    console.error(`❌ WebSocket错误 [${clientId}]:`, error);
    handleLeave(clientId);
  });
});

// 9. 处理加入房间
function handleJoin(ws, clientId, data) {
  const { userType, roomId, userName } = data;
  
  // 存储客户端信息
  clients.set(clientId, {
    ws,
    type: userType,
    roomId,
    userName: userName || (userType === 'teacher' ? '老师' : '学生')
  });
  
  // 初始化房间
  if (!rooms.has(roomId)) {
    rooms.set(roomId, []);
    console.log(`🏠 创建新房间: ${roomId}`);
  }
  
  const room = rooms.get(roomId);
  
  if (userType === 'teacher') {
    console.log(`👨‍🏫 教师 [${userName}] 加入房间 ${roomId}`);
    
    // 广播给房间内所有学生
    broadcastToRoom(roomId, {
      type: 'teacher_joined',
      teacherName: userName,
      roomId: roomId,
      timestamp: Date.now()
    });
    
  } else {
    // 学生加入
    room.push(clientId);
    console.log(`👨‍🎓 学生 [${userName}] 加入房间 ${roomId}，当前学生数: ${room.length}`);
    
    // 通知教师有新学生加入
    const teacher = Array.from(clients.values()).find(
      client => client.type === 'teacher' && client.roomId === roomId
    );
    
    if (teacher) {
      teacher.ws.send(JSON.stringify({
        type: 'student_joined',
        studentId: clientId,
        studentName: userName,
        roomId: roomId,
        timestamp: Date.now()
      }));
    }
    
    // 发送欢迎消息给学生
    ws.send(JSON.stringify({
      type: 'welcome',
      message: `欢迎加入课堂 ${roomId}`,
      roomInfo: {
        studentCount: room.length,
        teacherOnline: !!teacher,
        roomId: roomId
      },
      timestamp: Date.now()
    }));
  }
}

// 10. 处理音频数据
function handleAudioData(clientId, data) {
  const client = clients.get(clientId);
  if (!client || client.type !== 'teacher') return;
  
  const roomId = client.roomId;
  const room = rooms.get(roomId) || [];
  
  // 转发给房间内的所有学生
  room.forEach(studentId => {
    const student = clients.get(studentId);
    if (student && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(JSON.stringify({
        type: 'audio',
        data: data.audioData,
        timestamp: data.timestamp || Date.now(),
        sequence: data.sequence || 0
      }));
    }
  });
}

// 11. 处理聊天消息
function handleChatMessage(clientId, data) {
  const client = clients.get(clientId);
  if (!client) return;
  
  const messageData = {
    type: 'chat',
    senderId: clientId,
    senderName: client.userName,
    senderType: client.type,
    message: data.message,
    roomId: client.roomId,
    timestamp: Date.now()
  };
  
  // 广播给房间内所有人
  broadcastToRoom(client.roomId, messageData);
}

// 12. 处理离开房间
function handleLeave(clientId) {
  const client = clients.get(clientId);
  if (!client) return;
  
  const { roomId, type, userName } = client;
  
  // 从房间移除
  if (type === 'student') {
    const room = rooms.get(roomId);
    if (room) {
      const index = room.indexOf(clientId);
      if (index > -1) {
        room.splice(index, 1);
        console.log(`👋 学生 [${userName}] 离开房间 ${roomId}，剩余学生: ${room.length}`);
      }
    }
  }
  
  // 从客户端列表移除
  clients.delete(clientId);
  
  // 广播离开消息
  broadcastToRoom(roomId, {
    type: 'user_left',
    userId: clientId,
    userName: userName,
    userType: type,
    roomId: roomId,
    timestamp: Date.now()
  });
  
  // 如果房间空了，清理房间
  const room = rooms.get(roomId);
  if (room && room.length === 0) {
    const hasTeacher = Array.from(clients.values()).some(c => c.roomId === roomId && c.type === 'teacher');
    if (!hasTeacher) {
      rooms.delete(roomId);
      console.log(`🗑️ 清理空房间: ${roomId}`);
    }
  }
}

// 13. 广播消息到房间
function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId) || [];
  const teacher = Array.from(clients.values()).find(
    client => client.type === 'teacher' && client.roomId === roomId
  );
  
  // 发送给教师
  if (teacher && teacher.ws.readyState === WebSocket.OPEN) {
    teacher.ws.send(JSON.stringify(message));
  }
  
  // 发送给所有学生
  room.forEach(studentId => {
    const student = clients.get(studentId);
    if (student && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(JSON.stringify(message));
    }
  });
}

// 14. 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('========================================');
  console.log('🎉 音频直播服务器启动成功！');
  console.log(`📡 HTTP服务器: http://localhost:${PORT}`);
  console.log(`🔗 WebSocket服务器: ws://localhost:${PORT}`);
  console.log(`📊 状态接口: http://localhost:${PORT}/api/status`);
  console.log('========================================');
  console.log('💡 使用说明：');
  console.log('1. 教师端连接后发送 {"type":"join","userType":"teacher","roomId":"room1","userName":"张老师"}');
  console.log('2. 学生端连接后发送 {"type":"join","userType":"student","roomId":"room1","userName":"小明"}');
  console.log('3. 教师发送音频: {"type":"audio","audioData":"base64编码的音频数据"}');
  console.log('4. 发送聊天: {"type":"chat","message":"你好"}');
  console.log('========================================');
});

// 15. 优雅关闭
process.on('SIGINT', () => {
  console.log('🛑 正在关闭服务器...');
  
  // 关闭所有WebSocket连接
  wss.clients.forEach(client => {
    client.close();
  });
  
  wss.close(() => {
    server.close(() => {
      console.log('✅ 服务器已安全关闭');
      process.exit(0);
    });
  });
});