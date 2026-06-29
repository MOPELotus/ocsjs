import { splitAnswer, resolvePlainAnswer } from '../utils';
import { removeRedundant, answerNormalizedMatch, answerSimilar } from '../../utils/string';
import { StringUtils } from '../../../utils/string';

/** 单选题匹配结果 */
export interface SingleResolveResult {
	finish: boolean;
	option?: string;
	ratings?: number[];
	allAnswer?: string[];
	options?: string[];
}

/**
 * 单选题匹配算法（自适应）
 *
 * 三阶段自动匹配，无需手动选择模式：
 * 1. 归一化精确匹配 — 去除标点/空格/全角半角差异后精确比对
 * 2. 相似匹配 — 取所有选项中相似度最高且超过阈值的那个
 * 3. 纯ABCD答案兜底
 *
 * @param answers  所有题库返回的答案列表
 * @param options   选项文本列表
 * @param separators 答案分隔符
 */
export function resolveSingle(answers: string[], options: string[], separators?: string[]): SingleResolveResult {
	const allAnswer = answers.map((a) => splitAnswer(a, separators)).flat();
	const optionStrings = options.map(removeRedundant);

	// ========== 阶段1: 归一化精确匹配 ==========
	const normalizedResult = answerNormalizedMatch(allAnswer, optionStrings);
	if (normalizedResult.length) {
		const index = optionStrings.findIndex((opt) => opt === normalizedResult[0]);
		if (index !== -1) {
			return { finish: true, option: options[index] };
		}
	}

	// ========== 阶段2: 相似匹配（取最优） ==========
	const ratings = answerSimilar(allAnswer, optionStrings);

	let bestIndex = -1;
	let bestRating = 0;
	ratings.forEach((r, i) => {
		if (r.rating > bestRating) {
			bestRating = r.rating;
			bestIndex = i;
		}
	});

	if (bestIndex !== -1 && bestRating > 0.6) {
		return {
			finish: true,
			option: options[bestIndex],
			ratings: ratings.map((r) => r.rating)
		};
	}

	// ========== 阶段3: 纯ABCD答案兜底 ==========
	for (const answer of allAnswer) {
		const ans = resolvePlainAnswer(StringUtils.nowrap(answer, '').trim());
		// 单选仅允许单字母答案（多字母视为多选答案，不在此处理）
		if (ans && ans.length === 1) {
			const index = ans.charCodeAt(0) - 65;
			if (optionStrings[index] !== undefined) {
				return { finish: true, option: options[index] };
			}
		}
	}

	return { finish: false, allAnswer, options: optionStrings };
}
