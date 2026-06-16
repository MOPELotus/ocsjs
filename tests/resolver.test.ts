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
	a: string;
	opts: string[];
	expect: string;
}

interface MultipleCase {
	a: string;
	opts: string[];
	expect: string;
}

interface MultipleABCDCase {
	a: string;
	opts: string[];
	expect: string;
}

interface DisambiguationCase {
	a: string;
	opts: string[];
	expect: string;
}

interface JudgementCase {
	a: string;
	opts: string[];
	expect: string;
}

interface CompletionCase {
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
	console.log(`\n  ${title}`);
	return true;
}

function ok(actual: string, expected: string, info: string) {
	if (actual === expected) {
		pass++;
	} else {
		fail++;
		console.log(`    ❌ ${info}  结果=${JSON.stringify(actual)}`);
	}
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

function fmtOptCtx(c: { a: string; opts: string[] }) {
	return `答案=${JSON.stringify(c.a)}  选项=${JSON.stringify(c.opts)}`;
}

function fmtBlankCtx(c: { a: string; blanks: number }) {
	return `答案=${JSON.stringify(c.a)}  填空数=${c.blanks}`;
}

// ========== 单选题 ==========

if (section('单选题')) {
	for (const c of cases.single) {
		const r = resolveSingle(c.a.split(';'), c.opts);
		const actual = r.finish ? r.option ?? '' : '';
		ok(actual, c.expect, fmtOptCtx(c));
	}
}

// ========== 多选题 ==========

if (section('多选题')) {
	for (const c of cases.multiple) {
		const r = resolveMultiple([c.a], c.opts);
		const actual = r.finish ? (r.options ?? []).join(';') : '';
		ok(actual, c.expect, fmtOptCtx(c));
	}

	// ABCD 兜底
	for (const c of cases.multipleABCD) {
		const r = resolveMultiple([c.a], c.opts);
		const actual = r.finish ? (r.plainOptions ?? []).join(';') : '';
		ok(actual, c.expect, fmtOptCtx(c));
	}
}

// ========== 消歧 ==========

if (section('消歧')) {
	for (const c of cases.disambiguation) {
		const { opts: filteredOpts, ratings } = computeRatings(c.a, c.opts);
		const r = disambiguateSimilarOptions(filteredOpts, ratings);
		ok(r.join(';'), c.expect, fmtOptCtx(c));
	}
}

// ========== 判断题 ==========

if (section('判断题')) {
	for (const c of cases.judgement) {
		const r = resolveJudgement([[c.a]], c.opts);
		const actual = r.finish ? r.option ?? '' : '';
		ok(actual, c.expect, fmtOptCtx(c));
	}
}

// ========== 填空题 ==========

if (section('填空题')) {
	for (const c of cases.completion) {
		const r = resolveCompletion(
			c.a.split(' / ').map((s) => [s.trim()]),
			c.blanks
		);
		const actual = r.finish ? (r.answers ?? []).join(';') : '';
		ok(actual, c.expect, fmtBlankCtx(c));
	}
}

// ========== 结果 ==========

console.log(`\n  ✅ ${pass} 通过   ❌ ${fail} 失败   共 ${pass + fail} 项\n`);

if (fail > 0) process.exit(1);
