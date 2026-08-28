import {
	answerValueList,
	getCXAnswerCandidates,
	getCXQuestionType
} from '../packages/scripts/src/projects/cx-question';

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

console.log(`\n  ✅ ${passed} Chaoxing question-shape tests passed\n`);
