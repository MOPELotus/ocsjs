/**
 * 答题器匹配算法测试
 *
 * pnpm test                   运行全部
 * pnpm test -- --filter 单选  按关键词筛选
 * pnpm test -- --filter 多选
 * pnpm test -- --filter 消歧
 * pnpm test -- --filter 判断
 * pnpm test -- --filter 填空
 *
 * 用例维护：编辑 tests/cases.json 即可，无需改本文件
 */

import { resolveSingle } from '../packages/core/src/core/worker/resolvers/single';
import { resolveMultiple, disambiguateSimilarOptions } from '../packages/core/src/core/worker/resolvers/multiple';
import { resolveJudgement } from '../packages/core/src/core/worker/resolvers/judgement';
import { resolveCompletion } from '../packages/core/src/core/worker/resolvers/completion';
import { answerSimilar, removeRedundant } from '../packages/core/src/core/utils/string';
import _cases from './cases.json';
const cases = _cases as Cases;

// ========== JSON 类型声明 ==========

interface SingleCase {
	q: string;
	a: string;
	opts: string[];
	expect: string;
}

interface MultipleCase {
	q: string;
	a: string;
	opts: string[];
	expect: string;
}

interface MultipleABCDCase {
	q: string;
	a: string;
	opts: string[];
	expect: string;
}

interface DisambiguationCase {
	q: string;
	a: string;
	opts: string[];
	expect: string;
}

interface JudgementCase {
	q: string;
	a: string;
	opts: string[];
	expect: string;
}

interface CompletionCase {
	q: string;
	a: string;
	blanks: number;
	expect: string;
}

interface Cases {
	single: SingleCase[];
	multiple: MultipleCase[];
	multipleABCD: MultipleABCDCase[];
	disambiguation: DisambiguationCase[];
	judgement: JudgementCase[];
	completion: CompletionCase[];
}

// ========== 工具 ==========

let pass = 0;
let fail = 0;
const filter = process.argv.includes('--filter')
	? process.argv[process.argv.indexOf('--filter') + 1]?.toLowerCase()
	: undefined;

function section(title: string) {
	if (filter && !title.toLowerCase().includes(filter)) return false;
	console.log(`\n${'─'.repeat(60)}`);
	console.log(`  ${title}`);
	console.log('─'.repeat(60));
	return true;
}

function ok(actual: unknown, expected: unknown, label: string) {
	const isOk = actual === expected;
	if (isOk) pass++;
	else fail++;
	console.log(
		`    ${isOk ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${isOk ? '' : ` (期望 ${JSON.stringify(expected)})`}`
	);
}

/** 分号分隔的期望字符串 → 期望数组 */
function splitExpect(s: string) {
	return s
		.split(';')
		.map((o) => o.trim())
		.filter(Boolean);
}

/** 使用 answerSimilar 自动计算相似度评分，并过滤掉 ≤0.6 的选项（与 resolver pipeline 一致） */
function computeRatings(answer: string, options: string[]): { opts: string[]; ratings: number[] } {
	const answers = answer.split(';').map((a) => removeRedundant(a));
	const _options = options.map(removeRedundant);
	const raw = answerSimilar(answers, _options);
	const opts: string[] = [];
	const ratings: number[] = [];
	for (let i = 0; i < raw.length; i++) {
		if (raw[i].rating > 0.6) {
			opts.push(options[i]);
			ratings.push(raw[i].rating);
		}
	}
	return { opts, ratings };
}

// ========== 单选题 ==========

if (section('单选题')) {
	for (const c of cases.single) {
		console.log(`\n  题目：${c.q}`);
		console.log(`  答案：${c.a}`);
		console.log(`  选项：${c.opts.join('  ')}`);
		const r = resolveSingle(c.a.split(';'), c.opts);
		if (c.expect) {
			ok(r.finish, true, '匹配成功');
			ok(r.option, c.expect, `选中「${c.expect}」`);
		} else {
			ok(r.finish, false, '匹配失败');
		}
	}
}

// ========== 多选题 ==========

if (section('多选题')) {
	for (const c of cases.multiple) {
		console.log(`\n  题目：${c.q}`);
		console.log(`  答案：${c.a}`);
		console.log(`  选项：${c.opts.join('  ')}`);
		const expected = splitExpect(c.expect);
		const r = resolveMultiple([c.a], c.opts);
		ok(r.finish, true, '匹配成功');
		for (const e of expected) {
			ok(r.options?.includes(e), true, `包含「${e}」`);
		}
		for (const o of c.opts) {
			if (!expected.includes(o)) {
				ok(r.options?.includes(o), false, `不含「${o}」`);
			}
		}
	}

	// ABCD 兜底
	for (const c of cases.multipleABCD) {
		console.log(`\n  题目：${c.q}`);
		console.log(`  答案：${c.a}`);
		console.log(`  选项：${c.opts.join('  ')}`);
		const r = resolveMultiple([c.a], c.opts);
		ok(r.finish, true, '匹配成功');
		const expected = splitExpect(c.expect);
		for (const e of expected) {
			ok(r.plainOptions?.includes(e), true, `包含「${e}」`);
		}
	}
}

// ========== 消歧 ==========

if (section('消歧')) {
	for (const c of cases.disambiguation) {
		console.log(`\n  题目：${c.q}`);
		console.log(`  答案：${c.a}`);
		console.log(`  选项：${c.opts.join('  ')}`);
		const expected = splitExpect(c.expect);
		const { opts: filteredOpts, ratings } = computeRatings(c.a, c.opts);
		console.log(`  评分：${ratings.map((r) => r.toFixed(2)).join('  ')}`);
		const r = disambiguateSimilarOptions(filteredOpts, ratings);
		ok(r.length, expected.length, `保留 ${expected.length} 项`);
		for (const e of expected) {
			ok(r.includes(e), true, `包含「${e}」`);
		}
	}
}

// ========== 判断题 ==========

if (section('判断题')) {
	for (const c of cases.judgement) {
		console.log(`\n  题目：${c.q}`);
		console.log(`  答案：${c.a}`);
		console.log(`  选项：${c.opts.join('  ')}`);
		const r = resolveJudgement([[c.a]], c.opts);
		ok(r.finish, true, '匹配成功');
		ok(r.option, c.expect, `选中「${c.expect}」`);
	}
}

// ========== 填空题 ==========

if (section('填空题')) {
	for (const c of cases.completion) {
		console.log(`\n  题目：${c.q}`);
		console.log(`  答案：${c.a}`);
		console.log(`  填空数：${c.blanks}`);
		const expected = splitExpect(c.expect);
		const r = resolveCompletion(
			c.a.split(' / ').map((s) => [s.trim()]),
			c.blanks
		);
		if (expected.length) {
			ok(r.finish, true, '匹配成功');
			ok(r.answers?.length, expected.length, `填入 ${expected.length} 项`);
			for (let i = 0; i < expected.length; i++) {
				ok(r.answers?.[i], expected[i], `第${i + 1}项为「${expected[i]}」`);
			}
		} else {
			ok(r.finish, false, '匹配失败');
		}
	}
}

// ========== 结果 ==========

console.log(`\n${'═'.repeat(60)}`);
console.log(`  ✅ ${pass} 通过   ❌ ${fail} 失败   共 ${pass + fail} 项`);
console.log('═'.repeat(60));

if (fail > 0) process.exit(1);
