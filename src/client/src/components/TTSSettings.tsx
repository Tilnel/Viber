// TTSSettings - 简化版本（Piper TTS 使用默认设置）
interface TTSSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TTSSettings({ isOpen }: TTSSettingsProps) {
  // Piper TTS 使用默认配置，无需设置
  if (!isOpen) return null;
  return null;
}
