/**
 * 测试 cleanTextForTTS 函数
 * 单独测试文本清洗功能
 */

import { spawn, execSync } from 'child_process';

// 缓存 kimi 路径
let kimiCliPath = null;

function findKimiCli() {
  if (kimiCliPath) return kimiCliPath;
  
  try {
    kimiCliPath = execSync('which kimi', { encoding: 'utf8' }).trim();
    console.log(`[Test] Found kimi at: ${kimiCliPath}`);
    return kimiCliPath;
  } catch (err) {
    console.error('[Test] Could not find kimi in PATH');
    const fallbacks = [
      process.env.KIMI_CLI_PATH,
      '/usr/local/bin/kimi',
      '/usr/bin/kimi',
      `${process.env.HOME}/.local/bin/kimi`,
      'kimi'
    ].filter(Boolean);
    
    for (const path of fallbacks) {
      try {
        execSync(`test -x "${path}"`, { encoding: 'utf8' });
        kimiCliPath = path;
        console.log(`[Test] Using fallback kimi at: ${kimiCliPath}`);
        return kimiCliPath;
      } catch {
        continue;
      }
    }
    
    kimiCliPath = 'kimi';
    return kimiCliPath;
  }
}

async function cleanTextForTTS(text) {
  console.log(`\n[Test] Input text (${text.length} chars):`);
  console.log(`  "${text.substring(0, 80)}..."`);
  
  const cleanPrompt = `你是一个文本清洗助手。将下面的文本转换为适合语音朗读的口语化版本。

规则：
- 删除所有 Markdown 符号：** * # - > | 等
- 代码改为一句话描述功能
- URL 替换为"链接"或删除
- 数字转中文读法：123→一百二十三，=→等于
- 表格转为文字描述
- 整体口语化，像演讲一样自然

重要：只输出清洗后的纯文本，不要解释，不要包含上面的规则说明。

待清洗文本：
${text}

清洗结果：
`;

  return new Promise((resolve, reject) => {
    const kimiPath = findKimiCli();
    const args = ['--print', '-p', cleanPrompt];
    
    console.log(`[Test] Running: ${kimiPath} --print -p <prompt>`);
    
    const kimiProcess = spawn(kimiPath, args, {
      env: { 
        ...process.env, 
        PYTHONUNBUFFERED: '1',
        KIMI_MODEL_NAME: 'kimi-k2-5-lite'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    kimiProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    kimiProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    kimiProcess.on('close', (code) => {
      console.log(`[Test] kimi-cli exited with code: ${code}`);
      
      if (code !== 0) {
        console.error(`[Test] Error: ${errorOutput}`);
        resolve(text);
        return;
      }
      
      console.log(`\n[Test] Raw output (${output.length} chars):`);
      console.log('---START---');
      console.log(output.substring(0, 500));
      console.log('---END---');
      
      // 解析 TextPart() 中的 text= 内容
      let cleaned = text;
      
      const textPartMatches = output.matchAll(/TextPart\([^)]*text='([^']*)'/g);
      const texts = [];
      for (const match of textPartMatches) {
        if (match[1] && match[1].trim()) {
          texts.push(match[1]);
        }
      }
      
      if (texts.length > 0) {
        cleaned = texts[texts.length - 1];
        cleaned = cleaned.replace(/\\n/g, '\n');
        console.log(`[Test] Extracted from TextPart, texts found: ${texts.length}`);
      } else {
        const simpleMatch = output.match(/text='([^']+)'/);
        if (simpleMatch) {
          cleaned = simpleMatch[1].replace(/\\n/g, '\n');
          console.log(`[Test] Extracted from simple match`);
        }
      }
      
      // 检查结果是否有效
      if (cleaned.includes('待清洗文本') || cleaned.includes('你是一个文本清洗') || cleaned.length > text.length * 3) {
        console.log(`[Test] Cleaned text invalid, using original`);
        cleaned = text;
      }
      
      console.log(`\n[Test] Cleaned result (${cleaned.length} chars):`);
      console.log(`  "${cleaned.substring(0, 80)}..."`);
      
      resolve(cleaned);
    });

    setTimeout(() => {
      kimiProcess.kill();
      console.log('[Test] Timeout (10s), using original');
      resolve(text);
    }, 30000);
  });
}

// 测试用例
const testCases = [
  {
    name: '简单文本',
    input: '你好，这是一个测试文本。'
  },
  {
    name: '带Markdown',
    input: '**粗体文本**和*斜体*，还有`代码片段`。'
  },
  {
    name: '长文本（玩机器）',
    input: '玩机器（Machine，本名刘亦博）是斗鱼平台顶级CS:GO解说，以其独特的"乘法口诀表"式连杀播报闻名，比如"二二得四，三四十二"。他因解说时爱用成语被封为"成语大师"，口头禅"让人不禁感叹"和各种造梗能力让他成为CS圈的顶流解说，江湖人称"北美第一突破口"、"石家庄shroud"。'
  },
  {
    name: '带URL',
    input: '请访问 https://example.com 获取更多信息。'
  },
  {
    name: '带数字',
    input: '温度是36.5度，价格是1234元，比例是1:2。'
  }
];

async function runTests() {
  console.log('========================================');
  console.log('  Testing cleanTextForTTS function');
  console.log('========================================\n');
  
  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Test: ${testCase.name}`);
    console.log('='.repeat(50));
    
    try {
      const result = await cleanTextForTTS(testCase.input);
      console.log(`\n✓ Test completed`);
    } catch (err) {
      console.error(`\n✗ Test failed:`, err.message);
    }
  }
  
  console.log('\n========================================');
  console.log('  All tests completed');
  console.log('========================================');
}

runTests();
