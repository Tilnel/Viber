/**
 * TTS 文本清洗工具
 * 将 Markdown 格式文本转换为适合语音朗读的纯文本
 */

export interface TextCleanOptions {
  /** 是否保留代码块提示（如"以下是代码"） */
  keepCodeHint?: boolean;
  /** 代码块提示文字 */
  codeHintText?: string;
  /** 是否保留链接 URL */
  keepLinkUrl?: boolean;
  /** 是否保留表情符号 */
  keepEmojis?: boolean;
  /** 最大处理长度（防止超长文本） */
  maxLength?: number;
}

const DEFAULT_OPTIONS: TextCleanOptions = {
  keepCodeHint: true,
  codeHintText: '【代码】',
  keepLinkUrl: false,
  keepEmojis: false,
  maxLength: 5000,
};

/**
 * 清洗文本，转换为适合 TTS 朗读的格式
 */
export function cleanTextForTTS(text: string, options: TextCleanOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (!text || text.trim().length === 0) {
    return '';
  }

  let cleaned = text;

  // 1. 处理代码块 (```language...```)
  cleaned = cleaned.replace(
    /```[\s\S]*?```/g, 
    opts.keepCodeHint ? ` ${opts.codeHintText} ` : ' '
  );

  // 2. 处理行内代码 (`code`)
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // 3. 处理 Markdown 标题 (# ## ###)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // 4. 处理粗体和斜体
  cleaned = cleaned.replace(/\*\*\*(.*?)\*\*\*/g, '$1');  // ***粗斜体***
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');      // **粗体**
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');          // *斜体*
  cleaned = cleaned.replace(/___(.*?)___/g, '$1');        // ___粗斜体___
  cleaned = cleaned.replace(/__(.*?)__/g, '$1');          // __粗体__
  cleaned = cleaned.replace(/_(.*?)_/g, '$1');            // _斜体_
  cleaned = cleaned.replace(/~~(.*?)~~/g, '$1');          // ~~删除线~~

  // 5. 处理链接 [text](url) -> text 或 text，链接是 url
  if (opts.keepLinkUrl) {
    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1，链接地址是 $2');
  } else {
    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  }

  // 6. 处理图片 ![alt](url) -> 【图片描述：alt】或删除
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, opts.keepCodeHint ? '【图片：$1】' : ' ');

  // 7. 处理表格
  cleaned = cleanTable(cleaned);

  // 8. 处理列表标记
  cleaned = cleaned.replace(/^[\s]*[-*+][\s]+/gm, '');     // 无序列表
  cleaned = cleaned.replace(/^[\s]*\d+\.[\s]+/gm, '');      // 有序列表
  cleaned = cleaned.replace(/^[\s]*>[\s]?/gm, '');          // 引用块

  // 9. 处理水平分隔线
  cleaned = cleaned.replace(/^[\s]*[-=*]{3,}[\s]*$/gm, '。');

  // 10. 处理 HTML 标签
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // 11. 处理特殊字符和符号
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&amp;/g, '和');
  cleaned = cleaned.replace(/&lt;/g, '小于');
  cleaned = cleaned.replace(/&gt;/g, '大于');
  cleaned = cleaned.replace(/&quot;/g, '"');

  // 12. 处理表情符号（可选）
  if (!opts.keepEmojis) {
    // 移除常见表情符号
    cleaned = cleaned.replace(
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
      ' '
    );
  }

  // 13. 清理多余空白
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');  // 多个空行合并为两个
  cleaned = cleaned.replace(/[ \t]+/g, ' ');      // 多个空格合并为一个
  cleaned = cleaned.replace(/\n +/g, '\n');       // 行首空格去掉
  cleaned = cleaned.trim();

  // 14. 处理数学公式块 ($$...$$)
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, '【数学公式】');
  cleaned = cleaned.replace(/\$([^$]+)\$/g, '$1');

  // 15. 处理脚注 [^1]
  cleaned = cleaned.replace(/\[\^(\d+)\]/g, '【脚注$1】');

  // 16. 处理任务列表 - [x] 或 - [ ]
  cleaned = cleaned.replace(/^\s*-\s*\[x\]\s*/gmi, '已完成：');
  cleaned = cleaned.replace(/^\s*-\s*\[\s*\]\s*/gmi, '待完成：');

  // 17. 处理转义字符
  cleaned = cleaned.replace(/\\([\[\]\(\)*_`~])/g, '$1');

  // 18. 限制长度
  if (opts.maxLength && cleaned.length > opts.maxLength) {
    cleaned = cleaned.substring(0, opts.maxLength) + '...（内容过长，已截断）';
  }

  return cleaned;
}

/**
 * 清洗表格内容
 */
function cleanTable(text: string): string {
  // 检测表格行 (| col1 | col2 |)
  const tableRegex = /(\|[^\n]+\|\n\|[-:|\s]+\|\n)(\|[^\n]+\|\n?)+/g;
  
  return text.replace(tableRegex, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 2) return match;

    // 提取表头
    const headers = lines[0]
      .split('|')
      .map(h => h.trim())
      .filter(h => h.length > 0);

    // 提取数据行（跳过表头和分隔线）
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length > 0);
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    // 转换为自然语言描述
    let description = '【表格】';
    rows.forEach((row, idx) => {
      description += `第${idx + 1}行：`;
      row.forEach((cell, cellIdx) => {
        const header = headers[cellIdx] || `第${cellIdx + 1}列`;
        description += `${header}是${cell}，`;
      });
      description = description.replace(/，$/, '；');
    });
    description += '【表格结束】';

    return description;
  });
}

/**
 * 智能分段清洗 - 适用于流式输出
 * 只清洗完整的句子或段落，避免清洗到未完成的 Markdown
 */
export function cleanTextForTTSStreaming(
  text: string, 
  isComplete: boolean = false,
  options: TextCleanOptions = {}
): string {
  // 如果是完整文本，直接清洗
  if (isComplete) {
    return cleanTextForTTS(text, options);
  }

  // 对于流式文本，检测是否有未闭合的 Markdown 标记
  let safeText = text;

  // 检查未闭合的代码块
  const codeBlockCount = (text.match(/```/g) || []).length;
  if (codeBlockCount % 2 === 1) {
    // 有未闭合的代码块，移除最后的 ``` 和之后的内容
    const lastIndex = text.lastIndexOf('```');
    safeText = text.substring(0, lastIndex) + (options.codeHintText || '【代码】');
  }

  // 检查未闭合的行内代码
  const inlineCodeCount = (text.match(/`/g) || []).length;
  if (inlineCodeCount % 2 === 1) {
    const lastIndex = text.lastIndexOf('`');
    safeText = text.substring(0, lastIndex);
  }

  // 检查未闭合的粗体/斜体（简化处理：如果最后有奇数个 * 或 _，移除最后一个）
  const starCount = (text.match(/\*/g) || []).length;
  const underscoreCount = (text.match(/_/g) || []).length;
  
  if (starCount % 2 === 1) {
    const lastIndex = text.lastIndexOf('*');
    safeText = text.substring(0, lastIndex) + text.substring(lastIndex + 1);
  }
  
  if (underscoreCount % 2 === 1) {
    const lastIndex = text.lastIndexOf('_');
    safeText = text.substring(0, lastIndex) + text.substring(lastIndex + 1);
  }

  return cleanTextForTTS(safeText, options);
}

/**
 * 提取适合朗读的文本段落（过滤掉纯代码、表格等）
 * 适用于只想朗读正文内容，跳过代码和表格的场景
 */
export function extractSpeakableText(text: string, options: TextCleanOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // 先进行完整清洗
  let cleaned = cleanTextForTTS(text, opts);

  // 按段落分割
  const paragraphs = cleaned.split('\n\n');
  
  // 过滤掉太短的段落（可能是残留的标记）
  const meaningfulParagraphs = paragraphs.filter(p => {
    const trimmed = p.trim();
    return trimmed.length > 5 && !trimmed.startsWith('【代码】');
  });

  return meaningfulParagraphs.join('\n\n');
}

/**
 * 检测文本是否主要是代码
 */
export function isMainlyCode(text: string): boolean {
  const codeBlockMatches = (text.match(/```[\s\S]*?```/g) || []).length;
  const inlineCodeMatches = (text.match(/`[^`]+`/g) || []).length;
  const totalLength = text.length;
  
  if (totalLength === 0) return false;
  
  // 估算代码字符数
  let codeLength = 0;
  const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
  codeBlocks.forEach(block => {
    codeLength += block.length;
  });
  
  const inlineCodes = text.match(/`[^`]+`/g) || [];
  inlineCodes.forEach(code => {
    codeLength += code.length;
  });

  return codeLength / totalLength > 0.5;  // 超过 50% 是代码
}
