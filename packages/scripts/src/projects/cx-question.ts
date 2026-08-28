import type { SearchInformation } from '../../../core/src/core/answer-wrapper/interface';

export type CXQuestionType =
	| 'single'
	| 'multiple'
	| 'judgement'
	| 'completion'
	| 'shortanswer'
	| 'calculation'
	| 'accounting'
	| 'composite'
	| 'matching'
	| 'ordering'
	| 'cloze'
	| 'reading'
	| 'listening'
	| 'shared_options'
	| 'evaluation'
	| 'poll'
	| 'oral'
	| 'oral_evaluation'
	| 'writing'
	| 'other'
	| 'unknown';

export interface CXSubquestion {
	id: string;
	index: number;
	type: CXQuestionType;
	title: string;
	options: string[];
}

export interface CXQuestionDetails {
	native_type: string;
	blank_count: number;
	underline_count: number;
	material: string;
	subquestions: CXSubquestion[];
	shared_options: string[];
	matching_groups: { left: string[]; right: string[] } | null;
}

const typeLabels: [RegExp, CXQuestionType][] = [
	[/共用选项/, 'shared_options'],
	[/阅读理解/, 'reading'],
	[/完形填空/, 'cloze'],
	[/连线|匹配/, 'matching'],
	[/排序/, 'ordering'],
	[/计算/, 'calculation'],
	[/分录/, 'accounting'],
	[/资料|复合/, 'composite'],
	[/写作/, 'writing'],
	[/口语测评/, 'oral_evaluation'],
	[/口语/, 'oral'],
	[/听力/, 'listening'],
	[/测评/, 'evaluation'],
	[/投票/, 'poll'],
	[/简答|名词解释|论述/, 'shortanswer'],
	[/填空/, 'completion'],
	[/判断/, 'judgement'],
	[/多选|不定项/, 'multiple'],
	[/单选/, 'single']
];

/**
 * Chaoxing native question codes used by the current work/exam pages.
 * Visible labels take precedence because older deployments reused a few
 * numeric codes for different experimental question families.
 */
export function getCXQuestionType(value: number, label = ''): CXQuestionType {
	const normalizedLabel = label.replace(/\s+/g, '');
	for (const [pattern, type] of typeLabels) {
		if (pattern.test(normalizedLabel)) return type;
	}

	return (
		({
			0: 'single',
			1: 'multiple',
			2: 'completion',
			3: 'judgement',
			4: 'shortanswer',
			5: 'shortanswer',
			6: 'shortanswer',
			7: 'calculation',
			8: 'other',
			9: 'accounting',
			10: 'composite',
			11: 'matching',
			12: 'poll',
			13: 'ordering',
			14: 'cloze',
			15: 'reading',
			16: 'shared_options',
			17: 'composite',
			18: 'oral',
			19: 'listening',
			20: 'shared_options',
			21: 'evaluation',
			22: 'oral_evaluation',
			26: 'writing'
		}[value] as CXQuestionType | undefined) || 'unknown'
	);
}

export function getCXNativeType(root: HTMLElement): string {
	const input = root.querySelector<HTMLInputElement>(
		'input[name^="answertype"],input[id^="answertype"],input[name^="type"]'
	);
	return String(
		input?.value || root.getAttribute('data-type') || (root.matches('.TiMu') ? root.getAttribute('data') : '') || ''
	).trim();
}

/** Prefer a non-empty explicit type, then fall back to the type stored on the question root. */
export function resolveCXQuestionType(
	root: HTMLElement,
	label = '',
	explicitNativeType: string | number | null | undefined = ''
): CXQuestionType {
	const nativeType = String(explicitNativeType ?? '').trim() || getCXNativeType(root);
	return getCXQuestionType(Number.parseInt(nativeType || '-1'), label);
}

function normalizeAnswerItem(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const item = value as Record<string, unknown>;
	for (const key of ['answer', 'answers', 'options', 'option', 'text', 'value', 'content']) {
		if (key in item) return item[key];
	}
	if ('pairs' in item) return item.pairs;
	return value;
}

function parseAnswer(value: string, separators: string[]): unknown {
	const text = value.trim();
	if (!text) return '';
	try {
		return normalizeAnswerItem(JSON.parse(text));
	} catch {}

	for (const separator of separators) {
		if (separator && text.includes(separator)) {
			return text
				.split(separator)
				.map((item) => item.trim())
				.filter(Boolean);
		}
	}
	return text;
}

/** Preserve nested answers for compound questions while still accepting old # separated banks. */
export function getCXAnswerCandidates(searchInfos: SearchInformation[], separators: string[] = []): unknown[] {
	const actualSeparators = separators.length ? separators : ['===', '###', '---', '#', '|', ';', '；'];
	return searchInfos.flatMap((info) =>
		info.results
			.map((result) => String(result.answer || '').trim())
			.filter(Boolean)
			.map((answer) => parseAnswer(answer, actualSeparators))
	);
}

export function answerValueList(value: unknown): unknown[] {
	const normalized = normalizeAnswerItem(value);
	if (Array.isArray(normalized)) return normalized.map(normalizeAnswerItem);
	if (normalized && typeof normalized === 'object') {
		const entries = Object.entries(normalized as Record<string, unknown>);
		return entries.map(([, item]) => normalizeAnswerItem(item));
	}
	return String(normalized || '').trim() ? [normalized] : [];
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
	return elements.filter((element, index) => elements.indexOf(element) === index);
}

const ueditorFrameSelector = 'iframe[id^="ueditor_"],.edui-editor iframe';
const ueditorTextareaSelector = 'textarea[id^="answer"],textarea[name^="answer"]';

/**
 * Chaoxing's UEditor exposes one visible iframe and one hidden answer textarea for
 * the same answer. Resolve both controls to their smallest shared wrapper so they
 * count as one logical blank instead of two.
 */
function getUEditorLogicalTarget(control: HTMLElement, root: HTMLElement): HTMLElement | undefined {
	const isEditorFrame =
		control.matches(ueditorFrameSelector) ||
		(control.matches('iframe') && !!control.closest('.edui-editor,.edui-editor-iframeholder'));
	const isBackingTextarea = control.matches(ueditorTextareaSelector);
	if (!isEditorFrame && !isBackingTextarea) return;

	let container = control.parentElement;
	while (container && root.contains(container)) {
		const frames = container.querySelectorAll(ueditorFrameSelector);
		const textareas = container.querySelectorAll(ueditorTextareaSelector);
		if (frames.length === 1 && textareas.length === 1) return container;
		if (container === root) break;
		container = container.parentElement;
	}
}

/** Return one target per visible/logical answer editor, not one target per nested iframe/textarea. */
export function getCXCompletionTargets(root: HTMLElement, configured: HTMLElement[] = []): HTMLElement[] {
	const controls = [
		...configured,
		...Array.from(
			root.querySelectorAll<HTMLElement>(
				'textarea,input[type="text"],input:not([type]),iframe,[contenteditable="true"],.textDIV,.eidtDiv,.editDiv'
			)
		)
	];
	const targets: HTMLElement[] = [];
	for (const control of controls) {
		const editorGroup = getUEditorLogicalTarget(control, root);
		if (editorGroup) {
			targets.push(editorGroup);
			continue;
		}
		const group = control.closest<HTMLElement>('.Briefanswer[data-itemid],.blankItem,.jdt,.textDIV,.eidtDiv,.editDiv');
		if (group && root.contains(group)) targets.push(group);
		else if (root.contains(control) || control === root) targets.push(control);
	}
	return uniqueElements(targets).filter(
		(target) =>
			target.matches(
				'textarea,input[type="text"],input:not([type]),iframe,[contenteditable="true"],.textDIV,.eidtDiv,.editDiv'
			) ||
			!!target.querySelector(
				'textarea,input[type="text"],input:not([type]),iframe,[contenteditable="true"],.textDIV,.eidtDiv,.editDiv'
			)
	);
}

const cxEditableControlSelector =
	'iframe[id^="ueditor_"],.edui-editor iframe,textarea[id^="answer"],textarea[name^="answer"],textarea:not([readonly]):not([disabled]),input[type="text"]:not([readonly]):not([disabled]),input:not([type]):not([readonly]):not([disabled]),select:not([disabled]),input[type="radio"]:not([disabled]),input[type="checkbox"]:not([disabled]),[contenteditable="true"]';

/**
 * A submitted chapter test is rendered as a saved-answer block. It has no writable
 * editor, but normally still exposes a global “修改答案” link in the frame document.
 * Keep this check conservative so a normal, blank question is never skipped.
 */
export function isCXQuestionReadOnly(root: HTMLElement): boolean {
	const text = root.innerText || root.textContent || '';
	if (!/(我的答案|已作答|已回答|参考答案|答案解析)/.test(text)) return false;
	return !hasCXEditableControls(root);
}

/** Detect controls that Chaoxing exposes only after entering answer-edit mode. */
export function hasCXEditableControls(root: HTMLElement): boolean {
	return !!root.querySelector(cxEditableControlSelector);
}

function dispatchValueEvent(target: EventTarget, type: string) {
	const document = target instanceof Node ? target.ownerDocument : undefined;
	const EventConstructor = document?.defaultView?.Event || Event;
	target.dispatchEvent(new EventConstructor(type, { bubbles: true }));
}

/** Fill both UEditor and its backing textarea so a later editor sync cannot erase the answer. */
export function fillCXCompletionTarget(target: HTMLElement, answer: string): boolean {
	let filled = false;
	const textarea = (
		target.matches('textarea,input[type="text"],input:not([type])')
			? [target]
			: Array.from(target.querySelectorAll<HTMLElement>('textarea,input[type="text"],input:not([type])'))
	) as (HTMLTextAreaElement | HTMLInputElement)[];

	const editorIndex = Number(
		target.getAttribute('data-editorindex') ||
			target.querySelector<HTMLElement>('[data-editorindex]')?.getAttribute('data-editorindex') ||
			textarea[0]?.getAttribute('step')
	);
	const editors = (target.ownerDocument.defaultView as any)?.editors || (globalThis as any).editors;
	const editor = Number.isFinite(editorIndex) ? editors?.[editorIndex]?.ueditor || editors?.[editorIndex] : undefined;
	if (editor?.setContent) {
		editor.setContent(answer);
		editor.fireEvent?.('contentChange');
		filled = true;
	}

	const frames = target.matches('iframe')
		? [target as HTMLIFrameElement]
		: Array.from(target.querySelectorAll<HTMLIFrameElement>('iframe'));
	for (const frame of frames) {
		const body = frame.contentDocument?.body;
		if (!body) continue;
		body.textContent = answer;
		dispatchValueEvent(body, 'input');
		dispatchValueEvent(body, 'change');
		filled = true;
	}

	const editables = target.matches('[contenteditable="true"]')
		? [target]
		: Array.from(target.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
	for (const editable of editables) {
		editable.textContent = answer;
		dispatchValueEvent(editable, 'input');
		dispatchValueEvent(editable, 'change');
		filled = true;
	}

	for (const control of textarea) {
		control.value = answer;
		dispatchValueEvent(control, 'input');
		dispatchValueEvent(control, 'change');
		filled = true;
	}
	if (!filled && target.matches('.textDIV,.eidtDiv,.editDiv')) {
		target.textContent = answer;
		dispatchValueEvent(target, 'input');
		dispatchValueEvent(target, 'change');
		filled = true;
	}
	return filled;
}

function cleanText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function directOptionText(element: HTMLElement, render: (element: HTMLElement) => string): string {
	return cleanText(render(element));
}

export function getCXQuestionDetails(
	root: HTMLElement,
	title: string,
	nativeType: string,
	render: (element: HTMLElement) => string
): CXQuestionDetails {
	const materials = Array.from(
		root.querySelectorAll<HTMLElement>('.material,.question-material,.case,[class*="material"]')
	)
		.map((element) => directOptionText(element, render))
		.filter((text, index, all) => !!text && text !== title && all.indexOf(text) === index);

	const expectedMatchingCount = root.querySelectorAll(
		'.thirdUlList .dept_select,.line_answer_ct .selectBox,.selLineList > li'
	).length;
	const matchingGroup = (primarySelector: string, fallbackSelector: string) => {
		const primary = Array.from(root.querySelectorAll<HTMLElement>(primarySelector));
		const nodes = primary.length ? primary : Array.from(root.querySelectorAll<HTMLElement>(fallbackSelector));
		const values = nodes.map((element) => directOptionText(element, render)).filter(Boolean);
		return primary.length && expectedMatchingCount && values.length === expectedMatchingCount + 1
			? values.slice(1)
			: values;
	};
	const first = matchingGroup('.firstUlList > li', '.answerList-line:first-of-type > li');
	const second = matchingGroup('.secondUlList > li', '.answerList-line:nth-of-type(2) > li');

	const sharedOptions = Array.from(
		root.ownerDocument.querySelectorAll<HTMLElement>(
			'.wordBank li,.word-bank li,.word_box li,.wordBox li,.wordsBox li,.optionBank li,.option-bank li,.sharedOptions li,.shared-options li'
		)
	)
		.filter((element) => !element.closest('.questionLi,.singleQuesId,.TiMu') || root.contains(element))
		.map((element) => directOptionText(element, render))
		.filter((text, index, all) => !!text && all.indexOf(text) === index);

	const subquestions: CXSubquestion[] = [];
	const childTypes = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="readCompreHension-childType"]'));
	for (let index = 0; index < childTypes.length; index++) {
		const typeInput = childTypes[index];
		const idInput = typeInput.nextElementSibling as HTMLInputElement | null;
		let container = idInput?.nextElementSibling as HTMLElement | null;
		while (container && container.tagName !== 'UL' && !container.matches('.reading_answer,.filling_answer')) {
			container = container.nextElementSibling as HTMLElement | null;
		}
		if (!container) continue;
		const promptNode = container.querySelector<HTMLElement>('.ignoreli .ans-cc,.ignoreli,.question-title,.title');
		const options = Array.from(container.querySelectorAll<HTMLElement>('li:not(.ignoreli),.answer_p,.option'))
			.map((element) => directOptionText(element, render))
			.filter(Boolean);
		subquestions.push({
			id: String(idInput?.value || index + 1),
			index: index + 1,
			type: getCXQuestionType(Number(typeInput.value), promptNode?.innerText || ''),
			title: promptNode ? directOptionText(promptNode, render) : `子题 ${index + 1}`,
			options
		});
	}

	if (subquestions.length === 0) {
		const groups = Array.from(
			root.querySelectorAll<HTMLElement>('.reading_answer,.filling_answer,.clozeBlank,.B-answerCon')
		);
		for (let index = 0; index < groups.length; index++) {
			const group = groups[index];
			const prompt = group.querySelector<HTMLElement>('.ans-cc,.question-title,.title,.ignoreli');
			const options = Array.from(
				group.querySelectorAll<HTMLElement>('span.saveSingleSelect,.choice,li:not(.ignoreli),span[data]')
			)
				.map((element) => directOptionText(element, render))
				.filter(Boolean);
			subquestions.push({
				id: String(group.getAttribute('data-itemid') || index + 1),
				index: index + 1,
				type: 'single',
				title: prompt ? directOptionText(prompt, render) : `子题 ${index + 1}`,
				options
			});
		}
	}

	return {
		native_type: nativeType,
		blank_count: Math.max((title.match(/\[BLANK_\d+\]/gi) || []).length, getCXCompletionTargets(root).length),
		underline_count: (title.match(/\[UNDERLINE\]/gi) || []).length,
		material: materials.join('\n'),
		subquestions,
		shared_options: sharedOptions,
		matching_groups: first.length && second.length ? { left: first, right: second } : null
	};
}

function normalizeComparable(value: unknown): string {
	return String(value || '')
		.replace(/^[A-Z0-9]+[.、:：)）\-\s]+/i, '')
		.replace(/[\s、,，;；:：.．()（）]/g, '')
		.toLocaleLowerCase();
}

/** Match by native value/letter first and visible option text second. */
export function clickCXChoice(container: HTMLElement, answer: unknown): boolean {
	const wanted = normalizeComparable(answer);
	if (!wanted) return false;
	const candidates = Array.from(
		container.querySelectorAll<HTMLElement>(
			'span.saveSingleSelect,[id-param],[val-param],[data-option],[data-value],[data-id],span[data],.selDiv span,.choice,li.single,li.mult,li.judge'
		)
	).filter((candidate) => !candidate.matches('.ignoreli'));
	const exact = candidates.find((candidate) => {
		const values = [
			candidate.getAttribute('data'),
			candidate.getAttribute('data-option'),
			candidate.getAttribute('data-value'),
			candidate.getAttribute('data-id'),
			candidate.getAttribute('id-param'),
			candidate.getAttribute('val-param'),
			candidate.querySelector<HTMLElement>('em')?.getAttribute('id-param'),
			candidate.querySelector<HTMLElement>('em')?.innerText,
			candidate.innerText
		];
		return values.some((value) => normalizeComparable(value) === wanted);
	});
	const similar =
		exact ||
		candidates.find((candidate) => {
			const text = normalizeComparable(candidate.innerText);
			return text && wanted.length >= 2 && (text.includes(wanted) || wanted.includes(text));
		});
	if (!similar) return false;
	similar.click();
	return true;
}
