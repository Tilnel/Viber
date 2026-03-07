/**
 * Speech Detector Tests
 * 语音检测器单元测试
 * 
 * 使用方法：
 * cd src/server/services/detector && node test.js
 */

import {
  SpeechDetectorFactory,
  AudioContext,
  AudioChunk,
  AudioUtils,
  DetectorState
} from './types.js';
import './VolumeBasedSpeechDetector.js';

// 测试用音频数据生成器
class TestAudioGenerator {
  /**
   * 生成静音音频
   * @param {number} durationMs - 时长(ms)
   */
  static generateSilence(durationMs) {
    const samples = Math.floor(durationMs * 16); // 16 samples/ms @ 16kHz
    return Buffer.alloc(samples * 2, 0); // 16bit = 2 bytes
  }
  
  /**
   * 生成模拟语音音频（随机噪音模拟）
   * @param {number} durationMs 
   * @param {number} volume - 音量 0-1
   */
  static generateSpeech(durationMs, volume = 0.5) {
    const samples = Math.floor(durationMs * 16);
    const buffer = Buffer.alloc(samples * 2);
    
    for (let i = 0; i < samples; i++) {
      // 生成模拟语音波形（正弦波 + 噪音）
      const t = i / 16000;
      const freq = 200 + Math.sin(t * 10) * 100; // 200-300Hz 变化
      const amplitude = volume * 32767;
      const value = Math.sin(2 * Math.PI * freq * t) * amplitude;
      
      // 添加随机噪音
      const noise = (Math.random() - 0.5) * amplitude * 0.3;
      const sample = Math.max(-32768, Math.min(32767, Math.floor(value + noise)));
      
      buffer.writeInt16LE(sample, i * 2);
    }
    
    return buffer;
  }
  
  /**
   * 生成渐强音频（模拟语音开始）
   * @param {number} durationMs 
   */
  static generateRisingVolume(durationMs) {
    const samples = Math.floor(durationMs * 16);
    const buffer = Buffer.alloc(samples * 2);
    
    for (let i = 0; i < samples; i++) {
      const progress = i / samples;
      const volume = progress * 0.5; // 0 -> 0.5
      const amplitude = volume * 32767;
      const value = Math.sin(2 * Math.PI * 250 * (i / 16000)) * amplitude;
      
      buffer.writeInt16LE(Math.floor(value), i * 2);
    }
    
    return buffer;
  }
}

// 测试套件
class DetectorTestSuite {
  constructor() {
    this.results = [];
  }
  
  assert(condition, testName, details = {}) {
    const passed = !!condition;
    this.results.push({
      test: testName,
      passed,
      details
    });
    
    const icon = passed ? '✓' : '✗';
    console.log(`${icon} ${testName}`);
    if (!passed) {
      console.log('  Details:', details);
    }
  }
  
  summary() {
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    console.log('\n' + '='.repeat(50));
    console.log(`Test Summary: ${passed}/${total} passed`);
    console.log('='.repeat(50));
    
    return passed === total;
  }
}

// 运行测试
async function runTests() {
  console.log('Speech Detector Unit Tests\n');
  
  const tests = new DetectorTestSuite();
  
  // 测试 1: 音量计算
  console.log('--- AudioUtils Tests ---');
  {
    const silence = TestAudioGenerator.generateSilence(100);
    const volume = AudioUtils.calculateVolume(silence);
    tests.assert(volume < 0.001, 'Silence volume should be near zero', { volume });
    
    const speech = TestAudioGenerator.generateSpeech(100, 0.5);
    const speechVolume = AudioUtils.calculateVolume(speech);
    tests.assert(speechVolume > 0.1, 'Speech volume should be significant', { volume: speechVolume });
  }
  
  // 测试 2: AudioContext 基本功能
  console.log('\n--- AudioContext Tests ---');
  {
    const ctx = new AudioContext();
    
    // 添加静音分片
    for (let i = 0; i < 5; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSilence(100));
      chunk.volume = 0.001;
      ctx.addChunk(chunk);
    }
    
    tests.assert(ctx.currentVolume < 0.01, 'Context should track silence', {
      currentVolume: ctx.currentVolume
    });
    
    // 添加语音分片
    for (let i = 0; i < 5; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSpeech(100, 0.5));
      chunk.volume = 0.3;
      ctx.addChunk(chunk);
    }
    
    tests.assert(ctx.currentVolume > 0.1, 'Context should track speech', {
      currentVolume: ctx.currentVolume
    });
  }
  
  // 测试 3: VolumeBasedSpeechDetector - 静音检测
  console.log('\n--- VolumeBasedSpeechDetector Tests ---');
  {
    const detector = SpeechDetectorFactory.create('volume', {
      volumeThreshold: 0.05,
      minSpeechDuration: 300
    });
    
    const ctx = new AudioContext();
    
    // 模拟静音
    for (let i = 0; i < 10; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSilence(100));
      chunk.volume = 0.001;
      ctx.addChunk(chunk);
      
      const result = detector.detect(ctx);
      ctx.updateState(result.isSpeech, 100);
    }
    
    tests.assert(!detector._isSpeaking, 'Should not detect speech in silence', {
      state: detector._isSpeaking
    });
    
    detector.reset();
  }
  
  // 测试 4: VolumeBasedSpeechDetector - 语音检测
  {
    const detector = SpeechDetectorFactory.create('volume', {
      volumeThreshold: 0.1,
      minSpeechDuration: 300
    });
    
    const ctx = new AudioContext();
    
    // 模拟语音（超过 minSpeechDuration）
    for (let i = 0; i < 10; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSpeech(100, 0.5));
      chunk.volume = 0.3; // 大于阈值 0.1
      ctx.addChunk(chunk);
      
      const result = detector.detect(ctx);
      ctx.updateState(result.isSpeech, 100);
    }
    
    // 持续语音应该被检测到
    const finalResult = detector.detect(ctx);
    tests.assert(finalResult.isSpeech || detector._isSpeaking, 'Should detect speech', {
      result: finalResult,
      isSpeaking: detector._isSpeaking
    });
    
    detector.reset();
  }
  
  // 测试 5: 语音开始检测
  {
    const detector = SpeechDetectorFactory.create('volume', {
      volumeThreshold: 0.1,
      minSpeechDuration: 500
    });
    
    const ctx = new AudioContext();
    
    // 第一阶段：静音
    for (let i = 0; i < 3; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSilence(100));
      chunk.volume = 0.001;
      ctx.addChunk(chunk);
      detector.detect(ctx);
      ctx.updateState(false, 100);
    }
    
    // 第二阶段：语音开始（但不够长）
    let detectedStart = false;
    for (let i = 0; i < 3; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSpeech(100, 0.5));
      chunk.volume = 0.3;
      ctx.addChunk(chunk);
      const result = detector.detect(ctx);
      ctx.updateState(result.isSpeech, 100);
      
      if (result.isSpeech && result.reason === 'speech_start') {
        detectedStart = true;
      }
    }
    
    // 持续时间短，应该还没确认是语音开始
    tests.assert(!detectedStart || !detector._isSpeaking, 'Should not confirm speech too early', {
      detectedStart,
      speechDuration: ctx.speechDuration
    });
    
    detector.reset();
  }
  
  // 测试 6: 语音结束检测
  {
    const detector = SpeechDetectorFactory.create('volume', {
      volumeThreshold: 0.1,
      minSpeechDuration: 300,
      minSilenceDuration: 500
    });
    
    const ctx = new AudioContext();
    
    // 语音段
    for (let i = 0; i < 5; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSpeech(100, 0.5));
      chunk.volume = 0.3;
      ctx.addChunk(chunk);
      const result = detector.detect(ctx);
      ctx.updateState(result.isSpeech, 100);
    }
    
    tests.assert(detector._isSpeaking, 'Should be in speech state', {
      isSpeaking: detector._isSpeaking
    });
    
    // 静音段（超过 minSilenceDuration）
    let detectedEnd = false;
    for (let i = 0; i < 10; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSilence(100));
      chunk.volume = 0.001;
      ctx.addChunk(chunk);
      const result = detector.detect(ctx);
      ctx.updateState(result.isSpeech, 100);
      
      if (!result.isSpeech && result.reason === 'silence_timeout') {
        detectedEnd = true;
      }
    }
    
    tests.assert(!detector._isSpeaking, 'Should end speech after silence', {
      detectedEnd,
      silenceDuration: ctx.silenceDuration
    });
  }
  
  // 测试 7: 自适应阈值
  {
    const detector = SpeechDetectorFactory.create('volume', {
      volumeThreshold: 0.1,
      adaptiveThreshold: true,
      noiseAdaptationRate: 0.1
    });
    
    const ctx = new AudioContext();
    
    // 模拟高噪音环境
    for (let i = 0; i < 20; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSpeech(100, 0.1));
      chunk.volume = 0.1; // 相对较低的"噪音"
      ctx.addChunk(chunk);
      detector.detect(ctx);
    }
    
    // 噪音基底应该被拉高
    tests.assert(detector.config.noiseFloor > 0.01, 'Should adapt to noise floor', {
      noiseFloor: detector.config.noiseFloor,
      effectiveThreshold: detector._effectiveThreshold
    });
  }
  
  // 测试 8: EnergyBasedSpeechDetector
  console.log('\n--- EnergyBasedSpeechDetector Tests ---');
  {
    const detector = SpeechDetectorFactory.create('energy', {
      energyThreshold: 0.1,
      zcrThreshold: 0.2
    });
    
    const ctx = new AudioContext();
    
    // 模拟语音
    for (let i = 0; i < 10; i++) {
      const chunk = new AudioChunk(TestAudioGenerator.generateSpeech(100, 0.5));
      chunk.volume = 0.3;
      ctx.addChunk(chunk);
      const result = detector.detect(ctx);
    }
    
    // 能量检测器应该能检测到
    const result = detector.detect(ctx);
    tests.assert(result.isSpeech || detector._isSpeaking, 'Energy detector should work', {
      result,
      isSpeaking: detector._isSpeaking
    });
  }
  
  // 最终总结
  console.log('');
  const allPassed = tests.summary();
  process.exit(allPassed ? 0 : 1);
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

export { TestAudioGenerator, DetectorTestSuite, runTests };
