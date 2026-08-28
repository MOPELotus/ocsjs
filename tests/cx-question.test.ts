import {
	answerValueList,
	fillCXCompletionTarget,
	getCXAnswerCandidates,
	getCXCompletionTargets,
	getCXQuestionType,
	resolveCXQuestionType,
	findCXEditTrigger,
	isCXQuestionReadOnly
} from '../packages/scripts/src/projects/cx-question';

const browserEnv = require('browser-env');
browserEnv();

let passed = 0;

function equal(actual: unknown, expected: unknown, name: string) {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	if (left !== right) {
		throw new Error(`${name}: expected ${right}, received ${left}`);
	}
	passed++;
}

equal(getCXQuestionType(2), 'completion', 'type 2 fill blank');
equal(getCXQuestionType(4), 'shortanswer', 'type 4 short answer');
equal(getCXQuestionType(13), 'ordering', 'type 13 ordering');
equal(getCXQuestionType(16), 'shared_options', 'legacy type 16 shared options');
equal(getCXQuestionType(20), 'shared_options', 'type 20 shared options');
equal(getCXQuestionType(13, '【听力题】'), 'listening', 'visible label overrides legacy code');

const searchInfos = [
	{
		name: 'Responses',
		results: [{ question: 'q', answer: '[{"answer":"A"},{"answer":["B","D"]}]' }]
	}
];
const candidates = getCXAnswerCandidates(searchInfos);
equal(candidates, [[{ answer: 'A' }, { answer: ['B', 'D'] }]], 'compound JSON is preserved');
equal(answerValueList(candidates[0]), ['A', ['B', 'D']], 'compound answers keep child boundaries');

const shortAnswerRoot = document.createElement('div');
shortAnswerRoot.className = 'TiMu newTiMu';
shortAnswerRoot.setAttribute('data', '4');
shortAnswerRoot.innerHTML = `
	<ul class="Zy_ulTk">
		<li>
			<div class="edui-default">
				<div class="edui-editor edui-default">
					<div class="edui-editor-iframeholder"><iframe id="ueditor_0"></iframe></div>
				</div>
			</div>
			<textarea id="answer401848682" name="answer401848682" style="display:none"></textarea>
			<input type="hidden" id="answertype401848682" name="answertype401848682">
		</li>
	</ul>
`;
equal(
	resolveCXQuestionType(shortAnswerRoot, '简述钠离子依赖式主动转运方式，并举例说明。', ''),
	'shortanswer',
	'empty answertype falls back to TiMu data attribute'
);
shortAnswerRoot.setAttribute('data', '401848682');
equal(
	resolveCXQuestionType(shortAnswerRoot, '【简答题】简述钠离子依赖式主动转运方式，并举例说明。', ''),
	'shortanswer',
	'visible label overrides a question-id data attribute'
);
const shortAnswerTargets = getCXCompletionTargets(shortAnswerRoot);
equal(shortAnswerTargets.length, 1, 'UEditor iframe and backing textarea are one target');
equal(
	[shortAnswerTargets[0].querySelectorAll('iframe').length, shortAnswerTargets[0].querySelectorAll('textarea').length],
	[1, 1],
	'UEditor logical target contains both controls'
);
equal(fillCXCompletionTarget(shortAnswerTargets[0], '测试答案'), true, 'UEditor logical target can be filled');
equal(
	(shortAnswerRoot.querySelector('textarea') as HTMLTextAreaElement).value,
	'测试答案',
	'UEditor backing textarea receives the answer'
);

const readOnlyRoot = document.createElement('div');
readOnlyRoot.className = 'TiMu newTiMu';
readOnlyRoot.innerHTML = '<div class="Zy_TItle">简述题目</div><div class="newAnswerBx">我的答案：已有答案</div>';
equal(isCXQuestionReadOnly(readOnlyRoot), true, 'saved answer without editor is read-only');
equal(isCXQuestionReadOnly(shortAnswerRoot), false, 'UEditor answer remains editable');

const choiceRoot = document.createElement('div');
choiceRoot.className = 'TiMu';
choiceRoot.innerHTML = '<div>我的答案：A</div><label><input type="radio" name="choice"></label>';
equal(isCXQuestionReadOnly(choiceRoot), false, 'editable choice question is not read-only');

const editDocument = document.implementation.createHTMLDocument('chapter');
editDocument.body.innerHTML = '<a id="edit">修改答案</a>';
equal(findCXEditTrigger(editDocument)?.id, 'edit', 'find Chaoxing edit trigger');

console.log(`\n  ✅ ${passed} Chaoxing question-shape tests passed\n`);
