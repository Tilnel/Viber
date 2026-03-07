// Piper TTS - 本地神经网络语音合成
// https://github.com/rhasspy/piper

import { Router } from 'express';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const router = Router();

// Piper 配置 - 优先从环境变量读取
const PIPER_DIR = process.env.PIPER_DIR || '/opt/piper';
const PIPER_BIN = path.join(PIPER_DIR, 'piper');
const MODELS_DIR = path.join(PIPER_DIR, 'models');

// 默认模型 - 中文
const DEFAULT_MODEL = 'zh_CN-huayan-medium';

// 可用模型列表
const PIPER_MODELS = [
  { id: 'zh_CN-huayan-medium', desc: '华艳 (中文女声)', default: true },
  { id: 'zh_CN-huayan-x_low', desc: '华艳 - 低质量快速版' },
  { id: 'en_US-lessac-medium', desc: 'Lessac (英文女声)' },
  { id: 'en_US-amy-medium', desc: 'Amy (英文女声)' },
  { id: 'en_GB-southern_english_female-medium', desc: 'Southern English (英文女声)' },
];

// 检查 Piper 是否可用
function isPiperAvailable() {
  return existsSync(PIPER_BIN);
}

// 获取模型路径
function getModelPath(modelId) {
  return path.join(MODELS_DIR, `${modelId}.onnx`);
}

// 检查模型是否存在
function hasModel(modelId) {
  return existsSync(getModelPath(modelId));
}

// 获取语音列表
router.get('/voices', (req, res) => {
  console.log('[PiperTTS] PIPER_DIR:', PIPER_DIR);
  console.log('[PiperTTS] PIPER_BIN:', PIPER_BIN, 'exists:', isPiperAvailable());
  
  const available = PIPER_MODELS.map(m => ({
    ...m,
    available: hasModel(m.id),
  }));
  
  res.json({
    available,
    piperInstalled: isPiperAvailable(),
    modelsDir: MODELS_DIR,
  });
});

// 语音合成
router.post('/synthesize', async (req, res) => {
  console.log('[PiperTTS] Synthesize request received');
  
  try {
    const { text, model = DEFAULT_MODEL, speed = 1.0 } = req.body;

    if (!text) {
      console.log('[PiperTTS] Error: no text provided');
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log('[PiperTTS] Checking Piper installation...');
    if (!isPiperAvailable()) {
      console.log('[PiperTTS] Error: Piper not found at', PIPER_BIN);
      return res.status(503).json({ 
        error: 'Piper not installed',
        message: 'Please install Piper TTS',
        installUrl: 'https://github.com/rhasspy/piper/releases'
      });
    }

    if (!hasModel(model)) {
      console.log('[PiperTTS] Error: Model not found:', model);
      return res.status(404).json({
        error: 'Model not found',
        message: `Model ${model} not found. Please download it.`,
        downloadUrl: `https://huggingface.co/rhasspy/piper-voices/tree/main/zh/zh_CN/${model.split('-').slice(1).join('-')}`
      });
    }

    console.log(`[PiperTTS] Synthesizing (${model}):`, text.substring(0, 50) + '...');
    console.log('[PiperTTS] PIPER_BIN:', PIPER_BIN);
    console.log('[PiperTTS] Model path:', getModelPath(model));

    // 调用 Piper
    // 注意：Piper 从 stdin 读取文本，输出到 stdout（当 --output_file - 时）
    const args = [
      '--model', getModelPath(model),
      '--config', path.join(MODELS_DIR, `${model}.onnx.json`),
      '--output_file', '-', // 输出到 stdout
      '--length_scale', String(1.0 / speed), // 语速调整
    ];
    
    console.log('[PiperTTS] Spawning:', PIPER_BIN, args.join(' '));

    const piper = spawn(PIPER_BIN, args);
    const chunks = [];
    let stderrData = '';

    piper.stdout.on('data', (chunk) => {
      console.log('[PiperTTS] Received chunk:', chunk.length, 'bytes');
      chunks.push(chunk);
    });

    piper.stderr.on('data', (data) => {
      const str = data.toString();
      stderrData += str;
      console.log('[Piper stderr]', str.trim());
    });

    piper.on('error', (err) => {
      console.error('[PiperTTS] Spawn error:', err);
    });

    // 关键：向 Piper 的 stdin 写入文本，然后关闭 stdin
    console.log('[PiperTTS] Writing text to stdin...');
    piper.stdin.write(text + '\n');
    piper.stdin.end(); // 关闭 stdin，让 Piper 知道输入结束
    
    console.log('[PiperTTS] Waiting for Piper to complete...');
    
    const exitCode = await new Promise((resolve) => {
      piper.on('close', (code) => {
        console.log('[PiperTTS] Piper exited with code:', code);
        resolve(code);
      });
    });

    if (exitCode !== 0) {
      console.error('[PiperTTS] Piper failed:', exitCode, stderrData);
      return res.status(500).json({ 
        error: 'TTS synthesis failed', 
        message: `Piper exited with code ${exitCode}`,
        stderr: stderrData
      });
    }

    const audioBuffer = Buffer.concat(chunks);
    console.log('[PiperTTS] Generated audio:', audioBuffer.length, 'bytes');

    if (audioBuffer.length === 0) {
      console.error('[PiperTTS] Empty audio buffer!');
      return res.status(500).json({ error: 'Empty audio generated' });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', audioBuffer.length);
    console.log('[PiperTTS] Sending response...');
    res.send(audioBuffer);
    console.log('[PiperTTS] Response sent');

  } catch (error) {
    console.error('[PiperTTS] Error:', error);
    res.status(500).json({ error: 'TTS synthesis failed', message: error.message });
  }
});

export default router;
