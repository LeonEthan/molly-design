// Adapted from pi-ask-question 0.4.0 (MIT). See LICENSE and manifest.json.
// Only the dialog-backed question tool is selected; terminal UI and grill-me are omitted.
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

type Question = {
  id?: string;
  question: string;
  options?: string[];
  multiSelect?: boolean;
};

type NormalizedQuestion = {
  id: string;
  question: string;
  options: string[];
  multiSelect: boolean;
};

type Answer = {
  id: string;
  question: string;
  answer: string;
  wasCustom: boolean;
};

type AskQuestionDetails = {
  questions: NormalizedQuestion[];
  answers: Answer[];
  cancelled: boolean;
  timedOut: boolean;
};

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000;
const TIMEOUT_MESSAGE = "No answer was provided. Do not infer the user's choice or approval.";
const CUSTOM_OPTION = 'Type a custom answer';
const DONE_OPTION = 'Done selecting';

const QuestionSchema = Type.Object(
  {
    id: Type.Optional(
      Type.String({
        maxLength: 200,
        description: 'Stable answer id. Defaults to question_<n>; duplicates are auto-suffixed.',
      })
    ),
    question: Type.String({
      minLength: 1,
      maxLength: 8192,
      description: 'Question to ask the user.',
    }),
    options: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), {
        maxItems: 32,
        description: 'Choices, ordered from most recommended to least recommended.',
      })
    ),
    multiSelect: Type.Optional(
      Type.Boolean({
        description: 'Allow selecting more than one option for this question. Defaults to false.',
      })
    ),
  },
  { additionalProperties: false }
);

const AskQuestionParams = Type.Object(
  {
    question: Type.Optional(
      Type.String({ minLength: 1, maxLength: 8192, description: 'Single question to ask.' })
    ),
    options: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), {
        maxItems: 32,
        description: 'Choices, ordered from most recommended to least recommended.',
      })
    ),
    multiSelect: Type.Optional(
      Type.Boolean({
        description:
          'Allow selecting more than one option for the single question. Defaults to false.',
      })
    ),
    questions: Type.Optional(
      Type.Array(QuestionSchema, {
        maxItems: 8,
        description:
          'Ask several questions in order. When provided, takes precedence over the single-question fields.',
      })
    ),
  },
  { additionalProperties: false }
);

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function uniqueOptionLabel(label: string, options: string[]): string {
  let result = label;
  for (let suffix = 2; options.includes(result); suffix += 1) result = `${label} (${suffix})`;
  return result;
}

export function normalize(params: {
  question?: string;
  options?: string[];
  multiSelect?: boolean;
  questions?: Question[];
}): NormalizedQuestion[] {
  const raw = params.questions?.length
    ? params.questions
    : [
        {
          id: 'question_1',
          question: params.question ?? '',
          options: params.options,
          multiSelect: params.multiSelect,
        },
      ];

  const assigned = new Set<string>();
  const result: NormalizedQuestion[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const question = raw[index]!;
    const text = clean(question.question);
    if (!text) continue;

    const baseId = clean(question.id) ?? `question_${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (assigned.has(id)) {
      id = `${baseId}_${suffix}`;
      suffix += 1;
    }
    assigned.add(id);

    result.push({
      id,
      question: text,
      options: (question.options ?? [])
        .map(clean)
        .filter((option): option is string => Boolean(option)),
      multiSelect: question.multiSelect === true,
    });
  }

  return result;
}

function orderedAnswers(questions: NormalizedQuestion[], answers: Map<string, Answer>): Answer[] {
  return questions
    .map((question) => answers.get(question.id))
    .filter((answer): answer is Answer => Boolean(answer));
}

function summarize(
  questions: NormalizedQuestion[],
  answers: Map<string, Answer>,
  cancelled: boolean,
  timedOut: boolean
): string {
  if (timedOut)
    return [
      `Timed out after 5 minutes. ${TIMEOUT_MESSAGE}`,
      ...(answers.size
        ? [
            '',
            'Answers already provided:',
            ...orderedAnswers(questions, answers).map(
              (answer) => `- ${answer.id}: ${answer.answer}`
            ),
          ]
        : []),
    ].join('\n');
  if (cancelled) return 'User cancelled the question.';
  if (questions.length === 1)
    return `User answered: ${answers.get(questions[0]!.id)?.answer ?? 'unanswered'}`;
  return [
    'User answered:',
    ...questions.map(
      (question) => `- ${question.id}: ${answers.get(question.id)?.answer ?? 'unanswered'}`
    ),
  ].join('\n');
}

async function askWithDialogs(
  questions: NormalizedQuestion[],
  ui: ExtensionContext['ui'],
  signal?: AbortSignal
): Promise<{ answers: Answer[]; cancelled: boolean }> {
  const answers = new Map<string, Answer>();

  for (const question of questions) {
    if (signal?.aborted) return { answers: orderedAnswers(questions, answers), cancelled: true };
    const selected: string[] = [];
    const customOption = uniqueOptionLabel(CUSTOM_OPTION, question.options);
    const doneOption = uniqueOptionLabel(DONE_OPTION, question.options);

    while (true) {
      const choices = [
        ...question.options.filter((option) => !selected.includes(option)),
        customOption,
      ];
      if (question.multiSelect && selected.length) choices.push(doneOption);
      const choice = await ui.select(question.question, choices, { signal });
      if (signal?.aborted || choice === undefined)
        return { answers: orderedAnswers(questions, answers), cancelled: true };
      if (choice === doneOption) break;

      let answer = choice;
      let wasCustom = false;
      if (choice === customOption) {
        const input = await ui.input(question.question, 'Type your answer', { signal });
        if (signal?.aborted || input === undefined)
          return { answers: orderedAnswers(questions, answers), cancelled: true };
        const custom = clean(input);
        if (!custom) continue;
        answer = custom;
        wasCustom = true;
      }

      if (!selected.includes(answer)) selected.push(answer);
      answers.set(question.id, {
        id: question.id,
        question: question.question,
        answer: question.multiSelect ? selected.join(', ') : answer,
        wasCustom: question.multiSelect
          ? selected.some((selectedAnswer) => !question.options.includes(selectedAnswer))
          : wasCustom,
      });
      if (!question.multiSelect) break;
    }
  }

  return { answers: orderedAnswers(questions, answers), cancelled: false };
}

const askQuestionTool = defineTool({
  name: 'ask_question',
  label: 'Ask Question',
  description:
    'Ask the user one or more clarifying questions. Timeout or cancellation is not a user answer or approval.',
  promptSnippet: "Ask the user clarifying questions through pi's UI",
  promptGuidelines: [
    'For ask_question, list options from most recommended to least; the first option is the recommended choice, and do not label it as recommended.',
    'For ask_question, set multiSelect:true only when the user may need to choose more than one option.',
    'For ask_question, a typed custom-answer option is added automatically; do not include your own.',
  ],
  parameters: AskQuestionParams,
  executionMode: 'sequential',

  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const questions = normalize(params);
    if (!questions.length) throw new Error('ask_question needs either question or questions[].');
    if (!ctx.hasUI) throw new Error('ask_question needs Pi TUI or RPC UI support.');

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), QUESTION_TIMEOUT_MS);
    const questionSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      const result = await askWithDialogs(questions, ctx.ui, questionSignal);
      const answers = new Map(result.answers.map((answer) => [answer.id, answer]));
      const timedOut = result.cancelled && timeout.signal.aborted && !signal?.aborted;
      const cancelled = result.cancelled && !timedOut;

      return {
        content: [{ type: 'text', text: summarize(questions, answers, cancelled, timedOut) }],
        details: {
          questions,
          answers: result.answers,
          cancelled,
          timedOut,
        } satisfies AskQuestionDetails,
      };
    } finally {
      clearTimeout(timer);
    }
  },
});

export default function askQuestion(pi: Pick<ExtensionAPI, 'registerTool'>) {
  pi.registerTool(askQuestionTool);
}
