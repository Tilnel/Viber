// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { testConnection } from './db/index.js';
import { setupSocketHandlers } from './socket/index.js';
import { setupVolcanoSTTSocket } from './routes/volcanoSTT.js';
import { errorHandler } from './middleware/error.js';
import { authMiddleware } from './middleware/auth.js';

// Routes
import authRoutes from './routes/auth.js';
import fsRoutes from './routes/fs.js';
import ttsRoutes from './routes/tts.js';
import piperTTSRoutes from './routes/piperTTS.js';
import volcanoTTSRoutes from './routes/volcanoTTS.js';
import volcanoSTTRoutes from './routes/volcanoSTT.js';
import voiceRoutes from './routes/voice.js';
import projectRoutes from './routes/project.js';
import chatRoutes from './routes/chat.js';
import gitRoutes from './routes/git.js';
import settingsRoutes from './routes/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files (for production)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../dist')));
  
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist/index.html'));
  });
}

// Health check
app.get('/api/health', async (req, res) => {
  const dbConnected = await testConnection().catch(() => false);
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// API Routes - Auth (no middleware needed)
app.use('/api/auth', authRoutes);

// Protected API Routes
app.use('/api/fs', authMiddleware, fsRoutes);
app.use('/api/tts', authMiddleware, ttsRoutes);
app.use('/api/piper', authMiddleware, piperTTSRoutes);
app.use('/api/volcano/tts', authMiddleware, volcanoTTSRoutes);
app.use('/api/volcano/stt', authMiddleware, volcanoSTTRoutes);
app.use('/api/voice', authMiddleware, voiceRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/git', authMiddleware, gitRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);

// Socket.io setup
setupSocketHandlers(io);
setupVolcanoSTTSocket(io);

// Error handling
app.use(errorHandler);

// Start server
async function startServer() {
  console.log('🚀 Starting Kimi Code Web Assistant server...\n');
  
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.log('\n⚠️  Warning: Database not connected. Some features may not work.');
    console.log('Please run: npm run db:migrate\n');
  }

  httpServer.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${process.env.ROOT_DIR || '/path/to/your/code'}`);
    console.log(`\n📝 API endpoints:`);
    console.log(`   - GET  /api/health     - Health check`);
    console.log(`   - GET  /api/fs/list    - List directory`);
    console.log(`   - GET  /api/fs/read    - Read file`);
    console.log(`   - POST /api/fs/write   - Write file`);
    console.log(`   - GET  /api/projects   - List projects`);
    console.log(`   - POST /api/projects/open - Open project`);
    console.log(`\n🔌 WebSocket: ws://localhost:${PORT}`);
  });
}

startServer();
