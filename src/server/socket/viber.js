/**
 * Viber Unified WebSocket Service
 * 统一 WebSocket 服务 - 整合所有实时通信
 * 
 * @phase 5
 * @module socket/viber
 */

import { verifyToken } from '../middleware/auth.js';

/**
 * Viber Socket Manager
 * 管理 Socket.io 连接和消息路由
 */
export class ViberSocketManager {
  constructor(io) {
    this.io = io;
    this.namespace = io.of('/viber');
    
    // 连接管理
    this.connections = new Map(); // socketId -> {userId, rooms, streams}
    
    // 处理器注册表
    this.handlers = new Map(); // messageType -> handler
    
    // 房间管理
    this.roomManager = new RoomManager(this.namespace);
    
    this.setupNamespace();
  }

  /**
   * 设置命名空间
   */
  setupNamespace() {
    this.namespace.use(this.authMiddleware.bind(this));
    
    this.namespace.on('connection', (socket) => {
      console.log(`[ViberSocket] Client connected: ${socket.id}, user: ${socket.userId}`);
      
      // 存储连接信息
      this.connections.set(socket.id, {
        userId: socket.userId,
        socket: socket,
        rooms: new Set(),
        streams: new Map(), // streamId -> streamInfo
        connectedAt: Date.now()
      });
      
      // 发送认证成功
      socket.emit('message', {
        type: 'auth:success',
        data: {
          userId: socket.userId,
          socketId: socket.id
        }
      });
      
      // 设置消息处理器
      this.setupMessageHandlers(socket);
      
      // 断开处理
      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket, reason);
      });
    });
    
    console.log('[ViberSocket] Namespace /viber initialized');
  }

  /**
   * 认证中间件
   */
  async authMiddleware(socket, next) {
    try {
      // 开发环境：允许无 token 连接
      if (process.env.NODE_ENV === 'development' && !process.env.REQUIRE_AUTH) {
        socket.userId = 'dev-user';
        socket.authenticated = true;
        return next();
      }
      
      // 从 handshake auth 或 query 获取 token
      const token = socket.handshake.auth?.token || 
                    socket.handshake.query?.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      // 验证 token
      const decoded = await verifyToken(token);
      if (!decoded) {
        return next(new Error('Invalid token'));
      }
      
      socket.userId = decoded.userId;
      socket.authenticated = true;
      next();
      
    } catch (error) {
      console.error('[ViberSocket] Auth error:', error.message);
      next(new Error('Authentication failed'));
    }
  }

  /**
   * 设置消息处理器
   */
  setupMessageHandlers(socket) {
    // 统一消息入口
    socket.on('message', async (payload) => {
      try {
        const { type, data, id } = payload;
        
        if (!type) {
          return this.sendError(socket, 'INVALID_MESSAGE', 'Message type is required', id);
        }
        
        console.log(`[ViberSocket] Received ${type} from ${socket.id}`);
        
        // 查找处理器
        const handler = this.handlers.get(type);
        if (handler) {
          await handler(socket, data, id);
        } else {
          console.warn(`[ViberSocket] No handler for type: ${type}`);
          this.sendError(socket, 'NOT_IMPLEMENTED', `Handler not implemented for ${type}`, id);
        }
        
      } catch (error) {
        console.error('[ViberSocket] Message handler error:', error);
        this.sendError(socket, 'INTERNAL_ERROR', error.message, payload?.id);
      }
    });
    
    // 向后兼容：处理旧版事件格式
    socket.on('voice:start', (data) => {
      const handler = this.handlers.get('voice:start');
      if (handler) handler(socket, data);
    });
    
    socket.on('voice:audio', (data) => {
      const handler = this.handlers.get('voice:audio');
      if (handler) handler(socket, data);
    });
    
    socket.on('voice:stop', (data) => {
      const handler = this.handlers.get('voice:stop');
      if (handler) handler(socket, data);
    });
    
    socket.on('chat:join', (data) => {
      const handler = this.handlers.get('room:join');
      if (handler) handler(socket, { room: `chat:${data}` });
    });
    
    socket.on('chat:leave', (data) => {
      const handler = this.handlers.get('room:leave');
      if (handler) handler(socket, { room: `chat:${data}` });
    });
  }

  /**
   * 注册消息处理器
   */
  registerHandler(messageType, handler) {
    this.handlers.set(messageType, handler);
    console.log(`[ViberSocket] Registered handler for ${messageType}`);
  }

  /**
   * 批量注册处理器
   */
  registerHandlers(handlers) {
    for (const [type, handler] of Object.entries(handlers)) {
      this.registerHandler(type, handler);
    }
  }

  /**
   * 处理断开连接
   */
  handleDisconnect(socket, reason) {
    console.log(`[ViberSocket] Client disconnected: ${socket.id}, reason: ${reason}`);
    
    const conn = this.connections.get(socket.id);
    if (conn) {
      // 清理房间
      conn.rooms.forEach(room => {
        socket.leave(room);
      });
      
      // 清理流
      conn.streams.forEach((streamInfo, streamId) => {
        // 通知流关闭
        this.emitToUser(socket.userId, {
          type: 'voice:stopped',
          data: { streamId, reason: 'disconnected' }
        });
      });
      
      this.connections.delete(socket.id);
    }
  }

  /**
   * 发送错误消息
   */
  sendError(socket, code, message, originalId) {
    socket.emit('message', {
      type: 'error',
      data: {
        code,
        message,
        context: { originalId }
      },
      timestamp: Date.now()
    });
  }

  /**
   * 发送消息给指定 socket
   */
  sendToSocket(socketId, message) {
    console.log(`[ViberSocket] sendToSocket to ${socketId}, type=${message?.type}`);
    const socket = this.namespace.sockets.get(socketId);
    if (socket) {
      const fullMessage = {
        ...message,
        timestamp: Date.now()
      };
      console.log(`[ViberSocket] Emitting message to socket ${socketId}`);
      socket.emit('message', fullMessage);
      return true;
    }
    console.log(`[ViberSocket] Socket ${socketId} not found!`);
    return false;
  }

  /**
   * 发送消息给用户（所有连接）
   */
  emitToUser(userId, message) {
    this.namespace.emit('message', {
      ...message,
      timestamp: Date.now()
    });
  }

  /**
   * 发送消息到房间
   */
  emitToRoom(room, message) {
    this.namespace.to(room).emit('message', {
      ...message,
      timestamp: Date.now()
    });
  }

  /**
   * 广播消息（除指定 socket）
   */
  broadcast(exceptSocketId, message) {
    this.namespace.except(exceptSocketId).emit('message', {
      ...message,
      timestamp: Date.now()
    });
  }

  /**
   * 获取连接统计
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      totalRooms: this.roomManager.getRoomCount(),
      activeStreams: Array.from(this.connections.values())
        .reduce((sum, conn) => sum + conn.streams.size, 0)
    };
  }
}

/**
 * 房间管理器
 */
class RoomManager {
  constructor(namespace) {
    this.namespace = namespace;
    this.rooms = new Map(); // roomName -> {members: Set, metadata: {}}
  }

  join(socket, roomName, metadata = {}) {
    socket.join(roomName);
    
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, {
        members: new Set(),
        metadata,
        createdAt: Date.now()
      });
    }
    
    const room = this.rooms.get(roomName);
    room.members.add(socket.id);
    
    // 更新连接信息
    const conn = socket.manager?.connections?.get(socket.id);
    if (conn) {
      conn.rooms.add(roomName);
    }
    
    return room.members.size;
  }

  leave(socket, roomName) {
    socket.leave(roomName);
    
    const room = this.rooms.get(roomName);
    if (room) {
      room.members.delete(socket.id);
      if (room.members.size === 0) {
        this.rooms.delete(roomName);
      }
    }
    
    // 更新连接信息
    const conn = socket.manager?.connections?.get(socket.id);
    if (conn) {
      conn.rooms.delete(roomName);
    }
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getRoomMembers(roomName) {
    const room = this.rooms.get(roomName);
    return room ? Array.from(room.members) : [];
  }
}

// 单例实例
let instance = null;

export function createViberSocketManager(io) {
  if (!instance) {
    instance = new ViberSocketManager(io);
  }
  return instance;
}

export function getViberSocketManager() {
  return instance;
}

export default ViberSocketManager;
