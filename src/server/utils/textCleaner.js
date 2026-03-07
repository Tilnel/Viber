// 文本清洗工具 - 用于TTS前的文本预处理
// 去除emoji、markdown标记、特殊字符等

/**
 * 清洗文本用于TTS
 * @param {string} text - 原始文本
 * @returns {string} 清洗后的文本
 */
const MAX_TTS_LENGTH = 500; // 留余量，确保不超过1024字节

export function cleanTextForTTS(text) {
  if (!text) return '';
  
  let cleaned = text;
  
  // 截断过长的文本
  if (cleaned.length > MAX_TTS_LENGTH) {
    cleaned = cleaned.substring(0, MAX_TTS_LENGTH) + '...（内容过长，仅朗读前段）';
  }
  
  // 1. 去除emoji
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // 表情符号
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // 符号和象形文字
  cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // 交通和地图符号
  cleaned = cleaned.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // 国旗
  cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, '');   // 杂项符号
  cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, '');   // 装饰符号
  
  // 2. 去除markdown标记
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');      // **粗体**
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');          // *斜体*
  cleaned = cleaned.replace(/`{3}[\s\S]*?`{3}/g, '');       // ```代码块```
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');            // `行内代码`
  cleaned = cleaned.replace(/#{1,6}\s+/g, '');              // # 标题
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [链接](url)
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');  // ![图片](url)
  cleaned = cleaned.replace(/>{1}\s+/g, '');                // > 引用
  
  // 3. 去除特殊字符和格式
  cleaned = cleaned.replace(/[*#_`~\[\]<>|]/g, '');         // 剩余markdown字符
  cleaned = cleaned.replace(/!\[\]/g, '');                   // 图片占位符
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');              // 多余空行
  
  // 4. 去除URL
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '链接');
  
  // 5. 去除多余的空白字符
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * 清洗文本，保留基本格式
 * @param {string} text - 原始文本
 * @returns {string} 清洗后的文本
 */
export function cleanTextForTTSStreaming(text) {
  return cleanTextForTTS(text);
}

export default { cleanTextForTTS, cleanTextForTTSStreaming };
