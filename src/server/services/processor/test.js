/**
 * Thinking Processor Tests
 * 思考内容处理器单元测试
 * 
 * 使用方法：
 * cd src/server/services/processor && node test.js
 */

import {
  ThinkingProcessorFactory,
  ProcessResult,
  RuleBasedThinkingProcessor
} from './types.js';
import './KimiThinkingProcessor.js';

// 测试套件
class ProcessorTestSuite {
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

// 测试数据
const testCases = [
  {
    name: '简单思考',
    input: '让我看看这个文件的内容...',
    expectContains: ['我', '看看']
  },
  {
    name: '带 XML 标签',
    input: '<tool>read_file</tool><path>/src/main.js</path>让我读取这个文件',
    expectNotContains: ['<tool>', '<path>'],
    expectContains: ['读取', '文件']
  },
  {
    name: '带 Markdown',
    input: '我觉得应该用 **bold** 和 `code` 来强调',
    expectNotContains: ['**', '`'],
    expectContains: ['bold', 'code']
  },
  {
    name: '带代码块',
    input: '```javascript\nconst x = 1;\n```\n这行代码定义了一个变量',
    expectContains: ['代码', '变量'],
    expectNotContains: ['```']
  },
  {
    name: '第三人称转第一人称',
    input: 'AI 认为这个问题需要分步骤解决',
    expectContains: ['我觉得'],
    expectNotContains: ['AI 认为']
  },
  {
    name: '超长文本截断',
    input: '让我想想'.repeat(100), // 400 字
    expectCondition: (result) => result.processedText.length <= 250, // 200 + "..."
    expectContains: ['...']
  },
  {
    name: '空内容',
    input: '',
    expectEquals: ''
  },
  {
    name: '只有空白',
    input: '   \n\t  ',
    expectEquals: ''
  },
  {
    name: '复杂混合',
    input: `<tool>read_file</tool>
**分析中...**

\`\`\`typescript
function test() { return 1; }
\`\`\`

AI 认为这个函数需要优化。让我检查一下 <path>/src/test.ts</path>`,
    expectNotContains: ['<tool>', '<path>', '```', '**', 'AI 认为'],
    expectContains: ['函数', '优化', '我觉得', '检查']
  }
];

// 运行规则处理器测试
async function testRuleProcessor() {
  console.log('=== RuleBasedThinkingProcessor Tests ===\n');
  
  const tests = new ProcessorTestSuite();
  const processor = ThinkingProcessorFactory.create('rule', {
    filters: {
      removeMarkdown: true,
      removeCodeBlocks: true,
      removeXmlTags: true,
      maxLength: 200,
      truncationStrategy: 'tail'
    },
    enhancement: {
      convertToFirstPerson: true
    }
  });
  
  for (const testCase of testCases) {
    const result = await processor.clean(testCase.input);
    
    tests.assert(result.success, `${testCase.name}: should succeed`, {
      error: result.error
    });
    
    if (testCase.expectEquals !== undefined) {
      tests.assert(
        result.processedText === testCase.expectEquals,
        `${testCase.name}: exact match`,
        { expected: testCase.expectEquals, got: result.processedText }
      );
    }
    
    if (testCase.expectContains) {
      for (const expected of testCase.expectContains) {
        tests.assert(
          result.processedText.includes(expected),
          `${testCase.name}: should contain "${expected}"`,
          { result: result.processedText }
        );
      }
    }
    
    if (testCase.expectNotContains) {
      for (const notExpected of testCase.expectNotContains) {
        tests.assert(
          !result.processedText.includes(notExpected),
          `${testCase.name}: should NOT contain "${notExpected}"`,
          { result: result.processedText }
        );
      }
    }
    
    if (testCase.expectCondition) {
      tests.assert(
        testCase.expectCondition(result),
        `${testCase.name}: custom condition`,
        { result: result.processedText }
      );
    }
  }
  
  // 性能测试
  console.log('\n--- Performance Test ---');
  const iterations = 1000;
  const startTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    await processor.clean('让我看看 **这个** `代码` <tool>test</tool>');
  }
  
  const elapsed = Date.now() - startTime;
  const avgLatency = elapsed / iterations;
  
  console.log(`${iterations} iterations in ${elapsed}ms`);
  console.log(`Average latency: ${avgLatency.toFixed(3)}ms`);
  
  tests.assert(avgLatency < 1, 'Performance: avg latency < 1ms', { avgLatency });
  
  // 统计测试
  console.log('\n--- Stats Test ---');
  const stats = processor.getStats();
  console.log('Stats:', stats);
  
  tests.assert(stats.totalProcessed >= iterations, 'Stats: should track processed', stats);
  tests.assert(stats.avgLatency > 0, 'Stats: should track latency', stats);
  
  return tests.summary();
}

// 运行 Kimi 处理器测试（可选，需要 API key）
async function testKimiProcessor() {
  console.log('\n=== KimiThinkingProcessor Tests ===\n');
  
  if (!process.env.KIMI_API_KEY) {
    console.log('⚠ Skipping Kimi tests (KIMI_API_KEY not set)');
    return true;
  }
  
  const tests = new ProcessorTestSuite();
  
  try {
    const processor = ThinkingProcessorFactory.create('kimi', {
      model: {
        timeout: 10000
      }
    });
    
    // 预热
    console.log('Warming up...');
    await processor.warmup();
    
    // 基础测试
    const testCases = [
      '让我看看这个文件的内容',
      '<tool>read_file</tool>AI 认为需要优化',
      '```code```这个问题需要分步骤解决'
    ];
    
    for (const testCase of testCases) {
      const startTime = Date.now();
      const result = await processor.clean(testCase);
      const latency = Date.now() - startTime;
      
      tests.assert(result.success, `Should process: "${testCase.substring(0, 30)}..."`, {
        error: result.error,
        latency
      });
      
      tests.assert(result.processedText.length > 0, 'Should return non-empty result', {
        result: result.processedText
      });
      
      tests.assert(latency < 5000, 'Latency should be reasonable', { latency });
      
      console.log(`  Input: "${testCase.substring(0, 40)}..."`);
      console.log(`  Output: "${result.processedText.substring(0, 40)}..."`);
      console.log(`  Latency: ${latency}ms\n`);
    }
    
    // 缓存测试
    console.log('--- Cache Test ---');
    const testText = '这是一个测试文本用于缓存';
    
    const result1 = await processor.clean(testText);
    const result2 = await processor.clean(testText);
    
    tests.assert(result1.processedText === result2.processedText, 'Cache should return consistent result');
    tests.assert(result2.latency < result1.latency / 2, 'Cached result should be faster', {
      firstLatency: result1.latency,
      secondLatency: result2.latency
    });
    
  } catch (error) {
    tests.assert(false, 'Kimi processor should not throw', { error: error.message });
  }
  
  return tests.summary();
}

// 对比测试
async function testComparison() {
  console.log('\n=== Processor Comparison ===\n');
  
  const ruleProcessor = ThinkingProcessorFactory.create('rule');
  
  const testInputs = [
    '简单的思考',
    '<tool>test</tool>AI 认为需要修改',
    '```code```markdown **bold**',
    '让我检查一下这个函数的性能问题，可能需要优化'
  ];
  
  console.log('Input -> Rule Result');
  console.log('-'.repeat(60));
  
  for (const input of testInputs) {
    const ruleResult = await ruleProcessor.clean(input);
    
    console.log(`Input:    "${input.substring(0, 40)}${input.length > 40 ? '...' : ''}"`);
    console.log(`Rule:     "${ruleResult.processedText.substring(0, 40)}${ruleResult.processedText.length > 40 ? '...' : ''}"`);
    console.log(`Latency:  ${ruleResult.latency}ms`);
    console.log('');
  }
}

// 主运行函数
async function runAllTests() {
  console.log('Thinking Processor Unit Tests');
  console.log('=============================\n');
  
  const results = [];
  
  // 规则处理器测试（必跑）
  results.push(await testRuleProcessor());
  
  // Kimi 处理器测试（可选）
  results.push(await testKimiProcessor());
  
  // 对比测试
  await testComparison();
  
  // 最终总结
  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  
  if (results.every(r => r)) {
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed');
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

export { ProcessorTestSuite, testCases };
