import { useEffect, useRef, useState } from 'react';
import './VoiceVolumeVisualizer.css';

interface VoiceVolumeVisualizerProps {
  analyser: AnalyserNode | null;
  threshold: number;
  onThresholdChange: (threshold: number) => void;
  isActive: boolean;
}

export default function VoiceVolumeVisualizer({
  analyser,
  threshold,
  onThresholdChange,
  isActive
}: VoiceVolumeVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!analyser || !canvasRef.current || !isActive) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置 canvas 实际尺寸以匹配显示尺寸（高DPI支持）
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;
    
    // 实际绘制尺寸
    const drawWidth = rect.width;
    const drawHeight = rect.height;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      // 计算平均音量
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength / 255;
      setCurrentVolume(average);
      setIsSpeaking(average > threshold);

      // 清空画布
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, drawWidth, drawHeight);

      // 绘制阈值线
      const thresholdY = drawHeight - (threshold * drawHeight);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(drawWidth, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 绘制阈值标签
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '12px sans-serif';
      ctx.fillText(`阈值 ${(threshold * 100).toFixed(1)}%`, 5, thresholdY - 5);

      // 绘制频谱条（限制显示条数以避免过于密集）
      const maxBars = 64;
      const barWidth = (drawWidth / maxBars) * 0.8;
      const barGap = (drawWidth / maxBars) * 0.2;
      let barHeight;
      let x = 0;

      for (let i = 0; i < maxBars; i++) {
        // 采样频率数据
        const dataIndex = Math.floor((i / maxBars) * (bufferLength / 2));
        barHeight = (dataArray[dataIndex] / 255) * drawHeight;

        // 根据音量选择颜色
        const normalizedHeight = barHeight / drawHeight;
        if (normalizedHeight > threshold) {
          // 超过阈值 - 绿色
          const intensity = Math.min(1, (normalizedHeight - threshold) / (1 - threshold));
          ctx.fillStyle = `rgb(${100 - intensity * 100}, 255, ${100 - intensity * 100})`;
        } else {
          // 低于阈值 - 蓝色渐变
          ctx.fillStyle = `rgb(100, 150, ${200 + normalizedHeight * 55})`;
        }

        ctx.fillRect(x, drawHeight - barHeight, barWidth, barHeight);
        x += barWidth + barGap;
      }

      // 绘制当前音量数字
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      const volumeText = `${(average * 100).toFixed(1)}%`;
      ctx.fillText(volumeText, drawWidth - 60, 20);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, threshold, isActive]);

  if (!isActive) return null;

  return (
    <div className="voice-volume-visualizer">
      <div className="volume-header">
        <span className="volume-label">麦克风音量</span>
        <span className={`volume-status ${isSpeaking ? 'speaking' : ''}`}>
          {isSpeaking ? '🎤 检测到语音' : '🔇 静音'}
        </span>
      </div>
      
      <div className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={300}
          height={100}
          className="volume-canvas"
        />
      </div>
      
      <div className="threshold-control">
        <label htmlFor="threshold-slider">
          触发阈值: {(threshold * 100).toFixed(1)}%
        </label>
        <input
          id="threshold-slider"
          type="range"
          min="0.01"
          max="0.2"
          step="0.005"
          value={threshold}
          onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
          className="threshold-slider"
        />
        <div className="threshold-hints">
          <span>灵敏 (1%)</span>
          <span>适中 (5%)</span>
          <span>保守 (15%)</span>
        </div>
      </div>
      
      <div className="volume-tips">
        <p>💡 调节建议：</p>
        <ul>
          <li>红线是触发阈值，超过红线才会识别为说话</li>
          <li>如果误触发太多，调高阈值</li>
          <li>如果说话检测不到，调低阈值</li>
          <li>理想情况下，不说话时音量应低于红线</li>
        </ul>
      </div>
    </div>
  );
}
